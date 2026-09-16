/** 知识库目录、内容归档位置和标签的数据访问。 */
import crypto from "node:crypto";

/** 使用进程内共享 SQLite 连接创建内容组织仓储。 */
export function createContentOrganizationStore(database, {
  currentTimestamp = () => new Date().toISOString(),
} = {}) {
  const knowledgeTargetTypes = new Set(["document", "article", "paper"]);

  /** 验证知识内容类型。 */
  function normalizeKnowledgeTargetType(targetType) {
    const normalizedType = String(targetType ?? "").trim();
    if (!knowledgeTargetTypes.has(normalizedType)) throw new Error("不支持的内容类型。");
    return normalizedType;
  }

  /** 在同一父目录下查找或创建文件夹。 */
  function ensureFolder(parentId, name, sortOrder = 0) {
    const normalizedName = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!normalizedName) throw new Error("文件夹名称不能为空。");
    const existingFolder = parentId
      ? database.prepare("SELECT * FROM folders WHERE parent_id = ? AND name = ? LIMIT 1").get(parentId, normalizedName)
      : database.prepare("SELECT * FROM folders WHERE parent_id IS NULL AND name = ? LIMIT 1").get(normalizedName);
    if (existingFolder) return existingFolder;
    const now = currentTimestamp();
    const folderId = `folder_${crypto.randomUUID()}`;
    database.prepare(`
      INSERT INTO folders(id, parent_id, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(folderId, parentId, normalizedName, Number(sortOrder) || 0, now, now);
    return database.prepare("SELECT * FROM folders WHERE id = ?").get(folderId);
  }

  /** 清理用户输入的标签名称。 */
  function normalizeTagName(value) {
    const tagName = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!tagName) throw new Error("标签名称不能为空。");
    return tagName;
  }

  /** 读取某项内容的通用摘要信息。 */
  function getKnowledgeTargetSummary(targetType, targetId) {
    const normalizedType = normalizeKnowledgeTargetType(targetType);
    const normalizedId = String(targetId ?? "").trim();
    if (!normalizedId) return null;
    if (normalizedType === "document") {
      const row = database.prepare(`
        SELECT id, COALESCE(NULLIF(display_title, ''), title) AS title,
          title AS source_title, category, summary, updated_at
        FROM documents WHERE id = ? LIMIT 1
      `).get(normalizedId);
      return row ? {
        id: row.id,
        targetType: normalizedType,
        targetId: row.id,
        title: row.title,
        sourceTitle: row.source_title,
        category: row.category,
        summary: row.summary,
        updatedAt: row.updated_at,
      } : null;
    }
    if (normalizedType === "article") {
      const row = database.prepare(`
        SELECT id, COALESCE(NULLIF(display_title, ''), title) AS title, title AS source_title, category,
          COALESCE(NULLIF(translated_summary, ''), summary) AS summary,
          updated_at
        FROM articles WHERE id = ? LIMIT 1
      `).get(normalizedId);
      return row ? {
        id: row.id,
        targetType: normalizedType,
        targetId: row.id,
        title: row.title,
        sourceTitle: row.source_title,
        category: row.category,
        summary: row.summary,
        updatedAt: row.updated_at,
      } : null;
    }
    const row = database.prepare(`
      SELECT id, COALESCE(NULLIF(title_zh, ''), title) AS display_title,
        category, COALESCE(NULLIF(abstract_zh, ''), abstract, curator_note, '') AS display_summary,
        updated_at FROM papers WHERE id = ? LIMIT 1
    `).get(normalizedId);
    return row ? {
      targetType: normalizedType,
      targetId: row.id,
      title: row.display_title,
      category: row.category,
      summary: row.display_summary,
      updatedAt: row.updated_at,
    } : null;
  }

  /** 获取某项内容的全部标签。 */
  function listContentTags(targetType, targetId) {
    const normalizedType = normalizeKnowledgeTargetType(targetType);
    return database.prepare(`
      SELECT tag_name FROM content_tags
      WHERE target_type = ? AND target_id = ?
      ORDER BY tag_name COLLATE NOCASE
    `).all(normalizedType, String(targetId ?? "")).map((row) => row.tag_name);
  }

  /** 获取知识库标签及其使用次数。 */
  function listTags() {
    return database.prepare(`
      SELECT t.name, COUNT(ct.target_id) AS item_count
      FROM tags AS t LEFT JOIN content_tags AS ct ON ct.tag_name = t.name
      GROUP BY t.name ORDER BY item_count DESC, t.name COLLATE NOCASE
    `).all().map((row) => ({ name: row.name, itemCount: Number(row.item_count) }));
  }

  /** 为内容添加标签。 */
  function addContentTag(targetType, targetId, rawTagName) {
    const normalizedType = normalizeKnowledgeTargetType(targetType);
    const normalizedId = String(targetId ?? "").trim();
    if (!getKnowledgeTargetSummary(normalizedType, normalizedId)) throw new Error("找不到对应内容。");
    const tagName = normalizeTagName(rawTagName);
    const createdAt = currentTimestamp();
    database.prepare("INSERT OR IGNORE INTO tags(name, created_at) VALUES (?, ?)").run(tagName, createdAt);
    database.prepare(`
      INSERT OR IGNORE INTO content_tags(target_type, target_id, tag_name, created_at)
      VALUES (?, ?, ?, ?)
    `).run(normalizedType, normalizedId, tagName, createdAt);
    return listContentTags(normalizedType, normalizedId);
  }

  /** 移除内容与标签之间的关联，并清理不再使用的标签。 */
  function removeContentTag(targetType, targetId, rawTagName) {
    const normalizedType = normalizeKnowledgeTargetType(targetType);
    const tagName = normalizeTagName(rawTagName);
    database.prepare(`
      DELETE FROM content_tags WHERE target_type = ? AND target_id = ? AND tag_name = ?
    `).run(normalizedType, String(targetId ?? ""), tagName);
    database.prepare(`DELETE FROM tags WHERE name = ? AND NOT EXISTS(
      SELECT 1 FROM content_tags WHERE tag_name = ?
    )`).run(tagName, tagName);
    return listContentTags(normalizedType, targetId);
  }

  /** 按名称依次创建或复用一条树形文件夹路径。 */
  function ensureFolderPath(pathNames, sortOrders = [], rootParentId = null) {
    if (!Array.isArray(pathNames) || pathNames.length === 0) throw new Error("文件夹路径不能为空。");
    let parentId = String(rootParentId || "").trim() || null;
    if (parentId && !database.prepare("SELECT id FROM folders WHERE id = ?").get(parentId)) {
      throw new Error("找不到指定的知识库目录。");
    }
    const folders = [];
    for (const [pathIndex, pathName] of pathNames.entries()) {
      const folder = ensureFolder(
        parentId,
        pathName,
        Number.isFinite(Number(sortOrders[pathIndex])) ? Number(sortOrders[pathIndex]) : pathIndex,
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

  /** 返回全部文件夹、层级路径和直接/累计内容数量。 */
  function listFolders() {
    const rows = database.prepare(`
      SELECT * FROM folders ORDER BY sort_order ASC, name COLLATE NOCASE ASC
    `).all();
    const directCounts = new Map(
      database.prepare(`
        SELECT folder_id, COUNT(*) AS item_count
        FROM content_folders GROUP BY folder_id
      `).all().map((row) => [row.folder_id, Number(row.item_count) || 0]),
    );
    const childrenByParent = new Map();
    for (const row of rows) {
      const parentKey = row.parent_id || "";
      if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
      childrenByParent.get(parentKey).push(row.id);
    }
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const totalCountCache = new Map();
    function totalCount(folderId) {
      if (totalCountCache.has(folderId)) return totalCountCache.get(folderId);
      let count = directCounts.get(folderId) || 0;
      for (const childId of childrenByParent.get(folderId) || []) count += totalCount(childId);
      totalCountCache.set(folderId, count);
      return count;
    }
    function buildPath(row) {
      const pathItems = [];
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

  /** 创建用户指定的新文件夹。 */
  function createFolder(input) {
    const parentId = String(input.parentId || "").trim() || null;
    if (parentId && !database.prepare("SELECT id FROM folders WHERE id = ?").get(parentId)) {
      throw new Error("找不到父文件夹。");
    }
    const beforeIds = new Set(listFolders().map((folder) => folder.id));
    const folderRow = ensureFolder(parentId, input.name, 0);
    if (beforeIds.has(folderRow.id)) throw new Error("当前目录下已存在同名文件夹。");
    return listFolders().find((folder) => folder.id === folderRow.id);
  }

  /** 修改文件夹名称。 */
  function renameFolder(folderId, name) {
    const folder = database.prepare("SELECT * FROM folders WHERE id = ?").get(String(folderId || ""));
    if (!folder) throw new Error("找不到文件夹。");
    const normalizedName = String(name || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!normalizedName) throw new Error("文件夹名称不能为空。");
    database.prepare("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?")
      .run(normalizedName, currentTimestamp(), folder.id);
    return listFolders().find((item) => item.id === folder.id);
  }

  /** 把一个文件夹及其整棵子树移动到新的父目录。 */
  function moveFolder(folderId, parentId = null) {
    const normalizedFolderId = String(folderId || "").trim();
    const normalizedParentId = String(parentId || "").trim() || null;
    const folder = database.prepare("SELECT * FROM folders WHERE id = ?").get(normalizedFolderId);
    if (!folder) throw new Error("找不到需要移动的文件夹。");
    if ((folder.parent_id || null) === normalizedParentId) {
      return listFolders().find((item) => item.id === folder.id);
    }
    if (normalizedParentId === normalizedFolderId) throw new Error("不能把文件夹移动到自身下面。");
    if (normalizedParentId) {
      const parentFolder = database.prepare("SELECT * FROM folders WHERE id = ?").get(normalizedParentId);
      if (!parentFolder) throw new Error("找不到目标文件夹。");
      let ancestorId = normalizedParentId;
      while (ancestorId) {
        if (ancestorId === normalizedFolderId) throw new Error("不能把文件夹移动到自己的子目录中。");
        const ancestor = database.prepare("SELECT parent_id FROM folders WHERE id = ?").get(ancestorId);
        ancestorId = ancestor?.parent_id || null;
      }
    }
    const duplicate = normalizedParentId
      ? database.prepare(`
          SELECT id FROM folders WHERE parent_id = ? AND name = ? AND id <> ? LIMIT 1
        `).get(normalizedParentId, folder.name, normalizedFolderId)
      : database.prepare(`
          SELECT id FROM folders WHERE parent_id IS NULL AND name = ? AND id <> ? LIMIT 1
        `).get(folder.name, normalizedFolderId);
    if (duplicate) throw new Error("目标目录下已存在同名文件夹。");
    database.prepare("UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?")
      .run(normalizedParentId, currentTimestamp(), normalizedFolderId);
    return listFolders().find((item) => item.id === normalizedFolderId);
  }

  /** 将一项内容移动到指定文件夹；每项内容只有一个主要位置。 */
  function assignContentToFolder(targetType, targetId, folderId, sortOrder = 0) {
    const normalizedType = normalizeKnowledgeTargetType(targetType);
    const normalizedTargetId = String(targetId || "").trim();
    const normalizedFolderId = String(folderId || "").trim();
    const normalizedSortOrder = Math.max(0, Math.round(Number(sortOrder) || 0));
    if (!getKnowledgeTargetSummary(normalizedType, normalizedTargetId)) throw new Error("找不到对应内容。");
    if (!database.prepare("SELECT id FROM folders WHERE id = ?").get(normalizedFolderId)) {
      throw new Error("找不到目标文件夹。");
    }
    const now = currentTimestamp();
    database.prepare(`
      INSERT INTO content_folders(
        target_type, target_id, folder_id, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_type, target_id) DO UPDATE SET
        folder_id = excluded.folder_id,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run(normalizedType, normalizedTargetId, normalizedFolderId, normalizedSortOrder, now, now);
    return {
      targetType: normalizedType,
      targetId: normalizedTargetId,
      folderId: normalizedFolderId,
      sortOrder: normalizedSortOrder,
    };
  }

  /** 原子地把多项知识内容移动到同一文件夹。 */
  function assignContentsToFolder(items, folderId) {
    const normalizedFolderId = String(folderId || "").trim();
    if (!database.prepare("SELECT id FROM folders WHERE id = ?").get(normalizedFolderId)) {
      throw new Error("找不到目标文件夹。");
    }
    const normalizedItems = (Array.isArray(items) ? items : []).map((item) => ({
      targetType: normalizeKnowledgeTargetType(item?.targetType),
      targetId: String(item?.targetId || "").trim(),
    }));
    if (normalizedItems.length === 0) throw new Error("请选择需要移动的内容。");
    if (normalizedItems.length > 1000) throw new Error("一次最多移动 1000 项内容。");
    const uniqueItems = [...new Map(
      normalizedItems.map((item) => [`${item.targetType}:${item.targetId}`, item]),
    ).values()];
    for (const item of uniqueItems) {
      if (!getKnowledgeTargetSummary(item.targetType, item.targetId)) {
        throw new Error("待移动内容中有项目已不存在，请刷新后重试。");
      }
    }
    const now = currentTimestamp();
    const statement = database.prepare(`
      INSERT INTO content_folders(
        target_type, target_id, folder_id, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, 0, ?, ?)
      ON CONFLICT(target_type, target_id) DO UPDATE SET
        folder_id = excluded.folder_id,
        sort_order = 0,
        updated_at = excluded.updated_at
    `);
    database.exec("BEGIN IMMEDIATE;");
    try {
      for (const item of uniqueItems) {
        statement.run(item.targetType, item.targetId, normalizedFolderId, now, now);
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
    return uniqueItems.map((item) => ({ ...item, folderId: normalizedFolderId, sortOrder: 0 }));
  }

  /** 删除一个完全空的文件夹，避免误删其中内容。 */
  function deleteEmptyFolder(folderId) {
    const normalizedFolderId = String(folderId || "").trim();
    const folder = listFolders().find((item) => item.id === normalizedFolderId);
    if (!folder) throw new Error("找不到文件夹。");
    if (folder.childCount > 0 || folder.directItemCount > 0) {
      throw new Error("文件夹中仍有子文件夹或内容，请先移动后再删除。");
    }
    return database.prepare("DELETE FROM folders WHERE id = ?").run(normalizedFolderId).changes > 0;
  }

  /** 读取一项内容所属的标签和专题。 */
  function getContentOrganization(targetType, targetId) {
    const summary = getKnowledgeTargetSummary(targetType, targetId);
    if (!summary) return null;
    const topicRows = database.prepare(`
      SELECT t.id, t.name FROM topic_items AS ti
      JOIN topics AS t ON t.id = ti.topic_id
      WHERE ti.target_type = ? AND ti.target_id = ? ORDER BY t.name COLLATE NOCASE
    `).all(summary.targetType, summary.targetId);
    return { tags: listContentTags(summary.targetType, summary.targetId), topics: topicRows };
  }

  return Object.freeze({
    addContentTag,
    assignContentToFolder,
    assignContentsToFolder,
    createFolder,
    deleteEmptyFolder,
    ensureFolder,
    ensureFolderPath,
    getContentOrganization,
    getKnowledgeTargetSummary,
    listContentTags,
    listFolders,
    listTags,
    moveFolder,
    normalizeKnowledgeTargetType,
    removeContentTag,
    renameFolder,
  });
}
