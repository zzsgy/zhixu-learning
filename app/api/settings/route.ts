/** 跨端推送设置写入接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveSettings } from "@/lib/repository";

/** 客户端允许提交的设置字段。 */
type SettingsPayload = {
  /** 开始时间。 */
  startTime?: string;
  /** 结束时间。 */
  endTime?: string;
  /** 间隔分钟数。 */
  intervalMinutes?: number;
  /** AI 权重。 */
  aiWeight?: number;
  /** 生物工程权重。 */
  bioWeight?: number;
  /** PostgreSQL 权重。 */
  dbWeight?: number;
};

/** 校验 HH:mm 格式。 */
function isClockTime(value: string | undefined): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** 保存手机和网页共用的时间与内容配比。 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    /** user 是当前统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的 JSON。 */
    const payload = (await request.json()) as SettingsPayload;
    if (!isClockTime(payload.startTime) || !isClockTime(payload.endTime)) {
      return Response.json({ message: "时间格式应为 HH:mm。" }, { status: 400 });
    }
    /** intervalMinutes 限制在 30 分钟到 12 小时。 */
    const intervalMinutes = Math.min(
      Math.max(Math.round(payload.intervalMinutes ?? 60), 30),
      720,
    );
    /** weights 是三个领域的非负整数权重。 */
    const weights = [
      payload.aiWeight ?? 40,
      payload.bioWeight ?? 45,
      payload.dbWeight ?? 15,
    ].map((value) => Math.max(0, Math.round(value)));
    if (weights.reduce((sum, value) => sum + value, 0) <= 0) {
      return Response.json({ message: "至少一个领域权重大于 0。" }, { status: 400 });
    }
    /** saved 是数据库中的最终设置。 */
    const saved = await saveSettings({
      userId: user.id,
      startTime: payload.startTime,
      endTime: payload.endTime,
      intervalMinutes,
      aiWeight: weights[0],
      bioWeight: weights[1],
      dbWeight: weights[2],
    });
    return Response.json({ settings: saved });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
