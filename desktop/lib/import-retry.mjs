/** 可由后台任务执行器安全延迟并再次尝试的临时错误。 */
export class RetryableImportError extends Error {
  constructor(message, options = {}) {
    super(String(message || "来源暂时不可用。"), { cause: options.cause });
    this.name = "RetryableImportError";
    this.code = "IMPORT_RETRYABLE";
    this.retryable = true;
    this.retryAfterMs = Number.isFinite(Number(options.retryAfterMs))
      ? Math.max(1_000, Number(options.retryAfterMs))
      : null;
    this.maxAttempts = Math.min(Math.max(Number(options.maxAttempts) || 5, 2), 8);
    this.status = Number(options.status) || null;
  }
}

/** 将 Retry-After 的秒数或 HTTP 日期转换为延迟毫秒数。 */
export function parseRetryAfter(value, nowMilliseconds = Date.now()) {
  const text = String(value || "").trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.max(seconds * 1_000, 1_000), 60 * 60 * 1000);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(timestamp - nowMilliseconds, 1_000), 60 * 60 * 1000);
}

/** 网络波动、限流与上游 5xx 才允许自动重试；内容/权限/格式错误保持立即失败。 */
export function isTransientImportError(error) {
  if (error?.retryable || error?.code === "IMPORT_RETRYABLE") return true;
  const status = Number(error?.status || error?.statusCode);
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) return true;
  const message = String(error instanceof Error ? error.message : error || "");
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_|fetch failed|socket|connection (?:reset|closed|timed out)|network (?:error|unreachable)|HTTP\s*(?:408|425|429|5\d\d)\b|（(?:408|425|429|5\d\d)）/i.test(message);
}

/** 把普通临时错误标准化为带重试策略的错误；永久错误返回空值。 */
export function asRetryableImportError(error, options = {}) {
  if (!isTransientImportError(error)) return null;
  if (error instanceof RetryableImportError) return error;
  return new RetryableImportError(
    error instanceof Error ? error.message : String(error || "来源暂时不可用。"),
    {
      cause: error instanceof Error ? error : undefined,
      retryAfterMs: options.retryAfterMs ?? error?.retryAfterMs,
      maxAttempts: options.maxAttempts ?? error?.maxAttempts,
      status: options.status ?? error?.status ?? error?.statusCode,
    },
  );
}

/** 无 Retry-After 时采用 30 秒、2 分钟、8 分钟、30 分钟的有界退避。 */
export function getImportRetryDelay(error, attemptCount) {
  if (Number.isFinite(Number(error?.retryAfterMs))) {
    return Math.min(Math.max(Number(error.retryAfterMs), 1_000), 60 * 60 * 1000);
  }
  const delays = [30_000, 120_000, 480_000, 1_800_000];
  return delays[Math.min(Math.max(Number(attemptCount) - 1, 0), delays.length - 1)];
}
