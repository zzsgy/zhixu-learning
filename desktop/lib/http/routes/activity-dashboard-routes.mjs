/** 学习统计首页 HTTP 路由。URL、状态码和响应结构保持兼容。 */

/**
 * 创建学习统计路由处理器。统计查询允许在测试中替换为隔离实现。
 */
export function createActivityDashboardRouteHandler({
  getDashboard,
  sendJson,
}) {
  return async function handleActivityDashboardRoute(request, response, url) {
    if (request.method !== "GET" || url.pathname !== "/api/activity-dashboard") return false;
    const days = Number(url.searchParams.get("days") || 30);
    sendJson(response, 200, { dashboard: getDashboard(days) });
    return true;
  };
}
