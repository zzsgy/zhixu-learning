/** 网页或 Android 到点触发的实时卡片生成接口。 */
import { asc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { cards, settings } from "@/db/schema";
import { resolveAuthenticatedUser } from "@/lib/auth";
import { requestDeepSeekJson } from "@/lib/deepseek";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import { saveGeneratedCard } from "@/lib/repository";

/** 模型必须返回的卡片 JSON 结构。 */
type GeneratedCard = {
  /** 标题。 */
  title: string;
  /** 摘要。 */
  summary: string;
  /** 300 至 1000 字的技术正文。 */
  content: string;
  /** 可选公式。 */
  formula?: string | null;
  /** 流程步骤。 */
  flow?: string[];
  /** 参考资料。 */
  sources?: string[];
};

/** 请求方可选的领域覆盖参数。 */
type GeneratePayload = {
  /** 留空时按账号权重随机选择。 */
  domain?: "AI" | "BIO" | "DB";
};

/** 各领域随难度推进的体系化系列。 */
const DOMAIN_SERIES = {
  /** AI 主线。 */
  AI: ["大模型基础", "RAG 工程", "Agent 可靠性", "模型评估与推理优化"],
  /** 生物工程主线，重点覆盖生物制药、发酵和洁净生产。 */
  BIO: ["洁净生产与 CIP", "发酵过程控制", "卫生级流体设备", "换热与灭菌"],
  /** PostgreSQL 主线。 */
  DB: ["PostgreSQL 内核", "查询优化", "高可用与运维"],
} as const;

/** 根据用户权重随机选择一个领域。 */
function chooseWeightedDomain(input: {
  /** AI 权重。 */
  aiWeight: number;
  /** 生物工程权重。 */
  bioWeight: number;
  /** PostgreSQL 权重。 */
  dbWeight: number;
}): "AI" | "BIO" | "DB" {
  /** total 是三个非负权重之和。 */
  const total = input.aiWeight + input.bioWeight + input.dbWeight;
  /** point 是权重区间内的随机点。 */
  const point = Math.random() * Math.max(total, 1);
  if (point < input.aiWeight) return "AI";
  if (point < input.aiWeight + input.bioWeight) return "BIO";
  return "DB";
}

/** 实时生成并立即保存一张新卡片，不预先批量生成全年内容。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前统一账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();
    /** payload 是可选的领域覆盖参数。 */
    const payload = (await request.json().catch(() => ({}))) as GeneratePayload;
    /** db 是 D1 的 Drizzle 客户端。 */
    const db = getDb();
    /** userSettings 是账号共享的内容配比。 */
    const settingRows = await db
      .select()
      .from(settings)
      .where(eq(settings.userId, user.id))
      .limit(1);
    /** userSettings 在缺失时使用产品默认配比。 */
    const userSettings = settingRows[0] ?? {
      aiWeight: 40,
      bioWeight: 45,
      dbWeight: 15,
    };
    /** domain 是本次实际生成领域。 */
    const domain =
      payload.domain ??
      chooseWeightedDomain({
        aiWeight: userSettings.aiWeight,
        bioWeight: userSettings.bioWeight,
        dbWeight: userSettings.dbWeight,
      });
    /** existingCards 用于避免重复并推导学习进度。 */
    const existingCards = await db
      .select({
        title: cards.title,
        series: cards.series,
        level: cards.level,
        sequence: cards.sequence,
      })
      .from(cards)
      .where(
        or(isNull(cards.ownerUserId), eq(cards.ownerUserId, user.id)),
      )
      .orderBy(asc(cards.createdAt));
    /** domainCards 是当前领域已有内容。 */
    const domainCards = existingCards.filter((card) =>
      DOMAIN_SERIES[domain].some((series) => series === card.series),
    );
    /** sequence 是领域内下一张卡片的顺序。 */
    const sequence = domainCards.length + 1;
    /** level 每 20 张提升一级，最高为 5。 */
    const level = Math.min(5, Math.floor(domainCards.length / 20) + 1);
    /** seriesList 是当前领域的课程系列。 */
    const seriesList = DOMAIN_SERIES[domain];
    /** series 按顺序轮换，并随长期学习重复进入更深层。 */
    const series = seriesList[(sequence - 1) % seriesList.length];
    /** recentTitles 用于提示模型避免重复最近主题。 */
    const recentTitles = domainCards.slice(-12).map((card) => card.title);
    /** domainInstruction 是领域侧重点说明。 */
    const domainInstruction =
      domain === "BIO"
        ? "重点放在生物制药、发酵、洁净生产、CIP、泵、换热器、灭菌与工艺工程。"
        : domain === "DB"
          ? "聚焦 PostgreSQL 原理、SQL、索引、事务、性能和可靠运维。"
          : "聚焦大模型、Agent、RAG、推理、评估与论文中的具体技术点。";

    /** generated 是 DeepSeek 返回并解析后的结构化内容。 */
    const generated = await requestDeepSeekJson<GeneratedCard>({
      model: "deepseek-v4-flash",
      maxTokens: 3000,
      systemPrompt:
        "你是知序的中文技术课程编辑。只输出 JSON 对象，不要 Markdown 代码围栏。内容必须准确、可验证、纯技术导向，少量术语可保留英文。",
      userPrompt: `请生成一张体系化知识卡片，领域=${domain}，系列=${series}，难度等级=${level}，系列顺序=${sequence}。${domainInstruction}
正文目标 500-800 个中文字符，允许 300-1000 字；从概念、机制、工程判断和常见误区展开。提供必要公式、3-6 个流程步骤和 1-4 条可靠参考资料。不要重复这些近期标题：${recentTitles.join("、") || "无"}。
请严格输出 JSON：{"title":"...","summary":"...","content":"...","formula":"...或null","flow":["..."],"sources":["..."]}`,
    });
    if (generated.content.trim().length < 300) {
      return Response.json(
        { message: "生成内容不足 300 字，请重试。" },
        { status: 422 },
      );
    }

    /** cardId 使用 UUID，确保手机与网页同步时不冲突。 */
    const cardId = `card_${crypto.randomUUID()}`;
    /** saved 是数据库中的最终卡片。 */
    const saved = await saveGeneratedCard({
      userId: user.id,
      id: cardId,
      domain,
      series,
      level,
      sequence,
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
      formula: generated.formula ?? null,
      flow: Array.isArray(generated.flow) ? generated.flow : [],
      sources: Array.isArray(generated.sources) ? generated.sources : [],
      origin: "deepseek-v4-flash",
    });
    return Response.json({ card: saved }, { status: 201 });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
