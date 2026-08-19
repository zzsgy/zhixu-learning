/**
 * 英文文章语言状态、Codex 翻译队列和双语搜索测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 验证英文原文不会被译文覆盖，并且只有用户请求后才进入队列。
 */
test("英文文章经用户请求后进入 Codex 队列并保留双语内容", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内允许测试写入的隔离目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是本测试独占的 SQLite 目录。 */
  const temporaryDirectory = fs.mkdtempSync(
    path.join(testDataRoot, "zhixu-article-translation-"),
  );
  process.env.ZHIXU_DATA_DIR = temporaryDirectory;
  /** databaseModule 是设置隔离目录后加载的数据库模块。 */
  const databaseModule = await import("../lib/database.mjs");
  try {
    /** sourceText 是必须完整保留的模拟英文原文。 */
    const sourceText = "Mixture of experts routes each token to specialized networks. ".repeat(40);
    /** savedArticle 是尚未请求翻译的英文文章。 */
    const savedArticle = databaseModule.saveArticle({
      id: "article_english_test",
      url: "https://example.com/english-article",
      sourceType: "web",
      title: "Understanding Mixture of Experts",
      summary: "An English technical article about sparse expert routing.",
      category: "AI",
      categorySource: "rules",
      categoryConfidence: 0.95,
      author: "Example Author",
      publishedAt: "2026-08-18",
      coverImageUrl: null,
      contentHtml: `<h2>Introduction</h2><p>${sourceText}</p>`,
      contentText: sourceText,
      sourceLanguage: "en",
      translationStatus: "not_requested",
      wordCount: sourceText.length,
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    });
    assert.equal(savedArticle.sourceLanguage, "en");
    assert.equal(databaseModule.listPendingArticleTranslations().length, 0);
    /** pendingArticle 是用户主动加入 Codex 队列后的文章。 */
    const pendingArticle = databaseModule.requestArticleTranslation(savedArticle.id);
    assert.equal(pendingArticle.translationStatus, "pending");
    assert.equal(databaseModule.listPendingArticleTranslations().length, 1);
    /** translatedHtml 是仅使用安全语义标签的完整模拟中文译文。 */
    const translatedHtml = `<h2>简介</h2><p>${"混合专家模型会将每个令牌路由到专门的神经网络专家。".repeat(40)}</p>`;
    /** translatedArticle 是 Codex 中文译文写回后的双语文章。 */
    const translatedArticle = databaseModule.updateArticleTranslation(
      savedArticle.id,
      {
        translatedTitle: "理解混合专家模型",
        translatedSummary: "介绍稀疏专家路由机制的英文技术文章中文译文。",
        translatedHtml,
      },
    );
    assert.equal(translatedArticle.translationStatus, "ready");
    assert.equal(translatedArticle.translationSource, "codex");
    assert.equal(translatedArticle.contentText, sourceText);
    assert.match(translatedArticle.translatedText, /混合专家模型/);
    assert.equal(databaseModule.listPendingArticleTranslations().length, 0);
    /** chineseSearch 是只使用中文译文关键词执行的全文搜索。 */
    const chineseSearch = databaseModule.listArticles({ query: "混合专家模型" });
    assert.equal(chineseSearch.length, 1);
    assert.throws(
      () =>
        databaseModule.updateArticleTranslation(savedArticle.id, {
          translatedTitle: "不安全译文",
          translatedSummary: "验证危险属性无法写入文章阅读页面。",
          translatedHtml: `<p onclick="alert(1)">${"中文译文。".repeat(20)}</p>`,
        }),
      /不能包含 HTML 属性/,
    );
  } finally {
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

/**
 * 验证文章阅读页包含翻译请求和三种阅读模式所需的前端结构。
 */
test("文章阅读页提供中文、英文和双语模式", () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** indexHtml 是浏览器加载的主页面模板。 */
  const indexHtml = fs.readFileSync(
    path.join(projectDirectory, "public", "index.html"),
    "utf8",
  );
  /** applicationScript 是文章阅读页的交互脚本。 */
  const applicationScript = fs.readFileSync(
    path.join(projectDirectory, "public", "app.js"),
    "utf8",
  );
  /** styleSheet 是文章双语布局使用的样式表。 */
  const styleSheet = fs.readFileSync(
    path.join(projectDirectory, "public", "styles.css"),
    "utf8",
  );
  assert.match(indexHtml, /id="article-translation-request"/);
  assert.match(indexHtml, /data-article-language-mode="translation"/);
  assert.match(indexHtml, /data-article-language-mode="original"/);
  assert.match(indexHtml, /data-article-language-mode="bilingual"/);
  assert.match(applicationScript, /function renderArticleReadingMode\(\)/);
  assert.match(styleSheet, /\.article-bilingual-grid/);
});
