/** 学习专题及专题内容关联的数据访问。 */
import crypto from "node:crypto";

/** 使用共享 SQLite 连接和内容组织能力创建专题仓储。 */
export function createTopicStore(database, {
  currentTimestamp = () => new Date().toISOString(),
  getKnowledgeTargetSummary,
  listContentTags,
  normalizeKnowledgeTargetType,
}) {
  /** 获取全部专题及内容数量。 */
  function listTopics() {
    return database.prepare(`
      SELECT t.*, COUNT(ti.target_id) AS item_count
      FROM topics AS t LEFT JOIN topic_items AS ti ON ti.topic_id = t.id
      GROUP BY t.id ORDER BY t.updated_at DESC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      itemCount: Number(row.item_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** 创建一个学习专题。 */
  function createTopic(topic) {
    const topicName = String(topic.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!topicName) throw new Error("专题名称不能为空。");
    const description = String(topic.description ?? "").trim().slice(0, 2000);
    const topicId = `topic_${crypto.randomUUID()}`;
    const now = currentTimestamp();
    database.prepare(`
      INSERT INTO topics(id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(topicId, topicName, description, now, now);
    return listTopics().find((item) => item.id === topicId);
  }

  /** 读取专题中的全部内容摘要。 */
  function listTopicItems(topicId) {
    const itemRows = database.prepare(`
      SELECT target_type, target_id, created_at FROM topic_items
      WHERE topic_id = ? ORDER BY created_at DESC
    `).all(String(topicId ?? ""));
    return itemRows.map((row) => {
      const summary = getKnowledgeTargetSummary(row.target_type, row.target_id);
      return summary ? {
        ...summary,
        tags: listContentTags(row.target_type, row.target_id),
        addedAt: row.created_at,
      } : null;
    }).filter(Boolean);
  }

  /** 向专题加入一项内容。 */
  function addTopicItem(topicId, targetType, targetId) {
    const normalizedType = normalizeKnowledgeTargetType(targetType);
    const normalizedTopicId = String(topicId ?? "").trim();
    if (!database.prepare("SELECT id FROM topics WHERE id = ?").get(normalizedTopicId)) {
      throw new Error("找不到专题。");
    }
    if (!getKnowledgeTargetSummary(normalizedType, targetId)) throw new Error("找不到对应内容。");
    const now = currentTimestamp();
    database.prepare(`
      INSERT OR IGNORE INTO topic_items(topic_id, target_type, target_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(normalizedTopicId, normalizedType, String(targetId), now);
    database.prepare("UPDATE topics SET updated_at = ? WHERE id = ?").run(now, normalizedTopicId);
    return listTopicItems(normalizedTopicId);
  }

  /** 从专题中移除一项内容。 */
  function removeTopicItem(topicId, targetType, targetId) {
    const normalizedType = normalizeKnowledgeTargetType(targetType);
    database.prepare(`
      DELETE FROM topic_items WHERE topic_id = ? AND target_type = ? AND target_id = ?
    `).run(String(topicId ?? ""), normalizedType, String(targetId ?? ""));
    database.prepare("UPDATE topics SET updated_at = ? WHERE id = ?")
      .run(currentTimestamp(), String(topicId ?? ""));
    return listTopicItems(topicId);
  }

  return Object.freeze({
    addTopicItem,
    createTopic,
    listTopicItems,
    listTopics,
    removeTopicItem,
  });
}
