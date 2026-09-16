/** 创建知识卡片列表、写入、复习与删除路由。 */
export function createKnowledgeCardRouteHandler({
  createBackup,
  createCard,
  deleteCard,
  listCards,
  readRequestBuffer,
  reviewCard,
  sendJson,
}) {
  return async function handleKnowledgeCardRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/knowledge-cards") {
      const dueOnly = url.searchParams.get("due") === "1";
      sendJson(response, 200, { cards: listCards({ dueOnly }) });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/knowledge-cards") {
      const requestBuffer = await readRequestBuffer(request, 256 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const card = createCard(payload);
      createBackup();
      sendJson(response, 201, { card });
      return true;
    }

    const cardReviewMatch = url.pathname.match(/^\/api\/knowledge-cards\/([^/]+)\/review$/);
    if (request.method === "POST" && cardReviewMatch) {
      const cardId = decodeURIComponent(cardReviewMatch[1]);
      const requestBuffer = await readRequestBuffer(request, 32 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const card = reviewCard(cardId, String(payload.rating || "good"));
      if (!card) {
        sendJson(response, 404, { message: "找不到这张知识卡片。" });
        return true;
      }
      createBackup();
      sendJson(response, 200, { card });
      return true;
    }

    const cardDetailMatch = url.pathname.match(/^\/api\/knowledge-cards\/([^/]+)$/);
    if (request.method === "DELETE" && cardDetailMatch) {
      const cardId = decodeURIComponent(cardDetailMatch[1]);
      createBackup();
      const deleted = deleteCard(cardId);
      if (!deleted) {
        sendJson(response, 404, { message: "找不到这张知识卡片。" });
        return true;
      }
      sendJson(response, 200, { deleted: true });
      return true;
    }

    return false;
  };
}
