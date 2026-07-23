/** 网页端创建一次性手机配对码的接口。 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { devicePairCodes } from "@/db/schema";
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";

/** 配对码有效期，单位为分钟。 */
const PAIR_CODE_TTL_MINUTES = 10;

/** 生成六位数字配对码。 */
function createPairCode(): string {
  /** randomValue 使用密码学随机源，避免可预测的递增码。 */
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(randomValue % 1_000_000).padStart(6, "0");
}

/** 创建一个十分钟内有效、只能领取一次的配对码。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前网页登录账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** db 是 D1 的 Drizzle 客户端。 */
    const db = getDb();
    /** now 是配对码创建时间。 */
    const now = new Date();
    /** expiresAt 是配对码失效时间。 */
    const expiresAt = new Date(
      now.getTime() + PAIR_CODE_TTL_MINUTES * 60_000,
    ).toISOString();
    /** code 是本次六位配对码。 */
    const code = createPairCode();

    await db.insert(devicePairCodes).values({
      id: crypto.randomUUID(),
      code,
      userId: user.id,
      expiresAt,
      createdAt: now.toISOString(),
    });

    /** recentCodes 只用于确认刚创建记录可读。 */
    const recentCodes = await db
      .select({ code: devicePairCodes.code })
      .from(devicePairCodes)
      .where(eq(devicePairCodes.userId, user.id))
      .orderBy(desc(devicePairCodes.createdAt))
      .limit(1);
    return Response.json({
      code: recentCodes[0]?.code ?? code,
      expiresAt,
    });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
