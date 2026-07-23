/** 解析、分类并保存公开文章链接。 */
import { parseAndClassifyArticle } from "@/lib/article-parser";
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveArticle } from "@/lib/repository";

/** 浏览器提交的文章解析请求。 */
type ParseArticlePayload = {
  /** 普通网页或微信公众号文章链接。 */
  url?: string;
};

/** 解析一篇公开文章并保存到当前账号的文章库。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前已登录的网页账号或已配对的 Android 账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    /** payload 是经过最小结构约束的请求 JSON。 */
    const payload = (await request.json().catch(() => ({}))) as ParseArticlePayload;
    /** inputUrl 是移除首尾空白后的文章链接。 */
    const inputUrl = payload.url?.trim() ?? "";
    if (!inputUrl) {
      return Response.json({ message: "请输入文章链接。" }, { status: 400 });
    }

    /** parsed 是完成正文提取、安全过滤与分类后的文章。 */
    const parsed = await parseAndClassifyArticle(inputUrl);
    /** saved 是写入当前账号 D1 文章库后的最终记录。 */
    const saved = await saveArticle({
      userId: user.id,
      id: `article_${crypto.randomUUID()}`,
      ...parsed,
    });
    return Response.json({ article: saved }, { status: 201 });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
