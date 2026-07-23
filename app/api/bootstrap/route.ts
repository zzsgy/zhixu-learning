/** 网页首页与 Android 首次同步接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { loadBootstrapData } from "@/lib/repository";

/** 返回当前账号的卡片、进度、收藏、深度内容、设置与设备。 */
export async function GET(request: Request): Promise<Response> {
  try {
    /** user 是网页或手机令牌解析出的统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** data 是客户端建立本地缓存所需的完整快照。 */
    const data = await loadBootstrapData(user);
    return Response.json(data);
  } catch (error) {
    return serverErrorResponse(error);
  }
}
