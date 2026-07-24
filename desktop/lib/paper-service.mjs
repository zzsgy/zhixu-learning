/**
 * 每周论文候选服务。
 *
 * 服务端从 arXiv 公开接口读取近期论文元数据，候选项先缓存在本地 SQLite；
 * 只有用户在弹窗中确认后，论文才会正式进入论文库。
 */
import crypto from "node:crypto";
import {
  getPaperWeekStatus,
  listPaperCandidates,
  savePaperCandidates,
} from "./database.mjs";

/** arxivEndpoint 是无需浏览器跨域访问的公开论文检索接口。 */
const arxivEndpoint = "https://export.arxiv.org/api/query";
/** paperRequestTimeoutMilliseconds 是单次论文检索最长等待时间。 */
const paperRequestTimeoutMilliseconds = 20_000;
/** minimumReminderCandidates 是弹出选择提醒所需的最少候选数量。 */
const minimumReminderCandidates = 2;

/** paperTopics 定义每周候选论文覆盖的技术主题和展示分类。 */
const paperTopics = Object.freeze([
  {
    category: "AI",
    query: "cat:cs.AI OR cat:cs.LG OR cat:cs.CL",
  },
  {
    category: "生物工程",
    query:
      'all:bioprocess OR all:biopharmaceutical OR all:"protein purification"',
  },
  {
    category: "工艺工程",
    query:
      'all:fermentation OR all:"clean-in-place" OR all:"heat exchanger"',
  },
  {
    category: "数据库",
    query: "cat:cs.DB",
  },
]);

/** generationPromises 防止同一自然周被多个并发请求重复抓取。 */
const generationPromises = new Map();

/**
 * 返回某个日期所属的 ISO 自然周标识。
 *
 * @param {Date} inputDate 需要换算的日期。
 * @returns {string} 例如 2026-W30 的周标识。
 */
export function getIsoWeekKey(inputDate = new Date()) {
  /** utcDate 是去除本地时区差异后的 UTC 日期副本。 */
  const utcDate = new Date(
    Date.UTC(
      inputDate.getFullYear(),
      inputDate.getMonth(),
      inputDate.getDate(),
    ),
  );
  /** weekday 是将星期日换算为 7 后的 ISO 星期序号。 */
  const weekday = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - weekday);
  /** isoYear 是 ISO 周所属年份。 */
  const isoYear = utcDate.getUTCFullYear();
  /** yearStart 是 ISO 年第一天。 */
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  /** weekNumber 是从 ISO 年第一周开始计算的周序号。 */
  const weekNumber = Math.ceil(
    ((utcDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(weekNumber).padStart(2, "0")}`;
}

/**
 * 解码 arXiv Atom XML 中常见的字符实体。
 *
 * @param {string} value 原始 XML 文本。
 * @returns {string} 已恢复字符并合并空白的文本。
 */
function decodeXmlText(value) {
  /** namedEntities 是 XML/HTML 常见命名实体映射。 */
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_match, codePoint) =>
      String.fromCodePoint(Number(codePoint)),
    )
    .replace(/&#x([\da-f]+);/gi, (_match, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities[name] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 读取一个 Atom 节点中的首个指定标签。
 *
 * @param {string} entryXml 单篇论文的 XML。
 * @param {string} tagName 标签名称。
 * @returns {string} 清理后的标签正文。
 */
function readXmlTag(entryXml, tagName) {
  /** expression 是限定在指定标签内的非贪婪匹配。 */
  const expression = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  /** match 是标签匹配结果。 */
  const match = entryXml.match(expression);
  return match ? decodeXmlText(match[1]) : "";
}

/**
 * 从单篇 arXiv Atom 记录中读取指定关系的链接。
 *
 * @param {string} entryXml 单篇论文 XML。
 * @param {string} relation 目标 rel 属性。
 * @param {string} [contentType] 可选 type 属性。
 * @returns {string | null} 链接地址或空值。
 */
function readEntryLink(entryXml, relation, contentType = "") {
  /** linkTags 是论文记录中的全部自闭合 link 标签。 */
  const linkTags = entryXml.match(/<link\b[^>]*\/?>/gi) ?? [];
  for (const linkTag of linkTags) {
    /** relationMatch 是当前链接的 rel 属性。 */
    const relationMatch = linkTag.match(/\brel=["']([^"']+)["']/i);
    /** typeMatch 是当前链接的 type 属性。 */
    const typeMatch = linkTag.match(/\btype=["']([^"']+)["']/i);
    if (
      relationMatch?.[1] !== relation ||
      (contentType && typeMatch?.[1] !== contentType)
    ) {
      continue;
    }
    /** hrefMatch 是当前链接的 href 属性。 */
    const hrefMatch = linkTag.match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch) return decodeXmlText(hrefMatch[1]);
  }
  return null;
}

/**
 * 将 arXiv Atom 响应转换成候选论文对象。
 *
 * @param {string} xml Atom XML 正文。
 * @param {string} category 知序展示分类。
 * @returns {Record<string, unknown>[]} 候选论文数组。
 */
function parseArxivResponse(xml, category) {
  /** entryBlocks 是响应中的单篇论文 XML 片段。 */
  const entryBlocks = xml.match(/<entry>([\s\S]*?)<\/entry>/gi) ?? [];
  return entryBlocks.map((entryXml) => {
    /** rawExternalId 是 arXiv 返回的论文详情地址。 */
    const rawExternalId = readXmlTag(entryXml, "id");
    /** externalId 去除版本号，避免后续版本被当作全新论文。 */
    const externalId = rawExternalId.replace(/v\d+$/i, "");
    /** authorBlocks 是单篇论文的作者节点。 */
    const authorBlocks = entryXml.match(/<author>([\s\S]*?)<\/author>/gi) ?? [];
    /** authors 是保持原顺序的作者姓名列表。 */
    const authors = authorBlocks
      .map((authorXml) => readXmlTag(authorXml, "name"))
      .filter(Boolean);
    /** sourceUrl 是论文摘要页地址。 */
    const sourceUrl =
      readEntryLink(entryXml, "alternate") || externalId || rawExternalId;
    /** pdfUrl 是公开 PDF 下载地址。 */
    const pdfUrl = readEntryLink(entryXml, "related", "application/pdf");
    return {
      id: `candidate_${crypto.randomUUID()}`,
      externalId,
      title: readXmlTag(entryXml, "title"),
      abstract: readXmlTag(entryXml, "summary").slice(0, 4_000),
      authors,
      category,
      publishedAt: readXmlTag(entryXml, "published") || null,
      sourceUrl,
      pdfUrl,
    };
  });
}

/**
 * 从 arXiv 获取一个主题下最新且信息完整的候选论文。
 *
 * @param {{ category: string, query: string }} topic 主题配置。
 * @returns {Promise<Record<string, unknown> | null>} 单篇候选论文或空值。
 */
async function fetchTopicCandidate(topic) {
  /** requestUrl 是带检索表达式和排序规则的 arXiv API 地址。 */
  const requestUrl = new URL(arxivEndpoint);
  requestUrl.searchParams.set("search_query", topic.query);
  requestUrl.searchParams.set("start", "0");
  requestUrl.searchParams.set("max_results", "5");
  requestUrl.searchParams.set("sortBy", "submittedDate");
  requestUrl.searchParams.set("sortOrder", "descending");
  /** response 是公开论文接口响应。 */
  const response = await fetch(requestUrl, {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": "ZhixuLocalKnowledge/1.0",
    },
    signal: AbortSignal.timeout(paperRequestTimeoutMilliseconds),
  });
  if (!response.ok) {
    throw new Error(`论文来源暂时不可用（${response.status}）。`);
  }
  /** xml 是 arXiv 返回的 Atom 正文。 */
  const xml = await response.text();
  /** candidates 是该主题解析出的近期论文。 */
  const candidates = parseArxivResponse(xml, topic.category);
  return (
    candidates.find(
      (candidate) =>
        candidate.externalId &&
        candidate.title &&
        candidate.abstract &&
        candidate.sourceUrl,
    ) ?? null
  );
}

/**
 * 为指定自然周准备候选论文；已有缓存时不再联网。
 *
 * @param {string} weekKey ISO 周标识。
 * @returns {Promise<Record<string, unknown>[]>} 本周候选论文。
 */
export async function ensureWeeklyPaperCandidates(
  weekKey = getIsoWeekKey(),
) {
  /** cachedCandidates 是本周已经写入本地数据库的候选项。 */
  const cachedCandidates = listPaperCandidates(weekKey);
  if (cachedCandidates.length > 0) return cachedCandidates;
  if (generationPromises.has(weekKey)) return generationPromises.get(weekKey);
  /** generationPromise 是当前自然周唯一的候选抓取任务。 */
  const generationPromise = (async () => {
    /** results 是各主题独立抓取的完成状态。 */
    const results = await Promise.allSettled(
      paperTopics.map((topic) => fetchTopicCandidate(topic)),
    );
    /** candidates 是过滤抓取失败和空记录后的有效候选项。 */
    const candidates = results
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    if (candidates.length < minimumReminderCandidates) return [];
    return savePaperCandidates(weekKey, candidates);
  })().finally(() => {
    generationPromises.delete(weekKey);
  });
  generationPromises.set(weekKey, generationPromise);
  return generationPromise;
}

/**
 * 返回当前是否应该向用户弹出每周论文选择提醒。
 *
 * @param {Date} currentDate 当前时间，测试时可注入。
 * @returns {Promise<Record<string, unknown>>} 提醒状态和候选论文。
 */
export async function getWeeklyPaperReminder(currentDate = new Date()) {
  /** weekKey 是当前 ISO 自然周。 */
  const weekKey = getIsoWeekKey(currentDate);
  /** candidates 是当前周缓存或新抓取的候选论文。 */
  const candidates = await ensureWeeklyPaperCandidates(weekKey);
  /** weekStatus 是用户对当前周提醒的处理状态。 */
  const weekStatus = getPaperWeekStatus(weekKey);
  /** isSnoozed 表示延后提醒时间尚未到达。 */
  const isSnoozed =
    Boolean(weekStatus?.snoozedUntil) &&
    new Date(weekStatus.snoozedUntil).getTime() > currentDate.getTime();
  /** translationReady 表示全部候选均已由 Codex 完成中文翻译。 */
  const translationReady =
    candidates.length >= minimumReminderCandidates &&
    candidates.every(
      (candidate) =>
        Boolean(candidate.titleZh?.trim()) &&
        Boolean(candidate.abstractZh?.trim()) &&
        candidate.translationSource === "codex",
    );
  /** due 表示本周仍未选择、未跳过且没有处于延后时间。 */
  const due =
    translationReady &&
    (!weekStatus || weekStatus.status === "pending") &&
    !isSnoozed;
  return {
    weekKey,
    due,
    candidates: due ? candidates : [],
    status: weekStatus?.status ?? "pending",
    snoozedUntil: weekStatus?.snoozedUntil ?? null,
    translationReady,
  };
}
