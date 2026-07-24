/**
 * Codex 每周论文翻译队列命令行工具。
 *
 * “list”输出尚未翻译的论文候选；“apply 文件路径”把 Codex 生成的
 * 中文标题和摘要写回本地 SQLite。脚本不调用任何翻译服务。
 */
import fs from "node:fs";
import path from "node:path";
import {
  closeDatabase,
  listPendingPaperTranslations,
  updatePaperCandidateTranslation,
} from "../lib/database.mjs";

/** command 是命令行请求的操作名称。 */
const command = process.argv[2] || "list";

/**
 * 输出当前等待 Codex 翻译的论文候选。
 *
 * @returns {void}
 */
function printPendingTranslations() {
  /** candidates 是需要生成中文标题和中文摘要的候选论文。 */
  const candidates = listPendingPaperTranslations(20);
  process.stdout.write(`${JSON.stringify({ candidates }, null, 2)}\n`);
}

/**
 * 从 JSON 文件批量写回 Codex 翻译结果。
 *
 * @param {string} inputPath 翻译结果 JSON 文件路径。
 * @returns {void}
 */
function applyTranslationFile(inputPath) {
  if (!inputPath) throw new Error("请提供翻译结果 JSON 文件路径。");
  /** resolvedInputPath 是相对于当前工作目录解析的绝对路径。 */
  const resolvedInputPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`找不到翻译结果文件：${resolvedInputPath}`);
  }
  /** payload 是 Codex 生成并保存到文件中的翻译结果。 */
  const payload = JSON.parse(fs.readFileSync(resolvedInputPath, "utf8"));
  /** translations 是允许直接使用数组或 translations 字段的结果列表。 */
  const translations = Array.isArray(payload) ? payload : payload.translations;
  if (!Array.isArray(translations) || translations.length === 0) {
    throw new Error("翻译结果中没有 translations 数组。");
  }
  /** updatedCandidates 是成功写回数据库的候选论文。 */
  const updatedCandidates = [];
  for (const translation of translations) {
    /** candidateId 是当前翻译对应的候选论文 ID。 */
    const candidateId = String(translation.candidateId || "").trim();
    if (!candidateId) throw new Error("翻译结果缺少 candidateId。");
    /** updatedCandidate 是保存翻译后的最新候选论文。 */
    const updatedCandidate = updatePaperCandidateTranslation(candidateId, {
      titleZh: translation.titleZh,
      abstractZh: translation.abstractZh,
    });
    if (!updatedCandidate) {
      throw new Error(`找不到候选论文：${candidateId}`);
    }
    updatedCandidates.push(updatedCandidate);
  }
  process.stdout.write(
    `${JSON.stringify({ updated: updatedCandidates.length }, null, 2)}\n`,
  );
}

try {
  if (command === "list") {
    printPendingTranslations();
  } else if (command === "apply") {
    applyTranslationFile(process.argv[3]);
  } else {
    throw new Error(`未知命令：${command}`);
  }
} finally {
  closeDatabase();
}
