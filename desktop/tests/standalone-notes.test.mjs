import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("三种独立笔记与伴读笔记统一搜索、整理且类型筛选稳定", async () => {
  const project = path.resolve(import.meta.dirname, "..");
  const testRoot = path.join(project, ".test-data");
  fs.mkdirSync(testRoot, { recursive: true });
  const dataDirectory = fs.mkdtempSync(path.join(testRoot, "standalone-notes-"));
  process.env.ZHIXU_DATA_DIR = dataDirectory;
  process.env.ZHIXU_ENV_FILE = path.join(dataDirectory, "absent.env");
  const db = await import("../lib/database.mjs");
  try {
    const notes = ["markdown", "text", "word"].map((type) => db.createStandaloneNote(type));
    assert.deepEqual(notes.map((note) => note.noteType), ["markdown", "text", "word"]);
    assert.throws(() => db.createStandaloneNote("mindmap"), /不支持这种笔记类型/);
    db.updateStandaloneNote(notes[0].id, { title: "RAG 设计", contentText: "# 检索\n验证召回率。" });
    db.updateStandaloneNote(notes[1].id, { title: "快速记录", contentText: "待办：复现索引。" });
    db.updateStandaloneNote(notes[2].id, { title: "周报", contentText: "本周完成 Word 导出。", contentData: { html: "<h2>本周</h2><p>完成导出</p>" } });

    assert.equal(db.listAllNotes().total, 3);
    assert.equal(db.listAllNotes({ query: "召回率" }).items[0].noteType, "markdown");
    assert.equal(db.getNoteLibrarySummary().noteCount, 3);
    assert.equal(db.listAllNotes({ updatedAfter: "2000-01-01T00:00:00.000Z" }).total, 3);
    assert.equal(db.deleteStandaloneNote(notes[1].id), true);
    assert.equal(db.getStandaloneNote(notes[1].id), null);
  } finally {
    db.closeDatabase();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
