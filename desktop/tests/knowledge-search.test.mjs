import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { searchKnowledgePage } from "../lib/knowledge-search.mjs";

function createFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, title TEXT, display_title TEXT DEFAULT '', category TEXT DEFAULT 'AI',
      summary TEXT DEFAULT '', extracted_text TEXT DEFAULT '', updated_at TEXT DEFAULT '2026-09-12T00:00:00.000Z'
    );
    CREATE TABLE articles (
      id TEXT PRIMARY KEY, title TEXT, display_title TEXT DEFAULT '', category TEXT DEFAULT 'AI',
      summary TEXT DEFAULT '', content_text TEXT DEFAULT '', translated_title TEXT DEFAULT '',
      translated_summary TEXT DEFAULT '', translated_text TEXT DEFAULT '',
      updated_at TEXT DEFAULT '2026-09-12T00:00:00.000Z'
    );
    CREATE TABLE papers (
      id TEXT PRIMARY KEY, title TEXT, title_zh TEXT DEFAULT '', category TEXT DEFAULT 'AI',
      abstract TEXT DEFAULT '', abstract_zh TEXT DEFAULT '', curator_note TEXT DEFAULT '',
      source_text TEXT DEFAULT '', full_translation_html TEXT DEFAULT '',
      updated_at TEXT DEFAULT '2026-09-12T00:00:00.000Z'
    );
    CREATE TABLE reading_states (target_type TEXT, target_id TEXT, note_text TEXT, updated_at TEXT);
    CREATE TABLE reading_annotations (
      id TEXT PRIMARY KEY, target_type TEXT, target_id TEXT, quote_text TEXT, note_text TEXT, updated_at TEXT
    );
    CREATE TABLE content_tags (target_type TEXT, target_id TEXT, tag_name TEXT);
    CREATE TABLE content_folders (target_type TEXT, target_id TEXT, folder_id TEXT, sort_order INTEGER);
    CREATE TABLE favorites (target_type TEXT, target_id TEXT);
  `);
  return database;
}

function insert(database, table, row) {
  const columns = Object.keys(row);
  database.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...columns.map((column) => row[column]));
}

function fixtureTest(name, callback) {
  test(name, () => {
    const database = createFixture();
    try { callback(database); } finally { database.close(); }
  });
}

fixtureTest("统一搜索命中仅存在于中文译文标题、摘要或正文的内容", (database) => {
  for (const [field, phrase] of [
    ["translated_title", "标题独有检索词"],
    ["translated_summary", "摘要独有检索词"],
    ["translated_text", "正文独有检索词"],
  ]) {
    insert(database, "articles", {
      id: field, title: "English source title", summary: "English summary",
      content_text: "An English source that must stay unchanged.",
      [field]: `中文前文。${phrase}。中文后文。`,
    });
    const page = searchKnowledgePage(database, { query: phrase });
    assert.equal(page.total, 1);
    assert.equal(page.results[0].targetId, field);
    assert.equal(page.results[0].id, field);
    assert.equal(page.results[0].matchField, field);
    assert.ok(page.results[0].excerpt.includes(phrase));
    assert.equal(database.prepare("SELECT content_text FROM articles WHERE id=?").get(field).content_text,
      "An English source that must stay unchanged.");
  }
  assert.equal(searchKnowledgePage(database, { query: "English source" }).total, 3);
});

fixtureTest("统一搜索保留人工名称、原始名称和每项独立批量选择键", (database) => {
  insert(database, "documents", { id: "document-a", title: "Original A", display_title: "人工名称甲" });
  insert(database, "documents", { id: "document-b", title: "Original B", display_title: "人工名称乙" });
  insert(database, "articles", { id: "article-a", title: "Original C", display_title: "人工名称丙" });
  const { results, total } = searchKnowledgePage(database, { query: "人工名称" });
  assert.equal(total, 3);
  assert.equal(new Set(results.map((item) => `${item.targetType}:${item.id}`)).size, 3);
  const byId = new Map(results.map((item) => [item.targetId, item]));
  assert.equal(byId.get("document-a").title, "人工名称甲");
  assert.equal(byId.get("document-b").title, "人工名称乙");
  assert.equal(byId.get("article-a").title, "人工名称丙");
  assert.equal(byId.get("article-a").sourceTitle, "Original C");
  for (const item of results) assert.equal(item.id, item.targetId);
});

fixtureTest("370项相同时间戳结果超过200后可继续翻页，无重复或遗漏", (database) => {
  database.exec("BEGIN");
  for (let index = 0; index < 370; index += 1) {
    insert(database, "documents", {
      id: `document-${String(index).padStart(4, "0")}`, title: "分页资料", extracted_text: "数据分页回归",
    });
  }
  database.exec("COMMIT");
  const first = searchKnowledgePage(database, { query: "数据", limit: 200, offset: 0 });
  const second = searchKnowledgePage(database, { query: "数据", limit: 200, offset: 200 });
  const final = searchKnowledgePage(database, { query: "数据", limit: 200, offset: 400 });
  assert.equal(first.total, 370);
  assert.equal(first.results.length, 200);
  assert.equal(first.hasMore, true);
  assert.equal(second.total, 370);
  assert.equal(second.results.length, 170);
  assert.equal(second.hasMore, false);
  assert.equal(final.total, 370);
  assert.equal(final.results.length, 0);
  assert.equal(final.hasMore, false);
  const ids = [...first.results, ...second.results].map((item) => item.id);
  assert.equal(new Set(ids).size, 370);
  assert.deepEqual(ids, [...ids].sort());
});

fixtureTest("正文、译文、笔记和批注先去重；只在笔记或批注命中也仍可检索", (database) => {
  insert(database, "documents", { id: "multiple", title: "多来源", extracted_text: "共同命中词" });
  insert(database, "documents", { id: "notes", title: "阅读记录" });
  insert(database, "documents", { id: "annotations", title: "高亮记录" });
  for (const id of ["multiple", "notes"]) insert(database, "reading_states", {
    target_type: "document", target_id: id, note_text: "共同命中词", updated_at: "2026-09-12",
  });
  for (const id of ["multiple", "annotations"]) insert(database, "reading_annotations", {
    id: `annotation-${id}`, target_type: "document", target_id: id,
    quote_text: "共同命中词", note_text: "高亮说明", updated_at: "2026-09-12",
  });
  insert(database, "reading_states", {
    target_type: "document", target_id: "deleted-target", note_text: "共同命中词", updated_at: "2026-09-12",
  });
  const page = searchKnowledgePage(database, { query: "共同命中词" });
  assert.equal(page.total, 3);
  const byId = new Map(page.results.map((item) => [item.id, item]));
  assert.equal(byId.get("multiple").matchSource, "文档正文");
  assert.equal(byId.get("notes").matchSource, "阅读笔记");
  assert.equal(byId.get("annotations").matchSource, "高亮批注");
  for (const item of page.results) assert.ok(item.excerpt.includes("共同命中词"));
});

fixtureTest("论文原文和中文HTML分别命中时摘要取实际命中内容", (database) => {
  insert(database, "papers", {
    id: "paper", title: "Paper title", title_zh: "论文题名",
    source_text: "Original English unique_source_term in the paper.",
    full_translation_html: "<p>中文段落含有论文中文独有词。</p>",
  });
  const original = searchKnowledgePage(database, { query: "unique_source_term" });
  assert.equal(original.results[0].matchField, "source_text");
  assert.ok(original.results[0].excerpt.includes("unique_source_term"));
  const translated = searchKnowledgePage(database, { query: "论文中文独有词" });
  assert.equal(translated.results[0].matchField, "full_translation_html");
  assert.ok(translated.results[0].excerpt.includes("论文中文独有词"));
  assert.doesNotMatch(translated.results[0].excerpt, /<p>/);
});

fixtureTest("类型、分类、稳定目录ID和标签过滤在去重计数及分页之前生效", (database) => {
  insert(database, "documents", { id: "inside", title: "过滤命中", category: "AI" });
  insert(database, "documents", { id: "other-folder", title: "过滤命中", category: "AI" });
  insert(database, "articles", { id: "article", title: "过滤命中", category: "数据库" });
  for (const [id, folder] of [["inside", "stable-folder-a"], ["other-folder", "stable-folder-b"]]) {
    insert(database, "content_folders", { target_type: "document", target_id: id, folder_id: folder, sort_order: 7 });
    insert(database, "content_tags", { target_type: "document", target_id: id, tag_name: "回归" });
  }
  insert(database, "favorites", { target_type: "document", target_id: "inside" });
  const page = searchKnowledgePage(database, {
    query: "过滤", targetType: "document", category: "AI", tagName: "回归", folderId: "stable-folder-a", limit: 1,
  });
  assert.equal(page.total, 1);
  assert.equal(page.hasMore, false);
  assert.equal(page.results[0].id, "inside");
  assert.equal(page.results[0].folderId, "stable-folder-a");
  assert.equal(page.results[0].folderSortOrder, 7);
  assert.equal(page.results[0].isFavorite, true);
  assert.deepEqual(page.results[0].tags, ["回归"]);
  assert.equal(searchKnowledgePage(database, { query: "过滤", targetType: "article" }).total, 1);
  assert.equal(searchKnowledgePage(database, { query: "过滤", category: "数据库" }).total, 1);
  assert.equal(searchKnowledgePage(database, { query: "过滤", tagName: "不存在" }).total, 0);
});

fixtureTest("短中文词及LIKE百分号、下划线、反斜线均按字面值检索", (database) => {
  insert(database, "documents", { id: "literal", title: "汉字", extracted_text: String.raw`100% value_a C:\docs\manual` });
  insert(database, "documents", { id: "decoy", title: "decoy", extracted_text: "1000 valueXa C:docsmanual" });
  for (const query of ["字", "100%", "value_a", String.raw`C:\docs\manual`]) {
    const page = searchKnowledgePage(database, { query });
    assert.equal(page.total, 1);
    assert.equal(page.results[0].id, "literal");
    assert.ok(page.results[0].excerpt.includes(query));
  }
});

fixtureTest("分页参数有界，空查询稳定返回空页，非法内容类型拒绝", (database) => {
  insert(database, "documents", { id: "item", title: "命中" });
  assert.deepEqual(searchKnowledgePage(database, { query: "  " }), {
    results: [], total: 0, hasMore: false, offset: 0, limit: 200,
  });
  const page = searchKnowledgePage(database, { q: "命中", limit: 10000, offset: -20 });
  assert.equal(page.limit, 200);
  assert.equal(page.offset, 0);
  assert.equal(page.results.length, 1);
  assert.equal(searchKnowledgePage(database, { query: "命中", limit: 0 }).limit, 1);
  assert.equal(searchKnowledgePage(database, { query: "命中", offset: "invalid" }).offset, 0);
  assert.throws(() => searchKnowledgePage(database, { query: "命中", targetType: "invalid" }), TypeError);
});

fixtureTest("长正文返回命中附近短片段，结果不携带原文或译文全文字段", (database) => {
  insert(database, "articles", {
    id: "long", title: "Long source", content_text: "Original text.",
    translated_text: `${"很长的背景内容。".repeat(5000)}中间独有词${"后续资料。".repeat(5000)}`,
  });
  const item = searchKnowledgePage(database, { query: "中间独有词" }).results[0];
  assert.ok(item.excerpt.includes("中间独有词"));
  assert.ok(item.excerpt.length <= 222);
  assert.ok(item.excerpt.startsWith("…"));
  for (const field of ["contentText", "translatedText", "contentHtml", "translatedHtml", "extractedText"]) {
    assert.equal(Object.hasOwn(item, field), false);
  }
});
