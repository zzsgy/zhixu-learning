/** 卡片与文章的个人学习状态写入接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import {
  saveKnowledgeState,
  type KnowledgeStatus,
  type KnowledgeTargetType,
} from "@/lib/repository";

/** 浏览器允许提交的知识状态字段。 */
type KnowledgeStatePayload = {
  /** card 或 article。 */
  targetType?: KnowledgeTargetType;
  /** 卡片或文章稳定 ID。 */
  targetId?: string;
  /** 新的个人学习状态。 */
  status?: KnowledgeStatus;
};

/** 服务端允许写入的目标类型。 */
const ALLOWED_TARGET_TYPES = new Set<KnowledgeTargetType>(["card", "article"]);
/** 服务端允许写入的学习状态。 */
const ALLOWED_STATUSES = new Set<KnowledgeStatus>([
  "inbox",
  "organizing",
  "learning",
  "mastered",
  "archived",
]);

/** 保存当前用户对一张卡片或文章的学习状态。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前网页登录账号或已配对 Android 账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的最小状态结构。 */
    const payload = (await request.json().catch(() => ({}))) as KnowledgeStatePayload;
    if (
      !payload.targetId ||
      !payload.targetType ||
      !ALLOWED_TARGET_TYPES.has(payload.targetType) ||
      !payload.status ||
      !ALLOWED_STATUSES.has(payload.status)
    ) {
      return Response.json({ message: "知识状态参数不完整。" }, { status: 400 });
    }

    /** state 是数据库合并后的最终知识状态。 */
    const state = await saveKnowledgeState({
      userId: user.id,
      targetType: payload.targetType,
      targetId: payload.targetId,
      status: payload.status,
    });
    return Response.json({ state });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
