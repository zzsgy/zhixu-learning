/** 本地 AI 问答会话、消息和历史检索的数据访问。 */
import crypto from "node:crypto";

/** 使用共享 SQLite 连接创建 AI 问答历史仓储。 */
export function createAiHistoryStore(database, {
  currentTimestamp = () => new Date().toISOString(),
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  /** 安全解析数据库中保存的 JSON 数组。 */
  function parseStoredArray(value) {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  /** 把 AI 消息数据库行转换为浏览器字段。 */
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

  /** 把 AI 会话数据库行转换为浏览器字段。 */
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

  /** 读取一条完整 AI 会话及全部消息。 */
  function getAiConversation(conversationId) {
    const row = database.prepare(`
      SELECT c.*,
        (SELECT content FROM ai_messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_question,
        (SELECT content FROM ai_messages WHERE conversation_id = c.id AND role = 'assistant' ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_answer,
        (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) AS message_count
      FROM ai_conversations AS c WHERE c.id = ? LIMIT 1
    `).get(String(conversationId || ""));
    if (!row) return null;
    const messages = database.prepare(
      "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC",
    ).all(row.id).map(mapAiMessageRow);
    return { ...mapAiConversationRow(row), messages };
  }

  /** 保存一次用户问题和模型回答；首次提问时同时创建会话。 */
  function saveAiExchange(exchange) {
    const now = currentTimestamp();
    const requestedConversationId = String(exchange.conversationId || "").trim();
    const existingConversation = requestedConversationId
      ? database.prepare("SELECT * FROM ai_conversations WHERE id = ? LIMIT 1").get(requestedConversationId)
      : null;
    if (requestedConversationId && !existingConversation) {
      throw new Error("找不到要继续的问答记录。");
    }
    const conversationId = existingConversation?.id || `ai_conversation_${randomUUID()}`;
    const sources = Array.isArray(exchange.sources) ? exchange.sources.slice(0, 6) : [];
    const primarySource = sources[0] || null;
    const question = String(exchange.question || "").trim().slice(0, 4000);
    const answer = String(exchange.answer || "").trim();
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
        database.prepare("UPDATE ai_conversations SET updated_at = ? WHERE id = ?")
          .run(now, conversationId);
      }
      database.prepare(`
        INSERT INTO ai_messages (
          id, conversation_id, role, content, selected_quote,
          citations_json, insufficient_evidence, created_at
        ) VALUES (?, ?, 'user', ?, ?, '[]', 0, ?)
      `).run(
        `ai_message_${randomUUID()}`,
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
        `ai_message_${randomUUID()}`,
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

  /** 查询本地 AI 问答历史。 */
  function listAiConversations(filters = {}) {
    const query = String(filters.query || "").trim().slice(0, 200);
    const likeQuery = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const targetType = String(filters.targetType || "").trim();
    const targetId = String(filters.targetId || "").trim();
    const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
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

  return Object.freeze({
    getAiConversation,
    listAiConversations,
    saveAiExchange,
  });
}
