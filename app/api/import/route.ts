/** 从 Codex、ChatGPT 或其他来源快速收录优质回答。 */
import { resolveAuthenticatedUser } from "@/lib/auth";
import {
  serverErrorResponse,
  unauthorizedResponse,
} from "@/lib/http";
import {
  saveDeepDive,
  saveGeneratedCard,
} from "@/lib/repository";

/** 快速收录允许选择的知识领域。 */
type ImportDomain = "AI" | "BIO" | "DB";

/** 快速收录允许标记的内容来源。 */
type ImportSource = "Codex" | "ChatGPT" | "其他";

/** 浏览器提交的快速收录请求结构。 */
type ImportPayload = {
  /** 可选标题；留空时由正文第一行自动提取。 */
  title?: string;
  /** 卡片所属知识领域。 */
  domain?: ImportDomain;
  /** 原始回答的来源。 */
  source?: ImportSource;
  /** 需要完整保存的回答正文。 */
  content?: string;
};

/** 普通知识卡片允许收录的最小正文长度。 */
const MIN_IMPORT_CONTENT_LENGTH = 300;
/** 自动创建深度内容所需的最小正文长度。 */
const MIN_DEEP_DIVE_LENGTH = 2000;
/** 深度回答对应的卡片摘要正文长度。 */
const DEEP_DIVE_CARD_LENGTH = 1000;
/** 自动标题的最大字符数。 */
const MAX_AUTO_TITLE_LENGTH = 42;
/** 卡片摘要的最大字符数。 */
const MAX_SUMMARY_LENGTH = 110;

/** 判断未知字符串是否为允许的知识领域。 */
function isImportDomain(value: unknown): value is ImportDomain {
  return value === "AI" || value === "BIO" || value === "DB";
}

/** 判断未知字符串是否为允许的内容来源。 */
function isImportSource(value: unknown): value is ImportSource {
  return value === "Codex" || value === "ChatGPT" || value === "其他";
}

/** 去除 Markdown 标题符号和多余空白，得到适合界面展示的单行文字。 */
function normalizeDisplayLine(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从用户标题或正文第一行得到卡片标题。 */
function deriveTitle(requestedTitle: string | undefined, content: string): string {
  /** normalizedRequestedTitle 是用户主动填写并清理后的标题。 */
  const normalizedRequestedTitle = normalizeDisplayLine(requestedTitle ?? "");
  if (normalizedRequestedTitle) {
    return normalizedRequestedTitle.slice(0, MAX_AUTO_TITLE_LENGTH);
  }

  /** firstContentLine 是正文中第一条非空文本。 */
  const firstContentLine =
    content
      .split(/\r?\n/)
      .map((line) => normalizeDisplayLine(line))
      .find(Boolean) ?? "未命名知识点";
  return firstContentLine.slice(0, MAX_AUTO_TITLE_LENGTH);
}

/** 从正文生成列表页使用的一句话摘要。 */
function deriveSummary(content: string, title: string): string {
  /** summarySource 是去掉开头标题后的连续正文。 */
  const summarySource = normalizeDisplayLine(
    content.startsWith(title) ? content.slice(title.length) : content,
  );
  return (summarySource || title).slice(0, MAX_SUMMARY_LENGTH);
}

/** 为较长回答生成不超过约 1000 字的卡片预览正文。 */
function createCardContent(content: string): string {
  if (content.length < MIN_DEEP_DIVE_LENGTH) return content;
  /** previewSuffix 提示用户到深度阅读查看未截断原文。 */
  const previewSuffix = "\n\n……完整回答已保存到深度阅读。";
  /** previewLength 为预览正文扣除提示语后的可用字符数。 */
  const previewLength = DEEP_DIVE_CARD_LENGTH - previewSuffix.length;
  return `${content.slice(0, previewLength).trimEnd()}${previewSuffix}`;
}

/** 保存快速收录的回答，并在正文足够长时同步建立深度内容。 */
export async function POST(request: Request): Promise<Response> {
  try {
    /** user 是当前已登录的网页账号或已配对的 Android 账号。 */
    const user = await resolveAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    /** payload 是浏览器提交并经过最小类型约束的 JSON。 */
    const payload = (await request.json().catch(() => ({}))) as ImportPayload;
    /** content 是保留原始段落结构、仅去除首尾空白的回答正文。 */
    const content = payload.content?.trim() ?? "";
    if (content.length < MIN_IMPORT_CONTENT_LENGTH) {
      return Response.json(
        { message: `收录内容至少需要 ${MIN_IMPORT_CONTENT_LENGTH} 个字符。` },
        { status: 422 },
      );
    }

    /** domain 是校验后的知识领域，缺失时默认归入 AI 技术。 */
    const domain = isImportDomain(payload.domain) ? payload.domain : "AI";
    /** source 是校验后的回答来源，缺失时使用“其他”。 */
    const source = isImportSource(payload.source) ? payload.source : "其他";
    /** title 是用户填写或从正文自动提取的卡片标题。 */
    const title = deriveTitle(payload.title, content);
    /** summary 是知识库列表页使用的一句话摘要。 */
    const summary = deriveSummary(content, title);
    /** cardId 使用 UUID，避免电脑、手机和多次导入之间发生冲突。 */
    const cardId = `card_import_${crypto.randomUUID()}`;
    /** sourceDescription 是随内容持久化的来源说明。 */
    const sourceDescription = `用户从 ${source} 快速收录`;
    /** card 是写入 D1 后的最终知识卡片。 */
    const card = await saveGeneratedCard({
      userId: user.id,
      id: cardId,
      domain,
      series: "外部优质回答",
      level: 1,
      sequence: 1,
      title,
      summary,
      content: createCardContent(content),
      formula: null,
      flow: [],
      sources: [sourceDescription],
      origin: `import-${source.toLowerCase()}`,
    });

    /** deepDive 在正文少于 2000 字时保持为空。 */
    const deepDive =
      content.length >= MIN_DEEP_DIVE_LENGTH
        ? await saveDeepDive({
            userId: user.id,
            cardId,
            title,
            content,
            sources: [sourceDescription],
            origin: `import-${source.toLowerCase()}`,
          })
        : null;

    return Response.json({ card, deepDive }, { status: 201 });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
