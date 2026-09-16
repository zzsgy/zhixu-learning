/** GitHub 项目研读 HTTP 路由。URL、状态码和响应结构保持兼容。 */

/**
 * 创建 GitHub 项目研读路由处理器。
 *
 * 通用 HTTP 帮助函数与业务依赖均由服务入口注入，使模块本身不初始化
 * 数据库、不读取密钥，也便于隔离验证完整接口契约。
 */
export function createGitHubProjectRouteHandler({
  analyzeRepository,
  config,
  createBackup,
  getProject,
  listProjects,
  readRequestBuffer,
  saveProject,
  sendJson,
}) {
  return async function handleGitHubProjectRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/github-projects") {
      sendJson(response, 200, { projects: listProjects(null) });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/github-projects/analyze") {
      const requestBuffer = await readRequestBuffer(request, 64 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const projectSnapshot = await analyzeRepository(String(payload.url || ""), {
        githubToken: config.githubToken,
        deepSeekApiKey: config.deepSeekApiKey,
        deepSeekModel: config.deepSeekModel,
      });
      createBackup();
      const project = saveProject(projectSnapshot);
      sendJson(response, 201, { project });
      return true;
    }

    const projectMatch = url.pathname.match(/^\/api\/github-projects\/([^/]+)$/);
    if (request.method === "GET" && projectMatch) {
      const project = getProject(decodeURIComponent(projectMatch[1]));
      if (!project) {
        sendJson(response, 404, { message: "找不到这份 GitHub 项目分析。" });
        return true;
      }
      sendJson(response, 200, { project });
      return true;
    }

    return false;
  };
}
