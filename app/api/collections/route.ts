/** 个人专题创建与更新接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveCollection } from "@/lib/repository";

/** 浏览器允许提交的专题字段。 */
type CollectionPayload = {
  /** 专题名称。 */
  name?: string;
  /** 可选专题说明。 */
  description?: string;
};

/** 创建专题；同名专题存在时更新其说明。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前网页登录账号或已配对 Android 账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的专题结构。 */
    const payload = (await request.json().catch(() => ({}))) as CollectionPayload;
    if (!payload.name?.trim()) {
      return Response.json({ message: "请输入专题名称。" }, { status: 400 });
    }

    /** collection 是数据库新建或更新后的专题。 */
    const collection = await saveCollection({
      userId: user.id,
      name: payload.name,
      description: payload.description ?? "",
    });
    return Response.json({ collection }, { status: 201 });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
