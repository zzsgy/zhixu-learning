/**
 * Codex 论文全文翻译队列命令。
 *
 * 用法：
 *   node scripts/paper-fulltext-translation-queue.mjs extract <paper-id>
 *   node scripts/paper-fulltext-translation-queue.mjs list
 *   node scripts/paper-fulltext-translation-queue.mjs apply <json-file>
 */
import fs from "node:fs";
import {
  listPendingFullPaperTranslations,
  updatePaperFullTranslation,
} from "../lib/database.mjs";
import { preparePaperFullText } from "../lib/paper-fulltext.mjs";

/** command 是命令行请求的队列操作。 */
const command = process.argv[2] || "list";

/**
 * 输出等待 Codex 翻译的完整英文论文。
 *
 * @returns {void}
 */
function listQueue() {
  /** papers 是包含英文提取正文的待翻译论文。 */
  const papers = listPendingFullPaperTranslations();
  process.stdout.write(`${JSON.stringify({ papers }, null, 2)}\n`);
}

/**
 * 从 JSON 文件批量写入 Codex 中文全文。
 *
 * @param {string} filePath JSON 文件路径。
 * @returns {void}
 */
function applyTranslations(filePath) {
  if (!filePath) throw new TypeError("请提供翻译 JSON 文件路径。");
  /** payload 是 Codex 生成的翻译批次。 */
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  /** translations 是需要写回的论文翻译数组。 */
  const translations = Array.isArray(payload.translations)
    ? payload.translations
    : [];
  if (translations.length === 0) {
    throw new TypeError("翻译文件中没有 translations 数组。");
  }
  /** updatedPapers 收集成功写回的论文摘要。 */
  const updatedPapers = translations.map((translation) => {
    /** paper 是当前翻译写回后的论文。 */
    const paper = updatePaperFullTranslation(
      translation.paperId,
      translation.translatedHtml,
    );
    if (!paper) throw new Error(`论文不存在：${translation.paperId}`);
    return {
      id: paper.id,
      title: paper.title,
      fullTranslationStatus: paper.fullTranslationStatus,
    };
  });
  process.stdout.write(`${JSON.stringify({ updatedPapers }, null, 2)}\n`);
}

/**
 * 下载并提取指定论文的公开 PDF。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @returns {Promise<void>}
 */
async function extractPaper(paperId) {
  if (!paperId) throw new TypeError("请提供论文 ID。");
  /** paper 是完成全文提取后的论文。 */
  const paper = await preparePaperFullText(paperId);
  if (!paper) throw new Error("论文不存在。");
  process.stdout.write(
    `${JSON.stringify({
      id: paper.id,
      title: paper.title,
      sourceTextWordCount: paper.sourceTextWordCount,
      fullTranslationStatus: paper.fullTranslationStatus,
    }, null, 2)}\n`,
  );
}

if (command === "list") {
  listQueue();
} else if (command === "apply") {
  applyTranslations(process.argv[3]);
} else if (command === "extract") {
  await extractPaper(process.argv[3]);
} else {
  throw new TypeError(`未知命令：${command}`);
}
