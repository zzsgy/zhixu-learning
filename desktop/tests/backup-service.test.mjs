import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createDatabaseSnapshot, createFullBackup, getStorageStatus, restoreFullBackup, verifyFullBackup,
} from "../lib/backup-service.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhixu-backup-service-"));
  const dataDirectory = path.join(root, "data");
  const backupDirectory = path.join(dataDirectory, "backups");
  fs.mkdirSync(dataDirectory);
  for (const directory of ["attachments", "papers", "article-images", "work"]) {
    fs.mkdirSync(path.join(dataDirectory, directory));
  }
  const database = new DatabaseSync(path.join(dataDirectory, "zhixu.db"));
  database.exec("PRAGMA journal_mode = WAL; CREATE TABLE documents (id TEXT PRIMARY KEY, stored_name TEXT, sha256 TEXT, size_bytes INTEGER); CREATE TABLE notes(id INTEGER PRIMARY KEY, text TEXT);");
  database.prepare("INSERT INTO notes(text) VALUES (?)").run("first committed note");
  const options = { dataDirectory, backupDirectory, retentionDays: 30 };
  t.after(() => {
    database.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("zhixu-backup-service-"));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  function addAttachment(name = "document.txt", content = "original attachment") {
    const bytes = Buffer.from(content);
    fs.writeFileSync(path.join(dataDirectory, "attachments", name), bytes);
    database.prepare("INSERT INTO documents VALUES (?, ?, ?, ?)").run(
      name, name, crypto.createHash("sha256").update(bytes).digest("hex"), bytes.length,
    );
    return bytes;
  }
  return { root, database, options, dataDirectory, backupDirectory, addAttachment };
}

function noteCount(snapshotPath) {
  const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    assert.equal(snapshot.prepare("PRAGMA quick_check").get().quick_check, "ok");
    return snapshot.prepare("SELECT COUNT(*) AS n FROM notes").get().n;
  } finally { snapshot.close(); }
}

test("每日快照通过校验后复用，手动快照立即包含当天新增数据", (t) => {
  const app = fixture(t);
  const daily = createDatabaseSnapshot(app.database, app.options);
  assert.equal(noteCount(daily), 1);
  app.database.prepare("INSERT INTO notes(text) VALUES (?)").run("saved after daily snapshot");
  assert.equal(createDatabaseSnapshot(app.database, app.options), daily);
  assert.equal(noteCount(daily), 1);
  const manual = createDatabaseSnapshot(app.database, { ...app.options, kind: "manual" });
  const another = createDatabaseSnapshot(app.database, { ...app.options, kind: "manual" });
  assert.notEqual(manual, daily);
  assert.notEqual(another, manual);
  assert.equal(noteCount(manual), 2);
  const status = getStorageStatus(app.options);
  assert.equal(status.dataDirectory, app.dataDirectory);
  assert.equal(status.databasePath, path.join(app.dataDirectory, "zhixu.db"));
  assert.equal(status.latestDatabaseBackup.kind, "manual");
  assert.equal(status.lastError, null);
});

test("损坏的当天备份被保留供检查，并重新生成可用快照", (t) => {
  const app = fixture(t);
  const daily = createDatabaseSnapshot(app.database, app.options);
  fs.writeFileSync(daily, "interrupted or corrupt backup");
  assert.equal(createDatabaseSnapshot(app.database, app.options), daily);
  assert.equal(noteCount(daily), 1);
  const quarantined = fs.readdirSync(app.backupDirectory).filter((name) => name.includes(".invalid-"));
  assert.equal(quarantined.length, 1);
  assert.equal(fs.readFileSync(path.join(app.backupDirectory, quarantined[0]), "utf8"), "interrupted or corrupt backup");
});

test("创建失败不会发布半成品或清理旧快照，状态显示真实错误", (t) => {
  const app = fixture(t);
  const daily = createDatabaseSnapshot(app.database, app.options);
  const oldTime = new Date(Date.now() - 90 * 86400000);
  fs.utimesSync(daily, oldTime, oldTime);
  const brokenDatabase = { exec(sql) {
    const target = sql.match(/^VACUUM INTO '(.*)';$/)[1].replaceAll("''", "'");
    fs.writeFileSync(target, "partial database");
    throw new Error("injected snapshot disk failure");
  } };
  assert.throws(() => createDatabaseSnapshot(brokenDatabase, { ...app.options, kind: "manual" }), /injected snapshot disk failure/);
  assert.ok(fs.existsSync(daily), "新快照失败不能触发旧备份保留策略");
  assert.equal(fs.readdirSync(app.backupDirectory).filter((name) => name.endsWith(".tmp")).length, 0);
  assert.match(getStorageStatus(app.options).lastError.message, /injected snapshot disk failure/);
  const manual = createDatabaseSnapshot(app.database, { ...app.options, kind: "manual" });
  assert.ok(fs.existsSync(manual));
  assert.equal(fs.existsSync(daily), false, "新快照成功后才执行保留策略");
  assert.equal(getStorageStatus(app.options).lastError, null);
});

test("完整备份包含快照与原始资产，可在独立目录校验恢复且拒绝覆盖", async (t) => {
  const app = fixture(t);
  const attachment = app.addAttachment();
  fs.writeFileSync(path.join(app.dataDirectory, "papers", "paper.pdf"), "paper cached bytes");
  fs.writeFileSync(path.join(app.dataDirectory, "article-images", "image.png"), "only local image bytes");
  fs.writeFileSync(path.join(app.dataDirectory, ".env.local"), "PRIVATE_TEST_VALUE=must-not-copy");
  fs.writeFileSync(path.join(app.dataDirectory, "work", "pending.json"), "temporary processing state");
  createDatabaseSnapshot(app.database, app.options);
  const backup = await createFullBackup(app.database, app.options);
  const manifest = JSON.parse(fs.readFileSync(path.join(backup.path, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.files.map((file) => file.path).sort(), [
    "article-images/image.png", "attachments/document.txt", "papers/paper.pdf", "zhixu.db",
  ]);
  assert.equal(backup.fileCount, 4);
  assert.equal((await verifyFullBackup(backup.path)).valid, true);
  assert.equal(getStorageStatus(app.options).latestFullBackup.path, backup.path);

  const restoredPath = path.join(app.root, "isolated-restore");
  const restored = await restoreFullBackup(backup.path, restoredPath, app.options);
  assert.equal(restored.path, restoredPath);
  assert.equal(noteCount(path.join(restoredPath, "zhixu.db")), 1);
  assert.deepEqual(fs.readFileSync(path.join(restoredPath, "attachments", "document.txt")), attachment);
  assert.equal((await verifyFullBackup(restoredPath)).valid, true);
  await assert.rejects(restoreFullBackup(backup.path, restoredPath, app.options), /拒绝覆盖/);
  await assert.rejects(restoreFullBackup(backup.path, app.dataDirectory, app.options), /独立/);
  await assert.rejects(restoreFullBackup(backup.path, app.root, app.options), /独立/);
  await assert.rejects(restoreFullBackup(backup.path, path.join(backup.path, "nested"), app.options), /独立/);

  const emptyTarget = path.join(app.root, "existing-empty");
  fs.mkdirSync(emptyTarget);
  await restoreFullBackup(backup.path, emptyTarget, app.options);
  assert.equal(noteCount(path.join(emptyTarget, "zhixu.db")), 1);
  fs.appendFileSync(path.join(backup.path, "attachments", "document.txt"), "tampered");
  await assert.rejects(verifyFullBackup(backup.path), /校验失败/);
  await assert.rejects(restoreFullBackup(backup.path, path.join(app.root, "reject-corrupt"), app.options), /校验失败/);
  assert.equal(fs.existsSync(path.join(app.root, "reject-corrupt")), false);
});

test("原始附件丢失或与快照不一致时拒绝发布完整备份", async (t) => {
  const app = fixture(t);
  app.addAttachment();
  fs.writeFileSync(path.join(app.dataDirectory, "attachments", "document.txt"), "changed during backup");
  await assert.rejects(createFullBackup(app.database, app.options), /与数据库快照不一致/);
  assert.equal(getStorageStatus(app.options).latestFullBackup, null);
  assert.match(getStorageStatus(app.options).lastError.message, /与数据库快照不一致/);
  fs.rmSync(path.join(app.dataDirectory, "attachments", "document.txt"));
  await assert.rejects(createFullBackup(app.database, app.options), /原始附件缺失/);
  assert.equal(fs.readdirSync(app.backupDirectory).filter((name) => name.startsWith("zhixu-full-")).length, 0);
  assert.equal(fs.readdirSync(app.backupDirectory).filter((name) => name.endsWith(".tmp")).length, 0);
});

test("完整备份清单的越界路径不会在恢复时写到目标外", async (t) => {
  const app = fixture(t);
  app.addAttachment();
  const backup = await createFullBackup(app.database, app.options);
  const manifestPath = path.join(backup.path, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files[1].path = "../outside.txt";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  await assert.rejects(restoreFullBackup(backup.path, path.join(app.root, "safe-target"), app.options), /越界|不安全/);
  assert.equal(fs.existsSync(path.join(app.root, "outside.txt")), false);
});

test("Notebook 正文引用的内嵌图片必须存在并与内容哈希一致", async (t) => {
  const app = fixture(t);
  const image = Buffer.from("test embedded image bytes");
  const contentHash = crypto.createHash("sha256").update(image).digest("hex");
  const imageUrl = `https://embedded.zhixu.invalid/${contentHash}.png`;
  const cacheHash = crypto.createHash("sha256").update(imageUrl).digest("hex");
  app.database.exec("CREATE TABLE articles(content_html TEXT, translated_html TEXT)");
  app.database.prepare("INSERT INTO articles VALUES (?, '')").run(`<p><img src="${imageUrl}"></p>`);
  await assert.rejects(createFullBackup(app.database, app.options), /内嵌图片缺失/);
  const cachedImage = path.join(app.dataDirectory, "article-images", `${cacheHash}.png`);
  fs.writeFileSync(cachedImage, "incorrect image bytes");
  await assert.rejects(createFullBackup(app.database, app.options), /内嵌图片内容已变化/);
  fs.writeFileSync(cachedImage, image);
  const backup = await createFullBackup(app.database, app.options);
  assert.equal((await verifyFullBackup(backup.path)).valid, true);
});

test("备份目录不能嵌入原始资产目录，避免把备份递归复制进自身", (t) => {
  const app = fixture(t);
  assert.throws(() => createDatabaseSnapshot(app.database, {
    ...app.options, backupDirectory: path.join(app.dataDirectory, "attachments", "backups"),
  }), /不能放在原始附件/);
});
