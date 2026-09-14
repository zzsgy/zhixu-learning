import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { initializeReadingSessionDays, localReadingDay, recordReadingDayIncrement } from "../lib/reading-session-days.mjs";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE reading_sessions(id TEXT PRIMARY KEY,started_at TEXT,last_active_at TEXT,active_seconds INTEGER);
  `);
  return database;
}
function apply(database, seconds, now, byDay) {
  const old = database.prepare("SELECT * FROM reading_sessions WHERE id='session'").get();
  database.exec("BEGIN");
  recordReadingDayIncrement(database, {
    sessionId: "session", startedAt: old.started_at, previousSeconds: old.active_seconds,
    activeSeconds: Math.max(old.active_seconds, seconds), activeSecondsByDay: byDay, now,
  });
  database.prepare("UPDATE reading_sessions SET active_seconds=MAX(active_seconds,?),last_active_at=? WHERE id='session'").run(seconds, now);
  database.exec("COMMIT");
}
function totals(database) {
  return Object.fromEntries(database.prepare("SELECT local_day,active_seconds FROM reading_session_days ORDER BY local_day")
    .all().map((row) => [row.local_day, row.active_seconds]));
}

test("历史会话按原最后活动日只回填一次；重启不会把旧时长迁往新一天", () => {
  const database = fixture();
  try {
    database.prepare("INSERT INTO reading_sessions VALUES (?,?,?,?)").run(
      "session", new Date(2026, 8, 10, 22).toISOString(), new Date(2026, 8, 11, 1).toISOString(), 120,
    );
    initializeReadingSessionDays(database);
    assert.deepEqual(totals(database), { "2026-09-11": 120 });
    apply(database, 150, new Date(2026, 8, 12, 9).toISOString());
    initializeReadingSessionDays(database);
    assert.deepEqual(totals(database), { "2026-09-11": 120, "2026-09-12": 30 });
  } finally { database.close(); }
});

test("跨午夜累计分别记入两天，重复和乱序提交不重复计时", () => {
  const database = fixture();
  try {
    database.prepare("INSERT INTO reading_sessions VALUES (?,?,?,?)").run(
      "session", new Date(2026, 8, 11, 23, 59).toISOString(), new Date(2026, 8, 11, 23, 59).toISOString(), 0,
    );
    initializeReadingSessionDays(database);
    apply(database, 20, new Date(2026, 8, 11, 23, 59, 50).toISOString(), { "2026-09-11": 20 });
    const now = new Date(2026, 8, 12, 0, 0, 20).toISOString();
    apply(database, 50, now, { "2026-09-11": 30, "2026-09-12": 20 });
    apply(database, 50, now, { "2026-09-11": 30, "2026-09-12": 20 });
    apply(database, 20, now, { "2026-09-11": 20 });
    assert.deepEqual(totals(database), { "2026-09-11": 30, "2026-09-12": 20 });
    // 没有新增阅读秒数的隔日关闭，不会移动或创建活动日。
    apply(database, 50, new Date(2026, 8, 13, 8).toISOString());
    assert.deepEqual(totals(database), { "2026-09-11": 30, "2026-09-12": 20 });
    database.prepare("DELETE FROM reading_sessions WHERE id='session'").run();
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM reading_session_days").get().count, 0);
  } finally { database.close(); }
});

test("非法日期和超过累计总量的分日输入不增加总秒数", () => {
  const database = fixture();
  try {
    const now = new Date(2026, 8, 12, 9).toISOString();
    database.prepare("INSERT INTO reading_sessions VALUES (?,?,?,?)").run("session", now, now, 0);
    initializeReadingSessionDays(database);
    apply(database, 10, now, { "2026-99-99": 900, "2027-01-01": 900, "2026-09-12": 10000 });
    assert.deepEqual(totals(database), { "2026-09-12": 10 });
  } finally { database.close(); }
});

test("浏览器十五秒心跳跨午夜时分开累计到本地两天", () => {
  const source = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const fn = source.match(/function accumulateReadingActivity\(allowHidden = false\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  const now = new Date(2026, 8, 12, 0, 0, 5).getTime();
  class FakeDate extends Date { static now() { return now; } }
  const state = {
    readingActivityLastTickAt: now - 10000, readingActivityLastInteractionAt: now,
    readingActivitySeconds: 0, readingActivitySecondsByDay: {},
  };
  const context = vm.createContext({ Date: FakeDate, applicationState: state, document: { visibilityState: "visible" } });
  vm.runInContext(`${fn}\naccumulateReadingActivity();`, context);
  assert.equal(state.readingActivitySeconds, 10);
  assert.equal(state.readingActivitySecondsByDay["2026-09-11"], 5);
  assert.equal(state.readingActivitySecondsByDay["2026-09-12"], 5);
  assert.equal(localReadingDay(now), "2026-09-12");
});
