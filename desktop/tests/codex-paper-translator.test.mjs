/**
 * Codex 论文后台翻译工作器端到端状态测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 使用不联网的模拟 Codex 验证 pending -> processing -> ready 完整流程。
 */
test("英文论文入队后由单实例 Codex 工作器异步写回中文全文", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内允许测试写入的数据根目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是本测试独占的 SQLite 和模拟命令目录。 */
  const temporaryDirectory = fs.mkdtempSync(
    path.join(testDataRoot, "zhixu-codex-worker-"),
  );
  /** fakeCodexPath 是不访问网络的 Codex CLI 行为模拟脚本。 */
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
let promptAndSource = "";
for await (const chunk of process.stdin) promptAndSource += chunk;
const sourceHtml = promptAndSource.match(/<ZHIXU_SOURCE_HTML>\\n([\\s\\S]*?)\\n<\\/ZHIXU_SOURCE_HTML>/)?.[1] || "";
if (sourceHtml.includes("FORCE_USAGE_LIMIT")) {
  const flagPath = "usage-attempted.flag";
  if (!fs.existsSync(flagPath)) {
    fs.writeFileSync(flagPath, "1", "utf8");
    process.stderr.write("You've hit your usage limit. Try again later.\\n");
    process.exit(1);
  }
}
if (sourceHtml.includes("FORCE_FAILURE")) {
  fs.writeFileSync(outputPath, JSON.stringify({ translatedHtml: "<p>无法读取原文文件。</p>" }), "utf8");
  process.exit(0);
}
const mediaMarkers = sourceHtml.match(/ZHIXU_MEDIA_\\d{6}/g) || [];
const formulaMarkers = sourceHtml.match(/ZHIXU_MATH_\\d{6}/g) || [];
if (sourceHtml.includes("DROP_MARKER_ONCE") && !fs.existsSync("marker-attempted.flag")) {
  fs.writeFileSync("marker-attempted.flag", "1", "utf8");
  formulaMarkers.shift();
}
const translatedHtml = "<h2>完整中文译文</h2>"
  + mediaMarkers.map((marker) => "<p><code>" + marker + "</code></p>").join("")
  + formulaMarkers.map((marker) => "<p><code>" + marker + "</code></p>").join("")
  + "<p>" + "这是模拟的论文中文全文。".repeat(80) + "</p>";
fs.writeFileSync(outputPath, JSON.stringify({ translatedHtml }), "utf8");
process.exit(0);
`,
    "utf8",
  );
  process.env.ZHIXU_DATA_DIR = temporaryDirectory;
  process.env.ZHIXU_CODEX_CLI_JS = fakeCodexPath;
  delete process.env.ZHIXU_DISABLE_CODEX_WORKER;
  /** databaseModule 是使用测试隔离数据库的论文存储模块。 */
  const databaseModule = await import("../lib/database.mjs");
  /** workerModule 是待验证的 Codex 单实例后台工作器。 */
  const workerModule = await import("../lib/codex-paper-translator.mjs");
  /** articleTranslatorModule 提供论文和文章共用的图文锚点分段器。 */
  const articleTranslatorModule = await import("../lib/codex-article-translator.mjs");
  try {
    /** section 直属文字和公式锚点必须进入分段，不能在调用 Codex 前静默丢失。 */
    const nestedPrepared = articleTranslatorModule.prepareArticleTranslationMedia(
      "<section>Interpretation of <sub>A</sub>.<p>Body <sup>x</sup>.</p></section>",
    );
    const nestedSections = articleTranslatorModule.splitArticleTranslationSections(
      nestedPrepared.html,
      100,
    );
    const nestedJoined = nestedSections.join("\n");
    for (const formula of nestedPrepared.formulas) {
      assert.equal(
        (nestedJoined.match(new RegExp(formula.marker, "g")) || []).length,
        1,
      );
    }
    assert.match(nestedJoined, /Interpretation of/);
    /** usagePaper 验证额度不足只暂停，不把论文误记为内容失败。 */
    const usagePaper = databaseModule.upsertImportedPaper({
      externalId: "manual-test:codex-worker-usage",
      title: "Usage Limit Must Pause Queue",
      category: "AI",
      sourceUrl: "https://example.test/usage",
      sourceLanguage: "en",
      sourceText: "FORCE_USAGE_LIMIT",
      sourceHtml: "<h2>FORCE_USAGE_LIMIT</h2><p>FORCE_USAGE_LIMIT</p>",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    /** failedPaper 验证单篇失败不会阻塞其后的正常论文。 */
    const failedPaper = databaseModule.upsertImportedPaper({
      externalId: "manual-test:codex-worker-failure",
      title: "Failure Must Not Block Queue",
      category: "AI",
      sourceUrl: "https://example.test/failure",
      sourceLanguage: "en",
      sourceText: "FORCE_FAILURE",
      sourceHtml: "<h2>FORCE_FAILURE</h2><p>FORCE_FAILURE</p>",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    /** markerPaper 验证单段锚点丢失时自动重试，而不是整篇失败。 */
    const markerPaper = databaseModule.upsertImportedPaper({
      externalId: "manual-test:codex-worker-marker-retry",
      title: "Protected Marker Retry",
      category: "AI",
      sourceUrl: "https://example.test/marker-retry",
      sourceLanguage: "en",
      sourceText: "DROP_MARKER_ONCE x95",
      sourceHtml: "<h2>DROP_MARKER_ONCE</h2><p>x<sub>95</sub></p>",
      sourceStructure: {
        imageCount: 0,
        tableCount: 0,
        headingCount: 1,
        formulaCount: 1,
        semanticSubscriptCount: 1,
        semanticSuperscriptCount: 0,
        declaredFigureCount: 0,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    /** paper 是已提取英文正文并进入 pending 队列的模拟论文。 */
    const paper = databaseModule.upsertImportedPaper({
      externalId: "manual-test:codex-worker",
      title: "Attention Worker Test",
      category: "AI",
      sourceUrl: "https://example.test/paper",
      sourceLanguage: "en",
      sourceText: "A complete English paper body for asynchronous translation.",
      sourceHtml: '<h2>Results</h2><p>Accuracy is <i>x</i><sub>95</sub>.</p><figure><img src="https://example.test/figure-1.png" alt="Figure 1"><figcaption>Figure 1. Result.</figcaption></figure>',
      sourceStructure: {
        imageCount: 1,
        tableCount: 0,
        headingCount: 1,
        formulaCount: 1,
        semanticSubscriptCount: 1,
        semanticSuperscriptCount: 0,
        declaredFigureCount: 1,
      },
    });
    assert.equal(paper.fullTranslationStatus, "pending");
    await workerModule.triggerCodexPaperTranslationWorker();
    assert.equal(databaseModule.getPaperById(usagePaper.id).fullTranslationStatus, "pending");
    assert.equal(workerModule.getCodexPaperTranslationWorkerStatus().status, "waiting");
    await workerModule.triggerCodexPaperTranslationWorker();
    assert.equal(databaseModule.getPaperById(usagePaper.id).fullTranslationStatus, "ready");
    assert.equal(
      databaseModule.getPaperById(failedPaper.id).fullTranslationStatus,
      "failed",
    );
    assert.equal(databaseModule.getPaperById(markerPaper.id).fullTranslationStatus, "ready");
    /** translatedPaper 是工作器完成写回后的数据库记录。 */
    const translatedPaper = databaseModule.getPaperById(paper.id);
    assert.equal(translatedPaper.fullTranslationStatus, "ready");
    assert.equal(translatedPaper.fullTranslationSource, "codex");
    assert.match(translatedPaper.fullTranslationHtml, /完整中文译文/);
    assert.match(translatedPaper.fullTranslationHtml, /figure-1\.png/);
    assert.match(translatedPaper.fullTranslationHtml, /<sub>95<\/sub>/);
    assert.equal(translatedPaper.fullTranslationFidelity, "complete");
    assert.equal(
      workerModule.getCodexPaperTranslationWorkerStatus().status,
      "idle",
    );
  } finally {
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
