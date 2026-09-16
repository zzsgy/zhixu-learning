/** 创建 AI 来源目录和有出处问答路由。 */
export function createAiQuestionRouteHandler({
  answerQuestion,
  config,
  createBackup,
  getArticle,
  getConversation,
  getDocument,
  getPaper,
  listArticles,
  listDocuments,
  listPapers,
  readRequestBuffer,
  saveExchange,
  sendJson,
}) {
  /** 只按浏览器提交的类型和 ID 从本地数据库重新读取可信正文。 */
  function resolveSource(sourceReference, index) {
    const targetType = ["document", "article", "paper"].includes(sourceReference?.targetType)
      ? sourceReference.targetType
      : "";
    const targetId = String(sourceReference?.targetId ?? "").trim();
    const sourceKey = `S${index + 1}`;
    if (targetType === "document") {
      const item = getDocument(targetId);
      return item ? {
        sourceKey,
        targetType,
        targetId,
        title: item.title,
        text: item.extractedText || item.summary,
      } : null;
    }
    if (targetType === "article") {
      const item = getArticle(targetId);
      return item ? {
        sourceKey,
        targetType,
        targetId,
        title: item.title,
        text: item.contentText || item.summary,
      } : null;
    }
    if (targetType === "paper") {
      const item = getPaper(targetId);
      return item ? {
        sourceKey,
        targetType,
        targetId,
        title: item.titleZh || item.title,
        text: item.fullTranslationHtml || item.sourceText || item.abstractZh || item.abstract,
      } : null;
    }
    return null;
  }

  return async function handleAiQuestionRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/ai/sources") {
      const sources = [
        ...listDocuments({ limit: 1000 }).map((item) => ({
          targetType: "document",
          targetId: item.id,
          title: item.title,
          category: item.category,
          summary: item.summary,
        })),
        ...listArticles({ limit: 1000 }).map((item) => ({
          targetType: "article",
          targetId: item.id,
          title: item.title,
          category: item.category,
          summary: item.summary,
        })),
        ...listPapers().map((item) => ({
          targetType: "paper",
          targetId: item.id,
          title: item.titleZh || item.title,
          category: item.category,
          summary: item.abstractZh || item.abstract || item.curatorNote,
        })),
      ];
      sendJson(response, 200, {
        configured: Boolean(config.deepSeekApiKey),
        model: config.deepSeekModel,
        sources,
      });
      return true;
    }

    if (request.method !== "POST" || url.pathname !== "/api/ai/ask") return false;

    const requestBuffer = await readRequestBuffer(request, 512 * 1024);
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    const requestedSources = Array.isArray(payload.sources) ? payload.sources.slice(0, 6) : [];
    const resolvedSources = requestedSources
      .map((sourceReference, index) => resolveSource(sourceReference, index))
      .filter(Boolean);
    if (resolvedSources.length !== requestedSources.length) {
      sendJson(response, 422, { message: "部分所选资料已不存在，请刷新资料列表后重试。" });
      return true;
    }

    const existingConversation = payload.conversationId
      ? getConversation(String(payload.conversationId))
      : null;
    if (payload.conversationId && !existingConversation) {
      sendJson(response, 404, { message: "找不到要继续的问答记录。" });
      return true;
    }

    const result = await answerQuestion({
      apiKey: config.deepSeekApiKey,
      model: config.deepSeekModel,
      question: payload.question,
      mode: payload.mode,
      sources: resolvedSources,
      selectedQuote: payload.selectedQuote,
      conversationMessages: existingConversation?.messages ?? [],
    });
    const sourceReferenceMap = new Map(
      resolvedSources.map((source) => [source.sourceKey, source]),
    );
    const citations = result.citations.map((citation) => {
      const source = sourceReferenceMap.get(citation.sourceKey);
      return { ...citation, targetType: source.targetType, targetId: source.targetId };
    });
    const savedConversation = saveExchange({
      conversationId: existingConversation?.id,
      mode: payload.mode,
      sources: resolvedSources.map((source) => ({
        targetType: source.targetType,
        targetId: source.targetId,
        title: source.title,
      })),
      question: payload.question,
      selectedQuote: payload.selectedQuote,
      answer: result.answer,
      citations,
      insufficientEvidence: result.insufficientEvidence,
    });
    createBackup();
    sendJson(response, 200, {
      ...result,
      citations,
      conversationId: savedConversation.id,
      conversation: savedConversation,
    });
    return true;
  };
}
