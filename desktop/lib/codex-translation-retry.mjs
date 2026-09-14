/** 两条翻译队列共享账号级等待；截止时间存入 SQLite，服务重启仍遵守。 */
import { getCodexTranslationRetryState, setCodexTranslationRetryState } from "./database.mjs";

export function classifyCodexTransientError(error) {
  const message = String(error?.message || error || "");
  if (error?.code === "CODEX_USAGE_LIMIT" || /you(?:'|’)ve hit your usage limit|usage limit|purchase more credits|quota exceeded|insufficient_quota/i.test(message)) {
    return { reason: "Codex 当前用量已达上限，翻译进度已保留，额度恢复后自动继续。", delayMs: Math.max(60_000, Number(process.env.ZHIXU_CODEX_USAGE_RETRY_MS) || 30 * 60 * 1000) };
  }
  if (/not logged in|authentication required|login required|token (?:has )?expired|unauthorized/i.test(message)) {
    return { reason: "本机 Codex 登录暂不可用，翻译进度已保留，登录恢复后自动继续。", delayMs: 60_000 };
  }
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|connection (?:reset|timed out)|network (?:error|unreachable)|error sending request|stream disconnected|HTTP\s+(?:429|502|503|504)\b/i.test(message)) {
    return { reason: "Codex 网络暂不可用，翻译进度已保留，稍后自动继续。", delayMs: 60_000 };
  }
  return null;
}

export function getTranslationRetryWait(now = Date.now()) {
  const state = getCodexTranslationRetryState();
  return Number(state.retryAfter) > now ? { ...state, retryAfter: Number(state.retryAfter) } : null;
}

export function deferTranslationAvailability(error, now = Date.now()) {
  const transient = classifyCodexTransientError(error);
  if (!transient) return null;
  const existing = getCodexTranslationRetryState();
  return setCodexTranslationRetryState({ retryAfter: Math.max(Number(existing.retryAfter) || 0, now + transient.delayMs), reason: transient.reason });
}
