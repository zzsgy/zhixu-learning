/**
 * 创建后台导入任务的列表、详情、重试和视频确认管理路由。
 *
 * 具体任务执行器继续由服务入口持有；这里只负责稳定的 HTTP 契约。
 */
export function createImportJobRouteHandler({
  attachLocations,
  confirmVideoJob,
  getJob,
  getRunnerStatus,
  listJobs,
  readRequestBuffer,
  retryJob,
  sendJson,
  triggerRunner,
}) {
  return async function handleImportJobRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/import-jobs") {
      const jobs = attachLocations(listJobs({
        status: url.searchParams.get("status") || "",
        jobType: url.searchParams.get("jobType") || "",
        limit: Number(url.searchParams.get("limit")) || 30,
      }));
      sendJson(response, 200, { jobs, runner: getRunnerStatus() });
      return true;
    }

    const importJobMatch = url.pathname.match(/^\/api\/import-jobs\/([^/]+)$/);
    if (request.method === "GET" && importJobMatch) {
      const job = attachLocations([
        getJob(decodeURIComponent(importJobMatch[1])),
      ].filter(Boolean))[0];
      if (!job) {
        sendJson(response, 404, { message: "找不到这项导入任务。" });
        return true;
      }
      sendJson(response, 200, { job });
      return true;
    }

    const retryMatch = url.pathname.match(/^\/api\/import-jobs\/([^/]+)\/retry$/);
    if (request.method === "POST" && retryMatch) {
      const job = retryJob(decodeURIComponent(retryMatch[1]));
      if (!job) {
        sendJson(response, 409, { message: "只有失败的导入任务可以重试。" });
        return true;
      }
      triggerRunner();
      sendJson(response, 202, { job });
      return true;
    }

    const confirmMatch = url.pathname.match(/^\/api\/import-jobs\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) {
      const requestBuffer = await readRequestBuffer(request, 16 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      if (!["save_link", "generate_study_pdf"].includes(payload.action)) {
        sendJson(response, 400, { message: "请选择仅保存链接或生成图文学习 PDF。" });
        return true;
      }
      const job = confirmVideoJob(
        decodeURIComponent(confirmMatch[1]),
        String(payload.action || ""),
      );
      if (!job) {
        sendJson(response, 409, { message: "这项任务当前不需要视频导入确认。" });
        return true;
      }
      triggerRunner();
      sendJson(response, 202, { job });
      return true;
    }

    return false;
  };
}
