/**
 * API 路由共享的轻量 HTTP 帮助函数。
 */

/** 返回统一的未登录响应。 */
export function unauthorizedResponse(): Response {
  return Response.json(
    {
      error: "unauthorized",
      message: "请先在网页端登录，或在手机端完成设备配对。",
    },
    { status: 401 },
  );
}

/** 从未知异常中提取安全、可读的错误信息。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误";
}

/** 返回统一的服务端错误响应，同时避免向客户端泄露堆栈。 */
export function serverErrorResponse(error: unknown): Response {
  /**
   * diagnosticError 只写入受控的服务端生产日志，便于定位 D1 或运行时错误；
   * 客户端仍只接收不包含调用栈的可读错误消息。
   */
  const diagnosticError =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "UnknownError", message: String(error) };
  console.error("API request failed", diagnosticError);
  return Response.json(
    {
      error: "server_error",
      message: errorMessage(error),
    },
    { status: 500 },
  );
}
