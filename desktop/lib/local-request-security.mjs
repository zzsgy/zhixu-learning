/** 限制浏览器对个人本机 API 的来源；本地 CLI 无 Origin 的请求仍可使用。 */
export function checkLocalApiRequest(request, url, port) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const host = String(request.headers.host || "").trim().toLowerCase();
  if (!allowedHosts.has(host)) return "请求的本机服务地址不受信任。";
  const origin = String(request.headers.origin || "").trim();
  const extension = /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin);
  const extensionRoute = url.pathname === "/api/browser/pair"
    || url.pathname === "/api/browser/captures"
    || /^\/api\/browser\/captures\/[^/]+$/.test(url.pathname);
  // 扩展入口继续交由原有的配对码/随机令牌鉴权，不放行普通管理接口。
  if (extension && extensionRoute) return null;
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { return "只允许本机知序页面访问此接口。"; }
    if (parsed.protocol !== "http:" || parsed.origin !== origin || !allowedHosts.has(parsed.host.toLowerCase())) {
      return "只允许本机知序页面访问此接口。";
    }
  }
  const writes = !["GET", "HEAD", "OPTIONS"].includes(String(request.method || "GET").toUpperCase());
  if (writes && String(request.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
    return "已拒绝跨站页面发起的知识库修改请求。";
  }
  return null;
}
