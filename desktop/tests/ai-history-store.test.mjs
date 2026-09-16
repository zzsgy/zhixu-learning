import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAiHistoryStore } from "../lib/db/stores/ai-history.mjs";

function createAiDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE ai_conversations (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'ask',
      primary_target_type TEXT,
      primary_target_id TEXT,
      title TEXT NOT NULL,
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      selected_quote TEXT NOT NULL DEFAULT '',
      citations_json TEXT NOT NULL DEFAULT '[]',
      insufficient_evidence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );
  `);
  return database;
}

function createStore(database, timestamps = ["2026-09-16T08:00:00.000Z"]) {
  let timestampIndex = 0;
  let uuidIndex = 0;
  return createAiHistoryStore(database, {
    currentTimestamp: () => timestamps[Math.min(timestampIndex++, timestamps.length - 1)],
    randomUUID: () => `uuid-${++uuidIndex}`,
  });
}

test("AI 问答仓储创建完整会话并规范化模式、来源、标题、选区和引用", () => {
  const database = createAiDatabase();
  try {
    const store = createStore(database);
    const sources = Array.from({ length: 8 }, (_, index) => ({
      targetType: "article",
      targetId: `article-${index + 1}`,
      title: `来源 ${index + 1}`,
    }));
    const conversation = store.saveAiExchange({
      mode: "invalid",
      sources,
      question: "  状态机为什么可靠？  ",
      answer: "  因为状态可以恢复。  ",
      selectedQuote: "  可恢复检查点  ",
      citations: [{ quote: "检查点" }],
      insufficientEvidence: true,
    });

    assert.match(conversation.id, /^ai_conversation_/);
    assert.equal(conversation.mode, "ask");
    assert.equal(conversation.title, "状态机为什么可靠？");
    assert.equal(conversation.sources.length, 6);
    assert.equal(conversation.primaryTargetType, "article");
    assert.equal(conversation.primaryTargetId, "article-1");
    assert.equal(conversation.messageCount, 2);
    assert.deepEqual(conversation.messages.map((message) => message.role), ["user", "assistant"]);
    assert.equal(conversation.messages[0].content, "状态机为什么可靠？");
    assert.equal(conversation.messages[0].selectedQuote, "可恢复检查点");
    assert.deepEqual(conversation.messages[1].citations, [{ quote: "检查点" }]);
    assert.equal(conversation.messages[1].insufficientEvidence, true);
  } finally {
    database.close();
  }
});

test("AI 问答仓储连续追问只追加消息和更新时间并保留原会话属性", () => {
  const database = createAiDatabase();
  try {
    const timestamps = ["2026-09-16T08:00:00.000Z", "2026-09-16T09:00:00.000Z"];
    const store = createStore(database, timestamps);
    const first = store.saveAiExchange({
      mode: "compare",
      sources: [{ targetType: "paper", targetId: "paper-1", title: "原论文" }],
      question: "第一问",
      answer: "第一答",
    });
    const continued = store.saveAiExchange({
      conversationId: first.id,
      mode: "ask",
      sources: [{ targetType: "article", targetId: "article-2", title: "新来源" }],
      question: "第二问",
      answer: "第二答",
    });

    assert.equal(continued.id, first.id);
    assert.equal(continued.mode, "compare");
    assert.equal(continued.title, "第一问");
    assert.deepEqual(continued.sources, first.sources);
    assert.equal(continued.primaryTargetId, "paper-1");
    assert.equal(continued.updatedAt, timestamps[1]);
    assert.equal(continued.messageCount, 4);
    assert.deepEqual(continued.messages.map((message) => message.content), [
      "第一问", "第一答", "第二问", "第二答",
    ]);
  } finally {
    database.close();
  }
});

test("AI 问答仓储拒绝续接不存在的会话且不写入孤立消息", () => {
  const database = createAiDatabase();
  try {
    const store = createStore(database);
    assert.throws(() => store.saveAiExchange({
      conversationId: "missing",
      question: "问题",
      answer: "答案",
    }), /找不到要继续的问答记录/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_messages").get().count, 0);
  } finally {
    database.close();
  }
});

test("AI 问答仓储在双消息写入失败时回滚整轮会话", () => {
  const database = createAiDatabase();
  try {
    const store = createAiHistoryStore(database, {
      currentTimestamp: () => "2026-09-16T10:00:00.000Z",
      randomUUID: () => "duplicate",
    });
    assert.throws(() => store.saveAiExchange({ question: "问题", answer: "答案" }));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_conversations").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_messages").get().count, 0);
  } finally {
    database.close();
  }
});

test("AI 问答历史保持正文搜索、来源过滤、更新时间排序和数量上限", () => {
  const database = createAiDatabase();
  try {
    const store = createStore(database, [
      "2026-09-16T08:00:00.000Z",
      "2026-09-16T09:00:00.000Z",
    ]);
    const first = store.saveAiExchange({
      sources: [{ targetType: "article", targetId: "article-1" }],
      question: "百分号 100% 的含义",
      answer: "第一条回答",
    });
    const second = store.saveAiExchange({
      sources: [{ targetType: "paper", targetId: "paper-1" }],
      question: "普通问题",
      answer: "包含可恢复位置",
    });
    assert.deepEqual(store.listAiConversations().map((item) => item.id), [second.id, first.id]);
    assert.deepEqual(store.listAiConversations({ query: "100%" }).map((item) => item.id), [first.id]);
    assert.deepEqual(store.listAiConversations({ query: "可恢复位置" }).map((item) => item.id), [second.id]);
    assert.deepEqual(store.listAiConversations({
      targetType: "article",
      targetId: "article-1",
    }).map((item) => item.id), [first.id]);
    assert.equal(store.listAiConversations({ limit: 1 }).length, 1);
    assert.equal(store.getAiConversation("missing"), null);
  } finally {
    database.close();
  }
});

test("AI 问答历史遇到损坏的来源或引用 JSON 时安全回退为空数组", () => {
  const database = createAiDatabase();
  try {
    database.prepare(`
      INSERT INTO ai_conversations(id, mode, title, source_refs_json, created_at, updated_at)
      VALUES ('conversation-1', 'ask', '历史记录', '{bad', '2026-09-16', '2026-09-16')
    `).run();
    database.prepare(`
      INSERT INTO ai_messages(
        id, conversation_id, role, content, selected_quote,
        citations_json, insufficient_evidence, created_at
      ) VALUES ('message-1', 'conversation-1', 'assistant', '回答', '', '{bad', 0, '2026-09-16')
    `).run();
    const conversation = createStore(database).getAiConversation("conversation-1");
    assert.deepEqual(conversation.sources, []);
    assert.deepEqual(conversation.messages[0].citations, []);
  } finally {
    database.close();
  }
});
