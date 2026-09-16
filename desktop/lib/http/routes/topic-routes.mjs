/** 创建学习专题及专题内容关联路由。 */
export function createTopicRouteHandler({
  addItem,
  createBackup,
  createTopic,
  listItems,
  listTopics,
  readRequestBuffer,
  removeItem,
  sendJson,
}) {
  return async function handleTopicRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/topics") {
      sendJson(response, 200, { topics: listTopics() });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/topics") {
      const requestBuffer = await readRequestBuffer(request, 256 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const topic = createTopic(payload);
      createBackup();
      sendJson(response, 201, { topic });
      return true;
    }

    const topicItemsMatch = url.pathname.match(/^\/api\/topics\/([^/]+)\/items$/);
    if (request.method === "GET" && topicItemsMatch) {
      const topicId = decodeURIComponent(topicItemsMatch[1]);
      sendJson(response, 200, { items: listItems(topicId) });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/topic-items") {
      const requestBuffer = await readRequestBuffer(request, 256 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const items = addItem(payload.topicId, payload.targetType, payload.targetId);
      createBackup();
      sendJson(response, 201, { items });
      return true;
    }

    if (request.method === "DELETE" && url.pathname === "/api/topic-items") {
      const items = removeItem(
        url.searchParams.get("topicId") ?? "",
        url.searchParams.get("targetType") ?? "",
        url.searchParams.get("targetId") ?? "",
      );
      createBackup();
      sendJson(response, 200, { items });
      return true;
    }

    return false;
  };
}
