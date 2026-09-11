/** 专题成员加入与移除接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import {
  toggleCollectionItem,
  type KnowledgeTargetType,
} from "@/lib/repository";

/** 浏览器允许提交的专题成员字段。 */
type CollectionItemPayload = {
  /** 目标专题 ID。 */
  collectionId?: string;
  /** card 或 article。 */
  targetType?: KnowledgeTargetType;
  /** 卡片或文章稳定 ID。 */
  targetId?: string;
  /** true 表示加入，false 表示移除。 */
  active?: boolean;
};

/** 服务端允许写入的目标类型。 */
const ALLOWED_TARGET_TYPES = new Set<KnowledgeTargetType>(["card", "article"]);

/** 把知识目标加入专题，或从专题中移除。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前网页登录账号或已配对 Android 账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的专题成员结构。 */
    const payload = (await request.json().catch(() => ({}))) as CollectionItemPayload;
    if (
      !payload.collectionId ||
      !payload.targetId ||
      !payload.targetType ||
      !ALLOWED_TARGET_TYPES.has(payload.targetType) ||
      typeof payload.active !== "boolean"
    ) {
      return Response.json({ message: "专题成员参数不完整。" }, { status: 400 });
    }

    /** result 是保存后的专题成员状态。 */
    const result = await toggleCollectionItem({
      userId: user.id,
      collectionId: payload.collectionId,
      targetType: payload.targetType,
      targetId: payload.targetId,
      active: payload.active,
    });
    return Response.json(result);
  } catch (error) {
    return serverErrorResponse(error);
  }
}
