import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("共享额度等待跨工作器及模块重载生效，到期后文章恢复而不误标失败", async () => {
  const testRoot = path.resolve(import.meta.dirname, "../.test-data");
  fs.mkdirSync(testRoot, { recursive: true });
  const dataDirectory = fs.mkdtempSync(path.join(testRoot, "translation-retry-"));
  process.env.ZHIXU_DATA_DIR = dataDirectory;
  process.env.ZHIXU_ENV_FILE = path.join(dataDirectory, "absent.env");
  process.env.ZHIXU_CODEX_CLI_JS = path.resolve(import.meta.dirname, "fixtures/codex-quota-stub.mjs");
  process.env.ZHIXU_TEST_TRANSLATION_CONTROL = path.join(dataDirectory, "control.json");
  process.env.ZHIXU_CODEX_USAGE_RETRY_MS = "1800000";
  delete process.env.ZHIXU_DISABLE_CODEX_WORKER;
  const logPath = path.join(dataDirectory, "cli-calls.log");
  fs.writeFileSync(process.env.ZHIXU_TEST_TRANSLATION_CONTROL, JSON.stringify({ mode: "quota", logPath }));
  const db = await import("../lib/database.mjs");
  const articles = await import("../lib/codex-article-translator.mjs");
  const papers = await import("../lib/codex-paper-translator.mjs");
  try {
    const now = new Date().toISOString();
    const articleIds = [1, 2].map((index) => {
      const article = db.saveArticle({ id: `article_retry_${index}`, url: `https://example.test/article-${index}`, sourceType: "article", title: `Article ${index}`, summary: "A synthetic summary.", category: "AI", categorySource: "rules", categoryConfidence: 0.9, author: "", publishedAt: null, coverImageUrl: null, contentHtml: `<h2>Introduction</h2><p>${"Synthetic article content. ".repeat(70)}</p>`, contentText: "Synthetic article content. ".repeat(70), sourceLanguage: "en", translationStatus: "not_requested", wordCount: 210, createdAt: now, updatedAt: now });
      db.requestArticleTranslation(article.id);
      return article.id;
    });
    const requestTime = db.getArticleById(articleIds[0]).translationRequestedAt;
    await articles.triggerCodexArticleTranslationWorker();
    const firstCallCount = fs.readFileSync(logPath, "utf8").trim().split("\n").length;
    assert.equal(firstCallCount, 2); // login + exec
    assert.deepEqual(articleIds.map((id) => db.getArticleById(id).translationStatus), ["pending", "pending"]);
    assert.equal(db.getArticleById(articleIds[0]).translationRequestedAt, requestTime);
    assert.ok(articles.getCodexArticleTranslationWorkerStatus().retryAfter > Date.now());
    const paper = db.upsertImportedPaper({ externalId: "test:paper-retry", title: "Paper retry", sourceLanguage: "en", sourceText: "Synthetic source text.", sourceHtml: "<p>Synthetic source text.</p>" });
    await articles.triggerCodexArticleTranslationWorker();
    await papers.triggerCodexPaperTranslationWorker();
    assert.equal(fs.readFileSync(logPath, "utf8").trim().split("\n").length, firstCallCount);
    assert.equal(db.getPaperById(paper.id).fullTranslationStatus, "pending");
    const reloaded = await import("../lib/codex-translation-retry.mjs?reloaded");
    assert.ok(reloaded.getTranslationRetryWait()?.retryAfter > Date.now());
    fs.writeFileSync(process.env.ZHIXU_TEST_TRANSLATION_CONTROL, JSON.stringify({ mode: "success", logPath }));
    db.setCodexTranslationRetryState({ retryAfter: Date.now() - 1, reason: "模拟等待到期" });
    await articles.triggerCodexArticleTranslationWorker();
    await papers.triggerCodexPaperTranslationWorker();
    assert.deepEqual(articleIds.map((id) => db.getArticleById(id).translationStatus), ["ready", "ready"]);
    assert.equal(db.getPaperById(paper.id).fullTranslationStatus, "ready");
    assert.deepEqual(fs.readdirSync(path.join(dataDirectory, "article-translations")), []);
  } finally {
    db.closeDatabase();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
