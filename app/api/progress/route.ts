/** 阅读进度写入接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveProgress } from "@/lib/repository";

/** 客户端允许提交的进度字段。 */
type ProgressPayload = {
  /** 卡片 ID。 */
  cardId?: string;
  /** reading 或 completed。 */
  status?: "reading" | "completed";
  /** 本次设备记录的阅读秒数。 */
  readingSeconds?: number;
};

/** 保存一张卡片的当前阅读状态。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的 JSON。 */
    const payload = (await request.json()) as ProgressPayload;
    if (!payload.cardId || !["reading", "completed"].includes(payload.status ?? "")) {
      return Response.json({ message: "进度参数不完整。" }, { status: 400 });
    }
    /** saved 是数据库合并后的最终进度。 */
    const saved = await saveProgress({
      userId: user.id,
      cardId: payload.cardId,
      status: payload.status as "reading" | "completed",
      readingSeconds: payload.readingSeconds ?? 0,
    });
    return Response.json({ progress: saved });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
