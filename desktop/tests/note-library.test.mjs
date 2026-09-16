import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("独立笔记库汇总原伴读笔记并单独保存整理结果", async () => {
  const project = path.resolve(import.meta.dirname, "..");
  const testRoot = path.join(project, ".test-data");
  fs.mkdirSync(testRoot, { recursive: true });
  const dataDirectory = fs.mkdtempSync(path.join(testRoot, "notes-library-"));
  process.env.ZHIXU_DATA_DIR = dataDirectory;
  process.env.ZHIXU_ENV_FILE = path.join(dataDirectory, "absent.env");
  const db = await import("../lib/database.mjs");
  try {
    const first = db.upsertImportedPaper({ externalId: "manual:notes-1", title: "Vector Index", titleZh: "向量索引", category: "向量检索", sourceUrl: "https://example.test/notes-1", sourceText: "source" });
    const second = db.upsertImportedPaper({ externalId: "manual:notes-2", title: "Agent Tools", titleZh: "智能体工具", category: "智能体", sourceUrl: "https://example.test/notes-2", sourceText: "source" });
    db.updateReadingState("paper", first.id, { noteHtml: '<h2 style="font-family: SimSun">结论</h2><p>HNSW 需要平衡<strong>召回率</strong>与延迟。</p><table><tr><td>参数</td></tr></table>' });
    db.updateReadingState("paper", second.id, { noteText: "下一步验证工具调用失败重试。" });
    const all = db.listReadingNotes();
    assert.equal(all.total, 2);
    assert.equal(db.listReadingNotes({ query: "召回率" }).items[0].title, "向量索引");
    assert.match(db.getReadingWorkspace("paper", first.id).state.noteHtml, /font-family: SimSun/);
    assert.match(all.items.find((item) => item.targetId === first.id).noteHtml, /<table>/);
    assert.equal(db.listReadingNotes({ targetType: "document" }).total, 0);

    const original = db.getReadingWorkspace("paper", first.id).state.noteText;
    const digest = db.createNoteDigest({ periodStart: null, periodEnd: new Date().toISOString(), notes: all.items, digest: { title: "首次整理", themes: [] } });
    assert.equal(digest.sourceCount, 2);
    assert.equal(db.listNoteDigests()[0].digest.title, "首次整理");
    assert.equal(db.getReadingWorkspace("paper", first.id).state.noteText, original);

    const settings = db.updateNoteOrganizationSettings({ frequency: "daily", time: "20:30", enabled: true, nextRunAt: "2026-09-15T12:30:00.000Z" });
    assert.equal(settings.frequency, "daily");
    assert.equal(db.getNoteOrganizationSettings().time, "20:30");
  } finally {
    db.closeDatabase();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
