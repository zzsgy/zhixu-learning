/** Android 实时生成卡片同步接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveGeneratedCard } from "@/lib/repository";

/** 客户端允许提交的卡片字段。 */
type CardPayload = {
  /** 稳定卡片 ID。 */
  id?: string;
  /** 一级领域。 */
  domain?: "AI" | "BIO" | "DB";
  /** 体系化系列。 */
  series?: string;
  /** 难度等级。 */
  level?: number;
  /** 系列顺序。 */
  sequence?: number;
  /** 标题。 */
  title?: string;
  /** 摘要。 */
  summary?: string;
  /** 正文。 */
  content?: string;
  /** 可选公式。 */
  formula?: string | null;
  /** 流程步骤。 */
  flow?: string[];
  /** 参考资料。 */
  sources?: string[];
  /** 内容来源。 */
  origin?: string;
};

/** 保存一张到点实时生成的用户卡片。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的 JSON。 */
    const payload = (await request.json()) as CardPayload;
    if (
      !payload.id ||
      !payload.domain ||
      !payload.series ||
      !payload.title ||
      !payload.summary ||
      !payload.content
    ) {
      return Response.json({ message: "卡片参数不完整。" }, { status: 400 });
    }
    /** saved 是数据库中的最终卡片。 */
    const saved = await saveGeneratedCard({
      userId: user.id,
      id: payload.id,
      domain: payload.domain,
      series: payload.series,
      level: payload.level ?? 1,
      sequence: payload.sequence ?? 1,
      title: payload.title,
      summary: payload.summary,
      content: payload.content,
      formula: payload.formula ?? null,
      flow: Array.isArray(payload.flow) ? payload.flow : [],
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      origin: payload.origin?.trim() || "android",
    });
    return Response.json({ card: saved });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
