import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createPaperFolderStore } from "../lib/paper-folders.mjs";

function fixture(count = 3) {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE papers(id TEXT PRIMARY KEY,title TEXT,title_zh TEXT,abstract TEXT,abstract_zh TEXT,authors_json TEXT,created_at TEXT,published_at TEXT,source_type TEXT,full_translation_html TEXT,full_translation_fidelity TEXT,full_translation_status TEXT,extraction_error TEXT);
    CREATE TABLE reading_states(target_type TEXT,target_id TEXT,reading_status TEXT,note_text TEXT,PRIMARY KEY(target_type,target_id));
    CREATE TABLE import_jobs(target_type TEXT,target_id TEXT,status TEXT);
    CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT); INSERT INTO folders VALUES('document_folder','不要改动');
  `);
  const insert = db.prepare("INSERT INTO papers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (let i=0;i<count;i++) insert.run(`p${i}`, `Paper ${i}`, `论文 ${i}`, "abstract", "中文摘要", '["Author A"]', new Date(2026,0,1+i).toISOString(), "2025-01-01", i%2 ? "manual" : "classic", "正文".repeat(4000), "complete", "ready", null);
  db.prepare("INSERT INTO reading_states VALUES('paper','p0','reading','我的笔记')").run();
  return { db, store:createPaperFolderStore(db) };
}

test("论文目录独立、同名边界、重命名及子树移动保护", () => {
  const { db, store } = fixture();
  try {
    const a=store.create({name:"Agent"}), b=store.create({name:"RAG"}), child=store.create({name:"基础",parentId:a.id});
    assert.throws(()=>store.create({name:"agent"}),/同名/);
    assert.throws(()=>store.update(b.id,{name:"Agent"}),/同名/);
    assert.throws(()=>store.create({name:"x",parentId:"absent"}),/不存在/);
    assert.throws(()=>store.update(a.id,{parentId:child.id}),/子目录/);
    store.assign(["p0"],child.id);
    store.update(child.id,{parentId:b.id,name:"基础理论"});
    assert.deepEqual(store.list().find(f=>f.id===child.id).path.map(p=>p.name),["RAG","基础理论"]);
    assert.equal(store.list().find(f=>f.id===b.id).count,1);
    assert.equal(db.prepare("SELECT name FROM folders").get().name,"不要改动");
    assert.equal(db.prepare("SELECT note_text FROM reading_states").get().note_text,"我的笔记");
    assert.equal(createPaperFolderStore(db).list().length,3);
  } finally { db.close(); }
});

test("批量归档原子提交，目录删除仅解除归档，不删除论文或阅读数据", () => {
  const { db, store } = fixture();
  try {
    const root=store.create({name:"研究"}), child=store.create({name:"子目录",parentId:root.id});
    store.assign(["p0","p1","p1"],root.id);
    assert.throws(()=>store.assign(["p0","absent"],child.id),/整批/);
    assert.equal(store.page({folder:root.id,descendants:"0"}).total,2);
    assert.throws(()=>store.remove(root.id),/含子目录/);
    store.remove(child.id);
    assert.equal(store.remove(root.id),2);
    assert.equal(store.page({folder:"unfiled"}).total,3);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM papers").get().n,3);
    assert.equal(db.prepare("SELECT note_text FROM reading_states").get().note_text,"我的笔记");
    const next=store.create({name:"级联检查"}); store.assign(["p2"],next.id);
    db.prepare("DELETE FROM papers WHERE id='p2'").run();
    assert.equal(store.list()[0].count,0);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  } finally { db.close(); }
});

test("1005 篇论文分页完整，目录范围、组合搜索、阅读与质量筛选正确", () => {
  const { db, store } = fixture(1005);
  try {
    const a=store.create({name:"父目录"}), b=store.create({name:"子目录",parentId:a.id});
    store.assign(["p0","p1"],a.id); store.assign(["p2"],b.id);
    assert.equal(store.page({folder:a.id}).total,3);
    assert.equal(store.page({folder:a.id,descendants:"0"}).total,2);
    assert.equal(store.page({folder:a.id,source:"manual"}).total,1);
    assert.equal(store.page({reading:"reading"}).rows[0].id,"p0");
    assert.equal(store.page({reading:"unread"}).total,1004);
    assert.equal(store.page({q:"AUTHOR A"}).total,1005);
    assert.equal(store.page({q:"' OR 1=1 --"}).total,0);
    assert.equal(store.page({quality:"duplicate"},["p0","p2"]).total,2);
    assert.equal(store.page({quality:"failed"}).total,0);
    db.prepare("INSERT INTO import_jobs VALUES('paper','p2','failed')").run();
    assert.equal(store.page({quality:"failed"}).total,1);
    const ids=new Set(); for(let page=1;page<=42;page++) for(const row of store.page({page}).rows) { assert(row.full_translation_html.length<=3000); ids.add(row.id); }
    assert.equal(ids.size,1005); assert.equal(store.page({page:999}).page,42);
    assert.throws(()=>store.page({folder:"missing"}),/目录已不存在/);
  } finally { db.close(); }
});
