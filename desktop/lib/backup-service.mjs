/** 独立的本机备份与隔离恢复；不读取应用配置，不打开正式数据库。 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const assetDirectories = ["attachments", "papers", "article-images"];
const verifiedSnapshots = new Map();
const databaseNamePattern = /^zhixu-(?:\d{4}-\d{2}-\d{2}|manual-[\dT-]+-[a-f0-9]+)\.db$/;
const fullNamePattern = /^zhixu-full-[\dT-]+-[a-f0-9]+$/;
const stamp = () => new Date().toISOString().replace(/[:.Z]/g, "-").replace(/-$/, "");
const nonce = () => crypto.randomBytes(5).toString("hex");

function directories(options) {
  if (!options?.dataDirectory) throw new Error("必须明确提供知识库数据目录。");
  const dataDirectory = path.resolve(options.dataDirectory);
  const backupDirectory = path.resolve(options.backupDirectory || path.join(dataDirectory, "backups"));
  if (assetDirectories.some((directory) => inside(canonicalPath(backupDirectory), canonicalPath(path.join(dataDirectory, directory))))) {
    throw new Error("备份目录不能放在原始附件或图片目录内。");
  }
  return { dataDirectory, backupDirectory };
}

function inside(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalPath(candidate) {
  let current = path.resolve(candidate);
  const suffix = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("无法解析目标目录。");
    suffix.unshift(path.basename(current));
    current = parent;
  }
  return path.resolve(fs.realpathSync(current), ...suffix);
}

function readLedger(backupDirectory) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(backupDirectory, ".backup-status.json"), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

function recordOperation(backupDirectory, operation, error = null) {
  // 错误记录本身失败不能覆盖原始错误，也不能影响已成功入库的资料。
  try {
    fs.mkdirSync(backupDirectory, { recursive: true });
    const ledger = readLedger(backupDirectory);
    ledger.errors = ledger.errors && typeof ledger.errors === "object" ? ledger.errors : {};
    ledger.errors[operation] = error ? {
      operation, message: String(error.message || error).slice(0, 2000), occurredAt: new Date().toISOString(),
    } : null;
    const temporary = path.join(backupDirectory, `.backup-status-${nonce()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), { flag: "wx" });
      fs.renameSync(temporary, path.join(backupDirectory, ".backup-status.json"));
    } finally { fs.rmSync(temporary, { force: true }); }
  } catch {}
}

function checkDatabase(databasePath, allowCached = false) {
  const stat = fs.statSync(databasePath, { bigint: true });
  if (!stat.isFile() || stat.size === 0n) throw new Error("数据库备份为空或不是普通文件。");
  const signature = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  if (allowCached && verifiedSnapshots.get(databasePath) === signature) return;
  const snapshot = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const checks = snapshot.prepare("PRAGMA quick_check").all();
    if (checks.length !== 1 || checks[0].quick_check !== "ok") throw new Error("数据库备份完整性检查失败。");
    if (snapshot.prepare("PRAGMA foreign_key_check").all().length > 0) throw new Error("数据库备份存在无效外键引用。");
  } finally { snapshot.close(); }
  verifiedSnapshots.set(databasePath, signature);
}

function vacuumInto(database, target) {
  database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}';`);
  checkDatabase(target);
}

function pruneDatabaseSnapshots(backupDirectory, retentionDays, preservedPath) {
  const parsedDays = Number(retentionDays);
  const days = Number.isFinite(parsedDays) ? Math.min(3650, Math.max(1, parsedDays)) : 30;
  const cutoff = Date.now() - days * 86400000;
  for (const entry of fs.readdirSync(backupDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !databaseNamePattern.test(entry.name)) continue;
    const candidate = path.join(backupDirectory, entry.name);
    if (candidate !== preservedPath && fs.statSync(candidate).mtimeMs < cutoff) {
      fs.rmSync(candidate);
      verifiedSnapshots.delete(candidate);
    }
  }
}

/** 每日快照可复用；手动快照总是反映本次调用时的已提交数据库。 */
export function createDatabaseSnapshot(database, options) {
  const { backupDirectory } = directories(options);
  const kind = options.kind || "daily";
  if (!["daily", "manual"].includes(kind)) throw new Error("不支持的数据库备份类型。");
  const date = new Date().toLocaleDateString("sv-SE");
  const name = kind === "daily" ? `zhixu-${date}.db` : `zhixu-manual-${stamp()}-${nonce()}.db`;
  const target = path.join(backupDirectory, name);
  const temporary = path.join(backupDirectory, `.${name}-${nonce()}.tmp`);
  try {
    fs.mkdirSync(backupDirectory, { recursive: true });
    if (kind === "daily" && fs.existsSync(target)) {
      try {
        checkDatabase(target, true);
        recordOperation(backupDirectory, "database");
        return target;
      } catch {
        // 保留异常旧文件供检查，只有新快照通过校验后才替换正式名称。
      }
    }
    vacuumInto(database, temporary);
    // 另一进程可能已发布当天快照；只复用已核验副本，不把有效副本当损坏文件移走。
    if (kind === "daily" && fs.existsSync(target)) {
      try {
        checkDatabase(target, true);
        recordOperation(backupDirectory, "database");
        return target;
      } catch {}
    }
    if (fs.existsSync(target)) fs.renameSync(target, `${target}.invalid-${stamp()}-${nonce()}`);
    fs.renameSync(temporary, target);
    checkDatabase(target, true);
    pruneDatabaseSnapshots(backupDirectory, options.retentionDays, target);
    recordOperation(backupDirectory, "database");
    return target;
  } catch (error) {
    recordOperation(backupDirectory, "database", error);
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
    verifiedSnapshots.delete(temporary);
  }
}

function readManifest(backupPath) {
  const manifest = JSON.parse(fs.readFileSync(path.join(backupPath, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.kind !== "zhixu-full-backup" || !Array.isArray(manifest.files)) {
    throw new Error("完整备份清单格式无效。");
  }
  const seen = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== "string" || file.path.includes("\\") || file.path.includes(":")) throw new Error("备份清单包含不安全路径。");
    const parts = file.path.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")
      || !(file.path === "zhixu.db" || (assetDirectories.includes(parts[0]) && parts.length > 1))) {
      throw new Error("备份清单包含越界或非资料文件。");
    }
    if (seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) throw new Error("备份清单校验字段无效。");
    seen.add(file.path);
  }
  if (!seen.has("zhixu.db")) throw new Error("完整备份缺少数据库快照。");
  return manifest;
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

async function enumerateFiles(root, relativeDirectory = "") {
  const result = [];
  const entries = await fs.promises.readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`资料目录包含符号链接，无法安全备份：${relative}`);
    if (entry.isDirectory()) result.push(...await enumerateFiles(root, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`资料目录包含不支持的文件类型：${relative}`);
  }
  return result;
}

function checkAttachmentReferences(backupPath, manifest) {
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const snapshot = new DatabaseSync(path.join(backupPath, "zhixu.db"), { readOnly: true });
  try {
    const hasDocuments = snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'").get();
    if (!hasDocuments) throw new Error("备份数据库缺少 documents 表。");
    for (const row of snapshot.prepare("SELECT stored_name, sha256, size_bytes FROM documents").all()) {
      if (typeof row.stored_name !== "string" || path.basename(row.stored_name) !== row.stored_name || /[\\/:]/.test(row.stored_name)) {
        throw new Error("数据库包含不安全的原始附件路径。");
      }
      const asset = files.get(`attachments/${row.stored_name}`);
      if (!asset) throw new Error(`数据库引用的原始附件缺失：${row.stored_name}`);
      if (asset.sha256 !== row.sha256 || asset.sizeBytes !== Number(row.size_bytes)) {
        throw new Error(`原始附件与数据库快照不一致，可能在备份时发生变化：${row.stored_name}`);
      }
    }
    // Notebook 内嵌图只有本地副本，不能像未缓存的远程图片一样容许遗漏。
    for (const [table, candidates] of [
      ["articles", ["content_html", "translated_html"]],
      ["papers", ["source_html", "full_translation_html"]],
    ]) {
      const columns = new Set(snapshot.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
      const selected = candidates.filter((column) => columns.has(column));
      if (selected.length === 0) continue;
      for (const row of snapshot.prepare(`SELECT ${selected.join(", ")} FROM ${table}`).all()) {
        for (const html of Object.values(row)) {
          for (const match of String(html || "").matchAll(/https:\/\/embedded\.zhixu\.invalid\/[a-f0-9]{64}\.(?:png|jpe?g|gif|webp)/g)) {
            const extension = path.extname(new URL(match[0]).pathname);
            const cacheHash = crypto.createHash("sha256").update(match[0]).digest("hex");
            const asset = files.get(`article-images/${cacheHash}${extension}`);
            if (!asset) throw new Error("正文引用的本地内嵌图片缺失，无法生成完整备份。");
            if (asset.sha256 !== path.basename(new URL(match[0]).pathname, extension)) {
              throw new Error("正文引用的本地内嵌图片内容已变化，无法生成完整备份。");
            }
          }
        }
      }
    }
  } finally { snapshot.close(); }
}

/** 只校验既有备份，不修改来源或执行恢复。 */
export async function verifyFullBackup(backupPath) {
  const root = canonicalPath(backupPath);
  const manifest = readManifest(root);
  let totalBytes = 0;
  for (const file of manifest.files) {
    const candidate = path.resolve(root, ...file.path.split("/"));
    if (!inside(candidate, root) || !inside(canonicalPath(candidate), root)) throw new Error("备份文件越过备份目录边界。");
    const stat = await fs.promises.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`备份文件不是普通文件：${file.path}`);
    const actual = await hashFile(candidate);
    if (actual.sizeBytes !== file.sizeBytes || actual.sha256 !== file.sha256) throw new Error(`备份文件校验失败：${file.path}`);
    totalBytes += actual.sizeBytes;
  }
  checkDatabase(path.join(root, "zhixu.db"));
  checkAttachmentReferences(root, manifest);
  return { valid: true, fileCount: manifest.files.length, totalBytes, verifiedAt: new Date().toISOString() };
}

/** SQLite 一致性快照加原始资产；全部验证通过后才发布为完整备份目录。 */
export async function createFullBackup(database, options) {
  const { dataDirectory, backupDirectory } = directories(options);
  const createdAt = new Date().toISOString();
  const name = `zhixu-full-${stamp()}-${nonce()}`;
  const target = path.join(backupDirectory, name);
  const temporary = path.join(backupDirectory, `.${name}.tmp`);
  let ownsTemporary = false;
  try {
    await fs.promises.mkdir(backupDirectory, { recursive: true });
    await fs.promises.mkdir(temporary);
    ownsTemporary = true;
    vacuumInto(database, path.join(temporary, "zhixu.db"));
    const files = [{ path: "zhixu.db", ...await hashFile(path.join(temporary, "zhixu.db")) }];
    for (const assetDirectory of assetDirectories) {
      const source = path.join(dataDirectory, assetDirectory);
      await fs.promises.mkdir(path.join(temporary, assetDirectory));
      if (!fs.existsSync(source)) continue;
      if (!inside(canonicalPath(source), canonicalPath(dataDirectory)) || fs.lstatSync(source).isSymbolicLink()) {
        throw new Error(`资料目录指向了知识库外部：${assetDirectory}`);
      }
      for (const relative of await enumerateFiles(source)) {
        const destination = path.join(temporary, assetDirectory, relative);
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.copyFile(path.join(source, relative), destination, fs.constants.COPYFILE_EXCL);
        files.push({ path: [assetDirectory, ...relative.split(path.sep)].join("/"), ...await hashFile(destination) });
      }
    }
    const manifest = { schemaVersion: 1, kind: "zhixu-full-backup", createdAt, files };
    await fs.promises.writeFile(path.join(temporary, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
    const verified = await verifyFullBackup(temporary);
    manifest.verifiedAt = verified.verifiedAt;
    await fs.promises.writeFile(path.join(temporary, "manifest.json"), JSON.stringify(manifest, null, 2));
    await fs.promises.rename(temporary, target);
    recordOperation(backupDirectory, "full");
    return { path: target, name, createdAt, fileCount: verified.fileCount, totalBytes: verified.totalBytes, verifiedAt: verified.verifiedAt };
  } catch (error) {
    recordOperation(backupDirectory, "full", error);
    throw error;
  } finally {
    // temporary 是本次调用以随机名创建的唯一目录，不接受外部清理目标。
    if (ownsTemporary) await fs.promises.rm(temporary, { recursive: true, force: true });
  }
}

/** 返回真实配置目录和已发布的备份状态；读取失败以状态展示。 */
export function getStorageStatus(options) {
  const { dataDirectory, backupDirectory } = directories(options);
  const result = {
    dataDirectory, databasePath: path.join(dataDirectory, "zhixu.db"),
    attachmentDirectory: path.join(dataDirectory, "attachments"), backupDirectory,
    latestDatabaseBackup: null, latestFullBackup: null, lastError: null,
  };
  try {
    if (!fs.existsSync(backupDirectory)) return result;
    const snapshots = [];
    const complete = [];
    for (const entry of fs.readdirSync(backupDirectory, { withFileTypes: true })) {
      const candidate = path.join(backupDirectory, entry.name);
      if (entry.isFile() && databaseNamePattern.test(entry.name)) {
        const stat = fs.statSync(candidate);
        snapshots.push({ path: candidate, name: entry.name, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size, kind: entry.name.startsWith("zhixu-manual-") ? "manual" : "daily" });
      } else if (entry.isDirectory() && fullNamePattern.test(entry.name)) {
        const manifest = readManifest(candidate);
        complete.push({ path: candidate, name: entry.name, createdAt: manifest.createdAt,
          fileCount: manifest.files.length, totalBytes: manifest.files.reduce((total, file) => total + file.sizeBytes, 0), verifiedAt: manifest.verifiedAt || null });
      }
    }
    result.latestDatabaseBackup = snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
    result.latestFullBackup = complete.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
    const errors = Object.values(readLedger(backupDirectory).errors || {}).filter(Boolean);
    result.lastError = errors.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))[0] || null;
  } catch (error) {
    result.lastError = { operation: "status", message: error.message, occurredAt: new Date().toISOString() };
  }
  return result;
}

/** 恢复演练仅接受明确独立的新目录/空目录，绝不覆盖正式知识库。 */
export async function restoreFullBackup(backupPath, targetDirectory, options) {
  const { dataDirectory } = directories(options);
  if (!targetDirectory) throw new Error("必须明确提供独立恢复目录。");
  const target = canonicalPath(targetDirectory);
  const production = canonicalPath(dataDirectory);
  const source = canonicalPath(backupPath);
  if (target === path.parse(target).root || inside(target, production) || inside(production, target)
    || inside(target, source) || inside(source, target)) throw new Error("恢复目录必须独立于正式知识库和备份目录。");
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length > 0)) {
    throw new Error("恢复目标已存在内容，拒绝覆盖。");
  }
  await verifyFullBackup(source);
  const manifest = readManifest(source);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temporary = await fs.promises.mkdtemp(path.join(path.dirname(target), ".zhixu-restore-"));
  try {
    for (const directory of assetDirectories) await fs.promises.mkdir(path.join(temporary, directory));
    for (const file of manifest.files) {
      const destination = path.join(temporary, ...file.path.split("/"));
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.copyFile(path.join(source, ...file.path.split("/")), destination, fs.constants.COPYFILE_EXCL);
    }
    await fs.promises.writeFile(path.join(temporary, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
    const verified = await verifyFullBackup(temporary);
    // rmdir 只移除仍为空的目录；若其他程序写入，恢复安全失败而不会覆盖。
    if (fs.existsSync(target)) await fs.promises.rmdir(target);
    await fs.promises.rename(temporary, target);
    return { path: target, verifiedAt: verified.verifiedAt, fileCount: verified.fileCount, totalBytes: verified.totalBytes };
  } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
}
