/**
 * 经典论文每日推荐与兼容候选服务。
 *
 * 每日路线从本地经典目录选择一篇，只有用户确认后才进入论文库；旧的近期
 * arXiv 检索函数继续保留，供测试和未来主动检索扩展使用。
 */
import crypto from "node:crypto";
import {
  getPaperWeekStatus,
  listPaperCandidates,
  savePaperCandidates,
} from "./database.mjs";
import { fetchExternalResource } from "./article-parser.mjs";

/** arxivEndpoint 是无需浏览器跨域访问的公开论文检索接口。 */
const arxivEndpoint = "https://export.arxiv.org/api/query";
/** paperRequestTimeoutMilliseconds 是单次论文检索最长等待时间。 */
const paperRequestTimeoutMilliseconds = 20_000;
/** minimumReminderCandidates 是弹出选择提醒所需的最少候选数量。 */
const minimumReminderCandidates = 2;

/** classicPaperCatalog 按学习先后排列经典论文；只使用公开论文或作者主页。 */
export const classicPaperCatalog = Object.freeze([
  // 01 神经概率语言模型：从分布式词表示进入神经语言模型。
  Object.freeze({ externalId: "https://www.jmlr.org/papers/v3/bengio03a.html", title: "A Neural Probabilistic Language Model", titleZh: "一种神经概率语言模型", authors: ["Yoshua Bengio", "Réjean Ducharme", "Pascal Vincent", "Christian Jauvin"], category: "AI", publishedAt: "2003-02-01", sourceUrl: "https://www.jmlr.org/papers/v3/bengio03a.html", pdfUrl: "https://www.jmlr.org/papers/volume3/bengio03a/bengio03a.pdf", abstractZh: "以分布式词表示和神经网络联合学习语言模型，是理解神经语言模型、词向量与后续大模型预训练路线的基础工作。" }),
  // 02 Word2Vec：建立词向量和语义空间的工程基础。
  Object.freeze({ externalId: "https://arxiv.org/abs/1301.3781", title: "Efficient Estimation of Word Representations in Vector Space", titleZh: "向量空间中词表示的高效估计", authors: ["Tomas Mikolov", "Kai Chen", "Greg Corrado", "Jeffrey Dean"], category: "AI", publishedAt: "2013-01-16", sourceUrl: "https://arxiv.org/abs/1301.3781", pdfUrl: "https://arxiv.org/pdf/1301.3781", abstractZh: "提出高效学习连续词向量的架构，为 Word2Vec、语义相似度和现代向量检索建立了重要基础。" }),
  // 03 Seq2Seq：理解编码器—解码器序列生成范式。
  Object.freeze({ externalId: "https://arxiv.org/abs/1409.3215", title: "Sequence to Sequence Learning with Neural Networks", titleZh: "使用神经网络进行序列到序列学习", authors: ["Ilya Sutskever", "Oriol Vinyals", "Quoc V. Le"], category: "AI", publishedAt: "2014-09-10", sourceUrl: "https://arxiv.org/abs/1409.3215", pdfUrl: "https://arxiv.org/pdf/1409.3215", abstractZh: "用端到端编码器—解码器处理可变长度序列，奠定神经机器翻译和通用序列生成的经典范式。" }),
  // 04 Bahdanau Attention：理解可学习软对齐的起点。
  Object.freeze({ externalId: "https://arxiv.org/abs/1409.0473", title: "Neural Machine Translation by Jointly Learning to Align and Translate", titleZh: "通过联合学习对齐与翻译实现神经机器翻译", authors: ["Dzmitry Bahdanau", "Kyunghyun Cho", "Yoshua Bengio"], category: "AI", publishedAt: "2014-09-01", sourceUrl: "https://arxiv.org/abs/1409.0473", pdfUrl: "https://arxiv.org/pdf/1409.0473", abstractZh: "引入可学习的软对齐机制，使模型生成每个词时动态关注输入的不同部分，是 Attention 思想的关键来源。" }),
  // 05 Transformer：现代大语言模型架构的直接基础。
  Object.freeze({ externalId: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", titleZh: "注意力机制就是你所需要的一切", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin"], category: "AI", publishedAt: "2017-06-12", sourceUrl: "https://arxiv.org/abs/1706.03762", pdfUrl: "https://arxiv.org/pdf/1706.03762", abstractZh: "提出完全基于注意力的 Transformer，移除循环与卷积结构，成为现代大语言模型的核心架构基础。" }),
  // 06 BERT：理解双向预训练和下游微调。
  Object.freeze({ externalId: "https://arxiv.org/abs/1810.04805", title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding", titleZh: "BERT：用于语言理解的深度双向 Transformer 预训练", authors: ["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"], category: "AI", publishedAt: "2018-10-11", sourceUrl: "https://arxiv.org/abs/1810.04805", pdfUrl: "https://arxiv.org/pdf/1810.04805", abstractZh: "通过掩码语言模型预训练深度双向 Transformer，展示预训练后微调在多项语言理解任务上的通用能力。" }),
  // 07 GPT-3：理解规模扩展与上下文少样本学习。
  Object.freeze({ externalId: "https://arxiv.org/abs/2005.14165", title: "Language Models are Few-Shot Learners", titleZh: "语言模型是少样本学习器", authors: ["Tom B. Brown", "Benjamin Mann", "Nick Ryder", "Melanie Subbiah", "Jared Kaplan et al."], category: "AI", publishedAt: "2020-05-28", sourceUrl: "https://arxiv.org/abs/2005.14165", pdfUrl: "https://arxiv.org/pdf/2005.14165", abstractZh: "系统展示大规模自回归语言模型通过上下文示例完成零样本、单样本和少样本任务的能力。" }),
  // 08 DPR：从稠密语义检索进入 RAG 检索器。
  Object.freeze({ externalId: "https://arxiv.org/abs/2004.04906", title: "Dense Passage Retrieval for Open-Domain Question Answering", titleZh: "用于开放域问答的稠密段落检索", authors: ["Vladimir Karpukhin", "Barlas Oğuz", "Sewon Min", "Patrick Lewis et al."], category: "AI", publishedAt: "2020-04-10", sourceUrl: "https://arxiv.org/abs/2004.04906", pdfUrl: "https://arxiv.org/pdf/2004.04906", abstractZh: "使用双编码器把问题和段落映射到稠密向量空间，是理解语义检索、向量数据库和 RAG 检索器的重要基础。" }),
  // 09 RAG：参数化模型与非参数化知识索引结合。
  Object.freeze({ externalId: "https://arxiv.org/abs/2005.11401", title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", titleZh: "面向知识密集型 NLP 任务的检索增强生成", authors: ["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus", "Fabio Petroni et al."], category: "AI", publishedAt: "2020-05-22", sourceUrl: "https://arxiv.org/abs/2005.11401", pdfUrl: "https://arxiv.org/pdf/2005.11401", abstractZh: "将参数化生成模型与非参数化稠密文档索引结合，提出经典 RAG 训练与生成框架。" }),
  // 10 FAISS：大规模向量相似度检索工程基础。
  Object.freeze({ externalId: "https://arxiv.org/abs/1702.08734", title: "Billion-scale similarity search with GPUs", titleZh: "使用 GPU 进行十亿规模相似度搜索", authors: ["Jeff Johnson", "Matthijs Douze", "Hervé Jégou"], category: "数据库", publishedAt: "2017-02-28", sourceUrl: "https://arxiv.org/abs/1702.08734", pdfUrl: "https://arxiv.org/pdf/1702.08734", abstractZh: "介绍面向大规模向量相似度搜索的 GPU 算法与工程实现，是理解 FAISS 和向量索引系统的重要论文。" }),
  // 11 HNSW：现代向量数据库常用图索引。
  Object.freeze({ externalId: "https://arxiv.org/abs/1603.09320", title: "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs", titleZh: "基于分层可导航小世界图的高效稳健近似最近邻搜索", authors: ["Yu. A. Malkov", "D. A. Yashunin"], category: "数据库", publishedAt: "2016-03-30", sourceUrl: "https://arxiv.org/abs/1603.09320", pdfUrl: "https://arxiv.org/pdf/1603.09320", abstractZh: "提出 HNSW 图索引，在高召回率和高查询效率之间取得良好平衡，广泛用于现代向量数据库。" }),
  // 12 ReAct：Agent 推理、动作与观察闭环。
  Object.freeze({ externalId: "https://arxiv.org/abs/2210.03629", title: "ReAct: Synergizing Reasoning and Acting in Language Models", titleZh: "ReAct：在语言模型中协同推理与行动", authors: ["Shunyu Yao", "Jeffrey Zhao", "Dian Yu", "Nan Du et al."], category: "AI", publishedAt: "2022-10-06", sourceUrl: "https://arxiv.org/abs/2210.03629", pdfUrl: "https://arxiv.org/pdf/2210.03629", abstractZh: "让语言模型交替生成推理轨迹与动作，是理解现代 Agent 工具调用、观察反馈和任务闭环的经典工作。" }),
  // 13 Toolformer：语言模型自主学习工具调用。
  Object.freeze({ externalId: "https://arxiv.org/abs/2302.04761", title: "Toolformer: Language Models Can Teach Themselves to Use Tools", titleZh: "Toolformer：语言模型可以自学使用工具", authors: ["Timo Schick", "Jane Dwivedi-Yu", "Roberto Dessì", "Roberta Raileanu et al."], category: "AI", publishedAt: "2023-02-09", sourceUrl: "https://arxiv.org/abs/2302.04761", pdfUrl: "https://arxiv.org/pdf/2302.04761", abstractZh: "探索语言模型自主学习何时以及如何调用外部工具，为函数调用和工具增强型 Agent 提供代表性方法。" }),
  // 14 BioBERT：大模型方法在生物医学文本中的领域化。
  Object.freeze({ externalId: "https://arxiv.org/abs/1901.08746", title: "BioBERT: a pre-trained biomedical language representation model for biomedical text mining", titleZh: "BioBERT：用于生物医学文本挖掘的预训练语言表示模型", authors: ["Jinhyuk Lee", "Wonjin Yoon", "Sungdong Kim", "Donghyeon Kim et al."], category: "生物工程", publishedAt: "2019-01-25", sourceUrl: "https://arxiv.org/abs/1901.08746", pdfUrl: "https://arxiv.org/pdf/1901.08746", abstractZh: "在大规模生物医学语料上继续预训练 BERT，展示领域预训练对生物医学命名实体、关系抽取和问答的价值。" }),
  // 15 AlphaFold2：深度学习影响结构生物学的里程碑。
  Object.freeze({ externalId: "https://www.nature.com/articles/s41586-021-03819-2", title: "Highly accurate protein structure prediction with AlphaFold", titleZh: "使用 AlphaFold 进行高精度蛋白质结构预测", authors: ["John Jumper", "Richard Evans", "Alexander Pritzel", "Tim Green et al."], category: "生物工程", publishedAt: "2021-07-15", sourceUrl: "https://www.nature.com/articles/s41586-021-03819-2", pdfUrl: null, abstractZh: "AlphaFold2 以端到端神经网络显著提升蛋白质三维结构预测精度，是深度学习影响结构生物学的里程碑工作。" }),
]);

/** paperTopics 定义每周候选论文覆盖的技术主题和展示分类。 */
const paperTopics = Object.freeze([
  {
    category: "AI",
    query: "cat:cs.AI OR cat:cs.LG OR cat:cs.CL",
    maxResults: 20,
    preferenceTerms: Object.freeze([
      Object.freeze({
        pattern:
          /\b(?:large language models?|llms?|language agents?|agentic|multi-agent)\b/i,
        weight: 12,
      }),
      Object.freeze({
        pattern:
          /\b(?:tool use|tool calling|function calling|planning|agent memory|memory system|reasoning)\b/i,
        weight: 9,
      }),
      Object.freeze({
        pattern:
          /\b(?:retrieval-augmented generation|retrieval augmented generation|rag|model context protocol|mcp|long context)\b/i,
        weight: 8,
      }),
      Object.freeze({
        pattern:
          /\b(?:post-training|alignment|rlhf|dpo|fine-tuning|inference-time|test-time scaling|mixture of experts|moe)\b/i,
        weight: 6,
      }),
    ]),
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

/**
 * 计算候选论文与当前主题偏好的匹配分数。
 *
 * @param {Record<string, unknown>} candidate 待评分论文。
 * @param {{ preferenceTerms?: readonly { pattern: RegExp, weight: number }[] }} topic 主题偏好。
 * @returns {number} 分数越高表示越符合优先推荐方向。
 */
export function scorePaperPreference(candidate, topic) {
  /** searchableText 合并标题与摘要，避免只依赖标题命中关键词。 */
  const searchableText = `${candidate.title || ""} ${candidate.abstract || ""}`;
  /** preferenceTerms 是当前主题配置的带权关键词规则。 */
  const preferenceTerms = topic.preferenceTerms ?? [];
  return preferenceTerms.reduce(
    (score, term) =>
      score + (term.pattern.test(searchableText) ? term.weight : 0),
    0,
  );
}

/**
 * 从近期论文中优先选出最符合主题技术偏好的候选项。
 *
 * @param {Record<string, unknown>[]} candidates arXiv 返回的近期论文。
 * @param {Record<string, unknown>} topic 当前主题配置。
 * @returns {Record<string, unknown> | null} 最优候选论文或空值。
 */
export function selectPreferredPaperCandidate(candidates, topic) {
  /** completeCandidates 排除缺少核心元数据、无法展示或选择的论文。 */
  const completeCandidates = candidates.filter(
    (candidate) =>
      candidate.externalId &&
      candidate.title &&
      candidate.abstract &&
      candidate.sourceUrl,
  );
  /** rankedCandidates 先按偏好分数、再按发布时间倒序排列。 */
  const rankedCandidates = completeCandidates.toSorted((left, right) => {
    /** scoreDifference 是右侧与左侧的偏好分差，用于高分优先。 */
    const scoreDifference =
      scorePaperPreference(right, topic) - scorePaperPreference(left, topic);
    if (scoreDifference !== 0) return scoreDifference;
    /** rightPublishedAt 是右侧论文的可比较发布时间。 */
    const rightPublishedAt = Date.parse(String(right.publishedAt || "")) || 0;
    /** leftPublishedAt 是左侧论文的可比较发布时间。 */
    const leftPublishedAt = Date.parse(String(left.publishedAt || "")) || 0;
    return rightPublishedAt - leftPublishedAt;
  });
  return rankedCandidates[0] ?? null;
}

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
 * @param {{ category: string, query: string, maxResults?: number, preferenceTerms?: readonly { pattern: RegExp, weight: number }[] }} topic 主题配置。
 * @returns {Promise<Record<string, unknown> | null>} 单篇候选论文或空值。
 */
async function fetchTopicCandidate(topic) {
  /** requestUrl 是带检索表达式和排序规则的 arXiv API 地址。 */
  const requestUrl = new URL(arxivEndpoint);
  requestUrl.searchParams.set("search_query", topic.query);
  requestUrl.searchParams.set("start", "0");
  requestUrl.searchParams.set("max_results", String(topic.maxResults ?? 5));
  requestUrl.searchParams.set("sortBy", "submittedDate");
  requestUrl.searchParams.set("sortOrder", "descending");
  /** response 是公开论文接口响应。 */
  const response = await fetchExternalResource(requestUrl, {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": "ZhixuLocalKnowledge/1.0",
    },
    signal: AbortSignal.timeout(paperRequestTimeoutMilliseconds),
  }, "arXiv 论文接口");
  if (!response.ok) {
    throw new Error(`论文来源暂时不可用（${response.status}）。`);
  }
  /** xml 是 arXiv 返回的 Atom 正文。 */
  const xml = await response.text();
  /** candidates 是该主题解析出的近期论文。 */
  const candidates = parseArxivResponse(xml, topic.category);
  return selectPreferredPaperCandidate(candidates, topic);
}

/**
 * 根据 arXiv 摘要页或 PDF 链接读取一篇论文的规范元数据。
 *
 * @param {string} rawUrl 用户提交的 arXiv 链接。
 * @returns {Promise<Record<string, unknown> | null>} 论文元数据或空值。
 */
export async function fetchArxivPaperByUrl(rawUrl) {
  /** parsedUrl 是已经标准化的 arXiv 链接。 */
  const parsedUrl = new URL(String(rawUrl || ""));
  if (!/(^|\.)arxiv\.org$/i.test(parsedUrl.hostname)) return null;
  /** arxivId 是兼容新旧编号形式的无版本论文编号。 */
  const arxivId = parsedUrl.pathname
    .replace(/^\/(?:abs|pdf)\//i, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "")
    .trim();
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})$/i.test(arxivId)) {
    throw new TypeError("无法从链接中识别 arXiv 论文编号。");
  }
  /** requestUrl 是只查询一个编号的官方 Atom API。 */
  const requestUrl = new URL(arxivEndpoint);
  requestUrl.searchParams.set("id_list", arxivId);
  /** response 是 arXiv 官方元数据响应。 */
  const response = await fetchExternalResource(requestUrl, {
    headers: { Accept: "application/atom+xml", "User-Agent": "ZhixuLocalKnowledge/1.0" },
    signal: AbortSignal.timeout(paperRequestTimeoutMilliseconds),
  }, "arXiv 元数据接口");
  if (!response.ok) throw new Error(`arXiv 元数据读取失败（${response.status}）。`);
  /** candidates 是官方响应中解析出的唯一论文。 */
  const candidates = parseArxivResponse(await response.text(), "AI");
  return candidates[0] ?? null;
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

/**
 * 返回本地日期对应的每日推荐键。
 *
 * @param {Date} inputDate 当前本地时间。
 * @returns {string} 例如 daily:2026-08-18。
 */
export function getDailyPaperKey(inputDate = new Date()) {
  /** year 是本地年份。 */
  const year = inputDate.getFullYear();
  /** month 是补零后的本地月份。 */
  const month = String(inputDate.getMonth() + 1).padStart(2, "0");
  /** day 是补零后的本地日期。 */
  const day = String(inputDate.getDate()).padStart(2, "0");
  return `daily:${year}-${month}-${day}`;
}

/**
 * 为某一天生成唯一一篇经典论文候选。
 *
 * @param {Date} currentDate 当前时间，测试时可注入。
 * @returns {Promise<Record<string, unknown>[]>} 当天唯一候选。
 */
export async function ensureDailyClassicPaperCandidate(currentDate = new Date()) {
  /** dailyKey 是当天候选和提醒状态共用的键。 */
  const dailyKey = getDailyPaperKey(currentDate);
  /** cachedCandidates 是当天已经生成的候选。 */
  const cachedCandidates = listPaperCandidates(dailyKey);
  if (cachedCandidates.length > 0) return cachedCandidates;
  /** routeStart 是经典路线从第一篇开始计算的本地日期。 */
  const routeStart = new Date(2026, 7, 18);
  /** currentDay 是剔除时分秒后的当前本地日期。 */
  const currentDay = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  );
  /** dayOffset 是从经典路线第一天起经过的完整天数。 */
  const dayOffset = Math.max(
    0,
    Math.floor((currentDay.getTime() - routeStart.getTime()) / 86_400_000),
  );
  /** catalogItem 是今天按顺序轮到的经典论文。 */
  const catalogItem = classicPaperCatalog[dayOffset % classicPaperCatalog.length];
  /** candidate 是与旧候选表兼容的每日经典记录。 */
  const candidate = {
    id: `candidate_${crypto.randomUUID()}`,
    ...catalogItem,
    abstract: catalogItem.abstractZh,
    titleZh: catalogItem.titleZh,
    abstractZh: catalogItem.abstractZh,
    translationSource: "codex",
    translatedAt: new Date().toISOString(),
  };
  return savePaperCandidates(dailyKey, [candidate]);
}

/**
 * 返回今天是否应弹出经典论文提醒。
 *
 * @param {Date} currentDate 当前时间，测试时可注入。
 * @returns {Promise<Record<string, unknown>>} 每日提醒状态。
 */
export async function getDailyClassicPaperReminder(currentDate = new Date()) {
  /** dailyKey 是当天状态键。 */
  const dailyKey = getDailyPaperKey(currentDate);
  /** candidates 是今天固定的一篇经典论文。 */
  const candidates = await ensureDailyClassicPaperCandidate(currentDate);
  /** dailyStatus 复用本地提醒状态表存储选择、延后与跳过。 */
  const dailyStatus = getPaperWeekStatus(dailyKey);
  /** isSnoozed 表示用户选择的提醒时间尚未到达。 */
  const isSnoozed =
    Boolean(dailyStatus?.snoozedUntil) &&
    new Date(dailyStatus.snoozedUntil).getTime() > currentDate.getTime();
  /** due 表示今天尚未处理且未延后。 */
  const due =
    (!dailyStatus || dailyStatus.status === "pending") &&
    !isSnoozed;
  return {
    weekKey: dailyKey,
    dailyKey,
    due,
    candidates: due ? candidates : [],
    status: dailyStatus?.status ?? "pending",
    snoozedUntil: dailyStatus?.snoozedUntil ?? null,
    translationReady: true,
  };
}
