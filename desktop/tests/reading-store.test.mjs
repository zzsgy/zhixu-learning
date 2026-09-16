import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createReadingStore } from "../lib/db/stores/reading.mjs";

function createReadingDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE documents (id TEXT PRIMARY KEY);
    CREATE TABLE articles (id TEXT PRIMARY KEY);
    CREATE TABLE papers (id TEXT PRIMARY KEY);
    CREATE TABLE reading_states (
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reading_status TEXT NOT NULL DEFAULT 'unread',
      progress_percent REAL NOT NULL DEFAULT 0,
      note_text TEXT NOT NULL DEFAULT '',
      note_html TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(target_type, target_id)
    );
    CREATE TABLE reading_sessions (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      ended_at TEXT,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      progress_start REAL NOT NULL DEFAULT 0,
      progress_end REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE reading_session_days (
      session_id TEXT NOT NULL,
      local_day TEXT NOT NULL,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(session_id, local_day),
      FOREIGN KEY(session_id) REFERENCES reading_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE reading_annotations (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      quote_text TEXT NOT NULL,
      anchor_start INTEGER NOT NULL,
      anchor_end INTEGER NOT NULL,
      color TEXT NOT NULL DEFAULT 'yellow',
      note_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  database.prepare("INSERT INTO documents(id) VALUES (?)").run("document-1");
  database.prepare("INSERT INTO articles(id) VALUES (?)").run("article-1");
  database.prepare("INSERT INTO papers(id) VALUES (?)").run("paper-1");
  return database;
}

test("阅读状态仓储保持默认值、局部更新、富文本清洗和输入边界", () => {
  const database = createReadingDatabase();
  try {
    const timestamp = "2026-09-16T01:02:03.000Z";
    const store = createReadingStore(database, { currentTimestamp: () => timestamp });
    assert.deepEqual(store.getReadingWorkspace("document", "document-1"), {
      targetType: "document",
      targetId: "document-1",
      state: {
        status: "unread",
        progressPercent: 0,
        noteText: "",
        noteHtml: "",
        updatedAt: null,
      },
      annotations: [],
    });
    assert.equal(store.getReadingWorkspace("document", "missing"), null);
    assert.equal(store.updateReadingState("article", "missing", { status: "reading" }), null);
    assert.throws(
      () => store.getReadingWorkspace("video", "video-1"),
      /不支持的阅读内容类型/,
    );

    const richState = store.updateReadingState("document", "document-1", {
      status: "reading",
      progressPercent: 120,
      noteHtml: '<h2 style="font-family: SimSun" onclick="bad()">结论</h2><script>危险</script><p>保留内容</p>',
    });
    assert.equal(richState.status, "reading");
    assert.equal(richState.progressPercent, 100);
    assert.equal(richState.updatedAt, timestamp);
    assert.match(richState.noteHtml, /font-family: SimSun/);
    assert.doesNotMatch(richState.noteHtml, /script|onclick|危险/);
    assert.match(richState.noteText, /结论/);
    assert.match(richState.noteText, /保留内容/);

    const progressOnly = store.updateReadingState("document", "document-1", {
      progressPercent: -5,
    });
    assert.equal(progressOnly.progressPercent, 0);
    assert.equal(progressOnly.noteHtml, richState.noteHtml);
    assert.equal(progressOnly.noteText, richState.noteText);

    const legacyText = store.updateReadingState("document", "document-1", {
      noteText: "旧版纯文本笔记",
    });
    assert.equal(legacyText.noteText, "旧版纯文本笔记");
    assert.equal(legacyText.noteHtml, "");
    assert.throws(
      () => store.updateReadingState("document", "document-1", { status: "paused" }),
      /阅读状态无效/,
    );
  } finally {
    database.close();
  }
});

test("阅读批注仓储保持位置排序、字段校验、修改和幂等删除", () => {
  const database = createReadingDatabase();
  try {
    const timestamps = [
      "2026-09-16T02:00:00.000Z",
      "2026-09-16T02:01:00.000Z",
      "2026-09-16T02:02:00.000Z",
    ];
    let timestampIndex = 0;
    const store = createReadingStore(database, {
      currentTimestamp: () => timestamps[timestampIndex++],
    });
    assert.equal(store.createReadingAnnotation("paper", "missing", {
      quoteText: "片段",
      anchorStart: 0,
      anchorEnd: 2,
    }), null);

    const later = store.createReadingAnnotation("paper", "paper-1", {
      quoteText: " 后面的片段 ",
      anchorStart: 20,
      anchorEnd: 25,
      color: "yellow",
      noteText: "初始批注",
    });
    const earlier = store.createReadingAnnotation("paper", "paper-1", {
      quoteText: "前面的片段",
      anchorStart: 2,
      anchorEnd: 8,
      color: "green",
    });
    assert.match(later.id, /^annotation_/);
    assert.equal(later.quoteText, "后面的片段");
    assert.deepEqual(
      store.getReadingWorkspace("paper", "paper-1").annotations.map((item) => item.id),
      [earlier.id, later.id],
    );

    const updated = store.updateReadingAnnotation(later.id, {
      color: "blue",
      noteText: "更新后的批注",
    });
    assert.equal(updated.color, "blue");
    assert.equal(updated.noteText, "更新后的批注");
    assert.equal(updated.updatedAt, timestamps[2]);
    assert.equal(store.updateReadingAnnotation("missing", { color: "red" }), null);
    assert.throws(
      () => store.createReadingAnnotation("paper", "paper-1", {
        quoteText: "",
        anchorStart: 1,
        anchorEnd: 1,
      }),
      /请选择有效的原文内容/,
    );
    assert.throws(
      () => store.updateReadingAnnotation(earlier.id, { color: "purple" }),
      /高亮颜色无效/,
    );
    assert.equal(store.deleteReadingAnnotation(later.id), true);
    assert.equal(store.deleteReadingAnnotation(later.id), false);
  } finally {
    database.close();
  }
});

test("阅读会话仓储按本机日期幂等累计、限制进度并固定首次结束时间", () => {
  const database = createReadingDatabase();
  try {
    const timestamps = [
      new Date(2026, 8, 11, 23, 59, 30).toISOString(),
      new Date(2026, 8, 12, 0, 0, 20).toISOString(),
      new Date(2026, 8, 12, 0, 0, 25).toISOString(),
      new Date(2026, 8, 12, 0, 0, 30).toISOString(),
      new Date(2026, 8, 12, 0, 0, 40).toISOString(),
      new Date(2026, 8, 12, 0, 0, 50).toISOString(),
    ];
    let timestampIndex = 0;
    const store = createReadingStore(database, {
      currentTimestamp: () => timestamps[timestampIndex++],
    });
    assert.equal(store.startReadingSession("article", "missing", 10), null);
    const session = store.startReadingSession("article", "article-1", 150);
    assert.match(session.id, /^reading_session_/);
    assert.equal(session.progressStart, 100);
    assert.equal(session.progressEnd, 100);

    const firstDay = "2026-09-11";
    const secondDay = "2026-09-12";
    const firstUpdate = store.updateReadingSession(session.id, {
      activeSeconds: 50,
      progressPercent: 60,
      activeSecondsByDay: { [firstDay]: 30, [secondDay]: 20 },
    });
    assert.equal(firstUpdate.activeSeconds, 50);
    assert.equal(firstUpdate.progressEnd, 60);
    const duplicate = store.updateReadingSession(session.id, {
      activeSeconds: 50,
      progressPercent: 60,
      activeSecondsByDay: { [firstDay]: 30, [secondDay]: 20 },
    });
    assert.equal(duplicate.activeSeconds, 50);
    const lowerTotal = store.updateReadingSession(session.id, {
      activeSeconds: 20,
      progressPercent: -5,
    });
    assert.equal(lowerTotal.activeSeconds, 50);
    assert.equal(lowerTotal.progressEnd, 0);

    const ended = store.updateReadingSession(session.id, {
      activeSeconds: 60,
      progressPercent: 70,
      activeSecondsByDay: { [firstDay]: 30, [secondDay]: 30 },
      ended: true,
    });
    const endedAgain = store.updateReadingSession(session.id, {
      activeSeconds: 60,
      ended: true,
    });
    assert.equal(ended.endedAt, timestamps[4]);
    assert.equal(endedAgain.endedAt, ended.endedAt);
    assert.equal(store.updateReadingSession("missing", { activeSeconds: 10 }), null);

    const dayTotals = Object.fromEntries(
      database.prepare(`
        SELECT local_day, active_seconds
        FROM reading_session_days
        WHERE session_id = ?
        ORDER BY local_day
      `).all(session.id).map((row) => [row.local_day, Number(row.active_seconds)]),
    );
    assert.deepEqual(dayTotals, { [firstDay]: 30, [secondDay]: 30 });
    assert.equal(
      database.prepare("SELECT active_seconds FROM reading_sessions WHERE id = ?").get(session.id).active_seconds,
      60,
    );
  } finally {
    database.close();
  }
});
