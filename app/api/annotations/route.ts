/** 个人批注新增与删除接口。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import {
  createAnnotation,
  deleteAnnotation,
  type KnowledgeTargetType,
} from "@/lib/repository";

/** 浏览器允许提交的个人批注字段。 */
type AnnotationPayload = {
  /** card 或 article。 */
  targetType?: KnowledgeTargetType;
  /** 卡片或文章稳定 ID。 */
  targetId?: string;
  /** 可选的原文引用。 */
  quoteText?: string | null;
  /** 用户自己的批注正文。 */
  noteText?: string;
};

/** 服务端允许写入的目标类型。 */
const ALLOWED_TARGET_TYPES = new Set<KnowledgeTargetType>(["card", "article"]);

/** 新增一条属于当前用户的个人批注。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前网页登录账号或已配对 Android 账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的批注结构。 */
    const payload = (await request.json().catch(() => ({}))) as AnnotationPayload;
    if (
      !payload.targetId ||
      !payload.targetType ||
      !ALLOWED_TARGET_TYPES.has(payload.targetType) ||
      !payload.noteText?.trim()
    ) {
      return Response.json({ message: "批注参数不完整。" }, { status: 400 });
    }

    /** annotation 是数据库新建的个人批注。 */
    const annotation = await createAnnotation({
      userId: user.id,
      targetType: payload.targetType,
      targetId: payload.targetId,
      quoteText: payload.quoteText ?? null,
      noteText: payload.noteText,
    });
    return Response.json({ annotation }, { status: 201 });
  } catch (error) {
    return serverErrorResponse(error);
  }
}

/** 删除一条属于当前用户的个人批注。 */
export async function DELETE(request: Request): Promise<Response> {
  try {
    /** user 是当前网页登录账号或已配对 Android 账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** annotationId 是查询参数中待删除的批注 ID。 */
    const annotationId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!annotationId) {
      return Response.json({ message: "缺少批注 ID。" }, { status: 400 });
    }
    /** result 表示删除请求已经按用户归属安全执行。 */
    const result = await deleteAnnotation({
      userId: user.id,
      annotationId,
    });
    return Response.json(result);
  } catch (error) {
    return serverErrorResponse(error);
  }
}
