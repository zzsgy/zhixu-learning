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
  ["extraction_error", "TEXT"],
]);
for (const [columnName, columnDefinition] of paperLibraryColumns) {
  ensureTableColumn("papers", columnName, columnDefinition);
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
    isFavorite: Boolean(row.is_favorite),
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
    wordCount: row.word_count,
    isFavorite: Boolean(row.is_favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
          content_html, content_text, word_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    return document;
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
  database
    .prepare(`
      UPDATE papers
      SET source_text = ?, source_text_word_count = ?,
          full_translation_status = 'pending', extraction_error = NULL,
          updated_at = ?
      WHERE id = ?
    `)
    .run(sourceText, wordCount, updatedAt, paperId);
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
      ORDER BY created_at ASC
      LIMIT ?
    `)
    .all(safeLimit);
  return rows.map(mapPaperRow);
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
          updated_at = ?
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
      id, week_key, external_id, title, abstract, authors_json, category,
      published_at, source_url, pdf_url, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
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
  database.exec("BEGIN IMMEDIATE;");
  try {
    database
      .prepare(`
        INSERT INTO papers (
          id, external_id, title, abstract, title_zh, abstract_zh,
          translation_source, translated_at, authors_json, category,
          published_at, source_url, pdf_url, source_type, source_label,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'weekly',
          '每周精选', ?, ?)
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
