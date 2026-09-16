import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createContentOrganizationStore } from "../lib/db/stores/content-organization.mjs";

function createOrganizationDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, display_title TEXT, title TEXT, category TEXT,
      summary TEXT, updated_at TEXT
    );
    CREATE TABLE articles (
      id TEXT PRIMARY KEY, display_title TEXT, title TEXT, category TEXT,
      translated_summary TEXT, summary TEXT, updated_at TEXT
    );
    CREATE TABLE papers (
      id TEXT PRIMARY KEY, title_zh TEXT, title TEXT, category TEXT,
      abstract_zh TEXT, abstract TEXT, curator_note TEXT, updated_at TEXT
    );
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(parent_id, name),
      FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE RESTRICT
    );
    CREATE TABLE content_folders (
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(target_type, target_id),
      FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE RESTRICT
    );
    CREATE TABLE tags (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE content_tags (
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(target_type, target_id, tag_name),
      FOREIGN KEY(tag_name) REFERENCES tags(name) ON DELETE CASCADE
    );
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
  const timestamp = "2026-09-16T03:00:00.000Z";
  database.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?)")
    .run("document-1", "文档显示名称", "文档源标题", "工作", "文档摘要", timestamp);
  database.prepare("INSERT INTO articles VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("article-1", "文章显示名称", "文章源标题", "学习", "中文简介", "English summary", timestamp);
  database.prepare("INSERT INTO papers VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("paper-1", "中文论文标题", "English Paper", "论文", "中文摘要", "Abstract", "说明", timestamp);
  return database;
}

test("目录仓储保持路径复用、层级路径、移动保护、重命名和空目录删除", () => {
  const database = createOrganizationDatabase();
  try {
    const timestamp = "2026-09-16T04:00:00.000Z";
    const store = createContentOrganizationStore(database, { currentTimestamp: () => timestamp });
    const firstPath = store.ensureFolderPath(["  工作   资料  ", "项目 A"], [3, 4]);
    const repeatedPath = store.ensureFolderPath(["工作 资料", "项目 A"], [8, 9]);
    assert.deepEqual(repeatedPath.map((folder) => folder.id), firstPath.map((folder) => folder.id));
    assert.equal(firstPath[0].name, "工作 资料");
    assert.equal(firstPath[0].sortOrder, 3);
    assert.equal(firstPath[1].parentId, firstPath[0].id);

    const otherRoot = store.createFolder({ name: "另一入口" });
    assert.throws(
      () => store.createFolder({ name: "另一入口" }),
      /当前目录下已存在同名文件夹/,
    );
    const renamed = store.renameFolder(firstPath[1].id, "  新   项目名 ");
    assert.equal(renamed.name, "新 项目名");
    assert.equal(renamed.updatedAt, timestamp);
    const moved = store.moveFolder(firstPath[1].id, otherRoot.id);
    assert.deepEqual(moved.path.map((part) => part.name), ["另一入口", "新 项目名"]);
    assert.throws(
      () => store.moveFolder(otherRoot.id, moved.id),
      /不能把文件夹移动到自己的子目录中/,
    );
    assert.throws(
      () => store.deleteEmptyFolder(otherRoot.id),
      /仍有子文件夹或内容/,
    );

    const empty = store.createFolder({ name: "临时空目录" });
    assert.equal(store.deleteEmptyFolder(empty.id), true);
    assert.equal(store.listFolders().some((folder) => folder.id === empty.id), false);
    assert.throws(() => store.ensureFolderPath([]), /文件夹路径不能为空/);
    assert.throws(() => store.renameFolder("missing", "新名称"), /找不到文件夹/);
  } finally {
    database.close();
  }
});

test("内容归档保持单一位置、子树计数、批量去重和整批校验", () => {
  const database = createOrganizationDatabase();
  try {
    const store = createContentOrganizationStore(database, {
      currentTimestamp: () => "2026-09-16T05:00:00.000Z",
    });
    const [root, child] = store.ensureFolderPath(["资料", "项目"]);
    const documentAssignment = store.assignContentToFolder(
      "document",
      "document-1",
      child.id,
      -3,
    );
    assert.equal(documentAssignment.sortOrder, 0);
    store.assignContentToFolder("article", "article-1", root.id, 7.6);
    let folders = store.listFolders();
    assert.equal(folders.find((folder) => folder.id === child.id).directItemCount, 1);
    assert.equal(folders.find((folder) => folder.id === root.id).itemCount, 2);

    const moved = store.assignContentsToFolder([
      { targetType: "document", targetId: "document-1" },
      { targetType: "article", targetId: "article-1" },
      { targetType: "paper", targetId: "paper-1" },
      { targetType: "document", targetId: "document-1" },
    ], child.id);
    assert.equal(moved.length, 3);
    assert.ok(moved.every((item) => item.folderId === child.id && item.sortOrder === 0));
    folders = store.listFolders();
    assert.equal(folders.find((folder) => folder.id === child.id).directItemCount, 3);
    assert.equal(folders.find((folder) => folder.id === root.id).itemCount, 3);

    assert.throws(
      () => store.assignContentsToFolder([
        { targetType: "document", targetId: "document-1" },
        { targetType: "article", targetId: "missing" },
      ], root.id),
      /有项目已不存在/,
    );
    assert.equal(
      database.prepare("SELECT folder_id FROM content_folders WHERE target_type = 'document'").get().folder_id,
      child.id,
    );
    assert.throws(() => store.assignContentsToFolder([], root.id), /请选择需要移动的内容/);
    assert.throws(
      () => store.assignContentToFolder("video", "video-1", root.id),
      /不支持的内容类型/,
    );
    assert.throws(() => store.deleteEmptyFolder(child.id), /仍有子文件夹或内容/);
  } finally {
    database.close();
  }
});

test("标签仓储保持名称规范化、使用次数、孤立清理和专题组织摘要", () => {
  const database = createOrganizationDatabase();
  try {
    const timestamp = "2026-09-16T06:00:00.000Z";
    const store = createContentOrganizationStore(database, { currentTimestamp: () => timestamp });
    assert.deepEqual(store.addContentTag("document", "document-1", "  机器   学习 "), ["机器 学习"]);
    assert.deepEqual(store.addContentTag("document", "document-1", "机器 学习"), ["机器 学习"]);
    store.addContentTag("article", "article-1", "机器 学习");
    store.addContentTag("document", "document-1", "本地知识库");
    assert.deepEqual(store.listTags().find((tag) => tag.name === "机器 学习"), {
      name: "机器 学习",
      itemCount: 2,
    });

    database.prepare("INSERT INTO topics VALUES (?, ?, ?, ?, ?)")
      .run("topic-1", "Agent 学习", "专题说明", timestamp, timestamp);
    database.prepare("INSERT INTO topic_items VALUES (?, ?, ?, ?)")
      .run("topic-1", "document", "document-1", timestamp);
    const organization = store.getContentOrganization("document", "document-1");
    assert.deepEqual(
      organization.topics.map((topic) => ({ id: topic.id, name: topic.name })),
      [{ id: "topic-1", name: "Agent 学习" }],
    );
    assert.deepEqual(organization.tags, ["本地知识库", "机器 学习"]);
    assert.equal(store.getContentOrganization("document", "missing"), null);

    assert.deepEqual(store.removeContentTag("document", "document-1", "机器 学习"), ["本地知识库"]);
    assert.equal(store.listTags().find((tag) => tag.name === "机器 学习").itemCount, 1);
    assert.deepEqual(store.removeContentTag("article", "article-1", "机器 学习"), []);
    assert.equal(store.listTags().some((tag) => tag.name === "机器 学习"), false);
    assert.throws(() => store.addContentTag("document", "missing", "标签"), /找不到对应内容/);
    assert.throws(() => store.addContentTag("document", "document-1", "  "), /标签名称不能为空/);
  } finally {
    database.close();
  }
});

test("内容摘要继续优先使用人工名称、中文简介和中文论文元数据", () => {
  const database = createOrganizationDatabase();
  try {
    const store = createContentOrganizationStore(database);
    const document = store.getKnowledgeTargetSummary("document", "document-1");
    const article = store.getKnowledgeTargetSummary("article", "article-1");
    const paper = store.getKnowledgeTargetSummary("paper", "paper-1");
    assert.deepEqual(
      [document.title, document.sourceTitle, article.title, article.summary, paper.title, paper.summary],
      ["文档显示名称", "文档源标题", "文章显示名称", "中文简介", "中文论文标题", "中文摘要"],
    );
    assert.equal(store.getKnowledgeTargetSummary("paper", "missing"), null);
    assert.throws(
      () => store.getKnowledgeTargetSummary("video", "video-1"),
      /不支持的内容类型/,
    );
  } finally {
    database.close();
  }
});
