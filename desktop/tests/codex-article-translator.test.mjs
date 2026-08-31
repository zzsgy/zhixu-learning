/**
 * Codex 文章分段翻译、真实进度和断点目录清理测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 使用不联网的模拟 Codex 验证文章自动翻译完整流程。
 */
test("英文文章按真实分段进度自动翻译并清理中间文件", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内测试数据根目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是本测试独占的 SQLite 和工作目录。 */
  const temporaryDirectory = fs.mkdtempSync(
    path.join(testDataRoot, "zhixu-article-worker-"),
  );
  /** fakeCodexPath 是不联网的 Codex CLI 模拟脚本。 */
  const fakeCodexPath = path.join(temporaryDirectory, "fake-codex.mjs");
  fs.writeFileSync(
    fakeCodexPath,
    `import fs from "node:fs";
const argumentsList = process.argv.slice(2);
if (argumentsList[0] === "login" && argumentsList[1] === "status") {
  process.stdout.write("Logged in to ChatGPT\\n");
  process.exit(0);
}
const outputIndex = argumentsList.indexOf("--output-last-message");
const outputPath = argumentsList[outputIndex + 1];
const schemaIndex = argumentsList.indexOf("--output-schema");
const schema = JSON.parse(fs.readFileSync(argumentsList[schemaIndex + 1], "utf8"));
const sourceHtml = fs.readFileSync("source.html", "utf8");
const mediaMarkers = sourceHtml.match(/ZHIXU_MEDIA_\\d{6}/g) || [];
const formulaMarkers = sourceHtml.match(/ZHIXU_MATH_\\d{6}/g) || [];
setTimeout(() => {
  const output = {
    translatedHtml: "<h2>分段译文</h2>"
      + mediaMarkers.map((marker) => "<p><code>" + marker + "</code></p>").join("")
      + formulaMarkers.map((marker) => "<p><code>" + marker + "</code></p>").join("")
      + "<p>" + "这是模拟的文章中文译文。".repeat(60) + "<br>" + "这是换行后的译文。".repeat(60) + "</p>"
  };
  if (schema.properties.translatedTitle) output.translatedTitle = "图解 Transformer";
  if (schema.properties.translatedSummary) output.translatedSummary = "完整介绍 Transformer 结构的中文译文。";
  fs.writeFileSync(outputPath, JSON.stringify(output), "utf8");
}, 120);
`,
    "utf8",
  );
  process.env.ZHIXU_DATA_DIR = temporaryDirectory;
  process.env.ZHIXU_CODEX_CLI_JS = fakeCodexPath;
  delete process.env.ZHIXU_DISABLE_CODEX_WORKER;
  /** databaseModule 是隔离数据库模块。 */
  const databaseModule = await import("../lib/database.mjs");
  /** workerModule 是待验证的文章翻译工作器。 */
  const workerModule = await import("../lib/codex-article-translator.mjs");
  try {
    /** sourceBlocks 创建至少三个可独立处理的正文分段。 */
    const sourceBlocks = Array.from(
      { length: 4 },
      (_, index) => `<h2>Section ${index + 1}</h2><p>${"Transformer attention explanation. ".repeat(190)} $\\mathbf{X}_${index + 1} \\in \\mathbb{R}^{L \\times d}$</p><figure><img referrerpolicy="no-referrer" loading="lazy" alt="Diagram ${index + 1}" src="https://example.test/diagram-${index + 1}.png"><figcaption>Architecture diagram ${index + 1}.</figcaption></figure>`,
    ).join("\n");
    /** article 是用户主动请求翻译的英文文章。 */
    const article = databaseModule.saveArticle({
      id: "article_worker_test",
      url: "https://example.test/illustrated-transformer",
      sourceType: "article",
      title: "The Illustrated Transformer",
      summary: "A visual explanation of the Transformer architecture.",
      category: "AI",
      categorySource: "rules",
      categoryConfidence: 0.9,
      author: "Test Author",
      publishedAt: "2026-08-20",
      coverImageUrl: null,
      contentHtml: sourceBlocks,
      contentText: sourceBlocks.replace(/<[^>]+>/g, " "),
      sourceLanguage: "en",
      translationStatus: "not_requested",
      wordCount: sourceBlocks.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    databaseModule.requestArticleTranslation(article.id);
    /** workerPromise 在后台运行时允许测试读取处理中状态。 */
    const workerPromise = workerModule.triggerCodexArticleTranslationWorker();
    /** processingSnapshot 是首次出现真实分段总数后的状态。 */
    let processingSnapshot = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const snapshot = databaseModule.getArticleTranslationStatus(article.id);
      if (snapshot.translationStatus === "processing" && snapshot.translationTotalSections > 1) {
        processingSnapshot = snapshot;
        break;
      }
    }
    assert.ok(processingSnapshot);
    assert.equal(processingSnapshot.translationStage, "translating");
    assert.ok(processingSnapshot.translationProgressPercent >= 8);
    await workerPromise;
    /** translatedArticle 是完成分段合并后的正式文章。 */
    const translatedArticle = databaseModule.getArticleById(article.id);
    assert.equal(translatedArticle.translationStatus, "ready");
    assert.equal(translatedArticle.translationProgressPercent, 100);
    assert.equal(
      translatedArticle.translationCompletedSections,
      translatedArticle.translationTotalSections,
    );
    assert.match(translatedArticle.translatedHtml, /分段译文/);
    assert.equal((translatedArticle.translatedHtml.match(/<img\b/gi) || []).length, 4);
    assert.match(translatedArticle.translatedHtml, /https:\/\/example\.test\/diagram-1\.png/);
    assert.doesNotMatch(translatedArticle.translatedHtml, /ZHIXU_MEDIA_/);
    assert.match(
      translatedArticle.translatedHtml,
      /\$\\mathbf\{X\}_1 \\in \\mathbb\{R\}\^\{L \\times d\}\$/,
    );
    assert.doesNotMatch(translatedArticle.translatedHtml, /ZHIXU_MATH_/);
    assert.equal(translatedArticle.translatedTitle, "图解 Transformer");
    assert.equal(workerModule.getCodexArticleTranslationWorkerStatus().status, "idle");
    /** workEntries 验证成功后不会在数据盘留下文章中间文件。 */
    const workEntries = fs.readdirSync(path.join(temporaryDirectory, "article-translations"));
    assert.deepEqual(workEntries, []);
  } finally {
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
