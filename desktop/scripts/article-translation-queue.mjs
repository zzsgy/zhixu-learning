/**
 * Codex 英文文章翻译队列命令行工具。
 *
 * 用法：
 *   node --disable-warning=ExperimentalWarning scripts/article-translation-queue.mjs list
 *   node --disable-warning=ExperimentalWarning scripts/article-translation-queue.mjs apply <json-file>
 *
 * 本脚本只读取和写入本机 SQLite，不调用 DeepSeek 或任何第三方翻译服务。
 */
import fs from "node:fs";
import path from "node:path";
import {
  closeDatabase,
  listPendingArticleTranslations,
  updateArticleTranslation,
} from "../lib/database.mjs";

/** command 是用户要求执行的队列操作。 */
const command = process.argv[2] || "list";

/**
 * 输出用户已经主动加入队列的英文文章及其完整原文。
 *
 * @returns {void}
 */
function printPendingTranslations() {
  /** articles 是等待 Codex 翻译的完整英文或中英混合文章。 */
  const articles = listPendingArticleTranslations(10).map((article) => ({
    articleId: article.id,
    title: article.title,
    summary: article.summary,
    sourceLanguage: article.sourceLanguage,
    sourceUrl: article.url,
    sourceHtml: article.contentHtml,
    sourceText: article.contentText,
    wordCount: article.wordCount,
  }));
  process.stdout.write(`${JSON.stringify({ articles }, null, 2)}\n`);
}

/**
 * 从 Codex 生成的 JSON 文件批量写回中文标题、简介和完整译文。
 *
 * @param {string} inputPath 翻译结果 JSON 文件路径。
 * @returns {void}
 */
function applyTranslationFile(inputPath) {
  if (!inputPath) throw new TypeError("请提供文章翻译 JSON 文件路径。");
  /** resolvedInputPath 是相对于当前工作目录解析后的绝对路径。 */
  const resolvedInputPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`找不到文章翻译文件：${resolvedInputPath}`);
  }
  /** payload 是 Codex 按规定格式生成的翻译批次。 */
  const payload = JSON.parse(fs.readFileSync(resolvedInputPath, "utf8"));
  /** translations 是需要写回本地数据库的文章译文数组。 */
  const translations = Array.isArray(payload.translations)
    ? payload.translations
    : [];
  if (translations.length === 0) {
    throw new TypeError("翻译文件中没有 translations 数组。");
  }
  /** updatedArticles 收集成功写回的文章状态，便于最终核验。 */
  const updatedArticles = translations.map((translation) => {
    /** articleId 是译文对应的本地文章稳定 ID。 */
    const articleId = String(translation.articleId || "").trim();
    if (!articleId) throw new TypeError("文章翻译结果缺少 articleId。");
    /** article 是完成 Codex 译文写回后的最新文章。 */
    const article = updateArticleTranslation(articleId, {
      translatedTitle: translation.translatedTitle,
      translatedSummary: translation.translatedSummary,
      translatedHtml: translation.translatedHtml,
    });
    if (!article) throw new Error(`文章不存在：${articleId}`);
    return {
      id: article.id,
      title: article.title,
      translatedTitle: article.translatedTitle,
      translationStatus: article.translationStatus,
      translatedAt: article.translatedAt,
    };
  });
  process.stdout.write(`${JSON.stringify({ updatedArticles }, null, 2)}\n`);
}

try {
  if (command === "list") {
    printPendingTranslations();
  } else if (command === "apply") {
    applyTranslationFile(process.argv[3]);
  } else {
    throw new TypeError(`未知命令：${command}`);
  }
} finally {
  closeDatabase();
}
