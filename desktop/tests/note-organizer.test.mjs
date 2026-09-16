import assert from "node:assert/strict";
import test from "node:test";
import { calculateNextNoteRun, createLocalNoteDigest } from "../lib/note-organizer.mjs";

test("本地笔记整理归纳主题、重点、问题和行动且保留来源", () => {
  const notes = [
    { targetType: "paper", targetId: "p1", title: "HNSW", category: "向量检索", noteText: "# 我的理解\n分层图降低远距离搜索成本。\n问题：为什么高维仍有效？\n下一步复现 ef 参数实验。" },
    { targetType: "document", targetId: "d1", title: "RAG 实验", category: "检索增强", noteText: "召回率要和回答正确率一起验证。" },
  ];
  const digest = createLocalNoteDigest(notes, new Date("2026-09-14T12:00:00Z"));
  assert.match(digest.overview, /2 条笔记/);
  assert.deepEqual(new Set(digest.themes.map((item) => item.name)), new Set(["向量检索", "检索增强"]));
  assert.equal(digest.questions[0].targetId, "p1");
  assert.match(digest.actions[0].text, /复现/);
  assert.equal(notes[0].noteText.includes("分层图"), true);
});

test("每日与每周计划始终计算到未来的本地时刻", () => {
  const from = new Date(2026, 8, 14, 22, 30, 0);
  const daily = new Date(calculateNextNoteRun({ frequency: "daily", time: "21:00" }, from));
  assert.equal(daily.getDate(), 15);
  assert.equal(daily.getHours(), 21);
  const weekly = new Date(calculateNextNoteRun({ frequency: "weekly", weekday: 0, time: "21:00" }, from));
  assert.equal(weekly.getDay(), 0);
  assert.equal(weekly.getHours(), 21);
  assert.ok(weekly > from);
});
