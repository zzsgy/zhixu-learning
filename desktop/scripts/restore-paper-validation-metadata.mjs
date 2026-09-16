/**
 * 从已核验数据库快照恢复指定论文的结构校验元数据。
 *
 * 安全边界：只在原文、译文及两个时间戳与快照完全一致时提交；不修改
 * 论文正文、译文、标题、阅读数据或更新时间。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { backupDirectory, databasePath } from "../lib/config.mjs";

function readArguments(argv) {
  let snapshot = "";
  const paperIds = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--snapshot") snapshot = argv[++index] || "";
    else if (argv[index] === "--paper-id") paperIds.push(argv[++index] || "");
    else throw new Error(`不支持的参数：${argv[index]}`);
  }
  const normalizedIds = [...new Set(paperIds.map((value) => value.trim()).filter(Boolean))];
  if (!snapshot || !normalizedIds.length) {
    throw new Error("必须提供 --snapshot 和至少一个 --paper-id。");
  }
  return { snapshot, paperIds: normalizedIds };
}

function resolveSnapshot(snapshot) {
  const candidate = path.resolve(snapshot);
  const relative = path.relative(path.resolve(backupDirectory), candidate);
  if (
    !relative
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || path.extname(candidate).toLowerCase() !== ".db"
    || !fs.statSync(candidate).isFile()
  ) {
    throw new Error("恢复来源必须是知序备份目录内的 SQLite 快照。");
  }
  return candidate;
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function ensureHealthy(database, label) {
  const result = database.prepare("PRAGMA quick_check").get();
  if (String(result?.quick_check || "").toLowerCase() !== "ok") {
    throw new Error(`${label}未通过 SQLite 完整性检查。`);
  }
}

const { snapshot, paperIds } = readArguments(process.argv.slice(2));
const snapshotPath = resolveSnapshot(snapshot);
const current = new DatabaseSync(databasePath);
const backup = new DatabaseSync(snapshotPath, { readOnly: true });
const select = `
  SELECT id, title, source_html, full_translation_html, full_translated_at, updated_at,
         source_structure_json, full_translation_structure_json,
         full_translation_fidelity, full_translation_fidelity_message
  FROM papers WHERE id = ?
`;
const update = current.prepare(`
  UPDATE papers
  SET source_structure_json = ?, full_translation_structure_json = ?,
      full_translation_fidelity = ?, full_translation_fidelity_message = ?,
      full_translation_validation_source = 'manual'
  WHERE id = ?
`);
const restored = [];

try {
  ensureHealthy(current, "当前数据库");
  ensureHealthy(backup, "恢复快照");
  const columns = new Set(current.prepare("PRAGMA table_info(papers)").all().map((row) => row.name));
  if (!columns.has("full_translation_validation_source")) {
    throw new Error("当前数据库尚未部署校验来源字段，拒绝恢复。");
  }
  const verified = paperIds.map((paperId) => {
    const before = backup.prepare(select).get(paperId);
    const now = current.prepare(select).get(paperId);
    if (!before || !now) throw new Error(`快照或当前数据库中找不到论文：${paperId}`);
    for (const field of ["source_html", "full_translation_html"]) {
      if (digest(before[field]) !== digest(now[field])) {
        throw new Error(`论文正文与快照不一致，整批拒绝恢复：${now.title}`);
      }
    }
    for (const field of ["full_translated_at", "updated_at"]) {
      if (before[field] !== now[field]) {
        throw new Error(`论文时间戳与快照不一致，整批拒绝恢复：${now.title}`);
      }
    }
    return { paperId, before, now };
  });

  current.exec("BEGIN IMMEDIATE;");
  try {
    for (const item of verified) {
      update.run(
        item.before.source_structure_json,
        item.before.full_translation_structure_json,
        item.before.full_translation_fidelity,
        item.before.full_translation_fidelity_message,
        item.paperId,
      );
      restored.push({
        paperId: item.paperId,
        title: item.now.title,
        fidelity: item.before.full_translation_fidelity,
      });
    }
    current.exec("COMMIT;");
  } catch (error) {
    current.exec("ROLLBACK;");
    throw error;
  }
  ensureHealthy(current, "恢复后的数据库");
  console.log(JSON.stringify({ snapshotPath, restored }, null, 2));
} finally {
  backup.close();
  current.close();
}
