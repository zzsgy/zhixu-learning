import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountNotesCenter } from "../public/notes-center.js";

function fixture() {
  return parseHTML(`<section id="notes-view"><span id="notes-total"></span><span id="notes-pending"></span><span id="notes-latest"></span><span id="notes-organized"></span><span id="notes-result-status"></span><input id="notes-search"><select id="notes-type-filter"><option value=""></option><option value="paper"></option></select><div id="notes-list"></div><div id="notes-empty"></div><button id="notes-organize-now"></button><form id="notes-schedule-form"><input id="notes-schedule-enabled" type="checkbox"><select id="notes-schedule-frequency"><option value="weekly"></option><option value="daily"></option></select><label id="notes-schedule-weekday-field"><select id="notes-schedule-weekday"><option value="0"></option></select></label><input id="notes-schedule-time" type="time"><button type="submit"></button></form><p id="notes-next-run"></p><div id="notes-digests"></div><span id="notes-digest-count"></span></section>`);
}

test("笔记页安全汇总并可从笔记和整理结果返回来源", async () => {
  const { document, window } = fixture();
  const calls = [];
  const opened = [];
  const payload = {
    notes: [{ targetType: "paper", targetId: "p1", title: "HNSW", category: "检索", noteText: "<img src=x onerror=alert(1)> 核心结论", updatedAt: "2026-09-14T12:00:00Z", annotationCount: 2 }],
    total: 1,
    summary: { noteCount: 1, pendingCount: 1, latestNoteAt: "2026-09-14T12:00:00Z" },
    settings: { enabled: true, frequency: "weekly", weekday: 0, time: "21:00", nextRunAt: "2026-09-20T13:00:00Z" },
    digests: [{ id: "g1", noteCount: 1, createdAt: "2026-09-14T12:00:00Z", digest: { title: "本周整理", overview: "一条重点", themes: [{ name: "检索", count: 1 }], keyPoints: [{ targetType: "paper", targetId: "p1", title: "HNSW", text: "分层图是重点" }] } }],
  };
  const request = async (url, options = {}) => { calls.push({ url, options }); return url === "/api/notes/organize" ? { message: "完成" } : payload; };
  const center = mountNotesCenter({ document, request, notify: () => {}, openSource: (...args) => opened.push(args) });
  await center.load();
  assert.equal(document.querySelector("#notes-total").textContent, "1");
  assert.equal(document.querySelectorAll(".notes-card img").length, 0);
  assert.match(document.querySelector(".notes-card-excerpt").textContent, /<img/);
  document.querySelector(".notes-open-source").click();
  document.querySelector(".notes-digest-group button").click();
  assert.deepEqual(opened, [["paper", "p1"], ["paper", "p1"]]);
  document.querySelector("#notes-schedule-frequency option[value='daily']").setAttribute("selected", "selected");
  document.querySelector("#notes-schedule-frequency").dispatchEvent(new window.Event("change"));
  assert.equal(document.querySelector("#notes-schedule-weekday-field").hidden, true);
  assert.equal(calls[0].url.startsWith("/api/notes?"), true);
});
