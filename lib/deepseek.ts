/**
 * DeepSeek 服务端调用封装。
 *
 * API Key 仅从生产环境变量读取，不进入网页 JavaScript、Git 或 APK。
 */
import { env } from "cloudflare:workers";

/** DeepSeek Chat Completions 的最小响应结构。 */
type DeepSeekResponse = {
  /** 候选回答数组。 */
  choices?: Array<{
    /** 模型消息。 */
    message?: {
      /** 最终文本。 */
      content?: string | null;
    };
  }>;
  /** API 错误结构。 */
  error?: {
    /** 错误提示。 */
    message?: string;
  };
};

/** 运行时环境变量结构。 */
type DeepSeekEnvironment = {
  /** 由托管平台安全保存的 DeepSeek API Key。 */
  DEEPSEEK_API_KEY?: string;
};

/** 调用 DeepSeek 并要求返回严格 JSON 对象。 */
export async function requestDeepSeekJson<T>(input: {
  /** 系统提示词。 */
  systemPrompt: string;
  /** 用户提示词。 */
  userPrompt: string;
  /** 适合任务复杂度的模型。 */
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  /** 最大输出 token 数。 */
  maxTokens: number;
}): Promise<T> {
  /** runtimeEnv 是 Sites 注入的服务端环境变量。 */
  const runtimeEnv = env as unknown as DeepSeekEnvironment;
  /** apiKey 只在 Worker 内存中使用。 */
  const apiKey = runtimeEnv.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "云端尚未配置 DeepSeek API Key；可先使用手机已有生成能力并同步内容。",
    );
  }

  /** response 是 DeepSeek OpenAI 兼容接口的 HTTP 响应。 */
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: input.maxTokens,
      stream: false,
    }),
  });
  /** payload 是经过最小类型约束的 API 返回值。 */
  const payload = (await response.json()) as DeepSeekResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "DeepSeek 请求失败");
  }

  /** content 是模型生成的 JSON 字符串。 */
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek 返回了空内容，请稍后重试。");
  return JSON.parse(content) as T;
}
