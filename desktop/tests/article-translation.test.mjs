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
    /** duplicateByTitle 验证不同网址但原标题一致时不会创建第二篇网页文章。 */
    const duplicateByTitle = databaseModule.findDuplicateArticle({
      url: "https://example.com/copied-title",
      title: "Understanding  Mixture-of-Experts!",
      contentText: "different content",
    });
    assert.equal(duplicateByTitle.id, savedArticle.id);
    assert.equal(duplicateByTitle.matchReason, "title");
    /** duplicateByContent 验证标题改变但正文一致时仍可识别。 */
    const duplicateByContent = databaseModule.findDuplicateArticle({
      url: "https://example.com/copied-content",
      title: "A Renamed Article",
      contentText: sourceText,
    });
    assert.equal(duplicateByContent.id, savedArticle.id);
    assert.equal(duplicateByContent.matchReason, "content");
    assert.equal(databaseModule.listPendingArticleTranslations().length, 0);
    /** pendingArticle 是用户主动加入 Codex 队列后的文章。 */
    const pendingArticle = databaseModule.requestArticleTranslation(savedArticle.id);
    assert.equal(pendingArticle.translationStatus, "pending");
    assert.equal(pendingArticle.translationStage, "queued");
    assert.equal(pendingArticle.translationProgressPercent, 0);
    assert.equal(databaseModule.listPendingArticleTranslations().length, 1);
    /** queuedStatus 验证页面可读取真实排队位置。 */
    const queuedStatus = databaseModule.getArticleTranslationStatus(savedArticle.id);
    assert.equal(queuedStatus.queuePosition, 1);
    /** claimedArticle 模拟工作器原子领取文章。 */
    const claimedArticle = databaseModule.claimNextPendingArticleTranslation();
    assert.equal(claimedArticle.translationStatus, "processing");
    assert.equal(databaseModule.claimNextPendingArticleTranslation(), null);
    /** translatingArticle 验证分段完成数会形成真实百分比。 */
    const translatingArticle = databaseModule.updateArticleTranslationProgress(
      savedArticle.id,
      {
        stage: "translating",
        progressPercent: 42,
        totalSections: 4,
        completedSections: 2,
      },
    );
    assert.equal(translatingArticle.translationProgressPercent, 42);
    assert.equal(translatingArticle.translationCompletedSections, 2);
    /** failedArticle 和 retriedArticle 验证失败原因与重新排队。 */
    const failedArticle = databaseModule.markArticleTranslationFailed(
      savedArticle.id,
      "模拟 Codex 失败",
    );
    assert.equal(failedArticle.translationStatus, "failed");
    assert.equal(failedArticle.translationError, "模拟 Codex 失败");
    const retriedArticle = databaseModule.requestArticleTranslation(savedArticle.id);
    assert.equal(retriedArticle.translationStatus, "pending");
    assert.equal(databaseModule.claimNextPendingArticleTranslation().translationStatus, "processing");
    assert.equal(databaseModule.resetInterruptedArticleTranslations(), 1);
    assert.equal(databaseModule.claimNextPendingArticleTranslation().translationStatus, "processing");
    /** translatedHtml 是仅使用安全语义标签的完整模拟中文译文。 */
    const translatedHtml = `<h2>简介</h2><p>${"混合专家模型会将每个令牌路由到专门的神经网络专家。".repeat(20)}<br>${"换行后的完整译文。".repeat(20)}</p><p><img referrerpolicy="no-referrer" loading="lazy" alt="专家路由图" src="https://example.test/moe.png"></p>`;
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
    assert.equal(translatedArticle.translationProgressPercent, 100);
    assert.equal(translatedArticle.translationSource, "codex");
    assert.equal(translatedArticle.contentText, sourceText);
    assert.match(translatedArticle.translatedText, /混合专家模型/);
    assert.match(translatedArticle.translatedHtml, /<br>/);
    assert.match(translatedArticle.translatedHtml, /<img\b[^>]+https:\/\/example\.test\/moe\.png/);
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
    assert.throws(
      () =>
        databaseModule.updateArticleTranslation(savedArticle.id, {
          translatedTitle: "不安全换行",
          translatedSummary: "验证带事件属性的换行标签不能进入阅读页面。",
          translatedHtml: `<p>${"中文译文。".repeat(20)}<br onclick="alert(1)"></p>`,
        }),
      /不能包含 HTML 属性/,
    );
    assert.throws(
      () =>
        databaseModule.updateArticleTranslation(savedArticle.id, {
          translatedTitle: "不安全图片",
          translatedSummary: "验证危险图片地址无法写入文章阅读页面。",
          translatedHtml: `<p>${"中文译文。".repeat(20)}</p><img loading="lazy" referrerpolicy="no-referrer" src="javascript:alert(1)">`,
        }),
      /图片地址不安全/,
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
  assert.match(indexHtml, /id="article-translation-progress"/);
  assert.match(indexHtml, /data-article-language-mode="translation"/);
  assert.match(indexHtml, /data-article-language-mode="original"/);
  assert.match(indexHtml, /data-article-language-mode="bilingual"/);
  assert.match(indexHtml, /\/vendor\/katex\/katex\.min\.css/);
  assert.match(applicationScript, /function renderArticleReadingMode\(\)/);
  assert.match(
    applicationScript,
    /import renderMathInElement from "\/vendor\/katex\/contrib\/auto-render\.mjs"/,
  );
  assert.match(applicationScript, /function renderReadingMath\(readingSurface\)/);
  assert.match(applicationScript, /\{ left: "\$\$", right: "\$\$", display: true \}/);
  assert.match(applicationScript, /\{ left: "\$", right: "\$", display: false \}/);
  assert.match(applicationScript, /renderReadingMath\(dom\.articleReaderContent\)/);
  assert.match(applicationScript, /function pollArticleTranslation\(articleId\)/);
  assert.match(applicationScript, /translationCompletedSections/);
  assert.match(applicationScript, /sourceElement\.tagName === "IMG"/);
  assert.match(applicationScript, /\/api\/article-images\?url=/);
  assert.match(applicationScript, /function setArticleImageSource\(image, remoteSource\)/);
  assert.match(applicationScript, /addEventListener\("error"/);
  assert.match(styleSheet, /\.article-bilingual-grid/);
  assert.match(styleSheet, /\.article-translation-progress/);
});
