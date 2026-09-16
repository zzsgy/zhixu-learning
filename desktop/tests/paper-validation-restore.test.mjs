/** 论文人工校验元数据受控恢复脚本测试。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function createFixtureDatabase(filePath, rows) {
  const database = new DatabaseSync(filePath);
  database.exec(`
    CREATE TABLE papers (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, source_html TEXT NOT NULL,
      full_translation_html TEXT NOT NULL, full_translated_at TEXT, updated_at TEXT,
      source_structure_json TEXT NOT NULL, full_translation_structure_json TEXT NOT NULL,
      full_translation_fidelity TEXT NOT NULL, full_translation_fidelity_message TEXT,
      full_translation_validation_source TEXT NOT NULL DEFAULT 'legacy'
    )
  `);
  const insert = database.prepare("INSERT INTO papers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const row of rows) insert.run(...row);
  database.close();
}

test("恢复脚本只恢复元数据且正文不一致时整批拒绝", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-validation-restore-"));
  const backups = path.join(root, "backups");
  fs.mkdirSync(backups, { recursive: true });
  const currentPath = path.join(root, "zhixu.db");
  const snapshotPath = path.join(backups, "verified.db");
  const stable = ["paper-stable", "Stable", "<p>source</p>", "<p>translation</p>", "2026-09-01", "2026-09-02"];
  const mismatch = ["paper-mismatch", "Mismatch", "<p>old source</p>", "<p>translation</p>", "2026-09-01", "2026-09-02"];
  createFixtureDatabase(snapshotPath, [
    [...stable, '{"manual":true}', '{"verified":true}', "complete", "人工核验通过。", "legacy"],
    [...mismatch, '{"manual":true}', '{"verified":true}', "complete", "人工核验通过。", "legacy"],
  ]);
  createFixtureDatabase(currentPath, [
    [...stable, '{"auto":true}', '{"wrong":true}', "degraded", "错误降级。", "legacy"],
    [mismatch[0], mismatch[1], "<p>new source</p>", ...mismatch.slice(3), '{"auto":true}', '{"wrong":true}', "degraded", "错误降级。", "legacy"],
  ]);
  const run = (...ids) => spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      path.resolve(import.meta.dirname, "..", "scripts", "restore-paper-validation-metadata.mjs"),
      "--snapshot", snapshotPath,
      ...ids.flatMap((id) => ["--paper-id", id]),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ZHIXU_DATA_DIR: root, ZHIXU_ENV_FILE: path.join(root, "absent.env") },
    },
  );

  const refused = run("paper-stable", "paper-mismatch");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /正文与快照不一致/);
  let database = new DatabaseSync(currentPath, { readOnly: true });
  assert.equal(database.prepare("SELECT full_translation_fidelity FROM papers WHERE id='paper-stable'").get().full_translation_fidelity, "degraded");
  database.close();

  const restored = run("paper-stable");
  assert.equal(restored.status, 0, restored.stderr);
  database = new DatabaseSync(currentPath, { readOnly: true });
  const row = database.prepare("SELECT * FROM papers WHERE id='paper-stable'").get();
  database.close();
  assert.equal(row.source_html, stable[2]);
  assert.equal(row.full_translation_html, stable[3]);
  assert.equal(row.full_translated_at, stable[4]);
  assert.equal(row.updated_at, stable[5]);
  assert.equal(row.source_structure_json, '{"manual":true}');
  assert.equal(row.full_translation_structure_json, '{"verified":true}');
  assert.equal(row.full_translation_fidelity, "complete");
  assert.equal(row.full_translation_fidelity_message, "人工核验通过。");
  assert.equal(row.full_translation_validation_source, "manual");
  fs.rmSync(root, { recursive: true, force: true });
});
