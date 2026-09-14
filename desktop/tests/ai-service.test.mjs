/**
 * 有出处 AI 问答服务测试。
 *
 * 测试只使用内存中的模拟资料和模拟 HTTP 响应，不调用任何外部模型。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  answerFromSources,
  selectRelevantChunks,
  validateCitations,
} from "../lib/ai-service.mjs";

/** sampleSources 是覆盖 Agent 与数据库主题的两份模拟资料。 */
const sampleSources = [
  {
    sourceKey: "S1",
    title: "Agent 状态管理",
    text: "Agent 的状态机用于保存当前步骤、工具结果和可恢复检查点。可靠性来自明确的状态转移与失败重试。".repeat(20),
  },
  {
    sourceKey: "S2",
    title: "PostgreSQL 事务",
    text: "PostgreSQL 使用 MVCC 管理并发事务。事务隔离级别决定一次查询能够观察到哪些版本。".repeat(20),
  },
];

test("本地检索在比较模式下覆盖每份资料", () => {
  /** chunks 是问题相关片段选择结果。 */
  const chunks = selectRelevantChunks(sampleSources, "比较 Agent 状态与 PostgreSQL 事务", "compare");
  assert.ok(chunks.some((chunk) => chunk.sourceKey === "S1"));
  assert.ok(chunks.some((chunk) => chunk.sourceKey === "S2"));
  assert.ok(chunks.length <= 18);
});

test("引用校验剔除不存在于原文的引文", () => {
  /** chunks 是带真实原文的最小上下文。 */
  const chunks = [{ id: "S1-C1", sourceKey: "S1", title: "示例", text: "状态机用于保存当前步骤和工具结果。" }];
  /** citations 是本地逐字校验后的引用。 */
  const citations = validateCitations([
    { chunkId: "S1-C1", quote: "状态机用于保存当前步骤" },
    { chunkId: "S1-C1", quote: "原文从未说过这句话" },
    { chunkId: "S9-C9", quote: "状态机用于保存当前步骤" },
  ], chunks);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].quote, "状态机用于保存当前步骤");
});

test("问答结果只返回通过核验的来源", async () => {
  /** mockFetcher 模拟 DeepSeek JSON 响应，不发生网络请求。 */
  const mockFetcher = async (_url, options) => {
    /** request 是待断言的聊天补全请求。 */
    const request = JSON.parse(options.body);
    /** context 是服务实际发送的带编号资料。 */
    const context = request.messages[1].content;
    assert.match(context, /S1-C1/);
    assert.match(context, /<selected_quote>状态机用于保存当前步骤<\/selected_quote>/);
    assert.match(context, /<conversation_history>/);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify({
            answer: "状态机保存步骤与工具结果。[S1-C1]",
            insufficientEvidence: false,
            citations: [
              { chunkId: "S1-C1", quote: "状态机用于保存当前步骤" },
              { chunkId: "S1-C1", quote: "不存在的伪造引文" },
            ],
          }) } }],
        };
      },
    };
  };
  /** result 是模拟问答服务返回值。 */
  const result = await answerFromSources({
    apiKey: "test-only-key",
    model: "deepseek-chat",
    question: "Agent 状态机保存什么？",
    mode: "ask",
    selectedQuote: "状态机用于保存当前步骤",
    conversationMessages: [
      { role: "user", content: "状态机有什么用？" },
      { role: "assistant", content: "它用于维护可恢复的执行状态。" },
    ],
    sources: [sampleSources[0]],
    fetcher: mockFetcher,
  });
  assert.equal(result.citations.length, 1);
  assert.equal(result.insufficientEvidence, false);
  assert.match(result.answer, /S1-C1/);
});
