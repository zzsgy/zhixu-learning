/**
 * 本地 AI 问答会话与历史检索测试。
 *
 * 测试使用隔离 SQLite，不调用任何外部模型。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 验证阅读页连续追问、选区、引用和全文检索均能持久化。
 */
test("阅读页 AI 问答可保存、续问并在历史中心检索", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内允许测试写入的数据目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是本测试独占的 SQLite 数据目录。 */
  const temporaryDirectory = fs.mkdtempSync(path.join(testDataRoot, "zhixu-ai-history-"));
  process.env.ZHIXU_DATA_DIR = temporaryDirectory;
  /** databaseModule 是设置隔离目录后加载的本地数据库模块。 */
  const databaseModule = await import("../lib/database.mjs");
  try {
    /** firstConversation 是针对一篇文章创建的首轮问答。 */
    const firstConversation = databaseModule.saveAiExchange({
      mode: "ask",
      question: "状态机为什么能提高 Agent 的可靠性？",
      answer: "状态转移明确，失败后可以从检查点继续。",
      selectedQuote: "Agent 的状态机用于保存当前步骤、工具结果和可恢复检查点。",
      sources: [{ targetType: "article", targetId: "article_agent", title: "Agent 状态管理" }],
      citations: [{ chunkId: "S1-C1", quote: "可恢复检查点", targetType: "article", targetId: "article_agent" }],
      insufficientEvidence: false,
    });
    assert.equal(firstConversation.messages.length, 2);
    assert.equal(firstConversation.messages[0].selectedQuote.includes("状态机"), true);
    assert.equal(firstConversation.messages[1].citations.length, 1);

    /** continuedConversation 是沿用同一会话保存的第二轮追问。 */
    const continuedConversation = databaseModule.saveAiExchange({
      conversationId: firstConversation.id,
      mode: "ask",
      question: "失败重试和检查点有什么区别？",
      answer: "重试重新执行操作；检查点保存可恢复位置。",
      sources: [{ targetType: "article", targetId: "article_agent", title: "Agent 状态管理" }],
      citations: [],
      insufficientEvidence: true,
    });
    assert.equal(continuedConversation.messages.length, 4);
    assert.equal(continuedConversation.messages[3].insufficientEvidence, true);

    /** bySource 是当前阅读资料恢复最近会话时使用的过滤结果。 */
    const bySource = databaseModule.listAiConversations({
      targetType: "article",
      targetId: "article_agent",
    });
    assert.equal(bySource.length, 1);
    assert.equal(bySource[0].messageCount, 4);

    /** byAnswer 是资料问答历史中心对回答正文的检索结果。 */
    const byAnswer = databaseModule.listAiConversations({ query: "可恢复位置" });
    assert.equal(byAnswer.length, 1);
    assert.equal(byAnswer[0].id, firstConversation.id);
  } finally {
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
