import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createKnowledgeCardStore } from "../lib/db/stores/knowledge-cards.mjs";

function createCardDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE knowledge_cards (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      card_type TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      source_quote TEXT NOT NULL,
      anchor_start INTEGER NOT NULL DEFAULT 0,
      anchor_end INTEGER NOT NULL DEFAULT 0,
      due_at TEXT NOT NULL,
      interval_days INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      review_count INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

function createDependencies(dates = ["2026-09-16T08:00:00.000Z"]) {
  const summaries = new Map([
    ["document:document-1", { title: "PostgreSQL 内核", category: "数据库" }],
    ["article:article-1", { title: "Agent 教程", category: "人工智能" }],
  ]);
  let dateIndex = 0;
  return {
    currentDate: () => new Date(dates[Math.min(dateIndex++, dates.length - 1)]),
    getKnowledgeTargetSummary: (targetType, targetId) => summaries.get(`${targetType}:${targetId}`) || null,
    normalizeKnowledgeTargetType: (targetType) => {
      const normalized = String(targetType ?? "").trim();
      if (!["document", "article", "paper"].includes(normalized)) {
        throw new Error("不支持的内容类型。");
      }
      return normalized;
    },
  };
}

function insertCard(database, {
  id,
  targetType = "document",
  targetId = "document-1",
  dueAt = "2026-09-16T07:00:00.000Z",
  intervalDays = 10,
  easeFactor = 2.5,
  updatedAt = "2026-09-16T06:00:00.000Z",
}) {
  database.prepare(`
    INSERT INTO knowledge_cards(
      id, target_type, target_id, card_type, question, answer, source_quote,
      anchor_start, anchor_end, due_at, interval_days, ease_factor,
      review_count, last_reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'concept', '问题', '答案', '原文', 1, 2, ?, ?, ?, 0, NULL, ?, ?)
  `).run(id, targetType, targetId, dueAt, intervalDays, easeFactor, updatedAt, updatedAt);
}

test("知识卡片创建保持来源校验、字段规范化、类型回退和锚点边界", () => {
  const database = createCardDatabase();
  try {
    const createdAt = "2026-09-16T08:00:00.000Z";
    const store = createKnowledgeCardStore(database, createDependencies([
      createdAt,
      "2026-09-16T08:00:01.000Z",
    ]));
    const card = store.createKnowledgeCard({
      targetType: "document",
      targetId: " document-1 ",
      cardType: "unknown",
      question: "  MVCC   有什么作用？  ",
      answer: "  提供一致性快照。  ",
      sourceQuote: "  原文片段  ",
      anchorStart: -5,
      anchorEnd: -1,
    });
    assert.match(card.id, /^card_/);
    assert.equal(card.targetId, "document-1");
    assert.equal(card.cardType, "concept");
    assert.equal(card.question, "MVCC 有什么作用？");
    assert.equal(card.answer, "提供一致性快照。");
    assert.equal(card.sourceQuote, "原文片段");
    assert.equal(card.anchorStart, 0);
    assert.equal(card.anchorEnd, 0);
    assert.equal(card.dueAt, createdAt);
    assert.equal(card.sourceTitle, "PostgreSQL 内核");
    assert.equal(card.sourceCategory, "数据库");
    assert.equal(card.intervalDays, 0);
    assert.equal(card.easeFactor, 2.5);
  } finally {
    database.close();
  }
});

test("知识卡片创建拒绝无效来源、类型和缺失的正反面或原文", () => {
  const database = createCardDatabase();
  try {
    const store = createKnowledgeCardStore(database, createDependencies());
    const baseCard = {
      targetType: "document",
      targetId: "document-1",
      question: "问题",
      answer: "答案",
      sourceQuote: "原文",
    };
    assert.throws(
      () => store.createKnowledgeCard({ ...baseCard, targetType: "video" }),
      /不支持的内容类型/,
    );
    assert.throws(
      () => store.createKnowledgeCard({ ...baseCard, targetId: "missing" }),
      /找不到卡片对应的来源内容/,
    );
    assert.throws(
      () => store.createKnowledgeCard({ ...baseCard, question: "  " }),
      /卡片问题、答案和来源原文都不能为空/,
    );
  } finally {
    database.close();
  }
});

test("知识卡片列表保持到期筛选、排序、数量上限和来源删除回退", () => {
  const database = createCardDatabase();
  try {
    insertCard(database, { id: "card-later", dueAt: "2026-09-17T00:00:00.000Z" });
    insertCard(database, { id: "card-due-2", dueAt: "2026-09-16T07:00:00.000Z", updatedAt: "2026-09-16T06:02:00.000Z" });
    insertCard(database, { id: "card-due-1", targetId: "deleted", dueAt: "2026-09-16T06:00:00.000Z" });
    const store = createKnowledgeCardStore(database, createDependencies());
    assert.deepEqual(
      store.listKnowledgeCards({ dueOnly: true }).map((card) => card.id),
      ["card-due-1", "card-due-2"],
    );
    const first = store.listKnowledgeCards({ limit: 1 })[0];
    assert.equal(first.id, "card-due-1");
    assert.equal(first.sourceTitle, "来源已删除");
    assert.equal(first.sourceCategory, "");
  } finally {
    database.close();
  }
});

test("知识卡片复习保持四档间隔、难度边界、计数和缺失卡片语义", () => {
  const database = createCardDatabase();
  try {
    for (const rating of ["again", "hard", "good", "easy", "unknown"]) {
      insertCard(database, { id: `card-${rating}` });
    }
    insertCard(database, { id: "card-min", easeFactor: 1.3 });
    insertCard(database, { id: "card-max", easeFactor: 3.2 });
    const reviewedAt = "2026-09-16T10:00:00.000Z";
    const store = createKnowledgeCardStore(database, createDependencies([reviewedAt]));
    const expectations = new Map([
      ["again", [1, 2.3]],
      ["hard", [12, 2.45]],
      ["good", [22, 2.5]],
      ["easy", [30, 2.65]],
      ["unknown", [22, 2.5]],
    ]);
    for (const [rating, [intervalDays, easeFactor]] of expectations) {
      const card = store.reviewKnowledgeCard(`card-${rating}`, rating);
      assert.equal(card.intervalDays, intervalDays);
      assert.equal(card.easeFactor, easeFactor);
      assert.equal(card.reviewCount, 1);
      assert.equal(card.lastReviewedAt, reviewedAt);
      assert.equal(
        card.dueAt,
        new Date(new Date(reviewedAt).getTime() + intervalDays * 86_400_000).toISOString(),
      );
    }
    assert.equal(store.reviewKnowledgeCard("card-min", "again").easeFactor, 1.3);
    assert.equal(store.reviewKnowledgeCard("card-max", "easy").easeFactor, 3.2);
    assert.equal(store.reviewKnowledgeCard("missing", "good"), null);
  } finally {
    database.close();
  }
});

test("知识卡片删除返回是否实际删除且不影响其它卡片", () => {
  const database = createCardDatabase();
  try {
    insertCard(database, { id: "card-1" });
    insertCard(database, { id: "card-2" });
    const store = createKnowledgeCardStore(database, createDependencies());
    assert.equal(store.deleteKnowledgeCard("card-1"), true);
    assert.equal(store.deleteKnowledgeCard("card-1"), false);
    assert.deepEqual(store.listKnowledgeCards().map((card) => card.id), ["card-2"]);
  } finally {
    database.close();
  }
});
