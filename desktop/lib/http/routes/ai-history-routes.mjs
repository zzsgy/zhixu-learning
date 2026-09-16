/** 创建本地 AI 问答历史列表和详情路由。 */
export function createAiHistoryRouteHandler({
  getConversation,
  listConversations,
  sendJson,
}) {
  return async function handleAiHistoryRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/ai/conversations") {
      const conversations = listConversations({
        query: url.searchParams.get("q") ?? "",
        targetType: url.searchParams.get("targetType") ?? "",
        targetId: url.searchParams.get("targetId") ?? "",
      });
      sendJson(response, 200, { conversations });
      return true;
    }

    const conversationMatch = url.pathname.match(/^\/api\/ai\/conversations\/([^/]+)$/);
    if (request.method === "GET" && conversationMatch) {
      const conversationId = decodeURIComponent(conversationMatch[1]);
      const conversation = getConversation(conversationId);
      if (!conversation) {
        sendJson(response, 404, { message: "找不到这条问答记录。" });
        return true;
      }
      sendJson(response, 200, { conversation });
      return true;
    }

    return false;
  };
}
