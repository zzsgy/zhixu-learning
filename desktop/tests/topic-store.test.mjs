import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createTopicStore } from "../lib/db/stores/topics.mjs";

function createTopicDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE topics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE topic_items (
      topic_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(topic_id, target_type, target_id),
      FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );
  `);
  return database;
}

function createDependencies(timestamps) {
  const validTypes = new Set(["document", "article", "paper"]);
  const summaries = new Map([
    ["document:document-1", {
      targetType: "document",
      targetId: "document-1",
      title: "设备手册",
      category: "工作",
    }],
    ["article:article-1", {
      targetType: "article",
      targetId: "article-1",
      title: "Agent 教程",
      category: "学习",
    }],
  ]);
  let timestampIndex = 0;
  return {
    currentTimestamp: () => timestamps[Math.min(timestampIndex++, timestamps.length - 1)],
    getKnowledgeTargetSummary: (targetType, targetId) => summaries.get(`${targetType}:${targetId}`) || null,
    listContentTags: (targetType, targetId) => [`${targetType}-${targetId}-标签`],
    normalizeKnowledgeTargetType: (targetType) => {
      const normalized = String(targetType ?? "").trim();
      if (!validTypes.has(normalized)) throw new Error("不支持的内容类型。");
      return normalized;
    },
  };
}

test("专题仓储保持名称规范化、说明边界、数量统计和更新时间排序", () => {
  const database = createTopicDatabase();
  try {
    const timestamps = [
      "2026-09-16T07:00:00.000Z",
      "2026-09-16T07:01:00.000Z",
    ];
    const store = createTopicStore(database, createDependencies(timestamps));
    const first = store.createTopic({ name: "  Agent   学习  ", description: "  专题说明  " });
    assert.match(first.id, /^topic_/);
    assert.equal(first.name, "Agent 学习");
    assert.equal(first.description, "专题说明");
    assert.equal(first.itemCount, 0);
    assert.equal(first.createdAt, timestamps[0]);
    const second = store.createTopic({ name: "数据库", description: "PostgreSQL" });
    assert.deepEqual(store.listTopics().map((topic) => topic.id), [second.id, first.id]);
    assert.throws(() => store.createTopic({ name: "   " }), /专题名称不能为空/);
    assert.throws(() => store.createTopic({ name: "数据库" }));
  } finally {
    database.close();
  }
});

test("专题内容保持摘要、标签、倒序、重复添加幂等和内容数量", () => {
  const database = createTopicDatabase();
  try {
    const timestamps = [
      "2026-09-16T08:00:00.000Z",
      "2026-09-16T08:01:00.000Z",
      "2026-09-16T08:02:00.000Z",
      "2026-09-16T08:03:00.000Z",
    ];
    const store = createTopicStore(database, createDependencies(timestamps));
    const topic = store.createTopic({ name: "技术学习" });
    store.addTopicItem(topic.id, "document", "document-1");
    const items = store.addTopicItem(topic.id, "article", "article-1");
    assert.deepEqual(items.map((item) => item.targetId), ["article-1", "document-1"]);
    assert.equal(items[0].title, "Agent 教程");
    assert.deepEqual(items[0].tags, ["article-article-1-标签"]);
    assert.equal(items[0].addedAt, timestamps[2]);

    const repeated = store.addTopicItem(topic.id, "document", "document-1");
    assert.equal(repeated.length, 2);
    assert.equal(store.listTopics()[0].itemCount, 2);
    assert.equal(store.listTopics()[0].updatedAt, timestamps[3]);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM topic_items WHERE topic_id = ?").get(topic.id).count,
      2,
    );
  } finally {
    database.close();
  }
});

test("专题内容写入保持专题、内容和类型校验，移除后返回最新列表", () => {
  const database = createTopicDatabase();
  try {
    const timestamps = [
      "2026-09-16T09:00:00.000Z",
      "2026-09-16T09:01:00.000Z",
      "2026-09-16T09:02:00.000Z",
      "2026-09-16T09:03:00.000Z",
    ];
    const store = createTopicStore(database, createDependencies(timestamps));
    const topic = store.createTopic({ name: "验证专题" });
    assert.throws(
      () => store.addTopicItem("missing", "document", "document-1"),
      /找不到专题/,
    );
    assert.throws(
      () => store.addTopicItem(topic.id, "document", "missing"),
      /找不到对应内容/,
    );
    assert.throws(
      () => store.addTopicItem(topic.id, "video", "video-1"),
      /不支持的内容类型/,
    );
    store.addTopicItem(topic.id, "document", "document-1");
    store.addTopicItem(topic.id, "article", "article-1");
    const remaining = store.removeTopicItem(topic.id, "document", "document-1");
    assert.deepEqual(remaining.map((item) => item.targetId), ["article-1"]);
    assert.equal(store.listTopics()[0].updatedAt, timestamps[3]);
    assert.deepEqual(store.removeTopicItem("missing", "document", "document-1"), []);
  } finally {
    database.close();
  }
});
