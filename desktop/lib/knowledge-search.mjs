/**
 * 统一搜索的只读查询实现。
 * SQLite 连接由调用者传入；本模块不初始化存储、迁移或启动后台任务。
 */
const sourceDefinitions = Object.freeze({
  document: {
    table: "documents",
    title: "COALESCE(NULLIF(display_title, ''), title)",
    summary: "summary",
    matchSource: "文档正文",
    fields: ["display_title", "title", "summary", "extracted_text"],
  },
  article: {
    table: "articles",
    title: "COALESCE(NULLIF(display_title, ''), title)",
    summary: "COALESCE(NULLIF(translated_summary, ''), summary)",
    matchSource: "网页正文",
    fields: [
      "display_title", "title", "translated_title", "translated_summary",
      "summary", "translated_text", "content_text",
    ],
  },
  paper: {
    table: "papers",
    title: "COALESCE(NULLIF(title_zh, ''), title)",
    summary: "COALESCE(NULLIF(abstract_zh, ''), NULLIF(abstract, ''), curator_note, '')",
    matchSource: "论文全文",
    fields: ["title_zh", "title", "abstract_zh", "abstract", "full_translation_html", "source_text"],
  },
});

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, Math.floor(numeric)))
    : fallback;
}

/** 保留 LIKE 子串语义，同时把用户输入中的通配符和转义符视为字面文本。 */
function literalLikePattern(value) {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function likeCondition(field) {
  return `${field} LIKE $pattern ESCAPE '\\'`;
}

function targetKey(targetType, targetId) {
  return `${targetType}:${targetId}`;
}

/** 动态部分只生成参数名；资料 ID 始终通过 SQLite 绑定。 */
function bindIds(ids, bindings) {
  return ids.map((id, index) => {
    const parameter = `$id_${index}`;
    bindings[parameter] = id;
    return parameter;
  }).join(", ");
}

/** 仅从数据库读取命中附近的短片段，不把当前页完整正文带回 Node。 */
function readExcerptRows(database, querySql, bindings) {
  return database.prepare(`
    WITH matched AS (${querySql}), positioned AS (
      SELECT *, MAX(1, INSTR(LOWER(search_text), LOWER($literal)) - 55) AS excerpt_start
      FROM matched
    )
    SELECT target_type, target_id, match_source, match_field,
      SUBSTR(search_text, excerpt_start, 600) AS raw_excerpt,
      excerpt_start > 1 AS has_prefix,
      LENGTH(search_text) > excerpt_start + 599 AS has_suffix
    FROM positioned
    ORDER BY source_order ASC, updated_at DESC, target_type ASC, target_id ASC
  `).all(bindings);
}

function mapExcerpt(row, query) {
  const text = String(row.raw_excerpt || "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const matchAt = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, matchAt < 0 ? 0 : matchAt - 55);
  const length = Math.max(220, query.length + 55);
  return {
    matchSource: row.match_source,
    matchField: row.match_field,
    excerpt: `${row.has_prefix || start > 0 ? "…" : ""}${text.slice(start, start + length)}${row.has_suffix || text.length > start + length ? "…" : ""}`,
  };
}

function getPageExcerpts(database, pageRows, query, pattern) {
  const excerpts = new Map();
  for (const [targetType, definition] of Object.entries(sourceDefinitions)) {
    const ids = pageRows.filter((row) => row.target_type === targetType).map((row) => row.target_id);
    if (!ids.length) continue;
    const bindings = { $pattern: pattern, $literal: query };
    const idParameters = bindIds(ids, bindings);
    const conditions = definition.fields.map(likeCondition);
    const textCase = definition.fields.map((field, index) => `WHEN ${conditions[index]} THEN ${field}`).join(" ");
    const fieldCase = definition.fields.map((field, index) => `WHEN ${conditions[index]} THEN '${field}'`).join(" ");
    const rows = readExcerptRows(database, `
      SELECT '${targetType}' AS target_type, id AS target_id,
        '${definition.matchSource}' AS match_source,
        CASE ${fieldCase} END AS match_field,
        CASE ${textCase} END AS search_text, 0 AS source_order, updated_at
      FROM ${definition.table}
      WHERE id IN (${idParameters}) AND (${conditions.join(" OR ")})
    `, bindings);
    for (const row of rows) excerpts.set(targetKey(row.target_type, row.target_id), mapExcerpt(row, query));
  }

  const remaining = pageRows.filter((row) => !excerpts.has(targetKey(row.target_type, row.target_id)));
  if (!remaining.length) return excerpts;
  const bindings = { $pattern: pattern, $literal: query };
  const idParameters = bindIds([...new Set(remaining.map((row) => row.target_id))], bindings);
  const rows = readExcerptRows(database, `
    SELECT target_type, target_id, '阅读笔记' AS match_source, 'note_text' AS match_field,
      note_text AS search_text, 0 AS source_order, updated_at
    FROM reading_states
    WHERE target_id IN (${idParameters}) AND ${likeCondition("note_text")}
    UNION ALL
    SELECT target_type, target_id, '高亮批注',
      CASE WHEN ${likeCondition("quote_text")} THEN 'quote_text' ELSE 'note_text' END,
      CASE WHEN ${likeCondition("quote_text")} THEN quote_text ELSE note_text END,
      1, updated_at
    FROM reading_annotations
    WHERE target_id IN (${idParameters})
      AND (${likeCondition("quote_text")} OR ${likeCondition("note_text")})
  `, bindings);
  const requested = new Set(remaining.map((row) => targetKey(row.target_type, row.target_id)));
  for (const row of rows) {
    const key = targetKey(row.target_type, row.target_id);
    if (requested.has(key) && !excerpts.has(key)) excerpts.set(key, mapExcerpt(row, query));
  }
  return excerpts;
}

function getPageTags(database, pageRows) {
  const tagsByKey = new Map(pageRows.map((row) => [targetKey(row.target_type, row.target_id), []]));
  if (!pageRows.length) return tagsByKey;
  const bindings = {};
  const idParameters = bindIds([...new Set(pageRows.map((row) => row.target_id))], bindings);
  const rows = database.prepare(`
    SELECT target_type, target_id, tag_name FROM content_tags
    WHERE target_id IN (${idParameters}) ORDER BY tag_name COLLATE NOCASE
  `).all(bindings);
  for (const row of rows) tagsByKey.get(targetKey(row.target_type, row.target_id))?.push(row.tag_name);
  return tagsByKey;
}

/**
 * 跨文档、网页、论文、阅读笔记和批注进行中文/英文子串搜索。
 * @param {import('node:sqlite').DatabaseSync} database 已打开的 SQLite 连接。
 * @param {{query?:string,q?:string,targetType?:string,category?:string,tagName?:string,folderId?:string,limit?:number,offset?:number}} filters 查询与分页。
 * @returns {{results:Array<Record<string,unknown>>,total:number,hasMore:boolean,offset:number,limit:number}}
 */
export function searchKnowledgePage(database, filters = {}) {
  const query = String(filters.query ?? filters.q ?? "").trim().slice(0, 200);
  const limit = boundedInteger(filters.limit, 200, 1, 200);
  const offset = boundedInteger(filters.offset, 0, 0, 2147483647);
  if (!query) return { results: [], total: 0, hasMore: false, offset, limit };
  const targetType = String(filters.targetType ?? "").trim();
  if (targetType && !Object.hasOwn(sourceDefinitions, targetType)) throw new TypeError("不支持的知识内容类型。");
  const targetTypes = targetType ? [targetType] : Object.keys(sourceDefinitions);
  const pattern = literalLikePattern(query);
  const bindings = { $pattern: pattern };
  const typeSql = targetTypes.map((type) => `'${type}'`).join(", ");

  const candidates = targetTypes.map((type) => {
    const definition = sourceDefinitions[type];
    return `SELECT '${type}' AS target_type, id AS target_id FROM ${definition.table}
      WHERE ${definition.fields.map(likeCondition).join(" OR ")}`;
  });
  candidates.push(`SELECT target_type, target_id FROM reading_states
    WHERE target_type IN (${typeSql}) AND ${likeCondition("note_text")}`);
  candidates.push(`SELECT target_type, target_id FROM reading_annotations
    WHERE target_type IN (${typeSql}) AND (${likeCondition("quote_text")} OR ${likeCondition("note_text")})`);

  const contentSql = targetTypes.map((type) => {
    const definition = sourceDefinitions[type];
    return `SELECT '${type}' AS target_type, id AS target_id,
      ${definition.title} AS title, title AS source_title, category,
      ${definition.summary} AS summary, updated_at FROM ${definition.table}`;
  }).join(" UNION ALL ");
  const conditions = [];
  for (const [input, parameter, condition] of [
    [filters.category, "$category", "c.category = $category"],
    [filters.tagName, "$tag_name", `EXISTS (SELECT 1 FROM content_tags t
      WHERE t.target_type=c.target_type AND t.target_id=c.target_id AND t.tag_name=$tag_name)`],
    [filters.folderId, "$folder_id", `EXISTS (SELECT 1 FROM content_folders f
      WHERE f.target_type=c.target_type AND f.target_id=c.target_id AND f.folder_id=$folder_id)`],
  ]) {
    const value = String(input ?? "").trim();
    if (value) { bindings[parameter] = value; conditions.push(condition); }
  }
  const commonSql = `WITH candidate_ids AS (${candidates.join(" UNION ")}),
    content AS (${contentSql}),
    matching AS (
      SELECT c.* FROM content c JOIN candidate_ids hit
        ON hit.target_type=c.target_type AND hit.target_id=c.target_id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    )`;
  const total = Number(database.prepare(`${commonSql} SELECT COUNT(*) AS total FROM matching`).get(bindings).total);
  if (!total || offset >= total) return { results: [], total, hasMore: false, offset, limit };
  const pageRows = database.prepare(`${commonSql}
    SELECT m.*,
      (SELECT folder_id FROM content_folders f
        WHERE f.target_type=m.target_type AND f.target_id=m.target_id LIMIT 1) AS folder_id,
      (SELECT sort_order FROM content_folders f
        WHERE f.target_type=m.target_type AND f.target_id=m.target_id LIMIT 1) AS folder_sort_order,
      EXISTS(SELECT 1 FROM favorites f
        WHERE f.target_type=m.target_type AND f.target_id=m.target_id) AS is_favorite
    FROM matching m
    ORDER BY m.updated_at DESC, m.target_type ASC, m.target_id ASC
    LIMIT $limit OFFSET $offset
  `).all({ ...bindings, $limit: limit, $offset: offset });
  const excerpts = getPageExcerpts(database, pageRows, query, pattern);
  const tags = getPageTags(database, pageRows);
  const results = pageRows.map((row) => {
    const key = targetKey(row.target_type, row.target_id);
    return {
      id: row.target_id,
      targetId: row.target_id,
      targetType: row.target_type,
      title: row.title,
      sourceTitle: row.source_title,
      category: row.category,
      summary: row.summary || "",
      updatedAt: row.updated_at,
      folderId: row.folder_id || null,
      folderSortOrder: Number(row.folder_sort_order) || 0,
      isFavorite: Boolean(row.is_favorite),
      tags: tags.get(key) || [],
      ...(excerpts.get(key) || { matchSource: "正文", matchField: "", excerpt: row.summary || "" }),
    };
  });
  return { results, total, hasMore: offset + results.length < total, offset, limit };
}
