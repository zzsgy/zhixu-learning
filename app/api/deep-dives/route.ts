/** 手机生成的深度内容同步接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveDeepDive } from "@/lib/repository";

/** 客户端允许提交的深度内容字段。 */
type DeepDivePayload = {
  /** 卡片 ID。 */
  cardId?: string;
  /** 深度标题。 */
  title?: string;
  /** 不少于 2000 字的正文。 */
  content?: string;
  /** 参考资料。 */
  sources?: string[];
  /** 内容来源。 */
  origin?: string;
};

/** 保存 Android 或其他受信设备生成的深度内容。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的 JSON。 */
    const payload = (await request.json()) as DeepDivePayload;
    if (!payload.cardId || !payload.title || !payload.content) {
      return Response.json({ message: "深度内容参数不完整。" }, { status: 400 });
    }
    /** saved 是数据库中的最终深度内容。 */
    const saved = await saveDeepDive({
      userId: user.id,
      cardId: payload.cardId,
      title: payload.title,
      content: payload.content,
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      origin: payload.origin?.trim() || "android",
    });
    return Response.json({ deepDive: saved });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
