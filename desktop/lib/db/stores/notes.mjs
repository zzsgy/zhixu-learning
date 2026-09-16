/** 笔记库、独立笔记与本地整理结果的数据访问。 */
import crypto from "node:crypto";
import { normalizeStandaloneNoteContent } from "../../note-content.mjs";

const standaloneNoteTypes = new Set(["markdown", "text", "word"]);

function normalizeStandaloneNoteType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!standaloneNoteTypes.has(type)) throw new TypeError("不支持这种笔记类型。");
  return type;
}

function standaloneNoteTitle(type) {
  return {
    markdown: "未命名 Markdown 笔记",
    text: "未命名纯文本笔记",
    word: "未命名 Word 笔记",
  }[type];
}

function mapStandaloneNote(row) {
  if (!row) return null;
  let contentData = {};
  try {
    contentData = JSON.parse(row.content_json || "{}");
  } catch {}
  return {
    id: row.id,
    targetType: "standalone",
    targetId: row.id,
    noteType: row.note_type,
    title: row.title || standaloneNoteTitle(row.note_type),
    category: "独立笔记",
    noteText: row.content_text || "",
    contentText: row.content_text || "",
    contentData,
    annotationCount: 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 用共享 SQLite 连接创建笔记仓储。仓储本身不创建连接，也不执行表结构迁移。
 *
 * @param {import("node:sqlite").DatabaseSync} database 进程内唯一数据库连接。
 */
export function createNoteStore(database) {
  function listReadingNotes({ query = "", targetType = "", updatedAfter = "", limit = 100, offset = 0 } = {}) {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase("zh-CN");
    const normalizedType = ["document", "article", "paper"].includes(targetType) ? targetType : "";
    const safeLimit = Math.min(5000, Math.max(1, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const rows = database.prepare(`
      SELECT rs.target_type, rs.target_id, rs.note_text, rs.note_html, rs.updated_at,
        CASE rs.target_type
          WHEN 'document' THEN COALESCE(NULLIF(d.display_title, ''), d.title)
          WHEN 'article' THEN COALESCE(NULLIF(a.display_title, ''), NULLIF(a.translated_title, ''), a.title)
          WHEN 'paper' THEN COALESCE(NULLIF(p.title_zh, ''), p.title)
        END AS title,
        CASE rs.target_type
          WHEN 'document' THEN d.category
          WHEN 'article' THEN a.category
          WHEN 'paper' THEN p.category
        END AS category,
        (SELECT COUNT(*) FROM reading_annotations ra
          WHERE ra.target_type = rs.target_type AND ra.target_id = rs.target_id
            AND (TRIM(ra.quote_text) <> '' OR TRIM(ra.note_text) <> '')) AS annotation_count
      FROM reading_states rs
      LEFT JOIN documents d ON rs.target_type = 'document' AND rs.target_id = d.id
      LEFT JOIN articles a ON rs.target_type = 'article' AND rs.target_id = a.id
      LEFT JOIN papers p ON rs.target_type = 'paper' AND rs.target_id = p.id
      WHERE TRIM(rs.note_text) <> ''
        AND (d.id IS NOT NULL OR a.id IS NOT NULL OR p.id IS NOT NULL)
        AND (? = '' OR rs.target_type = ?)
        AND (? = '' OR rs.updated_at > ?)
        AND (? = '' OR LOWER(rs.note_text || ' ' || COALESCE(
          CASE rs.target_type
            WHEN 'document' THEN COALESCE(NULLIF(d.display_title, ''), d.title)
            WHEN 'article' THEN COALESCE(NULLIF(a.display_title, ''), NULLIF(a.translated_title, ''), a.title)
            WHEN 'paper' THEN COALESCE(NULLIF(p.title_zh, ''), p.title)
          END, '') || ' ' || COALESCE(
          CASE rs.target_type WHEN 'document' THEN d.category WHEN 'article' THEN a.category WHEN 'paper' THEN p.category END, ''
        )) LIKE ?)
      ORDER BY rs.updated_at DESC, rs.target_id
    `).all(
      normalizedType,
      normalizedType,
      String(updatedAfter || ""),
      String(updatedAfter || ""),
      normalizedQuery,
      `%${normalizedQuery}%`,
    );
    const items = rows.slice(safeOffset, safeOffset + safeLimit).map((row) => ({
      targetType: row.target_type,
      targetId: row.target_id,
      title: row.title || "未命名资料",
      category: row.category || "未分类",
      noteText: row.note_text,
      noteHtml: row.note_html || "",
      annotationCount: Number(row.annotation_count) || 0,
      updatedAt: row.updated_at,
    }));
    return { items, total: rows.length, hasMore: safeOffset + items.length < rows.length };
  }

  function getStandaloneNote(id) {
    return mapStandaloneNote(
      database.prepare("SELECT * FROM standalone_notes WHERE id = ? LIMIT 1").get(String(id || "")),
    );
  }

  function createStandaloneNote(noteType) {
    const type = normalizeStandaloneNoteType(noteType);
    const id = `note_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const contentText = type === "markdown" ? "# 新笔记\n\n" : "";
    const contentData = type === "word" ? { html: "<p><br></p>" } : {};
    database.prepare(`
      INSERT INTO standalone_notes(id, note_type, title, content_text, content_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, standaloneNoteTitle(type), contentText, JSON.stringify(contentData), now, now);
    return getStandaloneNote(id);
  }

  function updateStandaloneNote(id, changes = {}) {
    const current = getStandaloneNote(id);
    if (!current) return null;
    const safeChanges = current.noteType === "word" && changes.contentData !== undefined
      ? { ...changes, ...normalizeStandaloneNoteContent(current.noteType, changes) }
      : changes;
    const title = safeChanges.title === undefined
      ? current.title
      : String(safeChanges.title || "").replace(/\s+/g, " ").trim().slice(0, 240) || standaloneNoteTitle(current.noteType);
    const contentText = safeChanges.contentText === undefined
      ? current.contentText
      : String(safeChanges.contentText || "").slice(0, 2_000_000);
    const contentData = safeChanges.contentData === undefined
      ? current.contentData
      : safeChanges.contentData && typeof safeChanges.contentData === "object" && !Array.isArray(safeChanges.contentData)
        ? safeChanges.contentData
        : {};
    const serialized = JSON.stringify(contentData);
    if (Buffer.byteLength(serialized, "utf8") > 2_000_000) throw new TypeError("笔记结构数据过大。");
    const updatedAt = new Date().toISOString();
    database.prepare(`UPDATE standalone_notes
      SET title = ?, content_text = ?, content_json = ?, updated_at = ? WHERE id = ?`)
      .run(title, contentText, serialized, updatedAt, current.id);
    return getStandaloneNote(current.id);
  }

  function deleteStandaloneNote(id) {
    return Number(database.prepare("DELETE FROM standalone_notes WHERE id = ?").run(String(id || "")).changes) > 0;
  }

  function listStandaloneNotes({ query = "", noteType = "", updatedAfter = "", limit = 100, offset = 0 } = {}) {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase("zh-CN");
    const normalizedType = standaloneNoteTypes.has(noteType) ? noteType : "";
    const safeLimit = Math.min(5000, Math.max(1, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const rows = database.prepare(`SELECT * FROM standalone_notes
      WHERE note_type IN ('markdown', 'text', 'word')
        AND (? = '' OR note_type = ?)
        AND (? = '' OR updated_at > ?)
        AND (? = '' OR LOWER(title || ' ' || content_text) LIKE ?)
      ORDER BY updated_at DESC, id`).all(
      normalizedType,
      normalizedType,
      String(updatedAfter || ""),
      String(updatedAfter || ""),
      normalizedQuery,
      `%${normalizedQuery}%`,
    );
    const items = rows.slice(safeOffset, safeOffset + safeLimit).map(mapStandaloneNote);
    return { items, total: rows.length, hasMore: safeOffset + items.length < rows.length };
  }

  function listAllNotes({ query = "", targetType = "", updatedAfter = "", limit = 100, offset = 0 } = {}) {
    const isReadingFilter = ["document", "article", "paper"].includes(targetType);
    const isStandaloneFilter = standaloneNoteTypes.has(targetType);
    const readingItems = isStandaloneFilter ? [] : listReadingNotes({
      query,
      targetType: isReadingFilter ? targetType : "",
      updatedAfter,
      limit: 5000,
    }).items;
    const standaloneItems = isReadingFilter ? [] : listStandaloneNotes({
      query,
      noteType: isStandaloneFilter ? targetType : "",
      updatedAfter,
      limit: 5000,
    }).items;
    const rows = [...readingItems, ...standaloneItems]
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))
        || left.targetId.localeCompare(right.targetId));
    const safeLimit = Math.min(5000, Math.max(1, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const items = rows.slice(safeOffset, safeOffset + safeLimit);
    return { items, total: rows.length, hasMore: safeOffset + items.length < rows.length };
  }

  function getNoteLibrarySummary() {
    const reading = database.prepare(`
      SELECT COUNT(*) AS note_count, COUNT(DISTINCT target_type || ':' || target_id) AS source_count,
        MAX(updated_at) AS latest_note_at
      FROM reading_states WHERE TRIM(note_text) <> ''
    `).get();
    const standalone = database.prepare(`SELECT COUNT(*) AS note_count, MAX(updated_at) AS latest_note_at
      FROM standalone_notes WHERE note_type IN ('markdown', 'text', 'word')`).get();
    const digest = database.prepare("SELECT created_at FROM note_digests ORDER BY created_at DESC LIMIT 1").get();
    const latestNoteAt = [reading?.latest_note_at, standalone?.latest_note_at].filter(Boolean).sort().at(-1) || null;
    return {
      noteCount: (Number(reading?.note_count) || 0) + (Number(standalone?.note_count) || 0),
      sourceCount: (Number(reading?.source_count) || 0) + (Number(standalone?.note_count) || 0),
      latestNoteAt,
      lastOrganizedAt: digest?.created_at || null,
    };
  }

  function getNoteOrganizationSettings() {
    const row = database.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get("notes.organization.schedule");
    const defaults = {
      enabled: true,
      frequency: "weekly",
      weekday: 0,
      time: "21:00",
      lastRunAt: null,
      nextRunAt: null,
    };
    try {
      const saved = JSON.parse(row?.value || "{}");
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  }

  function updateNoteOrganizationSettings(changes = {}) {
    const current = getNoteOrganizationSettings();
    const frequency = ["daily", "weekly"].includes(changes.frequency) ? changes.frequency : current.frequency;
    const weekday = Math.min(6, Math.max(0, Number(changes.weekday ?? current.weekday) || 0));
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(changes.time || ""))
      ? String(changes.time)
      : current.time;
    const next = {
      enabled: changes.enabled === undefined ? Boolean(current.enabled) : Boolean(changes.enabled),
      frequency,
      weekday,
      time,
      lastRunAt: changes.lastRunAt === undefined ? current.lastRunAt : changes.lastRunAt,
      nextRunAt: changes.nextRunAt === undefined ? current.nextRunAt : changes.nextRunAt,
    };
    database.prepare(`INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run("notes.organization.schedule", JSON.stringify(next), new Date().toISOString());
    return next;
  }

  function createNoteDigest({ periodStart = null, periodEnd, notes, digest }) {
    const createdAt = new Date().toISOString();
    const id = `note_digest_${crypto.randomUUID()}`;
    const sourceCount = new Set(notes.map((item) => `${item.targetType}:${item.targetId}`)).size;
    database.prepare(`
      INSERT INTO note_digests(id, period_start, period_end, note_count, source_count, digest_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, periodStart, periodEnd, notes.length, sourceCount, JSON.stringify(digest), createdAt);
    return { id, periodStart, periodEnd, noteCount: notes.length, sourceCount, digest, createdAt };
  }

  function listNoteDigests(limit = 12) {
    return database.prepare("SELECT * FROM note_digests ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(100, Math.max(1, Number(limit) || 12)))
      .map((row) => {
        let digest = {};
        try {
          digest = JSON.parse(row.digest_json || "{}");
        } catch {}
        return {
          id: row.id,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          noteCount: Number(row.note_count) || 0,
          sourceCount: Number(row.source_count) || 0,
          digest,
          createdAt: row.created_at,
        };
      });
  }

  return Object.freeze({
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
  });
}
