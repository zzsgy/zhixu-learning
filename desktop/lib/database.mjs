/**
 * 知序本地 SQLite 数据访问模块。
 *
 * 本模块集中管理表结构、文档增删查改和数据库备份。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseHTML } from "linkedom";
import { listLibraryMetadataPage, listTargetLocations } from "./library-pagination.mjs";
import { initializeReadingSessionDays } from "./reading-session-days.mjs";
import { createDatabaseSnapshot, createFullBackup, getStorageStatus } from "./backup-service.mjs";
import { getPaperIdentityKey, parseArxivIdentity } from "./paper-identity.mjs";
import { createPaperFolderStore } from "./paper-folders.mjs";
import { createActivityDashboardStore } from "./db/stores/activity-dashboard.mjs";
import { createAiHistoryStore } from "./db/stores/ai-history.mjs";
import { createContentOrganizationStore } from "./db/stores/content-organization.mjs";
import { createGitHubProjectStore } from "./db/stores/github-projects.mjs";
import { createImportJobStore } from "./db/stores/import-jobs.mjs";
import { createKnowledgeCardStore } from "./db/stores/knowledge-cards.mjs";
import { createKnowledgeSearchStore } from "./db/stores/knowledge-search.mjs";
import { createNoteStore } from "./db/stores/notes.mjs";
import { createReadingStore } from "./db/stores/reading.mjs";
import { createTopicStore } from "./db/stores/topics.mjs";
import {
  analyzePaperHtmlStructure,
  paperStructureMetricVersion,
  validatePaperTranslationStructure,
} from "./paper-structure.mjs";
import {
  backupDirectory,
  dataDirectory,
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
    display_title TEXT NOT NULL DEFAULT '',
    document_kind TEXT NOT NULL DEFAULT 'imported',
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
    display_title TEXT NOT NULL DEFAULT '',
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
    translation_stage TEXT NOT NULL DEFAULT '',
    translation_progress_percent INTEGER NOT NULL DEFAULT 0,
    translation_total_sections INTEGER NOT NULL DEFAULT 0,
    translation_completed_sections INTEGER NOT NULL DEFAULT 0,
    translation_error TEXT NOT NULL DEFAULT '',
    translation_requested_at TEXT,
    translation_started_at TEXT,
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
    source_html TEXT NOT NULL DEFAULT '',
    source_structure_json TEXT NOT NULL DEFAULT '{}',
    source_text_word_count INTEGER NOT NULL DEFAULT 0,
    full_translation_html TEXT NOT NULL DEFAULT '',
    full_translation_status TEXT NOT NULL DEFAULT 'pending',
    full_translation_source TEXT,
    full_translated_at TEXT,
    full_translation_error TEXT,
    full_translation_structure_json TEXT NOT NULL DEFAULT '{}',
    full_translation_fidelity TEXT NOT NULL DEFAULT 'unknown',
    full_translation_fidelity_message TEXT,
    full_translation_validation_source TEXT NOT NULL DEFAULT 'legacy',
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

  CREATE TABLE IF NOT EXISTS github_projects (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    repository TEXT NOT NULL,
    full_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    default_branch TEXT NOT NULL DEFAULT 'main',
    primary_language TEXT NOT NULL DEFAULT 'Unknown',
    languages_json TEXT NOT NULL DEFAULT '{}',
    topics_json TEXT NOT NULL DEFAULT '[]',
    stars INTEGER NOT NULL DEFAULT 0,
    forks INTEGER NOT NULL DEFAULT 0,
    watchers INTEGER NOT NULL DEFAULT 0,
    open_issues INTEGER NOT NULL DEFAULT 0,
    size_kb INTEGER NOT NULL DEFAULT 0,
    license_name TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    pushed_at TEXT,
    latest_release_json TEXT,
    contributors_json TEXT NOT NULL DEFAULT '[]',
    structure_json TEXT NOT NULL DEFAULT '[]',
    tree_truncated INTEGER NOT NULL DEFAULT 0,
    readme_excerpt TEXT NOT NULL DEFAULT '',
    important_files_json TEXT NOT NULL DEFAULT '[]',
    analysis_json TEXT NOT NULL DEFAULT '{}',
    analysis_source TEXT NOT NULL DEFAULT 'local',
    analysis_warning TEXT NOT NULL DEFAULT '',
    analyzed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS github_projects_updated_idx
    ON github_projects(updated_at DESC);

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
    note_html TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY(target_type, target_id)
  );

  CREATE INDEX IF NOT EXISTS reading_states_updated_idx
    ON reading_states(updated_at DESC);

  CREATE TABLE IF NOT EXISTS standalone_notes (
    id TEXT PRIMARY KEY,
    note_type TEXT NOT NULL
      CHECK(note_type IN ('markdown', 'text', 'word', 'mindmap')),
    title TEXT NOT NULL DEFAULT '',
    content_text TEXT NOT NULL DEFAULT '',
    content_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS standalone_notes_updated_idx
    ON standalone_notes(updated_at DESC);

  CREATE TABLE IF NOT EXISTS note_digests (
    id TEXT PRIMARY KEY,
    period_start TEXT,
    period_end TEXT NOT NULL,
    note_count INTEGER NOT NULL DEFAULT 0,
    source_count INTEGER NOT NULL DEFAULT 0,
    digest_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS note_digests_created_idx
    ON note_digests(created_at DESC);

  CREATE TABLE IF NOT EXISTS reading_sessions (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL
      CHECK(target_type IN ('document', 'article', 'paper')),
    target_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    ended_at TEXT,
    active_seconds INTEGER NOT NULL DEFAULT 0,
    progress_start REAL NOT NULL DEFAULT 0,
    progress_end REAL NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS reading_sessions_active_idx
    ON reading_sessions(last_active_at DESC);

  CREATE INDEX IF NOT EXISTS reading_sessions_target_idx
    ON reading_sessions(target_type, target_id, last_active_at DESC);

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
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
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

  CREATE TABLE IF NOT EXISTS pending_file_deletions (
    id TEXT PRIMARY KEY,
    asset_kind TEXT NOT NULL CHECK(asset_kind IN ('attachment', 'paper_pdf', 'paper_chinese_pdf', 'paper_chinese_hash')),
    file_name TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(asset_kind, file_name)
  );
`);

// 旧会话只能按原最后活动日回填；新会话随后按每日实际增量累计。
initializeReadingSessionDays(database);

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

/** 用户修改的展示名称独立于来源标题，重新解析或更新原文时不会被覆盖。 */
ensureTableColumn("documents", "display_title", "TEXT NOT NULL DEFAULT ''");
ensureTableColumn("documents", "document_kind", "TEXT NOT NULL DEFAULT 'imported'");
ensureTableColumn("articles", "display_title", "TEXT NOT NULL DEFAULT ''");
ensureTableColumn("articles", "videos_json", "TEXT NOT NULL DEFAULT '[]'");
ensureTableColumn("reading_states", "note_html", "TEXT NOT NULL DEFAULT ''");
ensureTableColumn("import_jobs", "next_attempt_at", "TEXT");
ensureTableColumn("import_jobs", "retry_count", "INTEGER NOT NULL DEFAULT 0");

/** 兼容此前由原生编辑器创建、但尚未带类型标记的工作记录。 */
database.prepare(`
  UPDATE documents
  SET document_kind = 'work_record'
  WHERE document_kind = 'imported'
    AND extension = '.md'
    AND id IN (
      SELECT cf.target_id
      FROM content_folders AS cf
      JOIN folders AS child ON child.id = cf.folder_id
      JOIN folders AS root ON root.id = child.parent_id
      WHERE cf.target_type = 'document'
        AND child.name = '工作记录'
        AND root.name = '工作台'
        AND root.parent_id IS NULL
    )
`).run();

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
  ["translation_stage", "TEXT NOT NULL DEFAULT ''"],
  ["translation_progress_percent", "INTEGER NOT NULL DEFAULT 0"],
  ["translation_total_sections", "INTEGER NOT NULL DEFAULT 0"],
  ["translation_completed_sections", "INTEGER NOT NULL DEFAULT 0"],
  ["translation_error", "TEXT NOT NULL DEFAULT ''"],
  ["translation_requested_at", "TEXT"],
  ["translation_started_at", "TEXT"],
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
  ["identity_key", "TEXT NOT NULL DEFAULT ''"],
  ["source_type", "TEXT NOT NULL DEFAULT 'weekly'"],
  ["source_label", "TEXT NOT NULL DEFAULT '每周精选'"],
  ["curator_note", "TEXT NOT NULL DEFAULT ''"],
  ["video_url", "TEXT"],
  ["video_alt_url", "TEXT"],
  ["duration", "TEXT"],
  ["source_text", "TEXT NOT NULL DEFAULT ''"],
  ["source_html", "TEXT NOT NULL DEFAULT ''"],
  ["source_structure_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["source_text_word_count", "INTEGER NOT NULL DEFAULT 0"],
  ["full_translation_html", "TEXT NOT NULL DEFAULT ''"],
  ["full_translation_status", "TEXT NOT NULL DEFAULT 'pending'"],
  ["full_translation_source", "TEXT"],
  ["full_translated_at", "TEXT"],
  ["full_translation_error", "TEXT"],
  ["extraction_error", "TEXT"],
  ["full_translation_structure_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["full_translation_fidelity", "TEXT NOT NULL DEFAULT 'unknown'"],
  ["full_translation_fidelity_message", "TEXT"],
  ["full_translation_validation_source", "TEXT NOT NULL DEFAULT 'legacy'"],
]);
for (const [columnName, columnDefinition] of paperLibraryColumns) {
  ensureTableColumn("papers", columnName, columnDefinition);
}
// 非唯一索引保留既有重复记录及其笔记，只让后续导入复用稳定身份。
database.exec("CREATE INDEX IF NOT EXISTS papers_identity_idx ON papers(identity_key);");
for (const row of database.prepare("SELECT id, external_id, source_url, pdf_url FROM papers WHERE identity_key = ''").all()) {
  const key = getPaperIdentityKey({ externalId: row.external_id, sourceUrl: row.source_url, pdfUrl: row.pdf_url });
  if (key) database.prepare("UPDATE papers SET identity_key = ? WHERE id = ?").run(key, row.id);
}

/** defaultFolderNames 是知识库按使用场景组织的一级入口。 */
const defaultFolderNames = Object.freeze([
  "工作资料",
  "工作台",
  "学习",
  "待整理",
]);
/** automaticFolderRootName 是系统无法可靠识别用途时的唯一安全入口。 */
const automaticFolderRootName = "待整理";

/** 目录、内容归档位置和标签已迁移到独立仓储；旧导入路径继续兼容导出。 */
const contentOrganizationStore = createContentOrganizationStore(database);
const {
  ensureFolder,
  getKnowledgeTargetSummary,
  normalizeKnowledgeTargetType,
} = contentOrganizationStore;
export const {
  addContentTag,
  assignContentToFolder,
  assignContentsToFolder,
  createFolder,
  deleteEmptyFolder,
  ensureFolderPath,
  getContentOrganization,
  listContentTags,
  listFolders,
  listTags,
  moveFolder,
  removeContentTag,
  renameFolder,
} = contentOrganizationStore;

/** 学习专题已迁移到独立仓储；旧导入路径继续兼容导出。 */
const topicStore = createTopicStore(database, {
  getKnowledgeTargetSummary,
  listContentTags,
  normalizeKnowledgeTargetType,
});
export const {
  addTopicItem,
  createTopic,
  listTopicItems,
  listTopics,
  removeTopicItem,
} = topicStore;

/** 知识卡片及间隔复习调度已迁移到独立仓储；旧导入路径继续兼容导出。 */
const knowledgeCardStore = createKnowledgeCardStore(database, {
  getKnowledgeTargetSummary,
  normalizeKnowledgeTargetType,
});
export const {
  createKnowledgeCard,
  deleteKnowledgeCard,
  listKnowledgeCards,
  reviewKnowledgeCard,
} = knowledgeCardStore;

/** 统一搜索查询引擎通过独立仓储绑定共享连接；旧导出继续兼容。 */
const knowledgeSearchStore = createKnowledgeSearchStore(database);
export const {
  searchKnowledgeBase,
  searchKnowledgeBasePage,
} = knowledgeSearchStore;

/** AI 问答会话与历史检索已迁移到独立仓储；模型调用仍由服务层负责。 */
const aiHistoryStore = createAiHistoryStore(database);
export const {
  getAiConversation,
  listAiConversations,
  saveAiExchange,
} = aiHistoryStore;

/** 后台导入任务状态机已迁移到独立仓储；任务执行器仍由服务层编排。 */
const importJobStore = createImportJobStore(database);
export const {
  claimNextImportJob,
  completeImportJob,
  confirmVideoImportJob,
  createImportJob,
  deferImportJob,
  failImportJob,
  getImportJob,
  getNextImportJobAttemptAt,
  listImportJobs,
  resetInterruptedImportJobs,
  retryImportJob,
  updateImportJobProgress,
} = importJobStore;

/** 创建默认入口；旧内容已有目录归属时绝不擅自移动。 */
for (const [folderIndex, folderName] of defaultFolderNames.entries()) {
  ensureFolder(null, folderName, folderIndex);
}
/** 工作台提供空的工作组织入口，不会接管既有专业资料。 */
const workbenchFolder = ensureFolder(null, "工作台", 1);
for (const [index, name] of ["项目", "工作记录", "交付物"].entries()) {
  ensureFolder(workbenchFolder.id, name, index);
}

/**
 * 返回自动导入的“待整理 / 专业分类”目录。
 * 系统能判断专业领域，但不能替用户决定资料是工作、学习还是项目内容。
 *
 * @param {string} category 自动或人工给出的专业分类。
 * @returns {Record<string, unknown>[]} 最终目录路径。
 */
function ensureAutomaticFolderPath(category) {
  return ensureFolderPath([automaticFolderRootName, String(category || "其它")]);
}

/** 为历史上尚无目录归属的内容补入待整理，不触碰用户已有组织。 */
for (const targetType of ["document", "article"]) {
  const sourceTable = targetType === "document" ? "documents" : "articles";
  const rows = database.prepare(`
    SELECT DISTINCT COALESCE(category, '其它') AS category FROM ${sourceTable}
    WHERE id NOT IN (SELECT target_id FROM content_folders WHERE target_type = ?)
  `).all(targetType);
  for (const row of rows) {
    const folder = ensureAutomaticFolderPath(row.category).at(-1);
    const now = new Date().toISOString();
    database.prepare(`
      INSERT OR IGNORE INTO content_folders(target_type, target_id, folder_id, created_at, updated_at)
      SELECT ?, id, ?, ?, ? FROM ${sourceTable}
      WHERE COALESCE(category, '其它') = ?
    `).run(targetType, folder.id, now, now, row.category);
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
    title: row.display_title || row.title,
    sourceTitle: row.title,
    documentKind: row.document_kind || "imported",
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
 * 统一标题的宽窄字符、大小写、空白和标点，用于识别同名资料。
 *
 * @param {unknown} value 原始标题。
 * @returns {string} 可稳定比较的标题键。
 */
function normalizeDuplicateTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

/**
 * 清理用户设置的知识库展示名称。
 *
 * @param {unknown} value 用户输入。
 * @returns {string} 可持久化名称。
 */
function normalizeDisplayTitle(value) {
  const title = String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!title) throw new Error("名称不能为空。");
  if (title.length > 180) throw new Error("名称不能超过 180 个字符。");
  return title;
}

/**
 * 按原标题或原文件内容摘要查找已存在的普通文档。
 *
 * @param {{ title?: string, sha256?: string }} input 候选文档特征。
 * @returns {Record<string, unknown> | null} 重复文档摘要或空值。
 */
export function findDuplicateDocument(input = {}) {
  const sha256 = String(input.sha256 || "").trim().toLowerCase();
  if (sha256) {
    const contentMatch = database.prepare(`
      SELECT id, title, original_name FROM documents WHERE sha256 = ? LIMIT 1
    `).get(sha256);
    if (contentMatch) {
      return {
        id: contentMatch.id,
        title: contentMatch.title,
        originalName: contentMatch.original_name,
        matchReason: "content",
      };
    }
  }
  const titleKey = normalizeDuplicateTitle(input.title);
  if (!titleKey) return null;
  const titleMatch = database.prepare(`
    SELECT id, title, original_name FROM documents ORDER BY created_at ASC
  `).all().find((row) => normalizeDuplicateTitle(row.title) === titleKey);
  return titleMatch
    ? {
        id: titleMatch.id,
        title: titleMatch.title,
        originalName: titleMatch.original_name,
        matchReason: "title",
      }
    : null;
}

/**
 * 按最终链接、原标题或规范化正文查找已存在的网页文章。
 *
 * @param {{ url?: string, title?: string, contentText?: string }} input 候选文章特征。
 * @returns {Record<string, unknown> | null} 重复文章摘要或空值。
 */
export function findDuplicateArticle(input = {}) {
  const url = String(input.url || "").trim();
  const urlMatch = url
    ? database.prepare("SELECT id, url, title FROM articles WHERE url = ? LIMIT 1").get(url)
    : null;
  if (urlMatch) {
    return { id: urlMatch.id, url: urlMatch.url, title: urlMatch.title, matchReason: "url" };
  }
  const titleKey = normalizeDuplicateTitle(input.title);
  const titleRows = database.prepare(`
    SELECT id, url, title FROM articles ORDER BY created_at ASC
  `).all();
  const titleMatch = titleKey
    ? titleRows.find((row) => normalizeDuplicateTitle(row.title) === titleKey)
    : null;
  if (titleMatch) {
    return { id: titleMatch.id, url: titleMatch.url, title: titleMatch.title, matchReason: "title" };
  }
  /** contentText 由统一网页解析器清理，精确比较可避免把全部长正文读入 Node 内存。 */
  const contentText = String(input.contentText || "");
  const contentMatch = contentText.trim().length >= 80
    ? database.prepare(`
        SELECT id, url, title FROM articles WHERE content_text = ? LIMIT 1
      `).get(contentText)
    : null;
  return contentMatch
    ? { id: contentMatch.id, url: contentMatch.url, title: contentMatch.title, matchReason: "content" }
    : null;
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
    title: row.display_title || row.title,
    sourceTitle: row.title,
    summary: row.summary,
    category: row.category,
    categorySource: row.category_source,
    categoryConfidence: row.category_confidence,
    author: row.author,
    publishedAt: row.published_at,
    coverImageUrl: row.cover_image_url,
    contentHtml: row.content_html,
    videos: JSON.parse(row.videos_json || '[]'),
    contentText: row.content_text,
    sourceLanguage: row.source_language || "unknown",
    translationStatus: row.translation_status || "not_required",
    translatedTitle: row.display_title || row.translated_title || "",
    translatedSummary: row.translated_summary || "",
    translatedHtml: row.translated_html || "",
    translatedText: row.translated_text || "",
    translationSource: row.translation_source,
    translatedAt: row.translated_at,
    translationStage: row.translation_stage || "",
    translationProgressPercent: Number(row.translation_progress_percent) || 0,
    translationTotalSections: Number(row.translation_total_sections) || 0,
    translationCompletedSections: Number(row.translation_completed_sections) || 0,
    translationError: row.translation_error || "",
    translationRequestedAt: row.translation_requested_at,
    translationStartedAt: row.translation_started_at,
    wordCount: row.word_count,
    isFavorite: Boolean(row.is_favorite),
    folderId: row.folder_id || null,
    folderSortOrder: Number(row.folder_sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
 * @param {{targetFolderId?: string, sortOrder?: number}} options 可选的明确保存位置。
 * @returns {Record<string, unknown>} 已保存文章。
 */
export function saveArticle(article, { targetFolderId = "", sortOrder = 0 } = {}) {
  /** existingRow 是同一最终 URL 已存在的文章。 */
  const existingRow = database
    .prepare("SELECT id, created_at, display_title FROM articles WHERE url = ? LIMIT 1")
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
          content_html, content_text, source_language, translation_status, videos_json,
          translated_title, translated_summary, translated_html, translated_text,
          translation_source, translated_at, word_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          videos_json = excluded.videos_json,
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
        JSON.stringify(article.videos || []),
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
        `${existingRow?.display_title || article.title} ${article.title}`.trim(),
        article.summary,
        article.category,
        article.author ?? "",
        article.contentText,
      );
    // 正文、全文索引和目录归属在同一事务内写入，目录失效时整篇回滚。
    if (targetFolderId) {
      assignContentToFolder("article", articleId, targetFolderId, sortOrder);
    } else if (!existingRow) {
      const defaultFolderPath = ensureAutomaticFolderPath(article.category);
      assignContentToFolder("article", articleId, defaultFolderPath.at(-1).id);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
  return getArticleById(articleId);
}

/** 更新文章原文与既有译文中的媒体 HTML，不改变正文文本和翻译完成状态。 */
export function updateArticleMedia(articleId, { contentHtml, translatedHtml, coverImageUrl }) {
  const current = getArticleById(articleId);
  if (!current) return null;
  database.prepare(`
    UPDATE articles SET content_html = ?, translated_html = ?, cover_image_url = ?, updated_at = ?
    WHERE id = ?
  `).run(
    String(contentHtml || current.contentHtml || ""),
    String(translatedHtml || current.translatedHtml || ""),
    coverImageUrl ?? current.coverImageUrl ?? null,
    new Date().toISOString(),
    articleId,
  );
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
 * 修改网页文章在知识库中的展示名称，并同步全文索引。
 *
 * @param {string} articleId 文章 ID。
 * @param {unknown} nextTitle 新展示名称。
 * @returns {Record<string, unknown> | null} 更新后的文章。
 */
export function renameArticleTitle(articleId, nextTitle) {
  const displayTitle = normalizeDisplayTitle(nextTitle);
  const source = database.prepare(`
    SELECT title, translated_title FROM articles WHERE id = ? LIMIT 1
  `).get(String(articleId || ""));
  if (!source) return null;
  const updatedAt = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.prepare(`
      UPDATE articles SET display_title = ?, updated_at = ? WHERE id = ?
    `).run(displayTitle, updatedAt, articleId);
    const article = getArticleById(articleId);
    database.prepare("DELETE FROM article_search WHERE article_id = ?").run(articleId);
    database.prepare(`
      INSERT INTO article_search(article_id, title, summary, category, author, content_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      article.id,
      `${displayTitle} ${source.title} ${source.translated_title || ""}`.trim(),
      `${article.summary} ${article.translatedSummary || ""}`.trim(),
      article.category,
      article.author || "",
      `${article.contentText}\n\n${article.translatedText || ""}`.trim(),
    );
    database.exec("COMMIT;");
    return getArticleById(articleId);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
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

/** articleTranslationTags 是文章译文允许使用的安全语义标签。 */
const articleTranslationTags = new Set([
  "h2", "h3", "h4", "p", "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "sub", "sup", "br", "img",
]);

/**
 * 校验 Codex 文章译文只包含安全语义 HTML；图片仅允许解析器生成的受控属性。
 *
 * @param {string} translatedHtml 待写入的中文译文。
 * @returns {{ html: string, text: string }} 规范化译文及纯文本。
 */
function validateArticleTranslationHtml(translatedHtml) {
  /** html 是去除首尾空白后的完整中文译文。 */
  const html = String(translatedHtml || "").trim();
  if (!html) throw new TypeError("文章中文译文不能为空。");
  /** parsedDocument 用 DOM 逐项校验标签与图片地址，避免属性顺序影响判断。 */
  const { document: parsedDocument } = parseHTML(`<main>${html}</main>`);
  const root = parsedDocument.querySelector("main");
  if (!root) throw new TypeError("文章中文译文结构无效。");
  for (const element of root.querySelectorAll("*")) {
    /** tagName 是当前标签的小写名称。 */
    const tagName = element.tagName.toLowerCase();
    if (!articleTranslationTags.has(tagName)) {
      throw new TypeError(`文章译文包含不允许的标签：${tagName}。`);
    }
    if (tagName === "img") {
      /** attributeNames 只允许文章解析器生成的静态图片属性。 */
      const attributeNames = Array.from(element.attributes, (attribute) => attribute.name);
      if (attributeNames.some((name) => !["src", "alt", "loading", "referrerpolicy"].includes(name))) {
        throw new TypeError("文章译文图片包含不允许的属性。");
      }
      /** source 必须是文章解析阶段已经规范化的 HTTPS 图片地址。 */
      const source = element.getAttribute("src") || "";
      if (!/^https:\/\/[^\s]+$/i.test(source)) {
        throw new TypeError("文章译文图片地址不安全。");
      }
      if (element.getAttribute("loading") !== "lazy"
        || element.getAttribute("referrerpolicy") !== "no-referrer") {
        throw new TypeError("文章译文图片缺少安全加载属性。");
      }
      continue;
    }
    if (element.attributes.length > 0) {
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
 * @param {{ force?: boolean }} options 是否强制重新生成已有译文。
 * @returns {Record<string, unknown> | null} 更新后的文章。
 */
export function requestArticleTranslation(articleId, options = {}) {
  /** article 是准备进入翻译队列的完整原文。 */
  const article = getArticleById(articleId);
  if (!article) return null;
  if (!['en', 'mixed'].includes(article.sourceLanguage)) {
    throw new TypeError("当前文章不是英文或中英混合内容，无需加入翻译队列。");
  }
  if (article.translationStatus === "ready" && article.translatedHtml && !options.force) return article;
  /** requestedAt 是排队顺序、等待时间和恢复信息使用的本机时间。 */
  const requestedAt = new Date().toISOString();
  database.prepare(`
    UPDATE articles
    SET translation_status = 'pending', translation_stage = 'queued',
        translation_progress_percent = 0, translation_total_sections = 0,
        translation_completed_sections = 0, translation_error = '',
        translated_title = CASE WHEN ? THEN '' ELSE translated_title END,
        translated_summary = CASE WHEN ? THEN '' ELSE translated_summary END,
        translated_html = CASE WHEN ? THEN '' ELSE translated_html END,
        translated_text = CASE WHEN ? THEN '' ELSE translated_text END,
        translation_source = CASE WHEN ? THEN NULL ELSE translation_source END,
        translated_at = CASE WHEN ? THEN NULL ELSE translated_at END,
        translation_requested_at = ?, translation_started_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(
    options.force ? 1 : 0,
    options.force ? 1 : 0,
    options.force ? 1 : 0,
    options.force ? 1 : 0,
    options.force ? 1 : 0,
    options.force ? 1 : 0,
    requestedAt,
    requestedAt,
    articleId,
  );
  return getArticleById(articleId);
}

/**
 * 原子领取等待时间最早的一篇文章，防止同一服务进程重复处理。
 *
 * @returns {Record<string, unknown> | null} 已切换为 processing 的文章。
 */
export function claimNextPendingArticleTranslation() {
  /** row 是当前队列中等待最久的文章标识。 */
  const row = database.prepare(`
    SELECT id FROM articles
    WHERE translation_status = 'pending'
      AND source_language IN ('en', 'mixed')
      AND COALESCE(TRIM(translated_html), '') = ''
    ORDER BY COALESCE(translation_requested_at, updated_at) ASC, id ASC
    LIMIT 1
  `).get();
  if (!row) return null;
  /** startedAt 是本轮实际开始处理的时间。 */
  const startedAt = new Date().toISOString();
  /** result 用 pending 条件确保只领取一次。 */
  const result = database.prepare(`
    UPDATE articles
    SET translation_status = 'processing', translation_stage = 'preparing',
        translation_progress_percent = MAX(translation_progress_percent, 2),
        translation_error = '', translation_started_at = ?, updated_at = ?
    WHERE id = ? AND translation_status = 'pending'
  `).run(startedAt, startedAt, row.id);
  return result.changes === 1 ? getArticleById(row.id) : null;
}

/**
 * 保存文章分段翻译的真实完成进度。
 *
 * @param {string} articleId 文章 ID。
 * @param {{ stage: string, progressPercent: number, totalSections?: number, completedSections?: number }} progress 进度快照。
 * @returns {Record<string, unknown> | null} 更新后的文章。
 */
export function updateArticleTranslationProgress(articleId, progress) {
  /** progressPercent 是限制在 0 到 99 的处理中百分比。 */
  const progressPercent = Math.min(Math.max(Math.round(Number(progress.progressPercent) || 0), 0), 99);
  /** totalSections 是本次正文分段总数。 */
  const totalSections = Math.max(Math.trunc(Number(progress.totalSections) || 0), 0);
  /** completedSections 是已经成功生成中文译文的分段数。 */
  const completedSections = Math.min(
    Math.max(Math.trunc(Number(progress.completedSections) || 0), 0),
    totalSections || Number.MAX_SAFE_INTEGER,
  );
  database.prepare(`
    UPDATE articles
    SET translation_stage = ?, translation_progress_percent = ?,
        translation_total_sections = CASE WHEN ? > 0 THEN ? ELSE translation_total_sections END,
        translation_completed_sections = ?, updated_at = ?
    WHERE id = ? AND translation_status = 'processing'
  `).run(
    String(progress.stage || "translating").slice(0, 40),
    progressPercent,
    totalSections,
    totalSections,
    completedSections,
    new Date().toISOString(),
    articleId,
  );
  return getArticleById(articleId);
}

/**
 * 记录文章自动翻译失败原因，保留原文和可恢复的分段结果。
 *
 * @param {string} articleId 文章 ID。
 * @param {string} message 可展示的失败原因。
 * @returns {Record<string, unknown> | null} 更新后的文章。
 */
export function markArticleTranslationFailed(articleId, message) {
  /** failedAt 是失败状态写入时间。 */
  const failedAt = new Date().toISOString();
  database.prepare(`
    UPDATE articles
    SET translation_status = 'failed', translation_stage = 'failed',
        translation_error = ?, updated_at = ?
    WHERE id = ?
  `).run(String(message || "Codex 文章翻译失败。").slice(0, 1000), failedAt, articleId);
  return getArticleById(articleId);
}

/** 外部服务暂不可用时保留文章的队列位置和已完成分段。 */
export function deferArticleTranslation(articleId, message) {
  database.prepare(`
    UPDATE articles SET translation_status = 'pending', translation_stage = 'queued',
      translation_error = ?, updated_at = ?
    WHERE id = ? AND translation_status = 'processing'
  `).run(String(message || "翻译暂缓，稍后自动继续。").slice(0, 1000), new Date().toISOString(), articleId);
  return getArticleById(articleId);
}

/** 两类翻译工作器共享持久化的账号可用性等待状态。 */
export function getCodexTranslationRetryState() {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?")
    .get("codex.translation.retry");
  try {
    const value = JSON.parse(row?.value || "{}");
    return { retryAfter: Math.max(0, Number(value.retryAfter) || 0), reason: String(value.reason || "") };
  } catch { return { retryAfter: 0, reason: "" }; }
}

export function setCodexTranslationRetryState({ retryAfter = 0, reason = "" } = {}) {
  const state = { retryAfter: Math.max(0, Number(retryAfter) || 0), reason: String(reason).slice(0, 1000) };
  database.prepare(`INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run("codex.translation.retry", JSON.stringify(state), new Date().toISOString());
  return state;
}

/**
 * 服务启动时把异常中断的文章恢复到队列，磁盘分段结果将被继续使用。
 *
 * @returns {number} 恢复的任务数量。
 */
export function resetInterruptedArticleTranslations() {
  /** recoveredAt 是恢复任务重新入队的时间。 */
  const recoveredAt = new Date().toISOString();
  /** result 是本次恢复影响的文章数量。 */
  const result = database.prepare(`
    UPDATE articles
    SET translation_status = 'pending', translation_stage = 'queued',
        translation_error = '上一次翻译因本地服务中断而暂停，现已继续。',
        translation_started_at = NULL, updated_at = ?
    WHERE translation_status = 'processing'
  `).run(recoveredAt);
  return Number(result.changes) || 0;
}

/**
 * 返回前端轮询所需的轻量翻译状态和排队位置。
 *
 * @param {string} articleId 文章 ID。
 * @returns {Record<string, unknown> | null} 翻译状态快照。
 */
export function getArticleTranslationStatus(articleId) {
  /** row 只读取状态字段，避免每两秒返回整篇文章正文。 */
  const row = database.prepare(`
    SELECT id, title, translation_status, translation_stage,
           translation_progress_percent, translation_total_sections,
           translation_completed_sections, translation_error,
           translation_requested_at, translation_started_at, translated_at,
           updated_at
    FROM articles WHERE id = ? LIMIT 1
  `).get(articleId);
  if (!row) return null;
  /** queuePosition 只对 pending 任务计算从一开始的真实位置。 */
  let queuePosition = 0;
  if (row.translation_status === "pending") {
    const queueRows = database.prepare(`
      SELECT id FROM articles
      WHERE translation_status = 'pending'
      ORDER BY COALESCE(translation_requested_at, updated_at) ASC, id ASC
    `).all();
    queuePosition = queueRows.findIndex((item) => item.id === row.id) + 1;
  }
  return {
    id: row.id,
    title: row.title,
    translationStatus: row.translation_status,
    translationStage: row.translation_stage || "",
    translationProgressPercent: Number(row.translation_progress_percent) || 0,
    translationTotalSections: Number(row.translation_total_sections) || 0,
    translationCompletedSections: Number(row.translation_completed_sections) || 0,
    translationError: row.translation_error || "",
    translationRequestedAt: row.translation_requested_at,
    translationStartedAt: row.translation_started_at,
    translatedAt: row.translated_at,
    updatedAt: row.updated_at,
    queuePosition,
  };
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
            translation_source = 'codex', translated_at = ?,
            translation_stage = 'completed', translation_progress_percent = 100,
            translation_completed_sections = translation_total_sections,
            translation_error = '', updated_at = ?
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
      sha256, title, document_kind, category, category_source, category_confidence,
      summary, extracted_text, extraction_status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      document.documentKind || "imported",
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
    // 目录和索引必须与主记录一起提交，避免归属失败留下半保存资料。
    const importedFolderNames = Array.isArray(document.folderPath) ? document.folderPath : [];
    const targetFolderId = String(document.targetFolderId || "").trim();
    if (targetFolderId) {
      const selectedFolderPath = importedFolderNames.length > 0
        ? ensureFolderPath(importedFolderNames, [], targetFolderId)
        : [];
      assignContentToFolder("document", document.id, selectedFolderPath.at(-1)?.id || targetFolderId);
    } else {
      const initialFolderNames = importedFolderNames.length > 0
        ? [automaticFolderRootName, ...importedFolderNames]
        : [automaticFolderRootName, document.category || "其它"];
      const initialFolderPath = ensureFolderPath(initialFolderNames);
      assignContentToFolder("document", document.id, initialFolderPath.at(-1).id);
    }
    const savedDocument = getDocumentById(document.id);
    database.exec("COMMIT;");
    return savedDocument;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

/** 不读取长正文的文章分页；原 listArticles 数组接口保持兼容。 */
export function listArticlesPage(filters = {}) {
  const { rows, ...pagination } = listLibraryMetadataPage(database, "article", filters);
  const articles = rows.map((row) => {
    const { contentHtml, contentText, translatedHtml, translatedText, ...item } = mapArticleRow(row);
    return { ...item, tags: row.tags };
  });
  return { articles, ...pagination };
}

/**
 * 更新由知序原生编辑器创建的 Markdown 工作记录及全文索引。
 *
 * @param {string} documentId 文档 ID。
 * @param {{title: string, extractedText: string, sizeBytes: number, sha256: string, summary: string}} changes 新内容。
 * @returns {Record<string, unknown> | null} 更新后的文档。
 */
export function updateWorkRecordDocument(documentId, changes) {
  const current = getDocumentById(documentId);
  if (!current || current.documentKind !== "work_record" || current.extension !== ".md") return null;
  const title = normalizeDisplayTitle(changes.title);
  const extractedText = String(changes.extractedText || "");
  const updatedAt = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.prepare(`
      UPDATE documents SET
        title = ?, display_title = '', original_name = ?, size_bytes = ?, sha256 = ?,
        summary = ?, extracted_text = ?, extraction_status = 'ready', updated_at = ?
      WHERE id = ? AND document_kind = 'work_record'
    `).run(
      title,
      `${title}.md`,
      Number(changes.sizeBytes) || 0,
      String(changes.sha256 || ""),
      String(changes.summary || ""),
      extractedText,
      updatedAt,
      documentId,
    );
    database.prepare("DELETE FROM document_search WHERE document_id = ?").run(documentId);
    database.prepare(`
      INSERT INTO document_search(document_id, title, original_name, category, summary, extracted_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(documentId, title, `${title}.md`, current.category, String(changes.summary || ""), extractedText);
    database.exec("COMMIT;");
    return getDocumentById(documentId);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
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
 * 修改本地文档在知识库中的展示名称，并同步全文索引。
 *
 * @param {string} documentId 文档 ID。
 * @param {unknown} nextTitle 新展示名称。
 * @returns {Record<string, unknown> | null} 更新后的文档。
 */
export function renameDocumentTitle(documentId, nextTitle) {
  const displayTitle = normalizeDisplayTitle(nextTitle);
  if (!database.prepare("SELECT id FROM documents WHERE id = ? LIMIT 1").get(String(documentId || ""))) {
    return null;
  }
  const updatedAt = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.prepare(`
      UPDATE documents SET display_title = ?, updated_at = ? WHERE id = ?
    `).run(displayTitle, updatedAt, documentId);
    const document = getDocumentById(documentId);
    database.prepare("DELETE FROM document_search WHERE document_id = ?").run(documentId);
    database.prepare(`
      INSERT INTO document_search(document_id, title, original_name, category, summary, extracted_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      document.id,
      document.title,
      document.originalName,
      document.category,
      document.summary,
      document.extractedText,
    );
    database.exec("COMMIT;");
    return getDocumentById(documentId);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
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
      /** 已由用户放入工作资料、工作台或学习的内容，不因改专业标签被挪走。 */
      const currentFolder = listFolders().find((folder) => folder.id === document.folderId);
      const usesAutomaticPlacement = !currentFolder
        || currentFolder.path.at(0)?.name === automaticFolderRootName;
      if (usesAutomaticPlacement) {
        const categoryFolder = ensureAutomaticFolderPath(category).at(-1);
        assignContentToFolder("document", documentId, categoryFolder.id);
      }
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
    identityKey: row.identity_key || "",
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
    sourceHtml: row.source_html || "",
    sourceStructure: JSON.parse(row.source_structure_json || "{}"),
    sourceTextWordCount: row.source_text_word_count || 0,
    fullTranslationHtml: row.full_translation_html || "",
    fullTranslationStatus: row.full_translation_status || "pending",
    fullTranslationSource: row.full_translation_source,
    fullTranslatedAt: row.full_translated_at,
    fullTranslationError: row.full_translation_error,
    fullTranslationStructure: JSON.parse(row.full_translation_structure_json || "{}"),
    fullTranslationFidelity: row.full_translation_fidelity || "unknown",
    fullTranslationFidelityMessage: row.full_translation_fidelity_message,
    fullTranslationValidationSource: row.full_translation_validation_source || "legacy",
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
export const paperFolders = createPaperFolderStore(database);

export function getPaperLibraryPage(options, duplicateIds) {
  const { rows, ...page } = paperFolders.page(options, duplicateIds);
  return { ...page, papers: rows.map(row => ({ ...mapPaperRow(row), folderId: row.folder_id || null, readingStatus: row.reading_status })) };
}

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
  let externalId = String(paper.externalId || "").trim();
  /** title 是论文列表必须展示的标题。 */
  const title = String(paper.title || "").trim();
  if (!externalId || !title) {
    throw new TypeError("导入论文缺少稳定来源或标题。");
  }
  /** now 是本次导入或更新的统一时间。 */
  const now = new Date().toISOString();
  /** existingRow 用于重复导入时保留本地 ID 和首次创建时间。 */
  const existingRow = findPaperIdentityRow(paper);
  if (existingRow) externalId = existingRow.external_id;
  if (existingRow?.source_text?.trim() && !paper.replaceExisting) return mapPaperRow(existingRow);
  /** paperId 是论文的稳定本地 ID。 */
  const paperId = existingRow?.id ?? String(paper.id || `paper_${crypto.randomUUID()}`);
  /** sourceText 是文件或网页中已经提取的可读正文。 */
  const sourceText = String(paper.sourceText || "").trim();
  /** sourceHtml 是保留图片、表格、公式和标题结构的安全正文。 */
  const sourceHtml = String(paper.sourceHtml || "").trim();
  /** sourceStructureJson 是导入阶段生成的可核验结构清单。 */
  const sourceStructureJson = JSON.stringify(paper.sourceStructure || {});
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
        curator_note, source_text, source_html, source_structure_json,
        source_text_word_count,
        full_translation_status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', '手动导入',
        ?, ?, ?, ?, ?, ?, ?, ?
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
        source_html = CASE
          WHEN COALESCE(TRIM(excluded.source_html), '') <> '' THEN excluded.source_html
          ELSE papers.source_html
        END,
        source_structure_json = CASE
          WHEN excluded.source_structure_json <> '{}' THEN excluded.source_structure_json
          ELSE papers.source_structure_json
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
      sourceHtml,
      sourceStructureJson,
      wordCount,
      translationStatus,
      existingRow?.created_at ?? now,
      now,
    );
  database.prepare("UPDATE papers SET identity_key = ? WHERE id = ?").run(getPaperIdentityKey(paper), paperId);
  return getPaperById(paperId);
}

/** 不读取正文的文档分页；页面可继续读取第1000项以后的内容。 */
export function listDocumentsPage(filters = {}) {
  const { rows, ...pagination } = listLibraryMetadataPage(database, "document", filters);
  const documents = rows.map((row) => {
    const { extractedText, ...item } = mapDocumentRow(row);
    return { ...item, tags: row.tags };
  });
  return { documents, ...pagination };
}

export function getContentLocations(targets) {
  return listTargetLocations(database, targets);
}

function findPaperIdentityRow(paper) {
  const key = getPaperIdentityKey(paper);
  return database.prepare(`SELECT * FROM papers
    WHERE external_id = ? OR (? <> '' AND identity_key = ?)
    ORDER BY CASE WHEN TRIM(source_text) <> '' THEN 0 ELSE 1 END, created_at, id LIMIT 1
  `).get(String(paper.externalId || ""), key, key) || null;
}

/** 网络请求之前事务性保存占位论文和任务，重复点击复用同一任务。 */
export function enqueuePaperImport({ inputUrl = "", paperId = "", force = false, paperFolderId = "" } = {}) {
  database.exec("BEGIN IMMEDIATE;");
  try {
    paperFolders.assertFolder(paperFolderId);
    let paper = paperId ? getPaperById(paperId) : null;
    if (paperId && !paper) throw new Error("论文不存在。");
    const identity = parseArxivIdentity(inputUrl || paper?.sourceUrl);
    const url = new URL(inputUrl || paper?.sourceUrl || paper?.pdfUrl);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new TypeError("论文链接必须是不含登录凭据的 HTTP 或 HTTPS 公开地址。");
    url.hash = "";
    if (!paper) {
      const input = {
      externalId: identity?.externalId || `manual-url:${url.href}`,
      title: identity ? `arXiv ${identity.arxivId} · 等待识别` : `${url.hostname} · 等待识别`,
      sourceUrl: identity?.sourceUrl || url.href,
      pdfUrl: identity?.pdfUrl || (/\.pdf$/i.test(url.pathname) ? url.href : null),
      sourceLanguage: "unknown",
      };
      const existing = findPaperIdentityRow(input);
      paper = upsertImportedPaper(input);
      // 新记录与目标目录在同一事务保存；重复导入（包括尚未完成的导入）不改变用户归档。
      if (!existing && paperFolderId) database.prepare("INSERT INTO paper_folder_items(paper_id,folder_id,updated_at) VALUES(?,?,?)").run(paper.id, paperFolderId, new Date().toISOString());
    }
    const active = database.prepare("SELECT * FROM import_jobs WHERE job_type = 'paper_import' AND target_id = ? AND status IN ('queued','running') ORDER BY created_at LIMIT 1").get(paper.id);
    let job = active ? getImportJob(active.id) : null;
    const duplicate = Boolean(paper.sourceText?.trim() && !force);
    if (!job && !duplicate) {
      const kind = identity ? "arxiv" : paper.pdfUrl ? "pdf" : "webpage";
      const payload = { paperId: paper.id, inputUrl: identity?.sourceUrl || url.href, inputKind: kind, requestedVersion: identity?.requestedVersion || "", force: Boolean(force) };
      const previous = database.prepare("SELECT id FROM import_jobs WHERE job_type = 'paper_import' AND target_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 1").get(paper.id);
      if (previous) {
        database.prepare("UPDATE import_jobs SET payload_json = ? WHERE id = ?").run(JSON.stringify(payload), previous.id);
        job = retryImportJob(previous.id);
      } else job = createImportJob({ jobType: "paper_import", sourceLabel: paper.title, sourceUrl: url.href, targetType: "paper", targetId: paper.id, payload });
      database.prepare("UPDATE papers SET extraction_error = NULL, full_translation_status = CASE WHEN TRIM(source_text) = '' THEN 'pending' ELSE full_translation_status END WHERE id = ?").run(paper.id);
    }
    database.exec("COMMIT;");
    return { paper: getPaperById(paper.id), importJob: job, duplicate, processing: Boolean(job) };
  } catch (error) { database.exec("ROLLBACK;"); throw error; }
}

export function recoverPendingPaperImports() {
  const rows = database.prepare(`SELECT id, source_url FROM papers p WHERE TRIM(source_text) = '' AND extraction_error IS NULL AND full_translation_status = 'pending'
    AND source_url LIKE 'http%' AND NOT EXISTS (SELECT 1 FROM import_jobs j WHERE j.job_type = 'paper_import' AND j.target_id = p.id)`).all();
  for (const row of rows) enqueuePaperImport({ paperId: row.id, inputUrl: row.source_url });
  return rows.length;
}

export function getPaperImportStatuses() {
  return database.prepare(`SELECT id, target_id, status, stage, progress_percent, attempt_count, error_message, next_attempt_at FROM import_jobs j
    WHERE job_type = 'paper_import' AND id = (SELECT id FROM import_jobs WHERE job_type = 'paper_import' AND target_id = j.target_id ORDER BY created_at DESC, id DESC LIMIT 1)`).all();
}

export function listPaperIdentityDuplicates() {
  return database.prepare("SELECT identity_key AS identityKey, COUNT(*) AS count FROM papers WHERE identity_key <> '' GROUP BY identity_key HAVING COUNT(*) > 1").all().map(group => ({ ...group, paperIds: database.prepare("SELECT id FROM papers WHERE identity_key = ? ORDER BY created_at, id").all(group.identityKey).map(row => row.id) }));
}

export function updatePaperImportMetadata(paperId, metadata) {
  database.prepare(`UPDATE papers SET title = ?, abstract = ?, authors_json = ?, published_at = COALESCE(?, published_at),
    source_url = ?, pdf_url = COALESCE(?, pdf_url), identity_key = COALESCE(NULLIF(?, ''), identity_key), updated_at = ? WHERE id = ?`).run(
    String(metadata.title || "未命名论文"), String(metadata.abstract || metadata.summary || ""), JSON.stringify(metadata.authors || []),
    metadata.publishedAt || null, metadata.sourceUrl, metadata.pdfUrl || null, getPaperIdentityKey(metadata), new Date().toISOString(), paperId);
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
 * @param {{ sourceText: string, sourceHtml?: string, sourceStructure?: Record<string, unknown>, wordCount: number, sourceLanguage?: string, resetTranslation?: boolean }} extraction 提取结果。
 * @returns {Record<string, unknown> | null} 更新后的论文。
 */
export function updatePaperSourceText(paperId, extraction) {
  /** sourceText 是去除首尾空白后的英文论文正文。 */
  const sourceText = String(extraction.sourceText || "").trim();
  /** sourceHtml 保留图片、表格、上下标和 LaTeX 所在的安全语义结构。 */
  const sourceHtml = String(extraction.sourceHtml || "").trim();
  /** sourceStructure 是入库时生成、供完成门禁使用的结构清单。 */
  const sourceStructureJson = JSON.stringify(extraction.sourceStructure || {});
  /** wordCount 是提取正文的英文词数。 */
  const wordCount = Math.max(Number(extraction.wordCount) || 0, 0);
  /** updatedAt 是全文提取完成时间。 */
  const updatedAt = new Date().toISOString();
  /** translationStatus 对中文原文跳过不必要的全文翻译队列。 */
  const translationStatus = extraction.sourceLanguage === "zh" ? "not_required" : "pending";
  database
    .prepare(`
      UPDATE papers
      SET source_text = ?, source_html = ?, source_structure_json = ?,
          source_text_word_count = ?,
          full_translation_status = CASE
            WHEN COALESCE(TRIM(full_translation_html), '') = '' OR ? THEN ?
            WHEN full_translation_status = 'failed' THEN 'ready'
            ELSE full_translation_status
          END,
          full_translation_error = NULL,
          full_translation_html = CASE WHEN ? THEN '' ELSE full_translation_html END,
          full_translation_structure_json = CASE WHEN ? THEN '{}' ELSE full_translation_structure_json END,
          full_translation_fidelity = CASE WHEN ? THEN 'unknown' ELSE full_translation_fidelity END,
          full_translation_fidelity_message = CASE WHEN ? THEN NULL ELSE full_translation_fidelity_message END,
          full_translation_validation_source = CASE
            WHEN ? THEN 'auto'
            ELSE full_translation_validation_source
          END,
          extraction_error = NULL,
          updated_at = ?
      WHERE id = ?
    `)
    .run(
      sourceText,
      sourceHtml,
      sourceStructureJson,
      wordCount,
      extraction.resetTranslation ? 1 : 0,
      translationStatus,
      extraction.resetTranslation ? 1 : 0,
      extraction.resetTranslation ? 1 : 0,
      extraction.resetTranslation ? 1 : 0,
      extraction.resetTranslation ? 1 : 0,
      extraction.resetTranslation ? 1 : 0,
      updatedAt,
      paperId,
    );
  if (
    !extraction.resetTranslation
    && extraction.sourceStructure?.structureFidelity === "degraded"
  ) {
    database.prepare(`
      UPDATE papers
      SET full_translation_fidelity = CASE
            WHEN COALESCE(TRIM(full_translation_html), '') <> ''
              AND full_translation_validation_source = 'auto' THEN 'degraded'
            ELSE full_translation_fidelity
          END,
          full_translation_fidelity_message = CASE
            WHEN COALESCE(TRIM(full_translation_html), '') <> ''
              AND full_translation_validation_source = 'auto' THEN ?
            ELSE full_translation_fidelity_message
          END
      WHERE id = ?
    `).run(
      String(extraction.sourceStructure.structureMessage || "原始来源未提供完整图文结构。"),
      paperId,
    );
  }
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
      SET full_translation_status = CASE WHEN TRIM(source_text) <> '' THEN full_translation_status ELSE 'failed' END,
          extraction_error = ?, updated_at = ?
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
 * 因 Codex 临时不可用而把当前论文退回队列，不把外部额度问题记成论文失败。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @param {string} message 面向用户的暂停原因。
 * @returns {Record<string, unknown> | null} 退回等待状态后的论文。
 */
export function deferPaperFullTranslation(paperId, message) {
  const updatedAt = new Date().toISOString();
  const safeMessage = String(message || "Codex 暂时不可用，论文已保留在队列中。").slice(0, 500);
  database
    .prepare(`
      UPDATE papers
      SET full_translation_status = 'pending', full_translation_error = ?,
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
          full_translation_html = '', full_translation_structure_json = '{}',
          full_translation_fidelity = 'unknown', full_translation_fidelity_message = NULL,
          full_translation_validation_source = 'auto',
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
export function updatePaperFullTranslation(paperId, translatedHtml, structure = {}) {
  /** normalizedHtml 是去除首尾空白后的完整中文译文。 */
  const normalizedHtml = String(translatedHtml || "").trim();
  if (normalizedHtml.length < 500) {
    throw new TypeError("论文全文中文译文不能少于 500 个字符。");
  }
  /** translatedAt 是 Codex 完成全文翻译的时间。 */
  const translatedAt = new Date().toISOString();
  /** fidelity 必须由结构完整性校验明确给出，旧调用只能标为未核验。 */
  const fidelity = ["complete", "degraded"].includes(structure.fidelity)
    ? structure.fidelity
    : "unknown";
  const fidelityMessage = String(structure.message || "").trim() || null;
  const translatedStructureJson = JSON.stringify(structure.translation || {});
  /** 人工核验必须显式声明；普通工作器产生的结果始终属于自动校验。 */
  const validationSource = structure.validationSource === "manual" ? "manual" : "auto";
  database
    .prepare(`
      UPDATE papers
      SET full_translation_html = ?, full_translation_status = 'ready',
          full_translation_source = 'codex', full_translated_at = ?,
          full_translation_error = NULL,
          full_translation_structure_json = ?, full_translation_fidelity = ?,
          full_translation_fidelity_message = ?, full_translation_validation_source = ?,
          updated_at = ?
      WHERE id = ?
    `)
    .run(
      normalizedHtml,
      translatedAt,
      translatedStructureJson,
      fidelity,
      fidelityMessage,
      validationSource,
      translatedAt,
      paperId,
    );
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
  const existingRow = findPaperIdentityRow(paper);
  if (existingRow) {
    database.prepare(`UPDATE papers SET video_url = COALESCE(?, video_url), video_alt_url = COALESCE(?, video_alt_url),
      duration = COALESCE(?, duration), identity_key = ? WHERE id = ?`).run(
      paper.videoUrl || null, paper.videoAltUrl || null, paper.duration || null, getPaperIdentityKey(paper), existingRow.id);
    return getPaperById(existingRow.id);
  }
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
  database.prepare("UPDATE papers SET identity_key = ? WHERE id = ?").run(getPaperIdentityKey(paper), paperId);
  return getPaperById(paperId);
}

/**
 * 按当前计数口径重检旧版已完成译文。只更新结构清单与校验结论，不重新
 * 翻译、不改正文，也不改论文排序时间。版本一致时不会重复扫描正文。
 *
 * @returns {{ checkedCount: number, updatedCount: number, completeCount: number, degradedCount: number, items: Array<Record<string, string>> }} 重检摘要。
 */
export function revalidateReadyPaperTranslationStructures(paperIds = []) {
  const parseStructure = (value) => {
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const normalizedPaperIds = [...new Set(
    (Array.isArray(paperIds) ? paperIds : [paperIds])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
  const summary = {
    checkedCount: 0,
    updatedCount: 0,
    completeCount: 0,
    degradedCount: 0,
    items: [],
  };
  /** 禁止无目标的全库重检；结构迁移必须明确列出经过审查的论文。 */
  if (!normalizedPaperIds.length) return summary;
  const placeholders = normalizedPaperIds.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT id, source_html, source_structure_json, full_translation_html,
           full_translation_structure_json, full_translation_fidelity,
           full_translation_fidelity_message
    FROM papers
    WHERE full_translation_status = 'ready'
      AND full_translation_validation_source = 'auto'
      AND TRIM(source_html) <> ''
      AND TRIM(full_translation_html) <> ''
      AND id IN (${placeholders})
  `).all(...normalizedPaperIds);
  const update = database.prepare(`
    UPDATE papers
    SET source_structure_json = ?, full_translation_structure_json = ?,
        full_translation_fidelity = ?, full_translation_fidelity_message = ?
    WHERE id = ?
  `);
  database.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of rows) {
      const previousSource = parseStructure(row.source_structure_json);
      const previousTranslation = parseStructure(row.full_translation_structure_json);
      if (
        Number(previousSource.structureMetricVersion) >= paperStructureMetricVersion
        && Number(previousTranslation.structureMetricVersion) >= paperStructureMetricVersion
      ) {
        continue;
      }
      summary.checkedCount += 1;
      const sourceStructure = {
        ...previousSource,
        ...analyzePaperHtmlStructure(row.source_html),
      };
      const validation = validatePaperTranslationStructure(
        sourceStructure,
        row.full_translation_html,
      );
      const sourceJson = JSON.stringify(sourceStructure);
      const translationJson = JSON.stringify(validation.translation);
      const message = String(validation.message || "").trim() || null;
      update.run(sourceJson, translationJson, validation.fidelity, message, row.id);
      summary.updatedCount += 1;
      summary[validation.fidelity === "complete" ? "completeCount" : "degradedCount"] += 1;
      summary.items.push({
        paperId: row.id,
        previousFidelity: row.full_translation_fidelity || "unknown",
        fidelity: validation.fidelity,
      });
    }
    database.exec("COMMIT;");
    return summary;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
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
    ON CONFLICT(week_key, external_id) DO UPDATE SET
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
      pdf_url = excluded.pdf_url
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
    /** 已选论文同步候选目录中后来修正的来源与 PDF 地址。 */
    database
      .prepare(`
        UPDATE papers
        SET source_url = ?,
            pdf_url = COALESCE(NULLIF(TRIM(?), ''), pdf_url),
            full_translation_status = CASE
              WHEN COALESCE(TRIM(source_text), '') = ''
                AND COALESCE(TRIM(pdf_url), '') = ''
                AND COALESCE(TRIM(?), '') <> ''
              THEN 'pending'
              ELSE full_translation_status
            END,
            extraction_error = CASE
              WHEN COALESCE(TRIM(pdf_url), '') = ''
                AND COALESCE(TRIM(?), '') <> ''
              THEN NULL
              ELSE extraction_error
            END,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        candidate.source_url,
        candidate.pdf_url,
        candidate.pdf_url,
        candidate.pdf_url,
        new Date().toISOString(),
        existingWeekStatus.selected_paper_id,
      );
    /** existingPaper 是同步来源元数据后的已选论文。 */
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
    const existingIdentity = findPaperIdentityRow({ externalId: candidate.external_id, sourceUrl: candidate.source_url, pdfUrl: candidate.pdf_url });
    if (!existingIdentity) database
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
      .get(existingIdentity?.external_id || candidate.external_id);
    database.prepare("UPDATE papers SET identity_key = ? WHERE id = ?").run(
      getPaperIdentityKey({ externalId: candidate.external_id, sourceUrl: candidate.source_url, pdfUrl: candidate.pdf_url }), savedPaper.id);
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

/** 笔记数据访问已经迁移到独立仓储；旧导入路径继续由本文件兼容导出。 */
const noteStore = createNoteStore(database);
export const {
  createNoteDigest,
  createStandaloneNote,
  deleteStandaloneNote,
  getNoteLibrarySummary,
  getNoteOrganizationSettings,
  getStandaloneNote,
  listAllNotes,
  listNoteDigests,
  listReadingNotes,
  listStandaloneNotes,
  updateNoteOrganizationSettings,
  updateStandaloneNote,
} = noteStore;

/** GitHub 项目与学习统计已迁移到独立仓储；旧导入路径继续兼容导出。 */
const githubProjectStore = createGitHubProjectStore(database);
export const {
  getGitHubProject,
  getGitHubProjectStatistics,
  listGitHubProjects,
  upsertGitHubProject,
} = githubProjectStore;
const activityDashboardStore = createActivityDashboardStore(database, {
  getGitHubProjectStatistics,
  toLocalDateKey,
});
export const { getActivityDashboard } = activityDashboardStore;

/** 阅读状态、会话和批注已迁移到独立仓储；旧导入路径继续兼容导出。 */
const readingStore = createReadingStore(database, { toLocalDateKey });
export const {
  createReadingAnnotation,
  deleteReadingAnnotation,
  getReadingWorkspace,
  startReadingSession,
  updateReadingAnnotation,
  updateReadingSession,
  updateReadingState,
} = readingStore;

/**
 * 将 ISO 时间归入本机日期。统计页面按用户所在电脑的自然日展示。
 *
 * @param {string} value ISO 时间。
 * @returns {string} YYYY-MM-DD 日期键。
 */
function toLocalDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 与主记录删除位于同一事务，保证重启后仍能完成精确文件清理。 */
function enqueueKnowledgeTargetFiles(targetType, targetRow) {
  const files = [];
  if (targetType === "document") files.push(["attachment", targetRow.storedName]);
  if (targetType === "paper") {
    const safeId = String(targetRow.id).replace(/[^a-zA-Z0-9_-]/g, "_");
    files.push(["paper_pdf", `${targetRow.id}.pdf`], ["paper_chinese_pdf", `${safeId}.pdf`], ["paper_chinese_hash", `${safeId}.sha256`]);
  }
  const now = new Date().toISOString();
  const statement = database.prepare(`
    INSERT INTO pending_file_deletions(id, asset_kind, file_name, target_type, target_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(asset_kind, file_name) DO NOTHING
  `);
  for (const [kind, fileName] of files) {
    if (!fileName || path.basename(fileName) !== fileName || /[\\/:]/.test(fileName) || [".", ".."].includes(fileName)) {
      throw new Error("原始资产路径无效，已取消删除以保护本机文件。");
    }
    statement.run(`file_delete_${crypto.randomUUID()}`, kind, fileName, targetType, targetRow.id, now, now);
  }
}

export function listPendingFileDeletions() {
  return database.prepare("SELECT * FROM pending_file_deletions ORDER BY created_at, id").all().map((row) => ({
    id: row.id, assetKind: row.asset_kind, fileName: row.file_name, targetType: row.target_type,
    targetId: row.target_id, attemptCount: row.attempt_count, lastError: row.last_error,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export function completePendingFileDeletion(id) {
  database.prepare("DELETE FROM pending_file_deletions WHERE id = ?").run(String(id));
}

export function failPendingFileDeletion(id, error) {
  database.prepare("UPDATE pending_file_deletions SET attempt_count = attempt_count + 1, last_error = ?, updated_at = ? WHERE id = ?")
    .run(String(error?.message || error || "文件清理失败").slice(0, 2000), new Date().toISOString(), String(id));
}

/** 最后一次检查实时引用，保护历史重复记录和规范化名称碰撞时共享的文件。 */
export function isPendingFileStillReferenced(item) {
  if (item.assetKind === "attachment") return Boolean(database.prepare("SELECT id FROM documents WHERE stored_name = ? LIMIT 1").get(item.fileName));
  if (item.assetKind === "paper_pdf") return Boolean(database.prepare("SELECT id FROM papers WHERE id = ? LIMIT 1").get(String(item.fileName).replace(/\.pdf$/, "")));
  if (["paper_chinese_pdf", "paper_chinese_hash"].includes(item.assetKind)) {
    const stem = String(item.fileName).replace(/\.(?:pdf|sha256)$/, "");
    return database.prepare("SELECT id FROM papers").all().some((row) => String(row.id).replace(/[^a-zA-Z0-9_-]/g, "_") === stem);
  }
  return true;
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
    enqueueKnowledgeTargetFiles(normalizedType, targetRow);
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
 * 在一个数据库事务中永久删除多项知识内容。
 *
 * 调用方应在执行前完成用户确认与数据库备份，并根据返回的 storedName
 * 清理文档原始附件。任意目标不存在时整批拒绝，避免只删除一部分。
 *
 * @param {{ targetType: string, targetId: string }[]} items 待删除内容。
 * @returns {Record<string, unknown>[]} 已删除内容摘要。
 */
export function deleteKnowledgeTargets(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("请选择需要删除的内容。");
  if (items.length > 500) throw new Error("一次最多删除 500 项内容。");

  /** normalizedItems 是经过类型白名单、ID 清理和去重后的删除目标。 */
  const normalizedItems = [];
  /** seenKeys 防止同一目标在一个事务中被重复删除。 */
  const seenKeys = new Set();
  for (const item of items) {
    const normalizedType = normalizeKnowledgeTargetType(item?.targetType);
    const normalizedId = String(item?.targetId ?? "").trim();
    if (!normalizedId) throw new Error("存在无法识别的待删除内容。");
    const key = `${normalizedType}:${normalizedId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    normalizedItems.push({ targetType: normalizedType, targetId: normalizedId });
  }

  /** targets 在开始写事务前确认全部主记录存在，并保留附件定位信息。 */
  const targets = normalizedItems.map(({ targetType: normalizedType, targetId: normalizedId }) => {
    const targetRow =
      normalizedType === "document"
        ? database
            .prepare("SELECT id, title, stored_name AS storedName FROM documents WHERE id = ?")
            .get(normalizedId)
        : normalizedType === "article"
          ? database.prepare("SELECT id, title FROM articles WHERE id = ?").get(normalizedId)
          : database
              .prepare(
                `SELECT id, external_id AS externalId,
                  COALESCE(NULLIF(title_zh, ''), title) AS title
                 FROM papers WHERE id = ?`,
              )
              .get(normalizedId);
    if (!targetRow) throw new Error("部分所选内容已经不存在，请刷新后重新选择。");
    return { normalizedType, normalizedId, targetRow };
  });

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const { normalizedType, normalizedId, targetRow } of targets) {
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
      enqueueKnowledgeTargetFiles(normalizedType, targetRow);
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

  return targets.map(({ normalizedType, normalizedId, targetRow }) => ({
    targetType: normalizedType,
    targetId: normalizedId,
    ...targetRow,
  }));
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
 * 每天最多创建一次 SQLite 完整备份，并清理超期备份。
 *
 * @returns {string | null} 新建备份路径；当天已有备份时返回空值。
 */
export function createDailyBackup({ throwOnError = false } = {}) {
  try {
    return createDatabaseSnapshot(database, {
      dataDirectory, backupDirectory, kind: "daily", retentionDays: serverConfig.backupRetentionDays,
    });
  } catch (error) {
    console.error(`每日备份未完成，资料仍保留：${error.message}`);
    if (throwOnError) throw error;
    return null;
  }
}

export function createManualBackup() {
  return createDatabaseSnapshot(database, { dataDirectory, backupDirectory, kind: "manual" });
}

export function getLocalStorageStatus() {
  return getStorageStatus({ dataDirectory, backupDirectory });
}

let fullBackupPromise = null;
export function createFullKnowledgeBackup() {
  if (!fullBackupPromise) {
    fullBackupPromise = createFullBackup(database, { dataDirectory, backupDirectory })
      .finally(() => { fullBackupPromise = null; });
  }
  return fullBackupPromise;
}

/**
 * 关闭 SQLite 连接，供测试或服务退出时使用。
 *
 * @returns {void}
 */
export function closeDatabase() {
  database.close();
}
