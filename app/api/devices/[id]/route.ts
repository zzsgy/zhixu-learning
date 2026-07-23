/** 网页端撤销某台 Android 设备的接口。 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { deviceTokens } from "@/db/schema";
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";

/** Next 动态路由参数结构。 */
type RouteContext = {
  /** params 是异步解析的 URL 参数。 */
  params: Promise<{ id: string }>;
};

/** 撤销当前账号名下的一台设备。 */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    /** user 是当前网页登录账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** id 是待撤销设备记录 ID。 */
    const { id } = await context.params;
    /** db 是 D1 的 Drizzle 客户端。 */
    const db = getDb();
    /** now 是撤销时间。 */
    const now = new Date().toISOString();
    await db
      .update(deviceTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(deviceTokens.id, id),
          eq(deviceTokens.userId, user.id),
          isNull(deviceTokens.revokedAt),
        ),
      );
    return Response.json({ revoked: true });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
