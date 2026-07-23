/** 深度内容实时生成接口。 */
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { cards } from "@/db/schema";
import { resolveAuthenticatedUser } from "@/lib/auth";
import { requestDeepSeekJson } from "@/lib/deepseek";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveDeepDive } from "@/lib/repository";

/** 客户端提交的深度生成字段。 */
type GenerateDeepPayload = {
  /** 需要展开的卡片 ID。 */
  cardId?: string;
};

/** 模型必须返回的深度内容 JSON 结构。 */
type GeneratedDeepDive = {
  /** 深度标题。 */
  title: string;
  /** 不少于 2000 字且不设最大字数的正文。 */
  content: string;
  /** 参考资料。 */
  sources?: string[];
};

/** 为一张可见卡片生成并保存深度内容。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的 JSON。 */
    const payload = (await request.json()) as GenerateDeepPayload;
    if (!payload.cardId) {
      return Response.json({ message: "缺少 cardId。" }, { status: 400 });
    }

    /** db 是 D1 的 Drizzle 客户端。 */
    const db = getDb();
    /** visibleCards 最多返回一张公共或当前用户自己的卡片。 */
    const visibleCards = await db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.id, payload.cardId),
          or(isNull(cards.ownerUserId), eq(cards.ownerUserId, user.id)),
        ),
      )
      .limit(1);
    /** card 是要展开的原始卡片。 */
    const card = visibleCards[0];
    if (!card) {
      return Response.json({ message: "卡片不存在。" }, { status: 404 });
    }

    /** generated 是 DeepSeek 返回并解析后的深度内容。 */
    const generated = await requestDeepSeekJson<GeneratedDeepDive>({
      model: "deepseek-v4-pro",
      maxTokens: 12000,
      systemPrompt:
        "你是中文高级技术教材作者。只输出 JSON 对象，不要 Markdown 代码围栏。技术事实必须严谨，必要时保留英文术语、公式、流程和设备示意的文字说明。",
      userPrompt: `围绕下列卡片编写深度内容。最低 2000 个中文字符，不设最大字数，不要因为超过 5000 字而缩短或重新生成。结构至少包含：原理、关键参数、工程实现、故障或误区、验证与检查方法、延伸方向、参考资料。
领域：${card.domain}
系列：${card.series}
标题：${card.title}
卡片正文：${card.content}
请严格输出 JSON：{"title":"...","content":"...","sources":["..."]}`,
    });
    if (generated.content.trim().length < 2000) {
      return Response.json(
        { message: "生成内容不足 2000 字，请继续生成后再保存。" },
        { status: 422 },
      );
    }

    /** saved 是数据库中的最终深度内容。 */
    const saved = await saveDeepDive({
      userId: user.id,
      cardId: card.id,
      title: generated.title,
      content: generated.content,
      sources: Array.isArray(generated.sources) ? generated.sources : [],
      origin: "deepseek-v4-pro",
    });
    return Response.json({ deepDive: saved });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
