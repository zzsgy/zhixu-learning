/** Android 使用一次性配对码领取设备令牌的公开接口。 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { devicePairCodes, deviceTokens } from "@/db/schema";
import { createDeviceToken, sha256Hex } from "@/lib/auth";
import { serverErrorResponse } from "@/lib/http";

/** 手机提交的配对领取字段。 */
type ClaimPayload = {
  /** 网页显示的六位配对码。 */
  code?: string;
  /** 设备显示名称。 */
  deviceName?: string;
};

/** 领取配对码，并仅在本次响应中返回一次明文设备令牌。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** payload 是手机提交的 JSON。 */
    const payload = (await request.json()) as ClaimPayload;
    /** code 只保留数字，便于用户带空格输入。 */
    const code = payload.code?.replace(/\D/g, "") ?? "";
    /** deviceName 限制长度，避免异常客户端写入超长名称。 */
    const deviceName = payload.deviceName?.trim().slice(0, 80) || "Android 设备";
    if (code.length !== 6) {
      return Response.json({ message: "请输入六位配对码。" }, { status: 400 });
    }

    /** db 是 D1 的 Drizzle 客户端。 */
    const db = getDb();
    /** now 是领取与到期判断的统一时间。 */
    const now = new Date().toISOString();
    /** matches 最多返回一个仍有效且未领取的配对记录。 */
    const matches = await db
      .select()
      .from(devicePairCodes)
      .where(
        and(
          eq(devicePairCodes.code, code),
          isNull(devicePairCodes.claimedAt),
          gt(devicePairCodes.expiresAt, now),
        ),
      )
      .limit(1);
    /** pair 是待领取记录。 */
    const pair = matches[0];
    if (!pair) {
      return Response.json(
        { message: "配对码无效、已领取或已过期。" },
        { status: 404 },
      );
    }

    /** rawToken 是只向手机返回一次的高熵令牌。 */
    const rawToken = createDeviceToken();
    /** tokenHash 是数据库保存的不可逆摘要。 */
    const tokenHash = await sha256Hex(rawToken);
    /** tokenId 是设备记录主键。 */
    const tokenId = crypto.randomUUID();
    await db.batch([
      db
        .update(devicePairCodes)
        .set({ claimedAt: now })
        .where(
          and(
            eq(devicePairCodes.id, pair.id),
            isNull(devicePairCodes.claimedAt),
          ),
        ),
      db.insert(deviceTokens).values({
        id: tokenId,
        userId: pair.userId,
        tokenHash,
        deviceName,
        lastSeenAt: now,
        createdAt: now,
      }),
    ]);

    return Response.json({
      token: rawToken,
      tokenType: "Bearer",
      userId: pair.userId,
    });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
