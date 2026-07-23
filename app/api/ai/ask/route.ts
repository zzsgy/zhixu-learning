/** 针对卡片的 AI 追问接口，对话会保存并在手机与网页间同步。 */
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { aiMessages, cards, deepDives } from "@/db/schema";
import { resolveAuthenticatedUser } from "@/lib/auth";
import { requestDeepSeekJson } from "@/lib/deepseek";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";

/** 客户端提交的追问字段。 */
type AskPayload = {
  /** 当前卡片 ID。 */
  cardId?: string;
  /** 用户问题。 */
  question?: string;
};

/** 模型必须返回的追问 JSON 结构。 */
type AskResult = {
  /** 技术回答。 */
  answer: string;
  /** 可选的后续问题。 */
  suggestedQuestions?: string[];
};

/** 回答一条技术追问，并保存问答双方消息。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是客户端提交的 JSON。 */
    const payload = (await request.json()) as AskPayload;
    /** question 是去除首尾空白并限制长度后的问题。 */
    const question = payload.question?.trim().slice(0, 4000) ?? "";
    if (!payload.cardId || !question) {
      return Response.json({ message: "卡片和问题不能为空。" }, { status: 400 });
    }

    /** db 是 D1 的 Drizzle 客户端。 */
    const db = getDb();
    /** cardRows 最多返回一张当前账号可见卡片。 */
    const cardRows = await db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.id, payload.cardId),
          or(isNull(cards.ownerUserId), eq(cards.ownerUserId, user.id)),
        ),
      )
      .limit(1);
    /** card 是本次追问上下文。 */
    const card = cardRows[0];
    if (!card) {
      return Response.json({ message: "卡片不存在。" }, { status: 404 });
    }

    /** deepRows 是当前卡片已保存的深度内容。 */
    const deepRows = await db
      .select({ content: deepDives.content })
      .from(deepDives)
      .where(
        and(
          eq(deepDives.userId, user.id),
          eq(deepDives.cardId, card.id),
        ),
      )
      .limit(1);
    /** historyRows 是这张卡片最近的对话上下文。 */
    const historyRows = await db
      .select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.userId, user.id),
          eq(aiMessages.cardId, card.id),
        ),
      )
      .orderBy(asc(aiMessages.createdAt))
      .limit(12);
    /** generated 是 DeepSeek 返回的结构化回答。 */
    const generated = await requestDeepSeekJson<AskResult>({
      model: "deepseek-v4-pro",
      maxTokens: 5000,
      systemPrompt:
        "你是知序的中文技术导师。回答必须严谨、直接，区分事实、工程经验与推断。只输出 JSON 对象，不要 Markdown 代码围栏。",
      userPrompt: `卡片标题：${card.title}
卡片正文：${card.content}
已保存深度内容：${deepRows[0]?.content.slice(0, 12000) ?? "暂无"}
最近对话：${JSON.stringify(historyRows)}
用户问题：${question}
请输出 JSON：{"answer":"技术回答","suggestedQuestions":["后续问题1","后续问题2"]}`,
    });
    if (!generated.answer?.trim()) {
      throw new Error("DeepSeek 未返回有效回答。");
    }

    /** now 是用户消息保存时间。 */
    const now = new Date();
    /** assistantTime 比用户消息晚一毫秒，确保排序稳定。 */
    const assistantTime = new Date(now.getTime() + 1);
    /** userMessage 是待保存的用户提问。 */
    const userMessage = {
      id: crypto.randomUUID(),
      userId: user.id,
      cardId: card.id,
      role: "user",
      content: question,
      createdAt: now.toISOString(),
    };
    /** assistantMessage 是待保存的 AI 回答。 */
    const assistantMessage = {
      id: crypto.randomUUID(),
      userId: user.id,
      cardId: card.id,
      role: "assistant",
      content: generated.answer.trim(),
      createdAt: assistantTime.toISOString(),
    };
    await db.batch([
      db.insert(aiMessages).values(userMessage),
      db.insert(aiMessages).values(assistantMessage),
    ]);

    return Response.json({
      userMessage,
      assistantMessage,
      suggestedQuestions: Array.isArray(generated.suggestedQuestions)
        ? generated.suggestedQuestions.slice(0, 4)
        : [],
    });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
