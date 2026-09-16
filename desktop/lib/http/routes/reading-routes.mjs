/**
 * 创建阅读工作区、阅读会话和高亮批注路由。
 *
 * 数据库函数和 HTTP 帮助函数均由服务入口注入，方便在不连接正式数据库的情况下
 * 独立验证路由契约。
 */
export function createReadingRouteHandler({
  createAnnotation,
  createBackup,
  deleteAnnotation,
  getWorkspace,
  readRequestBuffer,
  sendJson,
  startSession,
  updateAnnotation,
  updateSession,
  updateState,
}) {
  return async function handleReadingRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/reading-workspace") {
      const targetType = url.searchParams.get("targetType")?.trim() ?? "";
      const targetId = url.searchParams.get("targetId")?.trim() ?? "";
      const workspace = getWorkspace(targetType, targetId);
      if (!workspace) {
        sendJson(response, 404, { message: "找不到对应的阅读内容。" });
        return true;
      }
      sendJson(response, 200, { workspace });
      return true;
    }

    if (request.method === "PATCH" && url.pathname === "/api/reading-workspace") {
      const requestBuffer = await readRequestBuffer(request, 8_500_000);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const state = updateState(
        String(payload.targetType ?? ""),
        String(payload.targetId ?? ""),
        payload,
      );
      if (!state) {
        sendJson(response, 404, { message: "找不到对应的阅读内容。" });
        return true;
      }
      sendJson(response, 200, { state });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/reading-sessions") {
      const requestBuffer = await readRequestBuffer(request, 64 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const session = startSession(
        String(payload.targetType ?? ""),
        String(payload.targetId ?? ""),
        Number(payload.progressPercent) || 0,
      );
      if (!session) {
        sendJson(response, 404, { message: "找不到对应的阅读内容。" });
        return true;
      }
      sendJson(response, 201, { session });
      return true;
    }

    const readingSessionMatch = url.pathname.match(/^\/api\/reading-sessions\/([^/]+)$/);
    if (request.method === "POST" && readingSessionMatch) {
      const requestBuffer = await readRequestBuffer(request, 64 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const session = updateSession(decodeURIComponent(readingSessionMatch[1]), payload);
      if (!session) {
        sendJson(response, 404, { message: "找不到对应的阅读会话。" });
        return true;
      }
      sendJson(response, 200, { session });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/reading-annotations") {
      const requestBuffer = await readRequestBuffer(request, 256 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const annotation = createAnnotation(
        String(payload.targetType ?? ""),
        String(payload.targetId ?? ""),
        payload,
      );
      if (!annotation) {
        sendJson(response, 404, { message: "找不到对应的阅读内容。" });
        return true;
      }
      createBackup();
      sendJson(response, 201, { annotation });
      return true;
    }

    const annotationMatch = url.pathname.match(/^\/api\/reading-annotations\/([^/]+)$/);
    if (request.method === "PATCH" && annotationMatch) {
      const annotationId = decodeURIComponent(annotationMatch[1]);
      const requestBuffer = await readRequestBuffer(request, 256 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const annotation = updateAnnotation(annotationId, payload);
      if (!annotation) {
        sendJson(response, 404, { message: "找不到这条批注。" });
        return true;
      }
      createBackup();
      sendJson(response, 200, { annotation });
      return true;
    }

    if (request.method === "DELETE" && annotationMatch) {
      const annotationId = decodeURIComponent(annotationMatch[1]);
      const deleted = deleteAnnotation(annotationId);
      if (!deleted) {
        sendJson(response, 404, { message: "找不到这条批注。" });
        return true;
      }
      createBackup();
      sendJson(response, 200, { deleted: true });
      return true;
    }

    return false;
  };
}
