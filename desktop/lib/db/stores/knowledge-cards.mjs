/** 带来源锚点和间隔重复调度的知识卡片数据访问。 */
import crypto from "node:crypto";

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

/** 使用共享 SQLite 连接和内容摘要能力创建知识卡片仓储。 */
export function createKnowledgeCardStore(database, {
  currentDate = () => new Date(),
  getKnowledgeTargetSummary,
  normalizeKnowledgeTargetType,
}) {
  /** 把数据库卡片行转换为前端字段，并补充来源标题。 */
  function mapKnowledgeCardRow(row) {
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

  /** 列出全部卡片或截至当前时间需要复习的卡片。 */
  function listKnowledgeCards(filters = {}) {
    const dueOnly = Boolean(filters.dueOnly);
    const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), 2000);
    const rows = database.prepare(`
      SELECT * FROM knowledge_cards
      WHERE (? = 0 OR due_at <= ?)
      ORDER BY due_at ASC, updated_at DESC
      LIMIT ?
    `).all(dueOnly ? 1 : 0, currentDate().toISOString(), limit);
    return rows.map(mapKnowledgeCardRow);
  }

  /** 创建一张带原文来源和字符锚点的知识卡片。 */
  function createKnowledgeCard(card) {
    const targetType = normalizeKnowledgeTargetType(card.targetType);
    const targetId = String(card.targetId ?? "").trim();
    if (!getKnowledgeTargetSummary(targetType, targetId)) {
      throw new Error("找不到卡片对应的来源内容。");
    }
    const cardType = knowledgeCardTypes.has(String(card.cardType))
      ? String(card.cardType)
      : "concept";
    const question = String(card.question ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    const answer = String(card.answer ?? "").trim().slice(0, 8000);
    const sourceQuote = String(card.sourceQuote ?? "").trim().slice(0, 8000);
    if (!question || !answer || !sourceQuote) {
      throw new TypeError("卡片问题、答案和来源原文都不能为空。");
    }
    const anchorStart = Math.max(0, Number(card.anchorStart) || 0);
    const anchorEnd = Math.max(anchorStart, Number(card.anchorEnd) || anchorStart);
    const now = currentDate().toISOString();
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

  /** 记录一次复习结果并计算下一次到期时间。 */
  function reviewKnowledgeCard(cardId, rating) {
    const row = database.prepare("SELECT * FROM knowledge_cards WHERE id = ?").get(cardId);
    if (!row) return null;
    const normalizedRating = ["again", "hard", "good", "easy"].includes(rating)
      ? rating
      : "good";
    const previousInterval = Number(row.interval_days) || 0;
    const intervalDays =
      normalizedRating === "again"
        ? 1
        : normalizedRating === "hard"
          ? Math.max(1, Math.round(previousInterval * 1.2))
          : normalizedRating === "easy"
            ? Math.max(3, Math.round((previousInterval || 1) * 3))
            : Math.max(1, Math.round((previousInterval || 1) * 2.2));
    const easeDelta = normalizedRating === "again"
      ? -0.2
      : normalizedRating === "hard"
        ? -0.05
        : normalizedRating === "easy"
          ? 0.15
          : 0;
    const easeFactor = Math.min(3.2, Math.max(1.3, Number(row.ease_factor) + easeDelta));
    const reviewedAt = currentDate();
    const dueAt = new Date(reviewedAt.getTime() + intervalDays * 86_400_000).toISOString();
    database.prepare(`
      UPDATE knowledge_cards SET interval_days = ?, ease_factor = ?, due_at = ?,
        review_count = review_count + 1, last_reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      intervalDays,
      easeFactor,
      dueAt,
      reviewedAt.toISOString(),
      reviewedAt.toISOString(),
      cardId,
    );
    return listKnowledgeCards().find((item) => item.id === cardId) || null;
  }

  /** 永久删除一张知识卡片。 */
  function deleteKnowledgeCard(cardId) {
    return database.prepare("DELETE FROM knowledge_cards WHERE id = ?").run(cardId).changes > 0;
  }

  return Object.freeze({
    createKnowledgeCard,
    deleteKnowledgeCard,
    listKnowledgeCards,
    reviewKnowledgeCard,
  });
}
