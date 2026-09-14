/** 轻量资料列表：保留既有 FTS 查询语义，按页读取元数据。 */
const listDefinitions = {
  document: {
    table: "documents", search: "document_search", searchId: "document_id",
    columns: "id original_name stored_name mime_type extension size_bytes sha256 title display_title document_kind category category_source category_confidence summary extraction_status ocr_status ocr_error ocr_language ocr_page_count ocr_average_confidence ocr_completed_at created_at updated_at".split(" "),
  },
  article: {
    table: "articles", search: "article_search", searchId: "article_id",
    columns: "id url source_type title display_title summary category category_source category_confidence author published_at cover_image_url videos_json source_language translation_status translated_title translated_summary translation_source translated_at translation_stage translation_progress_percent translation_total_sections translation_completed_sections translation_error translation_requested_at translation_started_at word_count created_at updated_at".split(" "),
  },
};

function integer(value, fallback, minimum, maximum) {
  const number = value === null || value === undefined || value === "" ? fallback : Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}

export function listLibraryMetadataPage(database, targetType, filters = {}) {
  const definition = listDefinitions[targetType];
  if (!definition) throw new TypeError("不支持的资料列表类型。");
  const limit = integer(filters.limit, 200, 1, 200);
  const offset = integer(filters.offset, 0, 0, 2147483647);
  const bindings = {};
  const conditions = [];
  const query = String(filters.query || "").trim().slice(0, 200);
  let searchJoin = "";
  if (query) {
    const search = query.split(/\s+/).map((term) => term.replace(/["*:^()]/g, "").trim())
      .filter(Boolean).map((term) => `"${term}"*`).join(" AND ");
    if (!search) return { rows: [], total: 0, hasMore: false, offset, limit };
    searchJoin = `JOIN ${definition.search} s ON s.${definition.searchId}=content.id`;
    conditions.push(`${definition.search} MATCH $search`);
    bindings.$search = search;
  }
  const category = String(filters.category || "").trim();
  if (category) { conditions.push("content.category=$category"); bindings.$category = category; }
  const folderId = String(filters.folderId || "").trim();
  if (folderId) {
    conditions.push(`EXISTS (SELECT 1 FROM content_folders f WHERE f.target_type='${targetType}' AND f.target_id=content.id AND f.folder_id=$folder)`);
    bindings.$folder = folderId;
  }
  const from = `FROM ${definition.table} content ${searchJoin} ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`;
  const total = Number(database.prepare(`SELECT COUNT(*) AS total ${from}`).get(bindings).total);
  if (!total || offset >= total) return { rows: [], total, hasMore: false, offset, limit };
  const rows = database.prepare(`
    SELECT ${definition.columns.map((name) => `content.${name}`).join(", ")},
      (SELECT f.folder_id FROM content_folders f WHERE f.target_type='${targetType}' AND f.target_id=content.id) AS folder_id,
      (SELECT f.sort_order FROM content_folders f WHERE f.target_type='${targetType}' AND f.target_id=content.id) AS folder_sort_order,
      EXISTS(SELECT 1 FROM favorites f WHERE f.target_type='${targetType}' AND f.target_id=content.id) AS is_favorite
    ${from}
    ORDER BY ${query ? "rank, " : ""}content.updated_at DESC, content.id ASC
    LIMIT $limit OFFSET $offset
  `).all({ ...bindings, $limit: limit, $offset: offset });
  const tagBindings = {};
  const parameters = rows.map((row, index) => { tagBindings[`$id${index}`] = row.id; return `$id${index}`; });
  const tags = database.prepare(`SELECT target_id,tag_name FROM content_tags
    WHERE target_type='${targetType}' AND target_id IN (${parameters.join(",")}) ORDER BY tag_name COLLATE NOCASE`)
    .all(tagBindings);
  const byId = new Map(rows.map((row) => [row.id, { ...row, tags: [] }]));
  for (const tag of tags) byId.get(tag.target_id)?.tags.push(tag.tag_name);
  return { rows: [...byId.values()], total, hasMore: offset + rows.length < total, offset, limit };
}

/** 任务位置按目标ID精确读取，和列表页大小无关。 */
export function listTargetLocations(database, targets = []) {
  const result = new Map();
  for (const targetType of ["document", "article"]) {
    const ids = [...new Set(targets.filter((target) => target.targetType === targetType)
      .map((target) => String(target.targetId || "")).filter(Boolean))];
    for (let start = 0; start < ids.length; start += 200) {
      const batch = ids.slice(start, start + 200);
      const placeholders = batch.map(() => "?").join(",");
      const rows = database.prepare(`SELECT target_id,folder_id FROM content_folders
        WHERE target_type=? AND target_id IN (${placeholders})`).all(targetType, ...batch);
      for (const row of rows) result.set(`${targetType}:${row.target_id}`, { id: row.target_id, folderId: row.folder_id });
    }
  }
  return result;
}
