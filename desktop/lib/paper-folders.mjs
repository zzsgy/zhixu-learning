import crypto from "node:crypto";

/** 独立论文目录；不迁移、不重命名文档库目录，也不按主题猜测归属。 */
export function createPaperFolderStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_folders (
      id TEXT PRIMARY KEY, parent_id TEXT REFERENCES paper_folders(id) ON DELETE RESTRICT,
      name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS paper_folders_sibling_name
      ON paper_folders(COALESCE(parent_id, ''), name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS paper_folder_items (
      paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
      folder_id TEXT NOT NULL REFERENCES paper_folders(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS paper_folder_items_folder ON paper_folder_items(folder_id);
  `);
  const fail = (message) => { throw new Error(message); };
  function folder(id) {
    return db.prepare("SELECT * FROM paper_folders WHERE id=?").get(String(id || "")) || fail("论文目录已不存在，请刷新后重试。");
  }
  function name(value) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    if (!text || text.length > 80) fail("目录名称须为 1–80 个字符。");
    return text;
  }
  function unique(label, parentId, except = "") {
    if (db.prepare("SELECT id FROM paper_folders WHERE COALESCE(parent_id,'')=? AND name=? COLLATE NOCASE AND id<>?").get(parentId || "", label, except)) fail("同一级下已有同名论文目录。");
  }
  function list() {
    const rows = db.prepare("SELECT * FROM paper_folders ORDER BY name COLLATE NOCASE,id").all();
    const byId = new Map(rows.map(row => [row.id, row]));
    const counts = new Map(db.prepare("SELECT folder_id,COUNT(*) count FROM paper_folder_items GROUP BY folder_id").all().map(row => [row.folder_id, row.count]));
    return rows.map(row => {
      const path = [];
      let current = row;
      while (current) {
        if (path.some(part => part.id === current.id)) fail("论文目录层级存在循环，请恢复有效备份。");
        path.unshift({ id: current.id, name: current.name });
        current = byId.get(current.parent_id);
      }
      return { id: row.id, parentId: row.parent_id, name: row.name, path, directCount: counts.get(row.id) || 0 };
    }).map((row, _, all) => ({ ...row, count: all.filter(item => item.path.some(part => part.id === row.id)).reduce((sum, item) => sum + item.directCount, 0) }));
  }
  function create(input) {
    const parentId = input.parentId || null;
    if (parentId) folder(parentId);
    const label = name(input.name);
    unique(label, parentId);
    const id = `pf_${crypto.randomUUID()}`, now = new Date().toISOString();
    db.prepare("INSERT INTO paper_folders VALUES(?,?,?,?,?)").run(id, parentId, label, now, now);
    return list().find(item => item.id === id);
  }
  function update(id, input) {
    const current = folder(id);
    const parentId = Object.hasOwn(input, "parentId") ? input.parentId || null : current.parent_id;
    const label = Object.hasOwn(input, "name") ? name(input.name) : current.name;
    let ancestorId = parentId;
    while (ancestorId) {
      if (ancestorId === id) fail("不能将目录移动到自身或子目录中。");
      ancestorId = folder(ancestorId).parent_id;
    }
    unique(label, parentId, id);
    db.prepare("UPDATE paper_folders SET parent_id=?,name=?,updated_at=? WHERE id=?").run(parentId, label, new Date().toISOString(), id);
    return list().find(item => item.id === id);
  }
  function assign(ids, folderId = null) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== "string" || !id)) fail("请选择 1–1000 篇有效论文。");
    const uniqueIds = [...new Set(ids)];
    db.exec("BEGIN IMMEDIATE");
    try {
      if (folderId) folder(folderId);
      for (const id of uniqueIds) if (!db.prepare("SELECT id FROM papers WHERE id=?").get(id)) fail("所选论文已不存在，整批移动未执行，请刷新。");
      const write = db.prepare("INSERT INTO paper_folder_items VALUES(?,?,?) ON CONFLICT(paper_id) DO UPDATE SET folder_id=excluded.folder_id,updated_at=excluded.updated_at");
      const remove = db.prepare("DELETE FROM paper_folder_items WHERE paper_id=?");
      for (const id of uniqueIds) {
        if (folderId) write.run(id, folderId, new Date().toISOString());
        else remove.run(id);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return uniqueIds.length;
  }
  function remove(id) {
    folder(id);
    if (db.prepare("SELECT id FROM paper_folders WHERE parent_id=? LIMIT 1").get(id)) fail("此目录含子目录，请先移动或删除子目录。");
    db.exec("BEGIN IMMEDIATE");
    try {
      const released = db.prepare("DELETE FROM paper_folder_items WHERE folder_id=?").run(id).changes;
      db.prepare("DELETE FROM paper_folders WHERE id=?").run(id);
      db.exec("COMMIT");
      return released;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function page(options = {}, duplicateIds = []) {
    const folders = list();
    const where = [], values = [];
    if (options.folder === "unfiled") where.push("pf.folder_id IS NULL");
    else if (options.folder) {
      folder(options.folder);
      const ids = options.descendants === "0" ? [options.folder] : folders.filter(item => item.path.some(part => part.id === options.folder)).map(item => item.id);
      where.push(`pf.folder_id IN (${ids.map(() => "?").join(",")})`); values.push(...ids);
    }
    if (options.source) { where.push("p.source_type=?"); values.push(options.source); }
    const query = String(options.q || "").trim().slice(0, 300).toLowerCase();
    if (query) {
      where.push("instr(lower(COALESCE(p.title_zh,'')||' '||p.title||' '||p.authors_json||' '||COALESCE(p.abstract_zh,'')||' '||p.abstract),?)>0"); values.push(query);
    }
    if (["degraded", "unknown"].includes(options.quality)) { where.push("p.full_translation_fidelity=?"); values.push(options.quality); }
    const job = "SELECT 1 FROM import_jobs j WHERE j.target_id=p.id AND j.target_type='paper'";
    if (options.quality === "failed") where.push(`(COALESCE(p.extraction_error,'')<>'' OR p.full_translation_status='failed' OR EXISTS(${job} AND j.status='failed'))`);
    if (options.quality === "processing") where.push(`(p.full_translation_status IN ('pending','processing') OR EXISTS(${job} AND j.status IN ('queued','running')))`);
    if (options.quality === "duplicate") {
      where.push(duplicateIds.length ? `p.id IN (${duplicateIds.map(() => "?").join(",")})` : "0"); values.push(...duplicateIds);
    }
    if (options.reading === "unread") where.push("COALESCE(rs.reading_status,'unread')='unread'");
    if (["reading", "completed"].includes(options.reading)) { where.push("rs.reading_status=?"); values.push(options.reading); }
    const from = "FROM papers p LEFT JOIN paper_folder_items pf ON pf.paper_id=p.id LEFT JOIN reading_states rs ON rs.target_type='paper' AND rs.target_id=p.id";
    const condition = where.length ? " WHERE " + where.join(" AND ") : "";
    const total = db.prepare(`SELECT COUNT(*) total ${from}${condition}`).get(...values).total;
    const pageSize = 24;
    const pageNumber = Math.min(Math.max(1, Math.floor(Number(options.page) || 1)), Math.max(1, Math.ceil(total / pageSize)));
    const order = { oldest: "p.created_at ASC", published: "p.published_at DESC", title: "COALESCE(NULLIF(p.title_zh,''),p.title) COLLATE NOCASE ASC" }[options.sort] || "p.created_at DESC";
    const excluded = new Set(["source_text", "source_html", "full_translation_html", "source_structure_json", "full_translation_structure_json"]);
    const columns = db.prepare("PRAGMA table_info(papers)").all().filter(item => !excluded.has(item.name)).map(item => `p.${item.name}`).join(",");
    const rows = db.prepare(`SELECT ${columns},substr(p.full_translation_html,1,3000) full_translation_html,pf.folder_id,COALESCE(rs.reading_status,'unread') reading_status ${from}${condition} ORDER BY ${order},p.id LIMIT ? OFFSET ?`).all(...values, pageSize, (pageNumber - 1) * pageSize);
    const libraryTotal = db.prepare("SELECT COUNT(*) count FROM papers").get().count;
    const unfiledCount = db.prepare("SELECT COUNT(*) count FROM papers WHERE id NOT IN (SELECT paper_id FROM paper_folder_items)").get().count;
    return { rows, total, page: pageNumber, pageSize, libraryTotal, unfiledCount, folders };
  }
  return { list, create, update, assign, remove, page, assertFolder: id => { if (id) folder(id); } };
}
