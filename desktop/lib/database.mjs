/**
 * 知序本地 SQLite 数据访问模块。
 *
 * 本模块集中管理表结构、文档增删查改和数据库备份。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  backupDirectory,
  databasePath,
  ensureLocalDirectories,
  serverConfig,
} from "./config.mjs";

ensureLocalDirectories();

/** database 是整个本地知识库共享的 SQLite 连接。 */
const database = new DatabaseSync(databasePath);
/** 启用外键约束，防止关联数据产生孤儿记录。 */
database.exec("PRAGMA foreign_keys = ON;");
/** WAL 模式允许读取和写入更平滑地并行。 */
database.exec("PRAGMA journal_mode = WAL;");
/** NORMAL 同步级别兼顾本地可靠性和写入速度。 */
database.exec("PRAGMA synchronous = NORMAL;");

/** 数据库表结构与全文检索索引。 */
database.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    extension TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    category_source TEXT NOT NULL DEFAULT 'rules',
    category_confidence REAL NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    extracted_text TEXT NOT NULL DEFAULT '',
    extraction_status TEXT NOT NULL DEFAULT 'pending',
    ocr_status TEXT NOT NULL DEFAULT 'not_required',
    ocr_error TEXT NOT NULL DEFAULT '',
    ocr_language TEXT NOT NULL DEFAULT '',
    ocr_page_count INTEGER NOT NULL DEFAULT 0,
    ocr_average_confidence REAL NOT NULL DEFAULT 0,
    ocr_completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS documents_category_updated_idx
    ON documents(category, updated_at DESC);

  CREATE INDEX IF NOT EXISTS documents_sha256_idx
    ON documents(sha256);

  CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
    document_id UNINDEXED,
    title,
    original_name,
    category,
    summary,
    extracted_text,
    tokenize = 'unicode61'
  );

  CREATE TABLE IF NOT EXISTS document_pages (
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    extraction_method TEXT NOT NULL DEFAULT 'ocr'
      CHECK(extraction_method IN ('native', 'ocr')),
    text TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    layout_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(document_id, page_number),
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS document_pages_document_idx
    ON document_pages(document_id, page_number ASC);

  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    category TEXT NOT NULL,
    category_source TEXT NOT NULL DEFAULT 'rules',
    category_confidence REAL NOT NULL DEFAULT 0,
    author TEXT,
    published_at TEXT,
    cover_image_url TEXT,
    content_html TEXT NOT NULL,
    content_text TEXT NOT NULL,
    source_language TEXT NOT NULL DEFAULT 'unknown',
    translation_status TEXT NOT NULL DEFAULT 'not_required',
    translated_title TEXT NOT NULL DEFAULT '',
    translated_summary TEXT NOT NULL DEFAULT '',
    translated_html TEXT NOT NULL DEFAULT '',
    translated_text TEXT NOT NULL DEFAULT '',
    translation_source TEXT,
    translated_at TEXT,
    word_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS articles_category_updated_idx
    ON articles(category, updated_at DESC);

  CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
    article_id UNINDEXED,
    title,
    summary,
    category,
    author,
    content_text,
    tokenize = 'unicode61'
  );

  CREATE TABLE IF NOT EXISTS favorites (
    target_type TEXT NOT NULL CHECK(target_type IN ('document', 'article')),
    target_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(target_type, target_id)
  );

  CREATE INDEX IF NOT EXISTS favorites_created_idx
    ON favorites(created_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    abstract TEXT NOT NULL DEFAULT '',
    title_zh TEXT,
    abstract_zh TEXT,
    translation_source TEXT,
    translated_at TEXT,
    authors_json TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL,
    published_at TEXT,
    source_url TEXT NOT NULL,
    pdf_url TEXT,
    source_type TEXT NOT NULL DEFAULT 'weekly',
    source_label TEXT NOT NULL DEFAULT '每周精选',
    curator_note TEXT NOT NULL DEFAULT '',
    video_url TEXT,
    video_alt_url TEXT,
    duration TEXT,
    source_text TEXT NOT NULL DEFAULT '',
    source_text_word_count INTEGER NOT NULL DEFAULT 0,
    full_translation_html TEXT NOT NULL DEFAULT '',
    full_translation_status TEXT NOT NULL DEFAULT 'pending',
    full_translation_source TEXT,
    full_translated_at TEXT,
    full_translation_error TEXT,
    extraction_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS papers_created_idx
    ON papers(created_at DESC);

  CREATE TABLE IF NOT EXISTS paper_candidates (
    id TEXT PRIMARY KEY,
    week_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    abstract TEXT NOT NULL DEFAULT '',
    title_zh TEXT,
    abstract_zh TEXT,
    translation_source TEXT,
    translated_at TEXT,
    authors_json TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL,
    published_at TEXT,
    source_url TEXT NOT NULL,
    pdf_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'selected')),
    created_at TEXT NOT NULL,
    UNIQUE(week_key, external_id)
  );

  CREATE INDEX IF NOT EXISTS paper_candidates_week_idx
    ON paper_candidates(week_key, status, created_at);

  CREATE TABLE IF NOT EXISTS paper_week_status (
    week_key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'selected', 'dismissed')),
    snoozed_until TEXT,
    selected_paper_id TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reading_states (
    target_type TEXT NOT NULL
      CHECK(target_type IN ('document', 'article', 'paper')),
    target_id TEXT NOT NULL,
    reading_status TEXT NOT NULL DEFAULT 'unread'
      CHECK(reading_status IN ('unread', 'reading', 'completed')),
    progress_percent REAL NOT NULL DEFAULT 0,
    note_text TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY(target_type, target_id)
  );

  CREATE INDEX IF NOT EXISTS reading_states_updated_idx
    ON reading_states(updated_at DESC);

  CREATE TABLE IF NOT EXISTS reading_annotations (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL
      CHECK(target_type IN ('document', 'article', 'paper')),
    target_id TEXT NOT NULL,
    quote_text TEXT NOT NULL,
    anchor_start INTEGER NOT NULL,
    anchor_end INTEGER NOT NULL,
    color TEXT NOT NULL DEFAULT 'yellow'
      CHECK(color IN ('yellow', 'green', 'blue', 'red')),
    note_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS reading_annotations_target_idx
    ON reading_annotations(target_type, target_id, anchor_start);

  CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS content_tags (
    target_type TEXT NOT NULL
      CHECK(target_type IN ('document', 'article', 'paper')),
    target_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(target_type, target_id, tag_name),
    FOREIGN KEY(tag_name) REFERENCES tags(name) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS content_tags_target_idx
    ON content_tags(target_type, target_id);

  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS topic_items (
    topic_id TEXT NOT NULL,
    target_type TEXT NOT NULL
      CHECK(target_type IN ('document', 'article', 'paper')),
    target_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(topic_id, target_type, target_id),
    FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS topic_items_target_idx
    ON topic_items(target_type, target_id);

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(parent_id, name),
    FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS folders_parent_idx
    ON folders(parent_id, sort_order, name);

  CREATE TABLE IF NOT EXISTS content_folders (
    target_type TEXT NOT NULL
      CHECK(target_type IN ('document', 'article', 'paper')),
    target_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(target_type, target_id),
    FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS content_folders_folder_idx
    ON content_folders(folder_id, target_type, updated_at DESC);

  CREATE TABLE IF NOT EXISTS knowledge_cards (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL
      CHECK(target_type IN ('document', 'article', 'paper')),
    target_id TEXT NOT NULL,
    card_type TEXT NOT NULL DEFAULT 'concept'
      CHECK(card_type IN ('concept', 'principle', 'compare', 'engineering', 'qa', 'formula', 'fault')),
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

  CREATE INDEX IF NOT EXISTS knowledge_cards_due_idx
    ON knowledge_cards(due_at, updated_at DESC);

  CREATE INDEX IF NOT EXISTS knowledge_cards_target_idx
    ON knowledge_cards(target_type, target_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'ask'
      CHECK(mode IN ('ask', 'compare')),
    primary_target_type TEXT
      CHECK(primary_target_type IS NULL OR primary_target_type IN ('document', 'article', 'paper')),
    primary_target_id TEXT,
    title TEXT NOT NULL,
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ai_conversations_target_idx
    ON ai_conversations(primary_target_type, primary_target_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS ai_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    selected_quote TEXT NOT NULL DEFAULT '',
    citations_json TEXT NOT NULL DEFAULT '[]',
    insufficient_evidence INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx
    ON ai_messages(conversation_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    source_label TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK(status IN ('queued', 'running', 'completed', 'failed')),
    stage TEXT NOT NULL DEFAULT 'queued',
    progress_percent REAL NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',
    target_type TEXT,
    target_id TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS import_jobs_status_created_idx
    ON import_jobs(status, created_at ASC);

  CREATE INDEX IF NOT EXISTS import_jobs_type_updated_idx
    ON import_jobs(job_type, updated_at DESC);

  CREATE TABLE IF NOT EXISTS browser_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS browser_clients_active_idx
    ON browser_clients(revoked_at, created_at DESC);
`);

/**
 * 为已经存在的 SQLite 表补充新增字段。
 *
 * @param {string} tableName 固定的本地表名。
 * @param {string} columnName 需要确认的字段名。
 * @param {string} columnDefinition ALTER TABLE 使用的字段定义。
 * @returns {void}
 */
function ensureTableColumn(tableName, columnName, columnDefinition) {
  /** columns 是当前表的全部字段元数据。 */
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  database.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`,
  );
}

/** articleTranslationColumns 是网页文章的语言识别和 Codex 译文字段。 */
const articleTranslationColumns = Object.freeze([
  ["source_language", "TEXT NOT NULL DEFAULT 'unknown'"],
  ["translation_status", "TEXT NOT NULL DEFAULT 'not_required'"],
  ["translated_title", "TEXT NOT NULL DEFAULT ''"],
  ["translated_summary", "TEXT NOT NULL DEFAULT ''"],
  ["translated_html", "TEXT NOT NULL DEFAULT ''"],
  ["translated_text", "TEXT NOT NULL DEFAULT ''"],
  ["translation_source", "TEXT"],
  ["translated_at", "TEXT"],
]);
for (const [columnName, columnDefinition] of articleTranslationColumns) {
  ensureTableColumn("articles", columnName, columnDefinition);
}

/** documentOcrColumns 是扫描件 OCR 状态和结果摘要字段。 */
const documentOcrColumns = Object.freeze([
  ["ocr_status", "TEXT NOT NULL DEFAULT 'not_required'"],
  ["ocr_error", "TEXT NOT NULL DEFAULT ''"],
  ["ocr_language", "TEXT NOT NULL DEFAULT ''"],
  ["ocr_page_count", "INTEGER NOT NULL DEFAULT 0"],
  ["ocr_average_confidence", "REAL NOT NULL DEFAULT 0"],
  ["ocr_completed_at", "TEXT"],
]);
for (const [columnName, columnDefinition] of documentOcrColumns) {
  ensureTableColumn("documents", columnName, columnDefinition);
}

/** contentFolderColumns 是目录关系用于保存内容在文件夹内顺序的扩展字段。 */
const contentFolderColumns = Object.freeze([
  ["sort_order", "INTEGER NOT NULL DEFAULT 0"],
]);
for (const [columnName, columnDefinition] of contentFolderColumns) {
  ensureTableColumn("content_folders", columnName, columnDefinition);
}

/** paperTranslationColumns 是论文与候选表共享的 Codex 翻译字段。 */
const paperTranslationColumns = Object.freeze([
  ["title_zh", "TEXT"],
  ["abstract_zh", "TEXT"],
  ["translation_source", "TEXT"],
  ["translated_at", "TEXT"],
]);
for (const tableName of ["papers", "paper_candidates"]) {
  for (const [columnName, columnDefinition] of paperTranslationColumns) {
    ensureTableColumn(tableName, columnName, columnDefinition);
  }
}

/** paperLibraryColumns 是统一论文库新增的来源、视频、全文和翻译字段。 */
const paperLibraryColumns = Object.freeze([
  ["source_type", "TEXT NOT NULL DEFAULT 'weekly'"],
  ["source_label", "TEXT NOT NULL DEFAULT '每周精选'"],
  ["curator_note", "TEXT NOT NULL DEFAULT ''"],
  ["video_url", "TEXT"],
  ["video_alt_url", "TEXT"],
  ["duration", "TEXT"],
  ["source_text", "TEXT NOT NULL DEFAULT ''"],
  ["source_text_word_count", "INTEGER NOT NULL DEFAULT 0"],
  ["full_translation_html", "TEXT NOT NULL DEFAULT ''"],
  ["full_translation_status", "TEXT NOT NULL DEFAULT 'pending'"],
  ["full_translation_source", "TEXT"],
  ["full_translated_at", "TEXT"],
  ["full_translation_error", "TEXT"],
  ["extraction_error", "TEXT"],
]);
for (const [columnName, columnDefinition] of paperLibraryColumns) {
  ensureTableColumn("papers", columnName, columnDefinition);
}

/** defaultFolderNames 是首次升级时创建的知识库一级文件夹。 */
const defaultFolderNames = Object.freeze([
  "AI",
  "数据库",
  "安全",
  "程序",
  "生物工程",
  "工艺工程",
  "其它",
]);

/**
 * 在同一父目录下查找或创建文件夹。
 *
 * @param {string | null} parentId 父文件夹 ID；一级文件夹使用空值。
 * @param {string} name 文件夹名称。
 * @param {number} sortOrder 同级显示顺序。
 * @returns {Record<string, unknown>} 已存在或新建的文件夹行。
 */
function ensureFolder(parentId, name, sortOrder = 0) {
  /** normalizedName 是压缩连续空白后的安全文件夹名称。 */
  const normalizedName = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!normalizedName) throw new Error("文件夹名称不能为空。");
  /** existingFolder 是同一父级下已经存在的同名文件夹。 */
  const existingFolder = parentId
    ? database.prepare("SELECT * FROM folders WHERE parent_id = ? AND name = ? LIMIT 1").get(parentId, normalizedName)
    : database.prepare("SELECT * FROM folders WHERE parent_id IS NULL AND name = ? LIMIT 1").get(normalizedName);
  if (existingFolder) return existingFolder;
  /** now 是文件夹创建和更新时间。 */
  const now = new Date().toISOString();
  /** folderId 是仅在本机使用的稳定文件夹 ID。 */
  const folderId = `folder_${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO folders(id, parent_id, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(folderId, parentId, normalizedName, Number(sortOrder) || 0, now, now);
  return database.prepare("SELECT * FROM folders WHERE id = ?").get(folderId);
}

/** 创建默认一级文件夹并让历史内容进入对应分类目录。 */
for (const [folderIndex, folderName] of defaultFolderNames.entries()) {
  /** rootFolder 是当前分类对应的一级文件夹。 */
  const rootFolder = ensureFolder(null, folderName, folderIndex);
  /** now 是历史内容首次建立目录关系的时间。 */
  const now = new Date().toISOString();
  for (const targetType of ["document", "article"]) {
    /** sourceTable 是目标类型对应的可信固定表名。 */
    const sourceTable = targetType === "document" ? "documents" : "articles";
    database.prepare(`
      INSERT OR IGNORE INTO content_folders(
        target_type, target_id, folder_id, created_at, updated_at
      )
      SELECT ?, id, ?, ?, ? FROM ${sourceTable} WHERE category = ?
    `).run(targetType, rootFolder.id, now, now, folderName);
  }
}

/**
 * 将数据库行转换为前端统一使用的驼峰字段。
 *
 * @param {Record<string, unknown>} row SQLite 查询结果。
 * @returns {Record<string, unknown>} 可直接序列化的文档对象。
 */
function mapDocumentRow(row) {
  return {
    id: row.id,
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType: row.mime_type,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    title: row.title,
    category: row.category,
    categorySource: row.category_source,
    categoryConfidence: row.category_confidence,
    summary: row.summary,
    extractedText: row.extracted_text,
    extractionStatus: row.extraction_status,
    ocrStatus: row.ocr_status || "not_required",
    ocrError: row.ocr_error || "",
    ocrLanguage: row.ocr_language || "",
    ocrPageCount: Number(row.ocr_page_count) || 0,
    ocrAverageConfidence: Number(row.ocr_average_confidence) || 0,
    ocrCompletedAt: row.ocr_completed_at,
    isFavorite: Boolean(row.is_favorite),
    folderId: row.folder_id || null,
    folderSortOrder: Number(row.folder_sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将文章数据库行转换为浏览器使用的驼峰字段。
 *
 * @param {Record<string, unknown>} row SQLite 查询结果。
 * @returns {Record<string, unknown>} 文章对象。
 */
function mapArticleRow(row) {
  return {
    id: row.id,
    url: row.url,
    sourceType: row.source_type,
    title: row.title,
    summary: row.summary,
    category: row.category,
    categorySource: row.category_source,
    categoryConfidence: row.category_confidence,
    author: row.author,
    publishedAt: row.published_at,
    coverImageUrl: row.cover_image_url,
    contentHtml: row.content_html,
    contentText: row.content_text,
    sourceLanguage: row.source_language || "unknown",
    translationStatus: row.translation_status || "not_required",
    translatedTitle: row.translated_title || "",
    translatedSummary: row.translated_summary || "",
    translatedHtml: row.translated_html || "",
    translatedText: row.translated_text || "",
    translationSource: row.translation_source,
    translatedAt: row.translated_at,
    wordCount: row.word_count,
    isFavorite: Boolean(row.is_favorite),
    folderId: row.folder_id || null,
    folderSortOrder: Number(row.folder_sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 安全解析数据库中的 JSON 对象；旧数据或异常值回退为空对象。
 *
 * @param {unknown} value SQLite 中保存的 JSON 文本。
 * @returns {Record<string, unknown>} 可安全读取的普通对象。
 */
function parseStoredObject(value) {
  try {
    /** parsedValue 是 JSON 文本解析后的候选值。 */
    const parsedValue = JSON.parse(String(value || "{}"));
    return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
      ? parsedValue
      : {};
  } catch {
    return {};
  }
}

/**
 * 将后台导入任务行转换为 API 使用的驼峰对象。
 *
 * @param {Record<string, unknown>} row SQLite 导入任务行。
 * @returns {Record<string, unknown> | null} 后台导入任务。
 */
function mapImportJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobType: row.job_type,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    status: row.status,
    stage: row.stage,
    progressPercent: Number(row.progress_percent) || 0,
    payload: parseStoredObject(row.payload_json),
    result: parseStoredObject(row.result_json),
    targetType: row.target_type || null,
    targetId: row.target_id || null,
    errorMessage: row.error_message || "",
    attemptCount: Number(row.attempt_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/**
 * 将浏览器客户端行转换为不包含令牌摘要的安全对象。
 *
 * @param {Record<string, unknown>} row SQLite 浏览器客户端行。
 * @returns {Record<string, unknown> | null} 可展示的客户端信息。
 */
function mapBrowserClientRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    active: !row.revoked_at,
  };
}

/**
 * 创建一个可在服务重启后恢复的后台导入任务。
 *
 * @param {Record<string, unknown>} input 任务类型、来源和执行参数。
 * @returns {Record<string, unknown>} 新建任务。
 */
export function createImportJob(input) {
  /** jobType 是处理器注册时使用的稳定任务类型。 */
  const jobType = String(input.jobType || "").trim().slice(0, 80);
  if (!/^[a-z][a-z0-9_-]*$/i.test(jobType)) throw new TypeError("导入任务类型无效。");
  /** now 是任务创建和首次更新时间。 */
  const now = new Date().toISOString();
  /** jobId 是仅在本机使用的任务 ID。 */
  const jobId = `import_${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO import_jobs(
      id, job_type, source_label, source_url, status, stage,
      progress_percent, payload_json, result_json, error_message,
      attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'queued', 'queued', 0, ?, '{}', '', 0, ?, ?)
  `).run(
    jobId,
    jobType,
    String(input.sourceLabel || "").replace(/\s+/g, " ").trim().slice(0, 240),
    String(input.sourceUrl || "").trim().slice(0, 4096),
    JSON.stringify(input.payload && typeof input.payload === "object" ? input.payload : {}),
    now,
    now,
  );
  return getImportJob(jobId);
}

/**
 * 按 ID 读取后台导入任务。
 *
 * @param {string} jobId 任务 ID。
 * @returns {Record<string, unknown> | null} 任务或空值。
 */
export function getImportJob(jobId) {
  return mapImportJobRow(
    database.prepare("SELECT * FROM import_jobs WHERE id = ? LIMIT 1").get(String(jobId || "")),
  );
}

/**
 * 查询最近的后台导入任务。
 *
 * @param {{ status?: string, jobType?: string, limit?: number }} filters 查询条件。
 * @returns {Array<Record<string, unknown>>} 按更新时间倒序的任务。
 */
export function listImportJobs(filters = {}) {
  /** status 是可选的固定任务状态。 */
  const status = ["queued", "running", "completed", "failed"].includes(filters.status)
    ? filters.status
    : "";
  /** jobType 是可选任务类型。 */
  const jobType = String(filters.jobType || "").trim().slice(0, 80);
  /** limit 避免任务历史响应无限增长。 */
  const limit = Math.min(Math.max(Number(filters.limit) || 30, 1), 200);
  return database.prepare(`
    SELECT * FROM import_jobs
    WHERE (? = '' OR status = ?) AND (? = '' OR job_type = ?)
    ORDER BY updated_at DESC LIMIT ?
  `).all(status, status, jobType, jobType, limit).map(mapImportJobRow);
}

/**
 * 原子领取一个当前进程能够处理的排队任务。
 *
 * @param {Array<string>} jobTypes 已注册处理器的任务类型。
 * @returns {Record<string, unknown> | null} 已切换为运行状态的任务。
 */
export function claimNextImportJob(jobTypes) {
  /** normalizedTypes 是去重后的可信任务类型列表。 */
  const normalizedTypes = [...new Set(
    (Array.isArray(jobTypes) ? jobTypes : [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^[a-z][a-z0-9_-]*$/i.test(value)),
  )];
  if (normalizedTypes.length === 0) return null;
  /** placeholders 只包含与类型数量相同的 SQL 参数占位符。 */
  const placeholders = normalizedTypes.map(() => "?").join(", ");
  database.exec("BEGIN IMMEDIATE;");
  try {
    /** candidate 是最早进入队列且拥有处理器的任务。 */
    const candidate = database.prepare(`
      SELECT id FROM import_jobs
      WHERE status = 'queued' AND job_type IN (${placeholders})
      ORDER BY created_at ASC LIMIT 1
    `).get(...normalizedTypes);
    if (!candidate) {
      database.exec("COMMIT;");
      return null;
    }
    /** now 是本次执行开始时间。 */
    const now = new Date().toISOString();
    database.prepare(`
      UPDATE import_jobs SET
        status = 'running', stage = 'starting', progress_percent = MAX(progress_percent, 1),
        error_message = '', attempt_count = attempt_count + 1,
        started_at = ?, completed_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(now, now, candidate.id);
    database.exec("COMMIT;");
    return getImportJob(candidate.id);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

/**
 * 更新运行任务的阶段和进度。
 *
 * @param {string} jobId 任务 ID。
 * @param {{ stage?: string, progressPercent?: number }} changes 进度变化。
 * @returns {Record<string, unknown> | null} 更新后的任务。
 */
export function updateImportJobProgress(jobId, changes = {}) {
  /** stage 是展示给用户的稳定阶段名称。 */
  const stage = String(changes.stage || "running").trim().slice(0, 80) || "running";
  /** progressPercent 被限制在未完成区间，完成时由专用函数写入100。 */
  const progressPercent = Math.min(
    Math.max(Number(changes.progressPercent) || 0, 0),
    99,
  );
  database.prepare(`
    UPDATE import_jobs SET stage = ?, progress_percent = ?, updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(stage, progressPercent, new Date().toISOString(), String(jobId || ""));
  return getImportJob(jobId);
}

/**
 * 将后台导入任务标记为成功，并保存目标内容与轻量结果。
 *
 * @param {string} jobId 任务 ID。
 * @param {Record<string, unknown>} result 处理器返回结果。
 * @returns {Record<string, unknown> | null} 完成后的任务。
 */
export function completeImportJob(jobId, result = {}) {
  /** now 是任务完成时间。 */
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE import_jobs SET
      status = 'completed', stage = 'completed', progress_percent = 100,
      result_json = ?, target_type = ?, target_id = ?, error_message = '',
      completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(result && typeof result === "object" ? result : {}),
    result.targetType ? String(result.targetType).slice(0, 40) : null,
    result.targetId ? String(result.targetId).slice(0, 180) : null,
    now,
    now,
    String(jobId || ""),
  );
  return getImportJob(jobId);
}

/**
 * 将后台导入任务标记为失败并保留可操作错误信息。
 *
 * @param {string} jobId 任务 ID。
 * @param {unknown} error 错误对象或消息。
 * @returns {Record<string, unknown> | null} 失败后的任务。
 */
export function failImportJob(jobId, error) {
  /** now 是本次失败完成时间。 */
  const now = new Date().toISOString();
  /** message 是限制长度后的本地错误说明。 */
  const message = String(error instanceof Error ? error.message : error || "导入失败。")
    .trim()
    .slice(0, 2000);
  /** stage 区分普通失败与必须由用户确认的无字幕视频。 */
  const stage = error && typeof error === "object"
    && error.code === "IMPORT_CONFIRMATION_REQUIRED"
    ? "awaiting_confirmation"
    : "failed";
  database.prepare(`
    UPDATE import_jobs SET
      status = 'failed', stage = ?, error_message = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(stage, message || "导入失败。", now, now, String(jobId || ""));
  return getImportJob(jobId);
}

/**
 * 服务异常退出后把运行中任务放回队列。
 *
 * @returns {number} 恢复的任务数量。
 */
export function resetInterruptedImportJobs() {
  /** now 是恢复任务的更新时间。 */
  const now = new Date().toISOString();
  const result = database.prepare(`
    UPDATE import_jobs SET
      status = 'queued', stage = 'queued', progress_percent = 0,
      error_message = '', started_at = NULL, completed_at = NULL, updated_at = ?
    WHERE status = 'running'
  `).run(now);
  return Number(result.changes) || 0;
}

/**
 * 用户重试失败任务时将其重新放回队列。
 *
 * @param {string} jobId 任务 ID。
 * @returns {Record<string, unknown> | null} 重新排队后的任务。
 */
export function retryImportJob(jobId) {
  /** now 是重新排队时间。 */
  const now = new Date().toISOString();
  const result = database.prepare(`
    UPDATE import_jobs SET
      status = 'queued', stage = 'queued', progress_percent = 0,
      error_message = '', started_at = NULL, completed_at = NULL, updated_at = ?
    WHERE id = ? AND status = 'failed'
  `).run(now, String(jobId || ""));
  return Number(result.changes) > 0 ? getImportJob(jobId) : null;
}

/**
 * 用户确认无字幕视频的处理方式后，写入确认动作并重新排队。
 *
 * @param {string} jobId 视频导入任务 ID。
 * @param {"save_link" | "generate_study_pdf"} action 用户明确选择的动作。
 * @returns {Record<string, unknown> | null} 重新排队的任务。
 */
export function confirmVideoImportJob(jobId, action) {
  if (!["save_link", "generate_study_pdf"].includes(action)) {
    throw new TypeError("不支持的视频确认动作。");
  }
  /** existingJob 必须是正在等待确认的视频字幕任务。 */
  const existingJob = getImportJob(jobId);
  if (
    !existingJob
    || existingJob.jobType !== "video_transcript"
    || existingJob.status !== "failed"
    || existingJob.stage !== "awaiting_confirmation"
  ) {
    return null;
  }
  const nextPayload = {
    ...existingJob.payload,
    confirmationAction: action,
  };
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE import_jobs SET
      status = 'queued', stage = 'queued', progress_percent = 0,
      payload_json = ?, error_message = '', started_at = NULL,
      completed_at = NULL, updated_at = ?
    WHERE id = ? AND status = 'failed' AND stage = 'awaiting_confirmation'
  `).run(JSON.stringify(nextPayload), now, String(jobId || ""));
  return getImportJob(jobId);
}

/**
 * 保存一个已经完成配对的浏览器客户端。
 *
 * @param {{ name?: string, tokenHash: string }} input 客户端名称和令牌摘要。
 * @returns {Record<string, unknown>} 新客户端。
 */
export function registerBrowserClient(input) {
  /** tokenHash 只保存不可逆 SHA-256 摘要。 */
  const tokenHash = String(input.tokenHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new TypeError("浏览器令牌摘要无效。");
  /** browserClientId 是客户端本地标识。 */
  const browserClientId = `browser_${crypto.randomUUID()}`;
  /** now 是配对完成时间。 */
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO browser_clients(id, name, token_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(
    browserClientId,
    String(input.name || "浏览器扩展").replace(/\s+/g, " ").trim().slice(0, 100) || "浏览器扩展",
    tokenHash,
    now,
  );
  return mapBrowserClientRow(
    database.prepare("SELECT * FROM browser_clients WHERE id = ?").get(browserClientId),
  );
}

/**
 * 使用令牌摘要验证仍有效的浏览器客户端。
 *
 * @param {string} tokenHash SHA-256 令牌摘要。
 * @returns {Record<string, unknown> | null} 客户端或空值。
 */
export function findBrowserClientByTokenHash(tokenHash) {
  const row = database.prepare(`
    SELECT * FROM browser_clients
    WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1
  `).get(String(tokenHash || "").trim().toLowerCase());
  return mapBrowserClientRow(row);
}

/**
 * 记录浏览器客户端最近一次成功调用。
 *
 * @param {string} clientId 客户端 ID。
 * @returns {void}
 */
export function touchBrowserClient(clientId) {
  database.prepare(`
    UPDATE browser_clients SET last_used_at = ?
    WHERE id = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), String(clientId || ""));
}

/**
 * 查询全部浏览器客户端，不返回令牌摘要。
 *
 * @returns {Array<Record<string, unknown>>} 最近配对的客户端。
 */
export function listBrowserClients() {
  return database.prepare(`
    SELECT * FROM browser_clients ORDER BY created_at DESC
  `).all().map(mapBrowserClientRow);
}

/**
 * 撤销浏览器客户端访问权限。
 *
 * @param {string} clientId 客户端 ID。
 * @returns {Record<string, unknown> | null} 撤销后的客户端。
 */
export function revokeBrowserClient(clientId) {
  database.prepare(`
    UPDATE browser_clients SET revoked_at = ?
    WHERE id = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), String(clientId || ""));
  return mapBrowserClientRow(
    database.prepare("SELECT * FROM browser_clients WHERE id = ? LIMIT 1").get(String(clientId || "")),
  );
}

/**
 * 新增文章；同一 URL 再次解析时更新原记录。
 *
 * @param {Record<string, unknown>} article 已解析文章。
 * @returns {Record<string, unknown>} 已保存文章。
 */
export function saveArticle(article) {
  /** existingRow 是同一最终 URL 已存在的文章。 */
  const existingRow = database
    .prepare("SELECT id, created_at FROM articles WHERE url = ? LIMIT 1")
    .get(article.url);
  /** articleId 复用旧记录 ID，避免重复收藏。 */
  const articleId = existingRow?.id ?? article.id;
  /** createdAt 首次导入时间保持不变。 */
  const createdAt = existingRow?.created_at ?? article.createdAt;
  database.exec("BEGIN IMMEDIATE;");
  try {
    database
      .prepare(`
        INSERT INTO articles (
          id, url, source_type, title, summary, category, category_source,
          category_confidence, author, published_at, cover_image_url,
          content_html, content_text, source_language, translation_status,
          translated_title, translated_summary, translated_html, translated_text,
          translation_source, translated_at, word_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          source_type = excluded.source_type,
          title = excluded.title,
          summary = excluded.summary,
          category = excluded.category,
          category_source = excluded.category_source,
          category_confidence = excluded.category_confidence,
          author = excluded.author,
          published_at = excluded.published_at,
          cover_image_url = excluded.cover_image_url,
          content_html = excluded.content_html,
          content_text = excluded.content_text,
          source_language = excluded.source_language,
          translation_status = CASE
            WHEN articles.content_text = excluded.content_text
              THEN articles.translation_status
            ELSE excluded.translation_status
          END,
          translated_title = CASE
            WHEN articles.content_text = excluded.content_text
              THEN articles.translated_title
            ELSE ''
          END,
          translated_summary = CASE
            WHEN articles.content_text = excluded.content_text
              THEN articles.translated_summary
            ELSE ''
          END,
          translated_html = CASE
            WHEN articles.content_text = excluded.content_text
              THEN articles.translated_html
            ELSE ''
          END,
          translated_text = CASE
            WHEN articles.content_text = excluded.content_text
              THEN articles.translated_text
            ELSE ''
          END,
          translation_source = CASE
            WHEN articles.content_text = excluded.content_text
              THEN articles.translation_source
            ELSE NULL
          END,
          translated_at = CASE
            WHEN articles.content_text = excluded.content_text
              THEN articles.translated_at
            ELSE NULL
          END,
          word_count = excluded.word_count,
          updated_at = excluded.updated_at
      `)
      .run(
        articleId,
        article.url,
        article.sourceType,
        article.title,
        article.summary,
        article.category,
        article.categorySource,
        article.categoryConfidence,
        article.author,
        article.publishedAt,
        article.coverImageUrl,
        article.contentHtml,
        article.contentText,
        article.sourceLanguage || "unknown",
        article.translationStatus || "not_required",
        article.translatedTitle || "",
        article.translatedSummary || "",
        article.translatedHtml || "",
        article.translatedText || "",
        article.translationSource ?? null,
        article.translatedAt ?? null,
        article.wordCount,
        createdAt,
        article.updatedAt,
      );
    database
      .prepare("DELETE FROM article_search WHERE article_id = ?")
      .run(articleId);
    database
      .prepare(`
        INSERT INTO article_search (
          article_id, title, summary, category, author, content_text
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        articleId,
        article.title,
        article.summary,
        article.category,
        article.author ?? "",
        article.contentText,
      );
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
  if (!existingRow) {
    /** defaultFolderPath 是普通网页文章首次保存时对应的一级分类目录。 */
    const defaultFolderPath = ensureFolderPath([article.category || "其它"]);
    assignContentToFolder("article", articleId, defaultFolderPath.at(-1).id);
  }
  return getArticleById(articleId);
}

/**
 * 按 ID 读取一篇完整文章。
 *
 * @param {string} articleId 文章 ID。
 * @returns {Record<string, unknown> | null} 文章或空值。
 */
export function getArticleById(articleId) {
  /** row 是数据库返回的文章记录。 */
  const row = database
    .prepare(`
      SELECT a.*,
        (SELECT cf.folder_id FROM content_folders AS cf
          WHERE cf.target_type = 'article' AND cf.target_id = a.id) AS folder_id,
        (SELECT cf.sort_order FROM content_folders AS cf
          WHERE cf.target_type = 'article' AND cf.target_id = a.id) AS folder_sort_order,
        EXISTS(
          SELECT 1 FROM favorites AS f
          WHERE f.target_type = 'article' AND f.target_id = a.id
        ) AS is_favorite
      FROM articles AS a
      WHERE a.id = ?
      LIMIT 1
    `)
    .get(articleId);
  return row ? mapArticleRow(row) : null;
}

/**
 * 为全部历史文章重新识别语言，并修正旧规则造成的技术中文误判。
 *
 * @param {(text: string) => "zh" | "en" | "mixed" | "unknown"} detectLanguage 语言识别函数。
 * @returns {number} 本次完成回填的文章数量。
 */
export function backfillArticleLanguages(detectLanguage) {
  if (typeof detectLanguage !== "function") {
    throw new TypeError("文章语言回填需要有效的识别函数。");
  }
  /** rows 是需要按当前规则核验语言的全部历史文章。 */
  const rows = database
    .prepare(`
      SELECT id, content_text, source_language, translation_status
      FROM articles
    `)
    .all();
  if (rows.length === 0) return 0;
  /** updateStatement 为语言发生变化的文章写入正确状态。 */
  const updateStatement = database.prepare(`
    UPDATE articles
    SET source_language = ?, translation_status = ?, updated_at = updated_at
    WHERE id = ?
  `);
  /** updatedCount 是本次实际发生语言状态变化的文章数量。 */
  let updatedCount = 0;
  database.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of rows) {
      /** sourceLanguage 是根据已经保存的原文重新识别的语言代码。 */
      const sourceLanguage = detectLanguage(row.content_text || "");
      /** translationStatus 表示英文内容可以由用户主动加入翻译队列。 */
      if (sourceLanguage === row.source_language) continue;
      /** translationStatus 保留已经完成的译文，其余按新识别结果重置。 */
      const translationStatus = row.translation_status === "ready"
        ? "ready"
        : ["en", "mixed"].includes(sourceLanguage)
          ? "not_requested"
          : "not_required";
      updateStatement.run(sourceLanguage, translationStatus, row.id);
      updatedCount += 1;
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
  return updatedCount;
}

/** articleTranslationTags 是 Codex 文章译文允许使用的无属性语义标签。 */
const articleTranslationTags = new Set([
  "h2", "h3", "h4", "p", "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "sub", "sup",
]);

/**
 * 校验 Codex 文章译文只包含安全的无属性语义 HTML。
 *
 * @param {string} translatedHtml 待写入的中文译文。
 * @returns {{ html: string, text: string }} 规范化译文及纯文本。
 */
function validateArticleTranslationHtml(translatedHtml) {
  /** html 是去除首尾空白后的完整中文译文。 */
  const html = String(translatedHtml || "").trim();
  if (!html) throw new TypeError("文章中文译文不能为空。");
  /** tagPattern 用于逐一校验标签名称并拒绝任何 HTML 属性。 */
  const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    /** tagName 是当前标签的小写名称。 */
    const tagName = match[1].toLowerCase();
    if (!articleTranslationTags.has(tagName)) {
      throw new TypeError(`文章译文包含不允许的标签：${tagName}。`);
    }
    if (!new RegExp(`^<\\/?${tagName}\\s*>$`, "i").test(match[0])) {
      throw new TypeError("文章译文标签不能包含 HTML 属性。");
    }
  }
  /** text 是去除标签后的中文纯文本，用于搜索和完整性检查。 */
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 30) throw new TypeError("文章中文译文过短，无法作为完整译文保存。");
  return { html, text };
}

/**
 * 将英文或中英混合文章加入 Codex 翻译队列。
 *
 * @param {string} articleId 文章稳定本地 ID。
 * @returns {Record<string, unknown> | null} 更新后的文章。
 */
export function requestArticleTranslation(articleId) {
  /** article 是准备进入翻译队列的完整原文。 */
  const article = getArticleById(articleId);
  if (!article) return null;
  if (!['en', 'mixed'].includes(article.sourceLanguage)) {
    throw new TypeError("当前文章不是英文或中英混合内容，无需加入翻译队列。");
  }
  if (article.translationStatus === "ready" && article.translatedHtml) return article;
  database
    .prepare("UPDATE articles SET translation_status = 'pending', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), articleId);
  return getArticleById(articleId);
}

/**
 * 返回等待 Codex 处理的英文文章原文。
 *
 * @param {number} limit 单次队列上限。
 * @returns {Record<string, unknown>[]} 待翻译文章。
 */
export function listPendingArticleTranslations(limit = 10) {
  /** safeLimit 防止一次输出过多长文章造成终端或上下文压力。 */
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  /** rows 是按请求时间排列的待翻译文章。 */
  const rows = database
    .prepare(`
      SELECT a.*, 0 AS is_favorite
      FROM articles AS a
      WHERE a.translation_status = 'pending'
        AND a.source_language IN ('en', 'mixed')
        AND COALESCE(TRIM(a.translated_html), '') = ''
      ORDER BY a.updated_at ASC
      LIMIT ?
    `)
    .all(safeLimit);
  return rows.map(mapArticleRow);
}

/**
 * 写入由 Codex 完成的文章中文全文，并同步全文搜索索引。
 *
 * @param {string} articleId 文章稳定本地 ID。
 * @param {{ translatedTitle: string, translatedSummary: string, translatedHtml: string }} translation 中文译文。
 * @returns {Record<string, unknown> | null} 更新后的文章。
 */
export function updateArticleTranslation(articleId, translation) {
  /** article 是等待接收译文的英文原文。 */
  const article = getArticleById(articleId);
  if (!article) return null;
  /** translatedTitle 是阅读页使用的中文标题。 */
  const translatedTitle = String(translation.translatedTitle || "").trim();
  /** translatedSummary 是文档库和阅读页使用的中文简介。 */
  const translatedSummary = String(translation.translatedSummary || "").trim();
  if (!translatedTitle) throw new TypeError("文章中文标题不能为空。");
  if (!translatedSummary) throw new TypeError("文章中文简介不能为空。");
  /** translated 是通过安全标签和最低完整性检查的中文全文。 */
  const translated = validateArticleTranslationHtml(translation.translatedHtml);
  /** translatedAt 是 Codex 完成翻译的本机时间。 */
  const translatedAt = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE;");
  try {
    database
      .prepare(`
        UPDATE articles
        SET translated_title = ?, translated_summary = ?, translated_html = ?,
            translated_text = ?, translation_status = 'ready',
            translation_source = 'codex', translated_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        translatedTitle,
        translatedSummary,
        translated.html,
        translated.text,
        translatedAt,
        translatedAt,
        articleId,
      );
    database.prepare("DELETE FROM article_search WHERE article_id = ?").run(articleId);
    database
      .prepare(`
        INSERT INTO article_search (
          article_id, title, summary, category, author, content_text
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        articleId,
        `${article.title} ${translatedTitle}`,
        `${article.summary} ${translatedSummary}`,
        article.category,
        article.author ?? "",
        `${article.contentText}\n\n${translated.text}`,
      );
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
  return getArticleById(articleId);
}

/**
 * 列出本地文章，可按分类和关键词过滤。
 *
 * @param {{ category?: string, query?: string, limit?: number }} filters 查询条件。
 * @returns {Record<string, unknown>[]} 文章列表。
 */
export function listArticles(filters = {}) {
  /** category 是可选分类过滤值。 */
  const category = filters.category?.trim() || "";
  /** query 是可选搜索关键词。 */
  const query = filters.query?.trim() || "";
  /** limit 是单次返回上限。 */
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  if (query) {
    /** searchQuery 是安全的 FTS 前缀搜索表达式。 */
    const searchQuery = query
      .split(/\s+/)
      .map((term) => term.replace(/["*:^()]/g, "").trim())
      .filter(Boolean)
      .map((term) => `"${term}"*`)
      .join(" AND ");
    if (!searchQuery) return [];
    /** rows 是全文搜索命中的文章。 */
    const rows = database
      .prepare(`
        SELECT a.*,
          (SELECT cf.folder_id FROM content_folders AS cf
            WHERE cf.target_type = 'article' AND cf.target_id = a.id) AS folder_id,
          (SELECT cf.sort_order FROM content_folders AS cf
            WHERE cf.target_type = 'article' AND cf.target_id = a.id) AS folder_sort_order,
          EXISTS(
            SELECT 1 FROM favorites AS f
            WHERE f.target_type = 'article' AND f.target_id = a.id
          ) AS is_favorite
        FROM article_search AS s
        JOIN articles AS a ON a.id = s.article_id
        WHERE article_search MATCH ?
          AND (? = '' OR a.category = ?)
        ORDER BY rank, a.updated_at DESC
        LIMIT ?
      `)
      .all(searchQuery, category, category, limit);
    return rows.map(mapArticleRow);
  }
  /** rows 是按更新时间倒序排列的文章。 */
  const rows = database
    .prepare(`
      SELECT a.*,
        (SELECT cf.folder_id FROM content_folders AS cf
          WHERE cf.target_type = 'article' AND cf.target_id = a.id) AS folder_id,
        (SELECT cf.sort_order FROM content_folders AS cf
          WHERE cf.target_type = 'article' AND cf.target_id = a.id) AS folder_sort_order,
        EXISTS(
          SELECT 1 FROM favorites AS f
          WHERE f.target_type = 'article' AND f.target_id = a.id
        ) AS is_favorite
      FROM articles AS a
      WHERE (? = '' OR a.category = ?)
      ORDER BY a.updated_at DESC
      LIMIT ?
    `)
    .all(category, category, limit);
  return rows.map(mapArticleRow);
}

/**
 * 新增一份文档及其全文检索内容。
 *
 * @param {Record<string, unknown>} document 文档元数据和提取正文。
 * @returns {Record<string, unknown>} 已保存文档。
 */
export function insertDocument(document) {
  /** insertDocumentStatement 写入文档主记录。 */
  const insertDocumentStatement = database.prepare(`
    INSERT INTO documents (
      id, original_name, stored_name, mime_type, extension, size_bytes,
      sha256, title, category, category_source, category_confidence,
      summary, extracted_text, extraction_status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  /** insertSearchStatement 写入全文搜索索引。 */
  const insertSearchStatement = database.prepare(`
    INSERT INTO document_search (
      document_id, title, original_name, category, summary, extracted_text
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN IMMEDIATE;");
  try {
    insertDocumentStatement.run(
      document.id,
      document.originalName,
      document.storedName,
      document.mimeType,
      document.extension,
      document.sizeBytes,
      document.sha256,
      document.title,
      document.category,
      document.categorySource,
      document.categoryConfidence,
      document.summary,
      document.extractedText,
      document.extractionStatus,
      document.createdAt,
      document.updatedAt,
    );
    insertSearchStatement.run(
      document.id,
      document.title,
      document.originalName,
      document.category,
      document.summary,
      document.extractedText,
    );
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
  /** defaultFolderPath 是上传文档首次保存时对应的一级分类目录。 */
  const defaultFolderPath = ensureFolderPath([document.category || "其它"]);
  assignContentToFolder("document", document.id, defaultFolderPath.at(-1).id);
  return getDocumentById(document.id);
}

/**
 * 按 ID 读取一份文档。
 *
 * @param {string} documentId 文档稳定 ID。
 * @returns {Record<string, unknown> | null} 文档对象或空值。
 */
export function getDocumentById(documentId) {
  /** row 是数据库返回的单条文档记录。 */
  const row = database
    .prepare(`
      SELECT d.*,
        (SELECT cf.folder_id FROM content_folders AS cf
          WHERE cf.target_type = 'document' AND cf.target_id = d.id) AS folder_id,
        (SELECT cf.sort_order FROM content_folders AS cf
          WHERE cf.target_type = 'document' AND cf.target_id = d.id) AS folder_sort_order,
        EXISTS(
          SELECT 1 FROM favorites AS f
          WHERE f.target_type = 'document' AND f.target_id = d.id
        ) AS is_favorite
      FROM documents AS d
      WHERE d.id = ?
      LIMIT 1
    `)
    .get(documentId);
  return row ? mapDocumentRow(row) : null;
}

/**
 * 将支持的图片或扫描 PDF 标记为等待 OCR。
 *
 * @param {string} documentId 文档 ID。
 * @returns {Record<string, unknown> | null} 更新后的文档。
 */
export function queueDocumentOcr(documentId) {
  const result = database.prepare(`
    UPDATE documents SET
      ocr_status = 'queued', ocr_error = '', ocr_completed_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), String(documentId || ""));
  return Number(result.changes) > 0 ? getDocumentById(documentId) : null;
}

/**
 * 后台处理器领取任务后把文档 OCR 状态切换为运行中。
 *
 * @param {string} documentId 文档 ID。
 * @returns {Record<string, unknown> | null} 更新后的文档。
 */
export function startDocumentOcr(documentId) {
  const result = database.prepare(`
    UPDATE documents SET ocr_status = 'running', ocr_error = '', updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), String(documentId || ""));
  return Number(result.changes) > 0 ? getDocumentById(documentId) : null;
}

/**
 * 保存分页 OCR 结果，更新文档正文、摘要与全文索引。
 *
 * @param {string} documentId 文档 ID。
 * @param {{ pages: Array<Record<string, unknown>>, language: string, averageConfidence: number, summary: string }} result OCR 结果。
 * @returns {Record<string, unknown> | null} 完成后的文档。
 */
export function saveDocumentOcrResult(documentId, result) {
  /** document 是写入前用于索引字段的原文档。 */
  const document = getDocumentById(documentId);
  if (!document) return null;
  /** pages 是按页码排序且正文受限的 OCR 页面。 */
  const pages = (Array.isArray(result.pages) ? result.pages : [])
    .map((page, index) => ({
      pageNumber: Math.max(1, Math.trunc(Number(page.pageNumber) || index + 1)),
      text: String(page.text || "").trim(),
      confidence: Math.min(Math.max(Number(page.confidence) || 0, 0), 100),
      layout: Array.isArray(page.layout) ? page.layout : [],
    }))
    .filter((page) => page.text)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  if (pages.length === 0) throw new Error("OCR 没有识别出可保存的文字。");
  /** extractedText 以页标题分隔，便于阅读和引用页码。 */
  const extractedText = pages
    .map((page) => `第 ${page.pageNumber} 页\n${page.text}`)
    .join("\n\n");
  /** now 是分页结果和文档的统一更新时间。 */
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.prepare("DELETE FROM document_pages WHERE document_id = ?").run(document.id);
    /** insertPageStatement 是重复使用的分页结果写入语句。 */
    const insertPageStatement = database.prepare(`
      INSERT INTO document_pages(
        document_id, page_number, extraction_method, text, confidence,
        layout_json, created_at, updated_at
      ) VALUES (?, ?, 'ocr', ?, ?, ?, ?, ?)
    `);
    for (const page of pages) {
      insertPageStatement.run(
        document.id,
        page.pageNumber,
        page.text,
        page.confidence,
        JSON.stringify(page.layout),
        now,
        now,
      );
    }
    database.prepare(`
      UPDATE documents SET
        summary = ?, extracted_text = ?, extraction_status = 'complete:ocr',
        ocr_status = 'completed', ocr_error = '', ocr_language = ?,
        ocr_page_count = ?, ocr_average_confidence = ?, ocr_completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(result.summary || "").trim().slice(0, 500),
      extractedText,
      String(result.language || "").trim().slice(0, 80),
      pages.length,
      Math.min(Math.max(Number(result.averageConfidence) || 0, 0), 100),
      now,
      now,
      document.id,
    );
    database.prepare("DELETE FROM document_search WHERE document_id = ?").run(document.id);
    database.prepare(`
      INSERT INTO document_search(
        document_id, title, original_name, category, summary, extracted_text
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      document.id,
      document.title,
      document.originalName,
      document.category,
      String(result.summary || "").trim().slice(0, 500),
      extractedText,
    );
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
  return getDocumentById(document.id);
}

/**
 * 保存 OCR 失败原因，让原始文件继续可下载并支持重试。
 *
 * @param {string} documentId 文档 ID。
 * @param {unknown} error 错误对象或消息。
 * @returns {Record<string, unknown> | null} 失败后的文档。
 */
export function failDocumentOcr(documentId, error) {
  /** message 是展示给本地用户的受限错误信息。 */
  const message = String(error instanceof Error ? error.message : error || "OCR 失败。")
    .trim()
    .slice(0, 2000);
  database.prepare(`
    UPDATE documents SET ocr_status = 'failed', ocr_error = ?, updated_at = ?
    WHERE id = ?
  `).run(message || "OCR 失败。", new Date().toISOString(), String(documentId || ""));
  return getDocumentById(documentId);
}

/**
 * 读取文档逐页 OCR 文本与版面坐标。
 *
 * @param {string} documentId 文档 ID。
 * @returns {Array<Record<string, unknown>>} 按页码排序的结果。
 */
export function listDocumentPages(documentId) {
  return database.prepare(`
    SELECT * FROM document_pages WHERE document_id = ? ORDER BY page_number ASC
  `).all(String(documentId || "")).map((row) => {
    let layout = [];
    try {
      layout = JSON.parse(row.layout_json || "[]");
    } catch {
      layout = [];
    }
    return {
      documentId: row.document_id,
      pageNumber: Number(row.page_number),
      extractionMethod: row.extraction_method,
      text: row.text,
      confidence: Number(row.confidence) || 0,
      layout,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * 查询文档列表并支持分类和关键词过滤。
 *
 * @param {{ category?: string, query?: string, limit?: number }} filters 查询条件。
 * @returns {Record<string, unknown>[]} 文档列表。
 */
export function listDocuments(filters = {}) {
  /** category 是可选分类过滤值。 */
  const category = filters.category?.trim() || "";
  /** query 是可选全文搜索关键词。 */
  const query = filters.query?.trim() || "";
  /** limit 是单次最多返回的记录数。 */
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);

  if (query) {
    /** searchQuery 将用户输入拆成安全的 FTS 前缀搜索词。 */
    const searchQuery = query
      .split(/\s+/)
      .map((term) => term.replace(/["*:^()]/g, "").trim())
      .filter(Boolean)
      .map((term) => `"${term}"*`)
      .join(" AND ");
    if (!searchQuery) return [];
    /** rows 是全文索引命中的文档记录。 */
    const rows = database
      .prepare(`
        SELECT d.*,
          (SELECT cf.folder_id FROM content_folders AS cf
            WHERE cf.target_type = 'document' AND cf.target_id = d.id) AS folder_id,
          (SELECT cf.sort_order FROM content_folders AS cf
            WHERE cf.target_type = 'document' AND cf.target_id = d.id) AS folder_sort_order,
          EXISTS(
            SELECT 1 FROM favorites AS f
            WHERE f.target_type = 'document' AND f.target_id = d.id
          ) AS is_favorite
        FROM document_search AS s
        JOIN documents AS d ON d.id = s.document_id
        WHERE document_search MATCH ?
          AND (? = '' OR d.category = ?)
        ORDER BY rank, d.updated_at DESC
        LIMIT ?
      `)
      .all(searchQuery, category, category, limit);
    return rows.map(mapDocumentRow);
  }

  /** rows 是按更新时间倒序排列的普通文档列表。 */
  const rows = database
    .prepare(`
      SELECT d.*,
        (SELECT cf.folder_id FROM content_folders AS cf
          WHERE cf.target_type = 'document' AND cf.target_id = d.id) AS folder_id,
        (SELECT cf.sort_order FROM content_folders AS cf
          WHERE cf.target_type = 'document' AND cf.target_id = d.id) AS folder_sort_order,
        EXISTS(
          SELECT 1 FROM favorites AS f
          WHERE f.target_type = 'document' AND f.target_id = d.id
        ) AS is_favorite
      FROM documents AS d
      WHERE (? = '' OR d.category = ?)
      ORDER BY d.updated_at DESC
      LIMIT ?
    `)
    .all(category, category, limit);
  return rows.map(mapDocumentRow);
}

/**
 * 新增或取消文件/网页文章的收藏状态。
 *
 * @param {{ targetType: "document" | "article", targetId: string, active: boolean }} favorite 收藏参数。
 * @returns {{ targetType: string, targetId: string, active: boolean }} 最终收藏状态。
 */
export function setFavorite(favorite) {
  /** targetType 是收藏对象类型，仅允许文件文档或网页文章。 */
  const targetType = favorite.targetType;
  /** targetId 是被收藏对象的稳定 ID。 */
  const targetId = String(favorite.targetId || "").trim();
  /** active 表示目标最终是否应处于收藏状态。 */
  const active = Boolean(favorite.active);
  if (!["document", "article"].includes(targetType) || !targetId) {
    throw new TypeError("收藏对象无效。");
  }
  /** sourceTable 是用于确认对象存在的安全固定表名。 */
  const sourceTable = targetType === "document" ? "documents" : "articles";
  /** sourceExists 表示目标记录仍存在于本地知识库。 */
  const sourceExists = database
    .prepare(`SELECT 1 FROM ${sourceTable} WHERE id = ? LIMIT 1`)
    .get(targetId);
  if (!sourceExists) return null;
  if (active) {
    database
      .prepare(`
        INSERT INTO favorites(target_type, target_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(target_type, target_id) DO NOTHING
      `)
      .run(targetType, targetId, new Date().toISOString());
  } else {
    database
      .prepare("DELETE FROM favorites WHERE target_type = ? AND target_id = ?")
      .run(targetType, targetId);
  }
  return { targetType, targetId, active };
}

/**
 * 返回文档数量和各分类统计。
 *
 * @returns {{ total: number, categories: Record<string, number> }} 统计结果。
 */
export function getDocumentStatistics() {
  /** totalRow 是全部文档总数查询结果。 */
  const totalRow = database.prepare("SELECT COUNT(*) AS count FROM documents").get();
  /** categoryRows 是按分类聚合的数量列表。 */
  const categoryRows = database
    .prepare(
      "SELECT category, COUNT(*) AS count FROM documents GROUP BY category ORDER BY count DESC",
    )
    .all();
  /** categories 是方便前端直接读取的分类数量映射。 */
  const categories = Object.fromEntries(
    categoryRows.map((row) => [row.category, row.count]),
  );
  return { total: totalRow.count, categories };
}

/**
 * 更新一份文档的人工分类，并同步全文索引。
 *
 * @param {string} documentId 文档 ID。
 * @param {string} category 新分类。
 * @returns {Record<string, unknown> | null} 更新后的文档。
 */
export function updateDocumentCategory(documentId, category) {
  /** updatedAt 是分类变更时间。 */
  const updatedAt = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE;");
  try {
    database
      .prepare(`
        UPDATE documents
        SET category = ?, category_source = 'manual',
            category_confidence = 1, updated_at = ?
        WHERE id = ?
      `)
      .run(category, updatedAt, documentId);
    /** document 是准备重新写入搜索索引的最新记录。 */
    const document = getDocumentById(documentId);
    if (document) {
      database
        .prepare("DELETE FROM document_search WHERE document_id = ?")
        .run(documentId);
      database
        .prepare(`
          INSERT INTO document_search (
            document_id, title, original_name, category, summary, extracted_text
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          document.id,
          document.title,
          document.originalName,
          document.category,
          document.summary,
          document.extractedText,
        );
    }
    database.exec("COMMIT;");
    if (document) {
      /** categoryFolder 是人工分类对应的一级文件夹。 */
      const categoryFolder = ensureFolderPath([category]).at(-1);
      assignContentToFolder("document", documentId, categoryFolder.id);
    }
    return getDocumentById(documentId);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

/**
 * 将论文数据库行转换成前端使用的字段。
 *
 * @param {Record<string, unknown>} row SQLite 论文查询结果。
 * @returns {Record<string, unknown>} 可序列化论文对象。
 */
function mapPaperRow(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    title: row.title,
    abstract: row.abstract,
    titleZh: row.title_zh,
    abstractZh: row.abstract_zh,
    translationSource: row.translation_source,
    translatedAt: row.translated_at,
    authors: JSON.parse(row.authors_json || "[]"),
    category: row.category,
    publishedAt: row.published_at,
    sourceUrl: row.source_url,
    pdfUrl: row.pdf_url,
    sourceType: row.source_type || "weekly",
    sourceLabel: row.source_label || "每周精选",
    curatorNote: row.curator_note || "",
    videoUrl: row.video_url,
    videoAltUrl: row.video_alt_url,
    duration: row.duration,
    sourceText: row.source_text || "",
    sourceTextWordCount: row.source_text_word_count || 0,
    fullTranslationHtml: row.full_translation_html || "",
    fullTranslationStatus: row.full_translation_status || "pending",
    fullTranslationSource: row.full_translation_source,
    fullTranslatedAt: row.full_translated_at,
    fullTranslationError: row.full_translation_error,
    extractionError: row.extraction_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将每周候选论文数据库行转换成前端使用的字段。
 *
 * @param {Record<string, unknown>} row SQLite 候选论文查询结果。
 * @returns {Record<string, unknown>} 可序列化候选论文对象。
 */
function mapPaperCandidateRow(row) {
  return {
    id: row.id,
    weekKey: row.week_key,
    externalId: row.external_id,
    title: row.title,
    abstract: row.abstract,
    titleZh: row.title_zh,
    abstractZh: row.abstract_zh,
    translationSource: row.translation_source,
    translatedAt: row.translated_at,
    authors: JSON.parse(row.authors_json || "[]"),
    category: row.category,
    publishedAt: row.published_at,
    sourceUrl: row.source_url,
    pdfUrl: row.pdf_url,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * 返回论文库中已经由用户选定的全部论文。
 *
 * @returns {Record<string, unknown>[]} 按加入时间倒序排列的论文。
 */
export function listPapers(sourceType = "") {
  /** normalizedSourceType 是可选的论文来源过滤值。 */
  const normalizedSourceType = String(sourceType || "").trim();
  /** rows 是论文库数据库查询结果。 */
  const rows = database
    .prepare(`
      SELECT * FROM papers
      WHERE (? = '' OR source_type = ?)
      ORDER BY created_at DESC
    `)
    .all(normalizedSourceType, normalizedSourceType);
  return rows.map(mapPaperRow);
}

/**
 * 按本地 ID 读取一篇论文的完整正文与翻译。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @returns {Record<string, unknown> | null} 完整论文或空值。
 */
export function getPaperById(paperId) {
  /** row 是数据库返回的单篇论文。 */
  const row = database
    .prepare("SELECT * FROM papers WHERE id = ? LIMIT 1")
    .get(paperId);
  return row ? mapPaperRow(row) : null;
}

/**
 * 幂等保存用户手动导入的论文文件或论文网页。
 *
 * @param {Record<string, unknown>} paper 已完成基础解析的论文数据。
 * @returns {Record<string, unknown>} 数据库中的论文记录。
 */
export function upsertImportedPaper(paper) {
  /** externalId 是文件摘要或规范化网页地址组成的稳定去重键。 */
  const externalId = String(paper.externalId || "").trim();
  /** title 是论文列表必须展示的标题。 */
  const title = String(paper.title || "").trim();
  if (!externalId || !title) {
    throw new TypeError("导入论文缺少稳定来源或标题。");
  }
  /** now 是本次导入或更新的统一时间。 */
  const now = new Date().toISOString();
  /** existingRow 用于重复导入时保留本地 ID 和首次创建时间。 */
  const existingRow = database
    .prepare("SELECT id, created_at FROM papers WHERE external_id = ? LIMIT 1")
    .get(externalId);
  /** paperId 是论文的稳定本地 ID。 */
  const paperId = existingRow?.id ?? String(paper.id || `paper_${crypto.randomUUID()}`);
  /** sourceText 是文件或网页中已经提取的可读正文。 */
  const sourceText = String(paper.sourceText || "").trim();
  /** sourceLanguage 决定中文原文是否需要进入 Codex 翻译队列。 */
  const sourceLanguage = String(paper.sourceLanguage || "unknown");
  /** translationStatus 对中文原文标记为无需翻译。 */
  const translationStatus = sourceLanguage === "zh" ? "not_required" : "pending";
  /** wordCount 是中英文统一采用空白词元和汉字数量中的较大值。 */
  const wordCount = Math.max(
    Number(paper.sourceTextWordCount) || 0,
    sourceText.split(/\s+/).filter(Boolean).length,
    (sourceText.match(/[\u3400-\u9fff]/g) || []).length,
  );
  database
    .prepare(`
      INSERT INTO papers (
        id, external_id, title, abstract, title_zh, abstract_zh,
        translation_source, translated_at, authors_json, category,
        published_at, source_url, pdf_url, source_type, source_label,
        curator_note, source_text, source_text_word_count,
        full_translation_status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', '手动导入',
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(external_id) DO UPDATE SET
        title = excluded.title,
        abstract = excluded.abstract,
        title_zh = COALESCE(excluded.title_zh, papers.title_zh),
        abstract_zh = COALESCE(excluded.abstract_zh, papers.abstract_zh),
        authors_json = excluded.authors_json,
        category = excluded.category,
        published_at = COALESCE(excluded.published_at, papers.published_at),
        source_url = excluded.source_url,
        pdf_url = COALESCE(excluded.pdf_url, papers.pdf_url),
        source_type = 'manual',
        source_label = '手动导入',
        source_text = CASE
          WHEN COALESCE(TRIM(excluded.source_text), '') <> '' THEN excluded.source_text
          ELSE papers.source_text
        END,
        source_text_word_count = MAX(excluded.source_text_word_count, papers.source_text_word_count),
        full_translation_status = CASE
          WHEN excluded.full_translation_status = 'not_required' THEN 'not_required'
          ELSE papers.full_translation_status
        END,
        extraction_error = NULL,
        updated_at = excluded.updated_at
    `)
    .run(
      paperId,
      externalId,
      title,
      String(paper.abstract || ""),
      sourceLanguage === "zh" ? title : paper.titleZh || null,
      sourceLanguage === "zh" ? String(paper.abstract || "") : paper.abstractZh || null,
      sourceLanguage === "zh" ? "original" : null,
      sourceLanguage === "zh" ? now : null,
      JSON.stringify(paper.authors ?? []),
      String(paper.category || "其它"),
      paper.publishedAt || null,
      String(paper.sourceUrl || ""),
      paper.pdfUrl || null,
      String(paper.curatorNote || ""),
      sourceText,
      wordCount,
      translationStatus,
      existingRow?.created_at ?? now,
      now,
    );
  return getPaperById(paperId);
}

/**
 * 更新手动导入论文的自动分类。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @param {string} category 分类名称。
 * @returns {Record<string, unknown> | null} 更新后的论文。
 */
export function updatePaperCategory(paperId, category) {
  /** normalizedCategory 是用于论文列表的非空分类。 */
  const normalizedCategory = String(category || "其它").trim() || "其它";
  database
    .prepare("UPDATE papers SET category = ?, updated_at = ? WHERE id = ?")
    .run(normalizedCategory, new Date().toISOString(), paperId);
  return getPaperById(paperId);
}

/**
 * 保存公开 PDF 中提取出的英文全文。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @param {{ sourceText: string, wordCount: number }} extraction 提取结果。
 * @returns {Record<string, unknown> | null} 更新后的论文。
 */
export function updatePaperSourceText(paperId, extraction) {
  /** sourceText 是去除首尾空白后的英文论文正文。 */
  const sourceText = String(extraction.sourceText || "").trim();
  /** wordCount 是提取正文的英文词数。 */
  const wordCount = Math.max(Number(extraction.wordCount) || 0, 0);
  /** updatedAt 是全文提取完成时间。 */
  const updatedAt = new Date().toISOString();
  /** translationStatus 对中文原文跳过不必要的全文翻译队列。 */
  const translationStatus = extraction.sourceLanguage === "zh" ? "not_required" : "pending";
  database
    .prepare(`
      UPDATE papers
      SET source_text = ?, source_text_word_count = ?,
          full_translation_status = ?, full_translation_error = NULL,
          extraction_error = NULL,
          updated_at = ?
      WHERE id = ?
    `)
    .run(sourceText, wordCount, translationStatus, updatedAt, paperId);
  return getPaperById(paperId);
}

/**
 * 记录论文全文提取失败原因，便于界面明确提示。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @param {string} message 可安全展示的错误说明。
 * @returns {Record<string, unknown> | null} 更新后的论文。
 */
export function markPaperExtractionFailed(paperId, message) {
  /** updatedAt 是失败状态写入时间。 */
  const updatedAt = new Date().toISOString();
  database
    .prepare(`
      UPDATE papers
      SET full_translation_status = 'failed', extraction_error = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(String(message || "无法提取论文全文。").slice(0, 500), updatedAt, paperId);
  return getPaperById(paperId);
}

/**
 * 返回已经提取英文全文但尚未完成 Codex 中文翻译的论文。
 *
 * @param {number} limit 单次读取上限。
 * @returns {Record<string, unknown>[]} 待翻译论文。
 */
export function listPendingFullPaperTranslations(limit = 5) {
  /** safeLimit 是限制在合理范围内的队列长度。 */
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);
  /** rows 是有英文正文且尚无完整中文译文的论文。 */
  const rows = database
    .prepare(`
      SELECT * FROM papers
      WHERE COALESCE(TRIM(source_text), '') <> ''
        AND COALESCE(TRIM(full_translation_html), '') = ''
        AND full_translation_status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(safeLimit);
  return rows.map(mapPaperRow);
}

/**
 * 原子领取队列中最早的一篇英文论文，防止多个触发事件重复翻译。
 *
 * @returns {Record<string, unknown> | null} 已切换为 processing 的论文或空值。
 */
export function claimNextPendingFullPaperTranslation() {
  /** row 是按照进入论文库时间选出的最早待处理论文。 */
  const row = database
    .prepare(`
      SELECT id FROM papers
      WHERE COALESCE(TRIM(source_text), '') <> ''
        AND COALESCE(TRIM(full_translation_html), '') = ''
        AND full_translation_status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .get();
  if (!row) return null;
  /** updatedAt 是工作器正式领取任务的时间。 */
  const updatedAt = new Date().toISOString();
  /** result 通过附加 pending 条件保证同一任务只会被领取一次。 */
  const result = database
    .prepare(`
      UPDATE papers
      SET full_translation_status = 'processing',
          full_translation_error = NULL, updated_at = ?
      WHERE id = ? AND full_translation_status = 'pending'
    `)
    .run(updatedAt, row.id);
  return result.changes === 1 ? getPaperById(row.id) : null;
}

/**
 * 服务异常退出后把未完成的 processing 任务退回等待队列。
 *
 * @returns {number} 被恢复的任务数量。
 */
export function resetInterruptedFullPaperTranslations() {
  /** updatedAt 是本次恢复队列的时间。 */
  const updatedAt = new Date().toISOString();
  /** result 是恢复操作影响的数据库行数。 */
  const result = database
    .prepare(`
      UPDATE papers
      SET full_translation_status = 'pending',
          full_translation_error = '上一次翻译因本地服务中断而暂停，现已重新排队。',
          updated_at = ?
      WHERE full_translation_status = 'processing'
    `)
    .run(updatedAt);
  return Number(result.changes) || 0;
}

/**
 * 记录 Codex 全文翻译失败，保留英文正文供用户稍后重试。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @param {string} message 可安全展示的失败原因。
 * @returns {Record<string, unknown> | null} 更新后的论文。
 */
export function markPaperFullTranslationFailed(paperId, message) {
  /** updatedAt 是失败状态写入时间。 */
  const updatedAt = new Date().toISOString();
  /** safeMessage 是限制长度后的本地错误说明。 */
  const safeMessage = String(message || "Codex 全文翻译失败。").slice(0, 1000);
  database
    .prepare(`
      UPDATE papers
      SET full_translation_status = 'failed', full_translation_error = ?,
          updated_at = ?
      WHERE id = ?
    `)
    .run(safeMessage, updatedAt, paperId);
  return getPaperById(paperId);
}

/**
 * 把已有英文正文的失败任务重新加入 Codex 翻译队列。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @returns {Record<string, unknown> | null} 重新排队后的论文或空值。
 */
export function retryPaperFullTranslation(paperId) {
  /** paper 是用于确认正文存在且确实需要翻译的论文。 */
  const paper = getPaperById(paperId);
  if (!paper || !paper.sourceText.trim()) return null;
  if (paper.fullTranslationStatus === "not_required") return paper;
  /** updatedAt 是重新排队的时间。 */
  const updatedAt = new Date().toISOString();
  database
    .prepare(`
      UPDATE papers
      SET full_translation_status = 'pending', full_translation_error = NULL,
          updated_at = ?
      WHERE id = ?
    `)
    .run(updatedAt, paperId);
  return getPaperById(paperId);
}

/**
 * 写入由 Codex 生成的论文全文中文阅读版。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @param {string} translatedHtml 只含阅读型标签的中文 HTML。
 * @returns {Record<string, unknown> | null} 更新后的论文。
 */
export function updatePaperFullTranslation(paperId, translatedHtml) {
  /** normalizedHtml 是去除首尾空白后的完整中文译文。 */
  const normalizedHtml = String(translatedHtml || "").trim();
  if (normalizedHtml.length < 500) {
    throw new TypeError("论文全文中文译文不能少于 500 个字符。");
  }
  /** translatedAt 是 Codex 完成全文翻译的时间。 */
  const translatedAt = new Date().toISOString();
  database
    .prepare(`
      UPDATE papers
      SET full_translation_html = ?, full_translation_status = 'ready',
          full_translation_source = 'codex', full_translated_at = ?,
          full_translation_error = NULL, updated_at = ?
      WHERE id = ?
    `)
    .run(normalizedHtml, translatedAt, translatedAt, paperId);
  return getPaperById(paperId);
}

/**
 * 幂等写入一条李沐精读目录论文或更新其视频与解读信息。
 *
 * @param {Record<string, unknown>} paper 李沐精读目录解析结果。
 * @returns {Record<string, unknown>} 数据库中的最终论文。
 */
export function upsertCuratedPaper(paper) {
  /** now 是目录同步时间。 */
  const now = new Date().toISOString();
  /** existingRow 是相同外部论文地址已经存在的记录。 */
  const existingRow = database
    .prepare("SELECT id, created_at FROM papers WHERE external_id = ? LIMIT 1")
    .get(paper.externalId);
  /** paperId 复用已存在的本地 ID。 */
  const paperId = existingRow?.id ?? `paper_${crypto.randomUUID()}`;
  /** createdAt 保留论文首次进入知识库的时间。 */
  const createdAt = existingRow?.created_at ?? now;
  database
    .prepare(`
      INSERT INTO papers (
        id, external_id, title, abstract, title_zh, abstract_zh,
        translation_source, translated_at, authors_json, category,
        published_at, source_url, pdf_url, source_type, source_label,
        curator_note, video_url, video_alt_url, duration, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mli', '李沐精读',
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(external_id) DO UPDATE SET
        title = excluded.title,
        abstract = excluded.abstract,
        title_zh = COALESCE(excluded.title_zh, papers.title_zh),
        abstract_zh = COALESCE(excluded.abstract_zh, papers.abstract_zh),
        category = excluded.category,
        source_url = excluded.source_url,
        pdf_url = COALESCE(excluded.pdf_url, papers.pdf_url),
        source_type = 'mli',
        source_label = '李沐精读',
        curator_note = excluded.curator_note,
        video_url = COALESCE(excluded.video_url, papers.video_url),
        video_alt_url = COALESCE(excluded.video_alt_url, papers.video_alt_url),
        duration = COALESCE(excluded.duration, papers.duration),
        updated_at = excluded.updated_at
    `)
    .run(
      paperId,
      paper.externalId,
      paper.title,
      paper.abstract || "",
      paper.titleZh || null,
      paper.abstractZh || null,
      paper.titleZh ? "mli" : null,
      paper.titleZh ? now : null,
      JSON.stringify(paper.authors ?? []),
      paper.category || "AI",
      paper.publishedAt || null,
      paper.sourceUrl,
      paper.pdfUrl || null,
      paper.curatorNote || "",
      paper.videoUrl || null,
      paper.videoAltUrl || null,
      paper.duration || null,
      createdAt,
      now,
    );
  return getPaperById(paperId);
}

/**
 * 返回指定自然周已经缓存的候选论文。
 *
 * @param {string} weekKey ISO 周标识。
 * @returns {Record<string, unknown>[]} 本周候选论文。
 */
export function listPaperCandidates(weekKey) {
  /** rows 是本周候选论文数据库查询结果。 */
  const rows = database
    .prepare(`
      SELECT * FROM paper_candidates
      WHERE week_key = ?
      ORDER BY created_at ASC
    `)
    .all(weekKey);
  return rows.map(mapPaperCandidateRow);
}

/**
 * 返回尚未完成中文标题或中文摘要的论文候选。
 *
 * @param {number} limit 单次最多返回数量。
 * @returns {Record<string, unknown>[]} 等待 Codex 翻译的候选论文。
 */
export function listPendingPaperTranslations(limit = 20) {
  /** safeLimit 是限制在合理范围内的队列长度。 */
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  /** rows 是缺少中文翻译的候选论文。 */
  const rows = database
    .prepare(`
      SELECT * FROM paper_candidates
      WHERE COALESCE(TRIM(title_zh), '') = ''
         OR COALESCE(TRIM(abstract_zh), '') = ''
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(safeLimit);
  return rows.map(mapPaperCandidateRow);
}

/**
 * 保存由 Codex 生成的中文标题和中文摘要。
 *
 * @param {string} candidateId 候选论文 ID。
 * @param {{ titleZh: string, abstractZh: string }} translation 中文译文。
 * @returns {Record<string, unknown> | null} 更新后的候选论文。
 */
export function updatePaperCandidateTranslation(candidateId, translation) {
  /** titleZh 是去除首尾空白的中文标题。 */
  const titleZh = String(translation.titleZh || "").trim();
  /** abstractZh 是去除首尾空白的中文摘要。 */
  const abstractZh = String(translation.abstractZh || "").trim();
  if (!titleZh || !abstractZh) {
    throw new TypeError("中文标题和中文摘要均不能为空。");
  }
  /** candidate 是等待写入翻译的候选论文。 */
  const candidate = database
    .prepare("SELECT * FROM paper_candidates WHERE id = ? LIMIT 1")
    .get(candidateId);
  if (!candidate) return null;
  /** translatedAt 是 Codex 完成翻译的时间。 */
  const translatedAt = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE;");
  try {
    database
      .prepare(`
        UPDATE paper_candidates
        SET title_zh = ?, abstract_zh = ?,
            translation_source = 'codex', translated_at = ?
        WHERE id = ?
      `)
      .run(titleZh, abstractZh, translatedAt, candidateId);
    database
      .prepare(`
        UPDATE papers
        SET title_zh = ?, abstract_zh = ?,
            translation_source = 'codex', translated_at = ?,
            updated_at = ?
        WHERE external_id = ?
      `)
      .run(
        titleZh,
        abstractZh,
        translatedAt,
        translatedAt,
        candidate.external_id,
      );
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
  /** updatedCandidate 是写入翻译后的最新候选记录。 */
  const updatedCandidate = database
    .prepare("SELECT * FROM paper_candidates WHERE id = ? LIMIT 1")
    .get(candidateId);
  return updatedCandidate ? mapPaperCandidateRow(updatedCandidate) : null;
}

/**
 * 首次生成某周候选论文时批量写入，重复调用不会产生重复记录。
 *
 * @param {string} weekKey ISO 周标识。
 * @param {Record<string, unknown>[]} candidates 来自公开论文索引的候选项。
 * @returns {Record<string, unknown>[]} 数据库中的本周候选项。
 */
export function savePaperCandidates(weekKey, candidates) {
  /** insertCandidateStatement 是候选论文幂等写入语句。 */
  const insertCandidateStatement = database.prepare(`
    INSERT INTO paper_candidates (
      id, week_key, external_id, title, abstract, title_zh, abstract_zh,
      translation_source, translated_at, authors_json, category,
      published_at, source_url, pdf_url, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(week_key, external_id) DO NOTHING
  `);
  /** now 是候选论文和周提醒状态的统一更新时间。 */
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE;");
  try {
    for (const candidate of candidates) {
      insertCandidateStatement.run(
        candidate.id,
        weekKey,
        candidate.externalId,
        candidate.title,
        candidate.abstract,
        candidate.titleZh || null,
        candidate.abstractZh || null,
        candidate.translationSource || null,
        candidate.translatedAt || null,
        JSON.stringify(candidate.authors ?? []),
        candidate.category,
        candidate.publishedAt,
        candidate.sourceUrl,
        candidate.pdfUrl,
        now,
      );
    }
    database
      .prepare(`
        INSERT INTO paper_week_status(week_key, status, updated_at)
        VALUES (?, 'pending', ?)
        ON CONFLICT(week_key) DO NOTHING
      `)
      .run(weekKey, now);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
  return listPaperCandidates(weekKey);
}

/**
 * 读取指定周的论文提醒状态。
 *
 * @param {string} weekKey ISO 周标识。
 * @returns {Record<string, unknown> | null} 周提醒状态或空值。
 */
export function getPaperWeekStatus(weekKey) {
  /** row 是单周提醒状态查询结果。 */
  const row = database
    .prepare("SELECT * FROM paper_week_status WHERE week_key = ? LIMIT 1")
    .get(weekKey);
  if (!row) return null;
  return {
    weekKey: row.week_key,
    status: row.status,
    snoozedUntil: row.snoozed_until,
    selectedPaperId: row.selected_paper_id,
    updatedAt: row.updated_at,
  };
}

/**
 * 将用户选中的候选项正式写入论文库，并结束本周提醒。
 *
 * @param {string} candidateId 候选论文 ID。
 * @returns {Record<string, unknown> | null} 新增或已存在的论文。
 */
export function selectPaperCandidate(candidateId) {
  /** candidate 是用户当前选中的候选论文数据库行。 */
  const candidate = database
    .prepare("SELECT * FROM paper_candidates WHERE id = ? LIMIT 1")
    .get(candidateId);
  if (!candidate) return null;
  /** existingWeekStatus 用于确保同一自然周最多正式选择一篇论文。 */
  const existingWeekStatus = database
    .prepare(`
      SELECT status, selected_paper_id
      FROM paper_week_status
      WHERE week_key = ?
      LIMIT 1
    `)
    .get(candidate.week_key);
  if (
    existingWeekStatus?.status === "selected" &&
    existingWeekStatus.selected_paper_id
  ) {
    /** existingPaper 是本周已经选定并保存在论文库中的论文。 */
    const existingPaper = database
      .prepare("SELECT * FROM papers WHERE id = ? LIMIT 1")
      .get(existingWeekStatus.selected_paper_id);
    return existingPaper ? mapPaperRow(existingPaper) : null;
  }
  /** now 是论文正式加入本地论文库的时间。 */
  const now = new Date().toISOString();
  /** paperId 是论文库中的稳定本地 ID。 */
  const paperId = `paper_${crypto.randomUUID()}`;
  /** isDailyClassic 表示候选来自每日经典论文路线。 */
  const isDailyClassic = String(candidate.week_key).startsWith("daily:");
  /** sourceType 是正式论文的来源筛选值。 */
  const sourceType = isDailyClassic ? "classic" : "weekly";
  /** sourceLabel 是论文卡片展示的来源名称。 */
  const sourceLabel = isDailyClassic ? "每日经典" : "每周精选";
  database.exec("BEGIN IMMEDIATE;");
  try {
    database
      .prepare(`
        INSERT INTO papers (
          id, external_id, title, abstract, title_zh, abstract_zh,
          translation_source, translated_at, authors_json, category,
          published_at, source_url, pdf_url, source_type, source_label,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(external_id) DO UPDATE SET
          title = excluded.title,
          abstract = excluded.abstract,
          title_zh = excluded.title_zh,
          abstract_zh = excluded.abstract_zh,
          translation_source = excluded.translation_source,
          translated_at = excluded.translated_at,
          authors_json = excluded.authors_json,
          category = excluded.category,
          published_at = excluded.published_at,
          source_url = excluded.source_url,
          pdf_url = excluded.pdf_url,
          updated_at = excluded.updated_at
      `)
      .run(
        paperId,
        candidate.external_id,
        candidate.title,
        candidate.abstract,
        candidate.title_zh,
        candidate.abstract_zh,
        candidate.translation_source,
        candidate.translated_at,
        candidate.authors_json,
        candidate.category,
        candidate.published_at,
        candidate.source_url,
        candidate.pdf_url,
        sourceType,
        sourceLabel,
        now,
        now,
      );
    database
      .prepare(`
        UPDATE paper_candidates
        SET status = CASE WHEN id = ? THEN 'selected' ELSE status END
        WHERE week_key = ?
      `)
      .run(candidateId, candidate.week_key);
    /** savedPaper 是处理重复外部论文后最终存在的论文记录。 */
    const savedPaper = database
      .prepare("SELECT * FROM papers WHERE external_id = ? LIMIT 1")
      .get(candidate.external_id);
    database
      .prepare(`
        INSERT INTO paper_week_status (
          week_key, status, snoozed_until, selected_paper_id, updated_at
        ) VALUES (?, 'selected', NULL, ?, ?)
        ON CONFLICT(week_key) DO UPDATE SET
          status = 'selected',
          snoozed_until = NULL,
          selected_paper_id = excluded.selected_paper_id,
          updated_at = excluded.updated_at
      `)
      .run(candidate.week_key, savedPaper.id, now);
    database.exec("COMMIT;");
    return mapPaperRow(savedPaper);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

/**
 * 将本周论文选择提醒延后到指定时间。
 *
 * @param {string} weekKey ISO 周标识。
 * @param {string} snoozedUntil 下次允许提醒的 ISO 时间。
 * @returns {Record<string, unknown>} 更新后的提醒状态。
 */
export function snoozePaperReminder(weekKey, snoozedUntil) {
  /** now 是提醒状态更新时间。 */
  const now = new Date().toISOString();
  database
    .prepare(`
      INSERT INTO paper_week_status (
        week_key, status, snoozed_until, updated_at
      ) VALUES (?, 'pending', ?, ?)
      ON CONFLICT(week_key) DO UPDATE SET
        status = 'pending',
        snoozed_until = excluded.snoozed_until,
        updated_at = excluded.updated_at
    `)
    .run(weekKey, snoozedUntil, now);
  return getPaperWeekStatus(weekKey);
}

/**
 * 关闭本周论文选择提醒，不向论文库自动添加任何论文。
 *
 * @param {string} weekKey ISO 周标识。
 * @returns {Record<string, unknown>} 更新后的提醒状态。
 */
export function dismissPaperReminder(weekKey) {
  /** now 是本周提醒被跳过的时间。 */
  const now = new Date().toISOString();
  database
    .prepare(`
      INSERT INTO paper_week_status(week_key, status, updated_at)
      VALUES (?, 'dismissed', ?)
      ON CONFLICT(week_key) DO UPDATE SET
        status = 'dismissed',
        snoozed_until = NULL,
        updated_at = excluded.updated_at
    `)
    .run(weekKey, now);
  return getPaperWeekStatus(weekKey);
}

/** readingTargetTables 是阅读工作台允许访问的内容类型与数据表映射。 */
const readingTargetTables = Object.freeze({
  document: "documents",
  article: "articles",
  paper: "papers",
});

/** readingStatuses 是阅读状态允许的固定值。 */
const readingStatuses = new Set(["unread", "reading", "completed"]);

/** annotationColors 是高亮标记允许的颜色名称。 */
const annotationColors = new Set(["yellow", "green", "blue", "red"]);

/**
 * 确认阅读目标类型有效，并返回对应的固定表名。
 *
 * @param {string} targetType 文档、文章或论文类型。
 * @returns {string} 对应的 SQLite 表名。
 */
function getReadingTargetTable(targetType) {
  /** targetTable 是从固定白名单取得的目标表名。 */
  const targetTable = readingTargetTables[targetType];
  if (!targetTable) throw new Error("不支持的阅读内容类型。");
  return targetTable;
}

/**
 * 检查阅读目标是否仍存在于本地知识库。
 *
 * @param {string} targetType 文档、文章或论文类型。
 * @param {string} targetId 阅读目标 ID。
 * @returns {boolean} 目标是否存在。
 */
function readingTargetExists(targetType, targetId) {
  /** targetTable 是通过白名单确认的目标表名。 */
  const targetTable = getReadingTargetTable(targetType);
  /** targetRow 是目标表中的最小存在性查询结果。 */
  const targetRow = database
    .prepare(`SELECT id FROM ${targetTable} WHERE id = ? LIMIT 1`)
    .get(targetId);
  return Boolean(targetRow);
}

/**
 * 将阅读状态数据库行转换为浏览器字段。
 *
 * @param {Record<string, unknown> | undefined} row SQLite 查询结果。
 * @returns {Record<string, unknown>} 阅读状态对象。
 */
function mapReadingStateRow(row) {
  return {
    status: row?.reading_status ?? "unread",
    progressPercent: Number(row?.progress_percent ?? 0),
    noteText: row?.note_text ?? "",
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * 将高亮批注数据库行转换为浏览器字段。
 *
 * @param {Record<string, unknown>} row SQLite 查询结果。
 * @returns {Record<string, unknown>} 高亮批注对象。
 */
function mapReadingAnnotationRow(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    quoteText: row.quote_text,
    anchorStart: Number(row.anchor_start),
    anchorEnd: Number(row.anchor_end),
    color: row.color,
    noteText: row.note_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 读取某项内容的进度、笔记和全部高亮批注。
 *
 * @param {string} targetType 文档、文章或论文类型。
 * @param {string} targetId 阅读目标 ID。
 * @returns {Record<string, unknown> | null} 阅读工作台数据；目标不存在时为空。
 */
export function getReadingWorkspace(targetType, targetId) {
  if (!readingTargetExists(targetType, targetId)) return null;
  /** stateRow 是已经保存的阅读状态；首次阅读时为空。 */
  const stateRow = database
    .prepare(`
      SELECT reading_status, progress_percent, note_text, updated_at
      FROM reading_states
      WHERE target_type = ? AND target_id = ?
      LIMIT 1
    `)
    .get(targetType, targetId);
  /** annotationRows 是按原文位置排列的全部高亮批注。 */
  const annotationRows = database
    .prepare(`
      SELECT * FROM reading_annotations
      WHERE target_type = ? AND target_id = ?
      ORDER BY anchor_start, created_at
    `)
    .all(targetType, targetId);
  return {
    targetType,
    targetId,
    state: mapReadingStateRow(stateRow),
    annotations: annotationRows.map(mapReadingAnnotationRow),
  };
}

/**
 * 新增或更新某项内容的阅读进度、状态和个人笔记。
 *
 * @param {string} targetType 文档、文章或论文类型。
 * @param {string} targetId 阅读目标 ID。
 * @param {Record<string, unknown>} changes 需要保存的字段。
 * @returns {Record<string, unknown> | null} 最新阅读状态；目标不存在时为空。
 */
export function updateReadingState(targetType, targetId, changes) {
  if (!readingTargetExists(targetType, targetId)) return null;
  /** existingRow 是合并局部更新所需的旧状态。 */
  const existingRow = database
    .prepare(`
      SELECT reading_status, progress_percent, note_text, updated_at
      FROM reading_states
      WHERE target_type = ? AND target_id = ?
      LIMIT 1
    `)
    .get(targetType, targetId);
  /** existingState 是包含首次阅读默认值的旧状态对象。 */
  const existingState = mapReadingStateRow(existingRow);
  /** requestedStatus 是浏览器提交或沿用的阅读状态。 */
  const requestedStatus = String(changes.status ?? existingState.status);
  if (!readingStatuses.has(requestedStatus)) {
    throw new Error("阅读状态无效。");
  }
  /** requestedProgress 是限制在 0 到 100 之间的阅读百分比。 */
  const requestedProgress = Math.min(
    100,
    Math.max(0, Number(changes.progressPercent ?? existingState.progressPercent) || 0),
  );
  /** requestedNoteText 是限制长度后的个人阅读笔记。 */
  const requestedNoteText = String(changes.noteText ?? existingState.noteText).slice(
    0,
    100000,
  );
  /** updatedAt 是本次阅读状态保存时间。 */
  const updatedAt = new Date().toISOString();
  database
    .prepare(`
      INSERT INTO reading_states(
        target_type, target_id, reading_status, progress_percent, note_text, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_type, target_id) DO UPDATE SET
        reading_status = excluded.reading_status,
        progress_percent = excluded.progress_percent,
        note_text = excluded.note_text,
        updated_at = excluded.updated_at
    `)
    .run(
      targetType,
      targetId,
      requestedStatus,
      requestedProgress,
      requestedNoteText,
      updatedAt,
    );
  return mapReadingStateRow({
    reading_status: requestedStatus,
    progress_percent: requestedProgress,
    note_text: requestedNoteText,
    updated_at: updatedAt,
  });
}

/**
 * 为选中的原文片段创建本地高亮批注。
 *
 * @param {string} targetType 文档、文章或论文类型。
 * @param {string} targetId 阅读目标 ID。
 * @param {Record<string, unknown>} annotation 待保存的高亮信息。
 * @returns {Record<string, unknown> | null} 新批注；目标不存在时为空。
 */
export function createReadingAnnotation(targetType, targetId, annotation) {
  if (!readingTargetExists(targetType, targetId)) return null;
  /** quoteText 是用户选中的原文。 */
  const quoteText = String(annotation.quoteText ?? "").trim().slice(0, 8000);
  /** anchorStart 是原文纯文本中的起始字符位置。 */
  const anchorStart = Math.max(0, Math.trunc(Number(annotation.anchorStart) || 0));
  /** anchorEnd 是原文纯文本中的结束字符位置。 */
  const anchorEnd = Math.max(anchorStart, Math.trunc(Number(annotation.anchorEnd) || 0));
  /** color 是经过白名单确认的高亮颜色。 */
  const color = String(annotation.color ?? "yellow");
  if (!quoteText || anchorEnd <= anchorStart) {
    throw new Error("请选择有效的原文内容。");
  }
  if (!annotationColors.has(color)) throw new Error("高亮颜色无效。");
  /** noteText 是与高亮绑定的可选批注。 */
  const noteText = String(annotation.noteText ?? "").slice(0, 20000);
  /** annotationId 是本地批注的唯一标识。 */
  const annotationId = `annotation_${crypto.randomUUID()}`;
  /** now 是批注创建和更新时间。 */
  const now = new Date().toISOString();
  database
    .prepare(`
      INSERT INTO reading_annotations(
        id, target_type, target_id, quote_text, anchor_start, anchor_end,
        color, note_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      annotationId,
      targetType,
      targetId,
      quoteText,
      anchorStart,
      anchorEnd,
      color,
      noteText,
      now,
      now,
    );
  /** savedRow 是插入后用于标准映射的完整批注行。 */
  const savedRow = database
    .prepare("SELECT * FROM reading_annotations WHERE id = ? LIMIT 1")
    .get(annotationId);
  return mapReadingAnnotationRow(savedRow);
}

/**
 * 修改高亮颜色或批注正文。
 *
 * @param {string} annotationId 批注 ID。
 * @param {Record<string, unknown>} changes 需要修改的字段。
 * @returns {Record<string, unknown> | null} 最新批注；不存在时为空。
 */
export function updateReadingAnnotation(annotationId, changes) {
  /** existingRow 是修改前的完整批注。 */
  const existingRow = database
    .prepare("SELECT * FROM reading_annotations WHERE id = ? LIMIT 1")
    .get(annotationId);
  if (!existingRow) return null;
  /** requestedColor 是新颜色或原颜色。 */
  const requestedColor = String(changes.color ?? existingRow.color);
  if (!annotationColors.has(requestedColor)) throw new Error("高亮颜色无效。");
  /** requestedNoteText 是限制长度后的新批注正文。 */
  const requestedNoteText = String(changes.noteText ?? existingRow.note_text).slice(
    0,
    20000,
  );
  /** updatedAt 是本次修改时间。 */
  const updatedAt = new Date().toISOString();
  database
    .prepare(`
      UPDATE reading_annotations
      SET color = ?, note_text = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(requestedColor, requestedNoteText, updatedAt, annotationId);
  /** updatedRow 是修改后的完整批注。 */
  const updatedRow = database
    .prepare("SELECT * FROM reading_annotations WHERE id = ? LIMIT 1")
    .get(annotationId);
  return mapReadingAnnotationRow(updatedRow);
}

/**
 * 删除一条本地高亮批注。
 *
 * @param {string} annotationId 批注 ID。
 * @returns {boolean} 是否删除了记录。
 */
export function deleteReadingAnnotation(annotationId) {
  /** result 是 SQLite 删除操作结果。 */
  const result = database
    .prepare("DELETE FROM reading_annotations WHERE id = ?")
    .run(annotationId);
  return result.changes > 0;
}

/** knowledgeTargetTypes 是标签、专题和统一搜索支持的内容类型。 */
const knowledgeTargetTypes = new Set(["document", "article", "paper"]);

/**
 * 验证知识内容类型。
 *
 * @param {string} targetType 待验证的内容类型。
 * @returns {string} 验证后的内容类型。
 */
function normalizeKnowledgeTargetType(targetType) {
  /** normalizedType 是移除空白后的类型值。 */
  const normalizedType = String(targetType ?? "").trim();
  if (!knowledgeTargetTypes.has(normalizedType)) throw new Error("不支持的内容类型。");
  return normalizedType;
}

/**
 * 永久删除一项知识内容及其全部阅读、标签和专题关联。
 *
 * 删除操作由调用方在执行前完成用户确认和备份；返回的 storedName 可用于
 * 安全删除上传文档附件，论文候选则恢复为待选择状态。
 *
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容稳定 ID。
 * @returns {Record<string, unknown> | null} 已删除内容摘要或空值。
 */
export function deleteKnowledgeTarget(targetType, targetId) {
  /** normalizedType 是经过白名单确认的内容类型。 */
  const normalizedType = normalizeKnowledgeTargetType(targetType);
  /** normalizedId 是清理首尾空白后的目标 ID。 */
  const normalizedId = String(targetId ?? "").trim();
  if (!normalizedId) return null;
  /** targetRow 是删除前保留的主记录关键信息。 */
  const targetRow =
    normalizedType === "document"
      ? database
          .prepare(
            "SELECT id, title, stored_name AS storedName FROM documents WHERE id = ?",
          )
          .get(normalizedId)
      : normalizedType === "article"
        ? database
            .prepare("SELECT id, title FROM articles WHERE id = ?")
            .get(normalizedId)
        : database
            .prepare(
              `SELECT id, external_id AS externalId,
                COALESCE(NULLIF(title_zh, ''), title) AS title
               FROM papers WHERE id = ?`,
            )
            .get(normalizedId);
  if (!targetRow) return null;

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare("DELETE FROM reading_annotations WHERE target_type = ? AND target_id = ?")
      .run(normalizedType, normalizedId);
    database
      .prepare("DELETE FROM reading_states WHERE target_type = ? AND target_id = ?")
      .run(normalizedType, normalizedId);
    database
      .prepare("DELETE FROM content_tags WHERE target_type = ? AND target_id = ?")
      .run(normalizedType, normalizedId);
    database
      .prepare("DELETE FROM topic_items WHERE target_type = ? AND target_id = ?")
      .run(normalizedType, normalizedId);
    database
      .prepare("DELETE FROM content_folders WHERE target_type = ? AND target_id = ?")
      .run(normalizedType, normalizedId);
    database
      .prepare("DELETE FROM knowledge_cards WHERE target_type = ? AND target_id = ?")
      .run(normalizedType, normalizedId);
    database
      .prepare("DELETE FROM ai_conversations WHERE primary_target_type = ? AND primary_target_id = ?")
      .run(normalizedType, normalizedId);
    if (normalizedType !== "paper") {
      database
        .prepare("DELETE FROM favorites WHERE target_type = ? AND target_id = ?")
        .run(normalizedType, normalizedId);
    }
    if (normalizedType === "document") {
      database.prepare("DELETE FROM document_search WHERE document_id = ?").run(normalizedId);
      database.prepare("DELETE FROM documents WHERE id = ?").run(normalizedId);
    } else if (normalizedType === "article") {
      database.prepare("DELETE FROM article_search WHERE article_id = ?").run(normalizedId);
      database.prepare("DELETE FROM articles WHERE id = ?").run(normalizedId);
    } else {
      database
        .prepare(
          `UPDATE paper_week_status
           SET status = 'pending', selected_paper_id = NULL, snoozed_until = NULL,
               updated_at = ?
           WHERE selected_paper_id = ?`,
        )
        .run(new Date().toISOString(), normalizedId);
      database
        .prepare("UPDATE paper_candidates SET status = 'pending' WHERE external_id = ?")
        .run(targetRow.externalId);
      database.prepare("DELETE FROM papers WHERE id = ?").run(normalizedId);
    }
    database.prepare(
      `DELETE FROM tags WHERE NOT EXISTS (
        SELECT 1 FROM content_tags WHERE content_tags.tag_name = tags.name
      )`,
    ).run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { targetType: normalizedType, targetId: normalizedId, ...targetRow };
}

/**
 * 清空论文库和旧推荐状态；调用方必须先创建数据库备份并删除精确 PDF 缓存。
 *
 * @returns {{ deletedCount: number, paperIds: string[] }} 清理结果。
 */
export function clearPaperLibrary() {
  /** papers 是删除前用于清理关联数据和磁盘缓存的精确论文集合。 */
  const papers = listPapers();
  for (const paper of papers) deleteKnowledgeTarget("paper", paper.id);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM paper_candidates").run();
    database.prepare("DELETE FROM paper_week_status").run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { deletedCount: papers.length, paperIds: papers.map((paper) => paper.id) };
}

/** knowledgeCardTypes 是允许用户创建的结构化卡片类型。 */
const knowledgeCardTypes = new Set([
  "concept",
  "principle",
  "compare",
  "engineering",
  "qa",
  "formula",
  "fault",
]);

/**
 * 把数据库卡片行转换为前端字段，并补充来源标题。
 *
 * @param {Record<string, unknown>} row SQLite 卡片行。
 * @returns {Record<string, unknown>} 前端卡片对象。
 */
function mapKnowledgeCardRow(row) {
  /** source 是卡片关联的原始知识内容摘要。 */
  const source = getKnowledgeTargetSummary(row.target_type, row.target_id);
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    cardType: row.card_type,
    question: row.question,
    answer: row.answer,
    sourceQuote: row.source_quote,
    anchorStart: Number(row.anchor_start),
    anchorEnd: Number(row.anchor_end),
    dueAt: row.due_at,
    intervalDays: Number(row.interval_days),
    easeFactor: Number(row.ease_factor),
    reviewCount: Number(row.review_count),
    lastReviewedAt: row.last_reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceTitle: source?.title || "来源已删除",
    sourceCategory: source?.category || "",
  };
}

/**
 * 创建一张带原文来源和字符锚点的知识卡片。
 *
 * @param {Record<string, unknown>} card 用户填写的卡片内容和来源。
 * @returns {Record<string, unknown>} 新卡片。
 */
export function createKnowledgeCard(card) {
  /** targetType 是经过白名单确认的来源类型。 */
  const targetType = normalizeKnowledgeTargetType(card.targetType);
  /** targetId 是来源内容的稳定 ID。 */
  const targetId = String(card.targetId ?? "").trim();
  if (!getKnowledgeTargetSummary(targetType, targetId)) {
    throw new Error("找不到卡片对应的来源内容。");
  }
  /** cardType 是经过卡片类型白名单确认的类型。 */
  const cardType = knowledgeCardTypes.has(String(card.cardType))
    ? String(card.cardType)
    : "concept";
  /** question 是卡片正面问题。 */
  const question = String(card.question ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  /** answer 是卡片背面答案。 */
  const answer = String(card.answer ?? "").trim().slice(0, 8000);
  /** sourceQuote 是保持原样的可追溯原文。 */
  const sourceQuote = String(card.sourceQuote ?? "").trim().slice(0, 8000);
  if (!question || !answer || !sourceQuote) {
    throw new TypeError("卡片问题、答案和来源原文都不能为空。");
  }
  /** anchorStart 是原文选区起点。 */
  const anchorStart = Math.max(0, Number(card.anchorStart) || 0);
  /** anchorEnd 是不小于起点的原文选区终点。 */
  const anchorEnd = Math.max(anchorStart, Number(card.anchorEnd) || anchorStart);
  /** now 是卡片创建、更新和首次到期时间。 */
  const now = new Date().toISOString();
  /** cardId 是本地唯一卡片 ID。 */
  const cardId = `card_${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO knowledge_cards(
      id, target_type, target_id, card_type, question, answer, source_quote,
      anchor_start, anchor_end, due_at, interval_days, ease_factor,
      review_count, last_reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 2.5, 0, NULL, ?, ?)
  `).run(
    cardId,
    targetType,
    targetId,
    cardType,
    question,
    answer,
    sourceQuote,
    anchorStart,
    anchorEnd,
    now,
    now,
    now,
  );
  return listKnowledgeCards().find((item) => item.id === cardId);
}

/**
 * 列出全部卡片或截至当前时间需要复习的卡片。
 *
 * @param {{ dueOnly?: boolean, limit?: number }} filters 卡片筛选条件。
 * @returns {Record<string, unknown>[]} 卡片列表。
 */
export function listKnowledgeCards(filters = {}) {
  /** dueOnly 表示是否只读取已经到期的卡片。 */
  const dueOnly = Boolean(filters.dueOnly);
  /** limit 是限制在合理范围内的返回数量。 */
  const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), 2000);
  /** rows 是按到期时间和更新时间排列的卡片行。 */
  const rows = database.prepare(`
    SELECT * FROM knowledge_cards
    WHERE (? = 0 OR due_at <= ?)
    ORDER BY due_at ASC, updated_at DESC
    LIMIT ?
  `).all(dueOnly ? 1 : 0, new Date().toISOString(), limit);
  return rows.map(mapKnowledgeCardRow);
}

/**
 * 记录一次复习结果并计算下一次到期时间。
 *
 * @param {string} cardId 卡片 ID。
 * @param {string} rating 复习结果 again、hard、good 或 easy。
 * @returns {Record<string, unknown> | null} 调度后的卡片或空值。
 */
export function reviewKnowledgeCard(cardId, rating) {
  /** row 是待复习卡片当前调度参数。 */
  const row = database.prepare("SELECT * FROM knowledge_cards WHERE id = ?").get(cardId);
  if (!row) return null;
  /** normalizedRating 是限制到四种固定结果的复习评价。 */
  const normalizedRating = ["again", "hard", "good", "easy"].includes(rating)
    ? rating
    : "good";
  /** previousInterval 是本次复习前的间隔天数。 */
  const previousInterval = Number(row.interval_days) || 0;
  /** intervalDays 是根据复习评价得到的下一次间隔天数。 */
  const intervalDays =
    normalizedRating === "again"
      ? 1
      : normalizedRating === "hard"
        ? Math.max(1, Math.round(previousInterval * 1.2))
        : normalizedRating === "easy"
          ? Math.max(3, Math.round((previousInterval || 1) * 3))
          : Math.max(1, Math.round((previousInterval || 1) * 2.2));
  /** easeDelta 是复习结果对难度系数的调整量。 */
  const easeDelta = normalizedRating === "again" ? -0.2 : normalizedRating === "hard" ? -0.05 : normalizedRating === "easy" ? 0.15 : 0;
  /** easeFactor 是限制在合理范围内的新难度系数。 */
  const easeFactor = Math.min(3.2, Math.max(1.3, Number(row.ease_factor) + easeDelta));
  /** reviewedAt 是本次复习完成时间。 */
  const reviewedAt = new Date();
  /** dueAt 是按日间隔计算的下一次复习时间。 */
  const dueAt = new Date(reviewedAt.getTime() + intervalDays * 86_400_000).toISOString();
  database.prepare(`
    UPDATE knowledge_cards SET interval_days = ?, ease_factor = ?, due_at = ?,
      review_count = review_count + 1, last_reviewed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(intervalDays, easeFactor, dueAt, reviewedAt.toISOString(), reviewedAt.toISOString(), cardId);
  return listKnowledgeCards().find((item) => item.id === cardId) || null;
}

/**
 * 永久删除一张知识卡片。
 *
 * @param {string} cardId 卡片 ID。
 * @returns {boolean} 是否实际删除。
 */
export function deleteKnowledgeCard(cardId) {
  return database.prepare("DELETE FROM knowledge_cards WHERE id = ?").run(cardId).changes > 0;
}

/**
 * 清理用户输入的标签名称。
 *
 * @param {unknown} value 原始标签值。
 * @returns {string} 可保存的标签名称。
 */
function normalizeTagName(value) {
  /** tagName 是折叠连续空白并限制长度后的标签。 */
  const tagName = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!tagName) throw new Error("标签名称不能为空。");
  return tagName;
}

/**
 * 读取某项内容的通用摘要信息。
 *
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @returns {Record<string, unknown> | null} 通用摘要或空值。
 */
function getKnowledgeTargetSummary(targetType, targetId) {
  /** normalizedType 是经过白名单确认的内容类型。 */
  const normalizedType = normalizeKnowledgeTargetType(targetType);
  /** normalizedId 是移除空白后的内容 ID。 */
  const normalizedId = String(targetId ?? "").trim();
  if (!normalizedId) return null;
  if (normalizedType === "document") {
    /** row 是文档摘要字段。 */
    const row = database.prepare(`
      SELECT id, title, category, summary, updated_at
      FROM documents WHERE id = ? LIMIT 1
    `).get(normalizedId);
    return row ? { targetType: normalizedType, targetId: row.id, title: row.title,
      category: row.category, summary: row.summary, updatedAt: row.updated_at } : null;
  }
  if (normalizedType === "article") {
    /** row 是网页文章摘要字段。 */
    const row = database.prepare(`
      SELECT id, title, category, summary, updated_at
      FROM articles WHERE id = ? LIMIT 1
    `).get(normalizedId);
    return row ? { targetType: normalizedType, targetId: row.id, title: row.title,
      category: row.category, summary: row.summary, updatedAt: row.updated_at } : null;
  }
  /** row 是论文的中英文摘要字段。 */
  const row = database.prepare(`
    SELECT id, COALESCE(NULLIF(title_zh, ''), title) AS display_title,
      category, COALESCE(NULLIF(abstract_zh, ''), abstract, curator_note, '') AS display_summary,
      updated_at FROM papers WHERE id = ? LIMIT 1
  `).get(normalizedId);
  return row ? { targetType: normalizedType, targetId: row.id, title: row.display_title,
    category: row.category, summary: row.display_summary, updatedAt: row.updated_at } : null;
}

/**
 * 获取某项内容的全部标签。
 *
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @returns {string[]} 按名称排列的标签。
 */
export function listContentTags(targetType, targetId) {
  /** normalizedType 是经过白名单确认的内容类型。 */
  const normalizedType = normalizeKnowledgeTargetType(targetType);
  return database.prepare(`
    SELECT tag_name FROM content_tags
    WHERE target_type = ? AND target_id = ?
    ORDER BY tag_name COLLATE NOCASE
  `).all(normalizedType, String(targetId ?? "")).map((row) => row.tag_name);
}

/**
 * 获取知识库标签及其使用次数。
 *
 * @returns {Record<string, unknown>[]} 标签统计列表。
 */
export function listTags() {
  return database.prepare(`
    SELECT t.name, COUNT(ct.target_id) AS item_count
    FROM tags AS t LEFT JOIN content_tags AS ct ON ct.tag_name = t.name
    GROUP BY t.name ORDER BY item_count DESC, t.name COLLATE NOCASE
  `).all().map((row) => ({ name: row.name, itemCount: Number(row.item_count) }));
}

/**
 * 为内容添加标签。
 *
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @param {unknown} rawTagName 原始标签名称。
 * @returns {string[]} 最新标签列表。
 */
export function addContentTag(targetType, targetId, rawTagName) {
  /** normalizedType 是经过白名单确认的内容类型。 */
  const normalizedType = normalizeKnowledgeTargetType(targetType);
  /** normalizedId 是目标内容 ID。 */
  const normalizedId = String(targetId ?? "").trim();
  if (!getKnowledgeTargetSummary(normalizedType, normalizedId)) throw new Error("找不到对应内容。");
  /** tagName 是规范化后的标签名称。 */
  const tagName = normalizeTagName(rawTagName);
  /** createdAt 是标签关联创建时间。 */
  const createdAt = new Date().toISOString();
  database.prepare("INSERT OR IGNORE INTO tags(name, created_at) VALUES (?, ?)").run(tagName, createdAt);
  database.prepare(`
    INSERT OR IGNORE INTO content_tags(target_type, target_id, tag_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(normalizedType, normalizedId, tagName, createdAt);
  return listContentTags(normalizedType, normalizedId);
}

/**
 * 移除内容与标签之间的关联。
 *
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @param {unknown} rawTagName 标签名称。
 * @returns {string[]} 最新标签列表。
 */
export function removeContentTag(targetType, targetId, rawTagName) {
  /** normalizedType 是经过白名单确认的内容类型。 */
  const normalizedType = normalizeKnowledgeTargetType(targetType);
  /** tagName 是规范化后的标签名称。 */
  const tagName = normalizeTagName(rawTagName);
  database.prepare(`
    DELETE FROM content_tags WHERE target_type = ? AND target_id = ? AND tag_name = ?
  `).run(normalizedType, String(targetId ?? ""), tagName);
  database.prepare(`DELETE FROM tags WHERE name = ? AND NOT EXISTS(
    SELECT 1 FROM content_tags WHERE tag_name = ?
  )`).run(tagName, tagName);
  return listContentTags(normalizedType, targetId);
}

/**
 * 按名称依次创建或复用一条树形文件夹路径。
 *
 * @param {string[]} pathNames 从一级目录到目标目录的名称数组。
 * @param {number[]} sortOrders 各层目录可选的显示顺序；未提供时沿用路径层级。
 * @returns {Record<string, unknown>[]} 路径中的全部文件夹。
 */
export function ensureFolderPath(pathNames, sortOrders = []) {
  if (!Array.isArray(pathNames) || pathNames.length === 0) {
    throw new Error("文件夹路径不能为空。");
  }
  /** parentId 是当前层级即将使用的父文件夹 ID。 */
  let parentId = null;
  /** folders 是按路径顺序返回的文件夹列表。 */
  const folders = [];
  for (const [pathIndex, pathName] of pathNames.entries()) {
    /** folder 是当前层级已存在或刚创建的文件夹。 */
    const folder = ensureFolder(
      parentId,
      pathName,
      Number.isFinite(Number(sortOrders[pathIndex]))
        ? Number(sortOrders[pathIndex])
        : pathIndex,
    );
    folders.push({
      id: folder.id,
      parentId: folder.parent_id,
      name: folder.name,
      sortOrder: Number(folder.sort_order) || 0,
    });
    parentId = folder.id;
  }
  return folders;
}

/**
 * 返回全部文件夹、层级路径和直接/累计内容数量。
 *
 * @returns {Record<string, unknown>[]} 文件夹树的扁平表示。
 */
export function listFolders() {
  /** rows 是数据库中的全部文件夹。 */
  const rows = database.prepare(`
    SELECT * FROM folders ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `).all();
  /** directCounts 是每个文件夹直接包含的内容数量。 */
  const directCounts = new Map(
    database.prepare(`
      SELECT folder_id, COUNT(*) AS item_count
      FROM content_folders GROUP BY folder_id
    `).all().map((row) => [row.folder_id, Number(row.item_count) || 0]),
  );
  /** childrenByParent 保存每个文件夹的直接子目录。 */
  const childrenByParent = new Map();
  for (const row of rows) {
    /** parentKey 统一使用空字符串表示知识库根目录。 */
    const parentKey = row.parent_id || "";
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey).push(row.id);
  }
  /** rowById 用于递归读取祖先和子目录。 */
  const rowById = new Map(rows.map((row) => [row.id, row]));
  /** totalCountCache 避免重复统计同一棵子树。 */
  const totalCountCache = new Map();
  /**
   * 统计一个文件夹及全部后代中的内容数量。
   *
   * @param {string} folderId 文件夹 ID。
   * @returns {number} 子树内容数量。
   */
  function totalCount(folderId) {
    if (totalCountCache.has(folderId)) return totalCountCache.get(folderId);
    /** count 从当前文件夹直接内容数量开始累计。 */
    let count = directCounts.get(folderId) || 0;
    for (const childId of childrenByParent.get(folderId) || []) count += totalCount(childId);
    totalCountCache.set(folderId, count);
    return count;
  }
  /**
   * 构造从根目录到目标文件夹的面包屑路径。
   *
   * @param {Record<string, unknown>} row 目标文件夹行。
   * @returns {Record<string, string>[]} 面包屑数组。
   */
  function buildPath(row) {
    /** pathItems 按目标到根的顺序临时收集祖先。 */
    const pathItems = [];
    /** current 是当前向上查找的文件夹。 */
    let current = row;
    while (current) {
      pathItems.unshift({ id: current.id, name: current.name });
      current = current.parent_id ? rowById.get(current.parent_id) : null;
    }
    return pathItems;
  }
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: Number(row.sort_order) || 0,
    directItemCount: directCounts.get(row.id) || 0,
    itemCount: totalCount(row.id),
    childCount: (childrenByParent.get(row.id) || []).length,
    path: buildPath(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * 创建用户指定的新文件夹。
 *
 * @param {{ parentId?: string | null, name: string }} input 文件夹参数。
 * @returns {Record<string, unknown>} 创建后的文件夹。
 */
export function createFolder(input) {
  /** parentId 是可选父文件夹；空字符串按根目录处理。 */
  const parentId = String(input.parentId || "").trim() || null;
  if (parentId && !database.prepare("SELECT id FROM folders WHERE id = ?").get(parentId)) {
    throw new Error("找不到父文件夹。");
  }
  /** beforeIds 用于判断 ensureFolder 是否复用了同名目录。 */
  const beforeIds = new Set(listFolders().map((folder) => folder.id));
  /** folderRow 是创建或找到的同名文件夹。 */
  const folderRow = ensureFolder(parentId, input.name, 0);
  if (beforeIds.has(folderRow.id)) throw new Error("当前目录下已存在同名文件夹。");
  return listFolders().find((folder) => folder.id === folderRow.id);
}

/**
 * 修改文件夹名称。
 *
 * @param {string} folderId 文件夹 ID。
 * @param {string} name 新名称。
 * @returns {Record<string, unknown>} 修改后的文件夹。
 */
export function renameFolder(folderId, name) {
  /** folder 是准备重命名的现有文件夹。 */
  const folder = database.prepare("SELECT * FROM folders WHERE id = ?").get(String(folderId || ""));
  if (!folder) throw new Error("找不到文件夹。");
  /** normalizedName 是压缩空白并限制长度后的新名称。 */
  const normalizedName = String(name || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!normalizedName) throw new Error("文件夹名称不能为空。");
  database.prepare("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?")
    .run(normalizedName, new Date().toISOString(), folder.id);
  return listFolders().find((item) => item.id === folder.id);
}

/**
 * 将一项内容移动到指定文件夹；每项内容只有一个主要位置。
 *
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @param {string} folderId 目标文件夹 ID。
 * @param {number} sortOrder 内容在目标文件夹中的稳定顺序。
 * @returns {Record<string, unknown>} 保存后的目录关系。
 */
export function assignContentToFolder(targetType, targetId, folderId, sortOrder = 0) {
  /** normalizedType 是经过知识内容白名单验证的类型。 */
  const normalizedType = normalizeKnowledgeTargetType(targetType);
  /** normalizedTargetId 是清理后的内容 ID。 */
  const normalizedTargetId = String(targetId || "").trim();
  /** normalizedFolderId 是清理后的目标文件夹 ID。 */
  const normalizedFolderId = String(folderId || "").trim();
  /** normalizedSortOrder 是用于教程章节等有序内容的非负整数位置。 */
  const normalizedSortOrder = Math.max(0, Math.round(Number(sortOrder) || 0));
  if (!getKnowledgeTargetSummary(normalizedType, normalizedTargetId)) throw new Error("找不到对应内容。");
  if (!database.prepare("SELECT id FROM folders WHERE id = ?").get(normalizedFolderId)) throw new Error("找不到目标文件夹。");
  /** now 是目录关系创建或更新时间。 */
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO content_folders(
      target_type, target_id, folder_id, sort_order, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_type, target_id) DO UPDATE SET
      folder_id = excluded.folder_id,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `).run(
    normalizedType,
    normalizedTargetId,
    normalizedFolderId,
    normalizedSortOrder,
    now,
    now,
  );
  return {
    targetType: normalizedType,
    targetId: normalizedTargetId,
    folderId: normalizedFolderId,
    sortOrder: normalizedSortOrder,
  };
}

/**
 * 删除一个完全空的文件夹，避免误删其中内容。
 *
 * @param {string} folderId 文件夹 ID。
 * @returns {boolean} 是否删除成功。
 */
export function deleteEmptyFolder(folderId) {
  /** normalizedFolderId 是清理后的文件夹 ID。 */
  const normalizedFolderId = String(folderId || "").trim();
  /** folder 是待删除文件夹。 */
  const folder = listFolders().find((item) => item.id === normalizedFolderId);
  if (!folder) throw new Error("找不到文件夹。");
  if (folder.childCount > 0 || folder.directItemCount > 0) {
    throw new Error("文件夹中仍有子文件夹或内容，请先移动后再删除。");
  }
  return database.prepare("DELETE FROM folders WHERE id = ?").run(normalizedFolderId).changes > 0;
}

/**
 * 获取全部专题及内容数量。
 *
 * @returns {Record<string, unknown>[]} 专题列表。
 */
export function listTopics() {
  return database.prepare(`
    SELECT t.*, COUNT(ti.target_id) AS item_count
    FROM topics AS t LEFT JOIN topic_items AS ti ON ti.topic_id = t.id
    GROUP BY t.id ORDER BY t.updated_at DESC
  `).all().map((row) => ({ id: row.id, name: row.name, description: row.description,
    itemCount: Number(row.item_count), createdAt: row.created_at, updatedAt: row.updated_at }));
}

/**
 * 创建一个学习专题。
 *
 * @param {Record<string, unknown>} topic 专题名称和说明。
 * @returns {Record<string, unknown>} 新专题。
 */
export function createTopic(topic) {
  /** topicName 是清理后的专题名称。 */
  const topicName = String(topic.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!topicName) throw new Error("专题名称不能为空。");
  /** description 是专题说明。 */
  const description = String(topic.description ?? "").trim().slice(0, 2000);
  /** topicId 是专题的本地唯一 ID。 */
  const topicId = `topic_${crypto.randomUUID()}`;
  /** now 是专题创建和更新时间。 */
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO topics(id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(topicId, topicName, description, now, now);
  return listTopics().find((item) => item.id === topicId);
}

/**
 * 向专题加入一项内容。
 *
 * @param {string} topicId 专题 ID。
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @returns {Record<string, unknown>[]} 专题最新内容。
 */
export function addTopicItem(topicId, targetType, targetId) {
  /** normalizedType 是经过白名单确认的内容类型。 */
  const normalizedType = normalizeKnowledgeTargetType(targetType);
  /** normalizedTopicId 是清理后的专题 ID。 */
  const normalizedTopicId = String(topicId ?? "").trim();
  if (!database.prepare("SELECT id FROM topics WHERE id = ?").get(normalizedTopicId)) throw new Error("找不到专题。");
  if (!getKnowledgeTargetSummary(normalizedType, targetId)) throw new Error("找不到对应内容。");
  /** now 是专题内容添加和更新时间。 */
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO topic_items(topic_id, target_type, target_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(normalizedTopicId, normalizedType, String(targetId), now);
  database.prepare("UPDATE topics SET updated_at = ? WHERE id = ?").run(now, normalizedTopicId);
  return listTopicItems(normalizedTopicId);
}

/**
 * 从专题中移除一项内容。
 *
 * @param {string} topicId 专题 ID。
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @returns {Record<string, unknown>[]} 专题最新内容。
 */
export function removeTopicItem(topicId, targetType, targetId) {
  /** normalizedType 是经过白名单确认的内容类型。 */
  const normalizedType = normalizeKnowledgeTargetType(targetType);
  database.prepare(`
    DELETE FROM topic_items WHERE topic_id = ? AND target_type = ? AND target_id = ?
  `).run(String(topicId ?? ""), normalizedType, String(targetId ?? ""));
  database.prepare("UPDATE topics SET updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), String(topicId ?? ""));
  return listTopicItems(topicId);
}

/**
 * 读取专题中的全部内容摘要。
 *
 * @param {string} topicId 专题 ID。
 * @returns {Record<string, unknown>[]} 专题内容列表。
 */
export function listTopicItems(topicId) {
  /** itemRows 是专题内容关联记录。 */
  const itemRows = database.prepare(`
    SELECT target_type, target_id, created_at FROM topic_items
    WHERE topic_id = ? ORDER BY created_at DESC
  `).all(String(topicId ?? ""));
  return itemRows.map((row) => {
    /** summary 是仍然存在的内容摘要。 */
    const summary = getKnowledgeTargetSummary(row.target_type, row.target_id);
    return summary ? { ...summary, tags: listContentTags(row.target_type, row.target_id), addedAt: row.created_at } : null;
  }).filter(Boolean);
}

/**
 * 读取一项内容所属的标签和专题。
 *
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @returns {Record<string, unknown> | null} 内容组织信息。
 */
export function getContentOrganization(targetType, targetId) {
  /** summary 是用于确认目标存在的通用摘要。 */
  const summary = getKnowledgeTargetSummary(targetType, targetId);
  if (!summary) return null;
  /** topicRows 是当前内容所属的专题。 */
  const topicRows = database.prepare(`
    SELECT t.id, t.name FROM topic_items AS ti
    JOIN topics AS t ON t.id = ti.topic_id
    WHERE ti.target_type = ? AND ti.target_id = ? ORDER BY t.name COLLATE NOCASE
  `).all(summary.targetType, summary.targetId);
  return { tags: listContentTags(summary.targetType, summary.targetId), topics: topicRows };
}

/**
 * 清理 HTML 并生成搜索结果片段。
 *
 * @param {unknown} rawText 原始正文。
 * @param {string} query 搜索词。
 * @returns {string} 命中附近的简短文本。
 */
function createSearchExcerpt(rawText, query) {
  /** plainText 是适合展示的连续纯文本。 */
  const plainText = String(rawText ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  /** matchIndex 是忽略大小写后的首次命中位置。 */
  const matchIndex = plainText.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  /** excerptStart 是保留上下文后的片段起点。 */
  const excerptStart = Math.max(0, matchIndex < 0 ? 0 : matchIndex - 55);
  /** excerpt 是最多 220 字的结果片段。 */
  const excerpt = plainText.slice(excerptStart, excerptStart + 220);
  return `${excerptStart > 0 ? "…" : ""}${excerpt}${excerptStart + 220 < plainText.length ? "…" : ""}`;
}

/**
 * 跨文档、文章、论文、笔记和批注执行统一搜索。
 *
 * @param {Record<string, unknown>} filters 搜索词与可选过滤条件。
 * @returns {Record<string, unknown>[]} 去重后的统一结果。
 */
export function searchKnowledgeBase(filters = {}) {
  /** query 是清理并限制长度后的搜索词。 */
  const query = String(filters.query ?? "").trim().slice(0, 200);
  if (!query) return [];
  /** targetType 是可选内容类型过滤值。 */
  const targetType = String(filters.targetType ?? "").trim();
  if (targetType) normalizeKnowledgeTargetType(targetType);
  /** category 是可选分类过滤值。 */
  const category = String(filters.category ?? "").trim();
  /** tagName 是可选标签过滤值。 */
  const tagName = String(filters.tagName ?? "").trim();
  /** likeQuery 是 SQLite LIKE 使用的模式。 */
  const likeQuery = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  /** candidateRows 收集各类型正文及个人笔记的命中项。 */
  const candidateRows = [];
  if (!targetType || targetType === "document") candidateRows.push(...database.prepare(`
    SELECT 'document' AS target_type, id AS target_id, title, category, summary,
      extracted_text AS search_text, updated_at, '文档正文' AS match_source
    FROM documents WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR extracted_text LIKE ? ESCAPE '\\'
  `).all(likeQuery, likeQuery, likeQuery));
  if (!targetType || targetType === "article") candidateRows.push(...database.prepare(`
    SELECT 'article' AS target_type, id AS target_id, title, category, summary,
      content_text AS search_text, updated_at, '网页正文' AS match_source
    FROM articles WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content_text LIKE ? ESCAPE '\\'
  `).all(likeQuery, likeQuery, likeQuery));
  if (!targetType || targetType === "paper") candidateRows.push(...database.prepare(`
    SELECT 'paper' AS target_type, id AS target_id,
      COALESCE(NULLIF(title_zh, ''), title) AS title, category,
      COALESCE(NULLIF(abstract_zh, ''), abstract, '') AS summary,
      COALESCE(full_translation_html, source_text, abstract_zh, abstract, '') AS search_text,
      updated_at, '论文全文' AS match_source
    FROM papers WHERE title LIKE ? ESCAPE '\\' OR title_zh LIKE ? ESCAPE '\\'
      OR abstract LIKE ? ESCAPE '\\' OR abstract_zh LIKE ? ESCAPE '\\'
      OR source_text LIKE ? ESCAPE '\\' OR full_translation_html LIKE ? ESCAPE '\\'
  `).all(likeQuery, likeQuery, likeQuery, likeQuery, likeQuery, likeQuery));
  candidateRows.push(...database.prepare(`
    SELECT rs.target_type, rs.target_id, '' AS title, '' AS category, '' AS summary,
      rs.note_text AS search_text, rs.updated_at, '阅读笔记' AS match_source
    FROM reading_states AS rs WHERE rs.note_text LIKE ? ESCAPE '\\'
      AND (? = '' OR rs.target_type = ?)
    UNION ALL
    SELECT ra.target_type, ra.target_id, '' AS title, '' AS category, '' AS summary,
      ra.quote_text || ' ' || ra.note_text AS search_text, ra.updated_at, '高亮批注' AS match_source
    FROM reading_annotations AS ra WHERE (ra.quote_text LIKE ? ESCAPE '\\' OR ra.note_text LIKE ? ESCAPE '\\')
      AND (? = '' OR ra.target_type = ?)
  `).all(likeQuery, targetType, targetType, likeQuery, likeQuery, targetType, targetType));
  /** resultMap 按内容 ID 合并正文与笔记的重复命中。 */
  const resultMap = new Map();
  for (const row of candidateRows) {
    /** summary 是该命中项对应的最新内容元数据。 */
    const summary = getKnowledgeTargetSummary(row.target_type, row.target_id);
    if (!summary || (category && summary.category !== category)) continue;
    /** tags 是命中内容的全部标签。 */
    const tags = listContentTags(row.target_type, row.target_id);
    if (tagName && !tags.includes(tagName)) continue;
    /** resultKey 是统一结果的去重键。 */
    const resultKey = `${row.target_type}:${row.target_id}`;
    if (resultMap.has(resultKey)) continue;
    resultMap.set(resultKey, { ...summary, tags, matchSource: row.match_source,
      excerpt: createSearchExcerpt(row.search_text || summary.summary, query) });
  }
  return [...resultMap.values()].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, 200);
}

/**
 * 对 SQL 字符串字面量中的单引号进行转义。
 *
 * @param {string} value 原始路径。
 * @returns {string} 可安全用于 VACUUM INTO 的路径文本。
 */
function escapeSqlLiteral(value) {
  return value.replaceAll("'", "''");
}

/**
 * 安全解析数据库中保存的 JSON 数组。
 *
 * @param {string} value 数据库 JSON 字符串。
 * @returns {Array<unknown>} 解析后的数组，异常时返回空数组。
 */
function parseStoredArray(value) {
  try {
    /** parsed 是 JSON.parse 得到的任意值。 */
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

/**
 * 把 AI 消息数据库行转换为浏览器字段。
 *
 * @param {Record<string, unknown>} row AI 消息行。
 * @returns {Record<string, unknown>} AI 消息对象。
 */
function mapAiMessageRow(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    selectedQuote: row.selected_quote || "",
    citations: parseStoredArray(row.citations_json),
    insufficientEvidence: Boolean(row.insufficient_evidence),
    createdAt: row.created_at,
  };
}

/**
 * 把 AI 会话数据库行转换为浏览器字段。
 *
 * @param {Record<string, unknown>} row AI 会话行。
 * @returns {Record<string, unknown>} AI 会话摘要。
 */
function mapAiConversationRow(row) {
  return {
    id: row.id,
    mode: row.mode,
    primaryTargetType: row.primary_target_type,
    primaryTargetId: row.primary_target_id,
    title: row.title,
    sources: parseStoredArray(row.source_refs_json),
    lastQuestion: row.last_question || "",
    lastAnswer: row.last_answer || "",
    messageCount: Number(row.message_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 保存一次用户问题和模型回答；首次提问时同时创建会话。
 *
 * @param {Record<string, unknown>} exchange 已完成且引用已核验的问答。
 * @returns {Record<string, unknown>} 保存后的完整会话。
 */
export function saveAiExchange(exchange) {
  /** now 是本次问答的统一时间戳。 */
  const now = new Date().toISOString();
  /** requestedConversationId 是连续追问时传入的现有会话 ID。 */
  const requestedConversationId = String(exchange.conversationId || "").trim();
  /** existingConversation 是连续追问对应的已有会话。 */
  const existingConversation = requestedConversationId
    ? database.prepare("SELECT * FROM ai_conversations WHERE id = ? LIMIT 1").get(requestedConversationId)
    : null;
  if (requestedConversationId && !existingConversation) throw new Error("找不到要继续的问答记录。");
  /** conversationId 是新建或沿用的稳定会话 ID。 */
  const conversationId = existingConversation?.id || `ai_conversation_${crypto.randomUUID()}`;
  /** sources 是去除多余字段后的本地来源引用。 */
  const sources = Array.isArray(exchange.sources) ? exchange.sources.slice(0, 6) : [];
  /** primarySource 是阅读内问答使用的第一份资料。 */
  const primarySource = sources[0] || null;
  /** question 是用户原始问题。 */
  const question = String(exchange.question || "").trim().slice(0, 4000);
  /** answer 是模型返回的已完成回答。 */
  const answer = String(exchange.answer || "").trim();
  /** title 是历史中心显示的会话标题。 */
  const title = existingConversation?.title || question.slice(0, 80) || "未命名问答";
  database.exec("BEGIN IMMEDIATE");
  try {
    if (!existingConversation) {
      database.prepare(`
        INSERT INTO ai_conversations (
          id, mode, primary_target_type, primary_target_id, title,
          source_refs_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        conversationId,
        exchange.mode === "compare" ? "compare" : "ask",
        primarySource?.targetType || null,
        primarySource?.targetId || null,
        title,
        JSON.stringify(sources),
        now,
        now,
      );
    } else {
      database.prepare("UPDATE ai_conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
    }
    database.prepare(`
      INSERT INTO ai_messages (
        id, conversation_id, role, content, selected_quote,
        citations_json, insufficient_evidence, created_at
      ) VALUES (?, ?, 'user', ?, ?, '[]', 0, ?)
    `).run(
      `ai_message_${crypto.randomUUID()}`,
      conversationId,
      question,
      String(exchange.selectedQuote || "").trim().slice(0, 8000),
      now,
    );
    database.prepare(`
      INSERT INTO ai_messages (
        id, conversation_id, role, content, selected_quote,
        citations_json, insufficient_evidence, created_at
      ) VALUES (?, ?, 'assistant', ?, '', ?, ?, ?)
    `).run(
      `ai_message_${crypto.randomUUID()}`,
      conversationId,
      answer,
      JSON.stringify(Array.isArray(exchange.citations) ? exchange.citations : []),
      exchange.insufficientEvidence ? 1 : 0,
      now,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getAiConversation(conversationId);
}

/**
 * 读取一条完整 AI 会话及全部消息。
 *
 * @param {string} conversationId 会话 ID。
 * @returns {Record<string, unknown> | null} 完整会话或空值。
 */
export function getAiConversation(conversationId) {
  /** row 是会话主记录及最新问题、回答统计。 */
  const row = database.prepare(`
    SELECT c.*,
      (SELECT content FROM ai_messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_question,
      (SELECT content FROM ai_messages WHERE conversation_id = c.id AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_answer,
      (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) AS message_count
    FROM ai_conversations AS c WHERE c.id = ? LIMIT 1
  `).get(String(conversationId || ""));
  if (!row) return null;
  /** messages 是按发生时间排序的完整对话。 */
  const messages = database.prepare(
    "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC",
  ).all(row.id).map(mapAiMessageRow);
  return { ...mapAiConversationRow(row), messages };
}

/**
 * 查询本地 AI 问答历史。
 *
 * @param {Record<string, unknown>} filters 搜索词与可选内容来源。
 * @returns {Array<Record<string, unknown>>} 最近更新优先的会话摘要。
 */
export function listAiConversations(filters = {}) {
  /** query 是标题、问题和回答的模糊搜索词。 */
  const query = String(filters.query || "").trim().slice(0, 200);
  /** likeQuery 是带通配符的 SQLite LIKE 参数。 */
  const likeQuery = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  /** targetType 是可选的来源类型过滤。 */
  const targetType = String(filters.targetType || "").trim();
  /** targetId 是可选的来源 ID 过滤。 */
  const targetId = String(filters.targetId || "").trim();
  /** limit 是历史中心单次返回上限。 */
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
  /** rows 是符合标题、消息正文与来源条件的会话。 */
  const rows = database.prepare(`
    SELECT c.*,
      (SELECT content FROM ai_messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_question,
      (SELECT content FROM ai_messages WHERE conversation_id = c.id AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_answer,
      (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) AS message_count
    FROM ai_conversations AS c
    WHERE (? = '' OR c.title LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM ai_messages AS m
      WHERE m.conversation_id = c.id AND m.content LIKE ? ESCAPE '\\'
    ))
      AND (? = '' OR c.primary_target_type = ?)
      AND (? = '' OR c.primary_target_id = ?)
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(query, likeQuery, likeQuery, targetType, targetType, targetId, targetId, limit);
  return rows.map(mapAiConversationRow);
}

/**
 * 每天最多创建一次 SQLite 完整备份，并清理超期备份。
 *
 * @returns {string | null} 新建备份路径；当天已有备份时返回空值。
 */
export function createDailyBackup() {
  /** today 是用于备份文件命名的本地日期。 */
  const today = new Date().toLocaleDateString("sv-SE");
  /** backupPath 是当天的 SQLite 备份路径。 */
  const backupPath = path.join(backupDirectory, `zhixu-${today}.db`);
  if (!fs.existsSync(backupPath)) {
    database.exec(`VACUUM INTO '${escapeSqlLiteral(backupPath)}';`);
  }

  /** retentionMilliseconds 是备份保留时长的毫秒值。 */
  const retentionMilliseconds =
    serverConfig.backupRetentionDays * 24 * 60 * 60 * 1000;
  /** expirationThreshold 是备份过期时间阈值。 */
  const expirationThreshold = Date.now() - retentionMilliseconds;
  for (const entry of fs.readdirSync(backupDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^zhixu-\d{4}-\d{2}-\d{2}\.db$/.test(entry.name)) {
      continue;
    }
    /** candidatePath 是待检查备份文件的绝对路径。 */
    const candidatePath = path.join(backupDirectory, entry.name);
    if (fs.statSync(candidatePath).mtimeMs < expirationThreshold) {
      fs.rmSync(candidatePath);
    }
  }
  return backupPath;
}

/**
 * 关闭 SQLite 连接，供测试或服务退出时使用。
 *
 * @returns {void}
 */
export function closeDatabase() {
  database.close();
}
