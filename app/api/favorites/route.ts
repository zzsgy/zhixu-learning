/** 收藏写入接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveFavorite } from "@/lib/repository";

/** 客户端允许提交的收藏字段。 */
type FavoritePayload = {
  /** 卡片 ID。 */
  cardId?: string;
  /** 是否收藏。 */
  active?: boolean;
};

/** 新增或取消收藏。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的 JSON。 */
    const payload = (await request.json()) as FavoritePayload;
    if (!payload.cardId || typeof payload.active !== "boolean") {
      return Response.json({ message: "收藏参数不完整。" }, { status: 400 });
    }
    /** result 表示保存后的收藏状态。 */
    const result = await saveFavorite({
      userId: user.id,
      cardId: payload.cardId,
      active: payload.active,
    });
    return Response.json(result);
  } catch (error) {
    return serverErrorResponse(error);
  }
}
