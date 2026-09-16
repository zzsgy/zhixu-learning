/**
 * 创建目录、归档位置和标签路由。
 *
 * 数据仓储、备份和 HTTP 帮助函数均由服务入口注入，专项测试不会加载正式数据库。
 */
export function createContentOrganizationRouteHandler({
  addTag,
  assignContent,
  assignContents,
  createBackup,
  createFolder,
  deleteFolder,
  getOrganization,
  listFolders,
  listTags,
  moveFolder,
  readRequestBuffer,
  removeTag,
  renameFolder,
  sendJson,
}) {
  return async function handleContentOrganizationRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/folders") {
      sendJson(response, 200, { folders: listFolders() });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/folders") {
      const requestBuffer = await readRequestBuffer(request, 128 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const folder = createFolder(payload);
      createBackup();
      sendJson(response, 201, { folder, folders: listFolders() });
      return true;
    }

    const folderMoveMatch = url.pathname.match(/^\/api\/folders\/([^/]+)\/move$/);
    if (request.method === "PATCH" && folderMoveMatch) {
      const requestBuffer = await readRequestBuffer(request, 128 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const folder = moveFolder(decodeURIComponent(folderMoveMatch[1]), payload.parentId || null);
      createBackup();
      sendJson(response, 200, { folder, folders: listFolders() });
      return true;
    }

    const folderMatch = url.pathname.match(/^\/api\/folders\/([^/]+)$/);
    if (request.method === "PATCH" && folderMatch) {
      const requestBuffer = await readRequestBuffer(request, 128 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const folder = renameFolder(decodeURIComponent(folderMatch[1]), payload.name);
      createBackup();
      sendJson(response, 200, { folder, folders: listFolders() });
      return true;
    }

    if (request.method === "DELETE" && folderMatch) {
      const deleted = deleteFolder(decodeURIComponent(folderMatch[1]));
      createBackup();
      sendJson(response, 200, { deleted, folders: listFolders() });
      return true;
    }

    if (request.method === "PATCH" && url.pathname === "/api/folder-items") {
      const requestBuffer = await readRequestBuffer(request, 128 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const assignment = assignContent(payload.targetType, payload.targetId, payload.folderId);
      createBackup();
      sendJson(response, 200, { assignment, folders: listFolders() });
      return true;
    }

    if (request.method === "PATCH" && url.pathname === "/api/folder-items/batch") {
      const requestBuffer = await readRequestBuffer(request, 512 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const assignments = assignContents(payload.items, payload.folderId);
      createBackup();
      sendJson(response, 200, {
        assignments,
        movedCount: assignments.length,
        folders: listFolders(),
      });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/tags") {
      sendJson(response, 200, { tags: listTags() });
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/content-organization") {
      const organization = getOrganization(
        url.searchParams.get("targetType") ?? "",
        url.searchParams.get("targetId") ?? "",
      );
      if (!organization) {
        sendJson(response, 404, { message: "找不到对应内容。" });
        return true;
      }
      sendJson(response, 200, { organization });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/content-tags") {
      const requestBuffer = await readRequestBuffer(request, 256 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const tags = addTag(payload.targetType, payload.targetId, payload.tagName);
      createBackup();
      sendJson(response, 201, { tags });
      return true;
    }

    if (request.method === "DELETE" && url.pathname === "/api/content-tags") {
      const tags = removeTag(
        url.searchParams.get("targetType") ?? "",
        url.searchParams.get("targetId") ?? "",
        url.searchParams.get("tagName") ?? "",
      );
      createBackup();
      sendJson(response, 200, { tags });
      return true;
    }

    return false;
  };
}
