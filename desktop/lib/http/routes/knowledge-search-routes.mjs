/** 创建跨文档、文章、论文、笔记和批注的统一搜索路由。 */
export function createKnowledgeSearchRouteHandler({
  searchPage,
  sendJson,
}) {
  return async function handleKnowledgeSearchRoute(request, response, url) {
    if (request.method !== "GET" || url.pathname !== "/api/search") return false;

    const resultPage = searchPage({
      query: url.searchParams.get("q") ?? "",
      targetType: url.searchParams.get("targetType") ?? "",
      category: url.searchParams.get("category") ?? "",
      tagName: url.searchParams.get("tagName") ?? "",
      folderId: url.searchParams.get("folderId") ?? "",
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
    });
    sendJson(response, 200, resultPage);
    return true;
  };
}
