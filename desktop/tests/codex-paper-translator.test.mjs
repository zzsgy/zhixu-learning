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
const translatedHtml = "<h2>完整中文译文</h2><p>" + "这是模拟的论文中文全文。".repeat(80) + "</p>";
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
  try {
    /** paper 是已提取英文正文并进入 pending 队列的模拟论文。 */
    const paper = databaseModule.upsertImportedPaper({
      externalId: "manual-test:codex-worker",
      title: "Attention Worker Test",
      category: "AI",
      sourceUrl: "https://example.test/paper",
      sourceLanguage: "en",
      sourceText: "A complete English paper body for asynchronous translation.",
    });
    assert.equal(paper.fullTranslationStatus, "pending");
    await workerModule.triggerCodexPaperTranslationWorker();
    /** translatedPaper 是工作器完成写回后的数据库记录。 */
    const translatedPaper = databaseModule.getPaperById(paper.id);
    assert.equal(translatedPaper.fullTranslationStatus, "ready");
    assert.equal(translatedPaper.fullTranslationSource, "codex");
    assert.match(translatedPaper.fullTranslationHtml, /完整中文译文/);
    assert.equal(
      workerModule.getCodexPaperTranslationWorkerStatus().status,
      "idle",
    );
  } finally {
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
