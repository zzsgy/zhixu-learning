/**
 * Docsify 教程站发现与 Markdown 章节解析模块。
 *
 * 模块只读取同源公开 Markdown，不执行目标网站 JavaScript，也不会递归抓取正文中的站外链接。
 */
import { marked } from "marked";
import { parseHTML } from "linkedom";
import { classifyDocument, isDocumentCategory } from "./classifier.mjs";
import {
  detectArticleLanguage,
  fetchPublicSource,
  sanitizeArticleHtml,
} from "./article-parser.mjs";

/** minimumChapterLength 是有效教程章节所需的最少正文字符数。 */
const minimumChapterLength = 180;
/** maximumDiscoveredChapters 防止异常目录产生无限批量请求。 */
const maximumDiscoveredChapters = 200;
/** discoveryConcurrency 是目录验证时允许并发读取的章节数量。 */
const discoveryConcurrency = 4;

/** markedOptions 是教程 Markdown 的本地渲染规则。 */
const markedOptions = Object.freeze({
  gfm: true,
  breaks: false,
  async: false,
});

/**
 * 清理 Markdown 链接文字中的强调符号和多余空白。
 *
 * @param {string} value 原始目录文字。
 * @returns {string} 可用于标题展示的纯文本。
 */
function cleanLabel(value) {
  return String(value || "")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从站点 HTML 中读取网页标题。
 *
 * @param {string} html Docsify 入口 HTML。
 * @param {URL} baseUrl 站点根地址。
 * @returns {string} 简洁站点名称。
 */
function readSiteTitle(html, baseUrl) {
  /** parsedDocument 是只用于读取 title 的隔离文档。 */
  const { document: parsedDocument } = parseHTML(html);
  /** rawTitle 是网页声明的完整标题。 */
  const rawTitle = parsedDocument.title?.replace(/\s+/g, " ").trim() || "";
  /** pathName 是站点根目录的最后一段。 */
  const pathName = baseUrl.pathname.split("/").filter(Boolean).at(-1) || baseUrl.hostname;
  if (/all[-_ ]?in[-_ ]?rag/i.test(`${rawTitle} ${pathName}`)) return "All-in-RAG";
  return rawTitle.split(/[|｜·]/)[0].trim().slice(0, 100) || pathName;
}

/**
 * 将用户输入地址转换为 Docsify 站点根地址和可选章节路由。
 *
 * @param {string} inputUrl 用户输入的根地址或章节地址。
 * @returns {{ baseUrl: URL, route: string }} 根地址和 Hash 路由。
 */
export function normalizeDocumentationSourceUrl(inputUrl) {
  /** parsedUrl 是经过 URL 标准解析的输入地址。 */
  const parsedUrl = new URL(String(inputUrl || "").trim());
  /** githubTreeMatch 识别公开 GitHub 仓库中的文档目录链接。 */
  const githubTreeMatch = parsedUrl.hostname.toLowerCase() === "github.com"
    ? parsedUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/)
    : null;
  if (githubTreeMatch) {
    /** owner 是 GitHub 仓库所属组织或用户。 */
    const owner = decodeURIComponent(githubTreeMatch[1]);
    /** repository 是去除可选 .git 后缀的仓库名称。 */
    const repository = decodeURIComponent(githubTreeMatch[2]).replace(/\.git$/i, "");
    /** branch 是 GitHub tree 链接中声明的分支或标签。 */
    const branch = decodeURIComponent(githubTreeMatch[3]);
    /** directoryPath 是仓库内准备作为教程根目录的相对路径。 */
    const directoryPath = decodeURIComponent(githubTreeMatch[4]).replace(/^\/+|\/+$/g, "");
    if (!owner || !repository || !branch || !directoryPath || directoryPath.includes("..")) {
      throw new Error("GitHub 文档目录链接不完整。");
    }
    /** baseUrl 是读取 Markdown 和图片时使用的 Raw 文档根地址。 */
    const baseUrl = new URL(
      `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(branch)}/${directoryPath}/`,
    );
    /** publicBaseUrl 是文章阅读页“查看原网页”使用的 GitHub 文件目录。 */
    const publicBaseUrl = new URL(
      `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/blob/${encodeURIComponent(branch)}/${directoryPath}/`,
    );
    return {
      baseUrl,
      publicBaseUrl,
      displayBaseUrl: parsedUrl.href,
      route: "",
      sourceKind: "github-docs",
      repository,
    };
  }
  /** route 是移除 #、前导斜杠和查询参数后的章节路径。 */
  const route = decodeURIComponent(parsedUrl.hash.replace(/^#\/?/, ""))
    .split("?")[0]
    .replace(/^\/+|\/+$/g, "");
  parsedUrl.hash = "";
  parsedUrl.search = "";
  if (!parsedUrl.pathname.endsWith("/")) {
    /** lastSegment 是判断输入路径是否为文件名的最后一段。 */
    const lastSegment = parsedUrl.pathname.split("/").at(-1) || "";
    parsedUrl.pathname = lastSegment.includes(".")
      ? parsedUrl.pathname.slice(0, parsedUrl.pathname.lastIndexOf("/") + 1)
      : `${parsedUrl.pathname}/`;
  }
  return {
    baseUrl: parsedUrl,
    publicBaseUrl: parsedUrl,
    displayBaseUrl: parsedUrl.href,
    route,
    sourceKind: "docsify",
    repository: "",
  };
}

/**
 * 把目录 href 转换为同源 Markdown 源地址和正常阅读地址。
 *
 * @param {string} href `_sidebar.md` 中的链接。
 * @param {URL} baseUrl Docsify 根地址。
 * @returns {{ sourceUrl: string, publicUrl: string, route: string } | null} 标准章节地址。
 */
function resolveChapterLink(href, baseUrl, publicBaseUrl = baseUrl) {
  /** rawHref 是去除标题和锚点后的链接正文。 */
  const rawHref = String(href || "").trim().replace(/\s+["'].*$/, "");
  if (!rawHref || /^(?:https?:)?\/\//i.test(rawHref) || rawHref.startsWith("#")) return null;
  /** route 是 Docsify 章节使用的无扩展路径。 */
  const route = rawHref
    .replace(/^\.\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!route || route.includes("..")) return null;
  /** sourcePath 是服务器上真实的 Markdown 相对路径。 */
  const sourcePath = rawHref.endsWith("/")
    ? `${rawHref}README.md`
    : /\.md(?:[?#]|$)/i.test(rawHref)
      ? rawHref.replace(/[?#].*$/, "")
      : `${rawHref.replace(/[?#].*$/, "")}.md`;
  /** sourceUrl 是与站点根地址同源的真实 Markdown 地址。 */
  const sourceUrl = new URL(sourcePath, baseUrl);
  if (sourceUrl.origin !== baseUrl.origin || !sourceUrl.pathname.startsWith(baseUrl.pathname)) return null;
  /** publicUrl 是用户在原站点打开章节时使用的可读地址。 */
  const publicUrl = publicBaseUrl.hostname.toLowerCase() === "github.com"
    ? new URL(sourcePath, publicBaseUrl)
    : new URL(baseUrl.href);
  if (publicBaseUrl.hostname.toLowerCase() !== "github.com") publicUrl.hash = `/${route}`;
  return { sourceUrl: sourceUrl.href, publicUrl: publicUrl.href, route };
}

/**
 * 解析 Docsify `_sidebar.md` 中的内部章节链接。
 *
 * @param {string} sidebarMarkdown 目录 Markdown。
 * @param {URL} baseUrl Docsify 根地址。
 * @returns {Record<string, unknown>[]} 去重后的候选章节。
 */
export function parseDocsifySidebar(sidebarMarkdown, baseUrl, publicBaseUrl = baseUrl) {
  /** chapters 是保持原目录顺序的候选章节。 */
  const chapters = [];
  /** seenSourceUrls 用于避免目录中重复链接被导入两次。 */
  const seenSourceUrls = new Set();
  /** groupByDepth 保存每个缩进层级最近出现的无链接章节标题。 */
  const groupByDepth = new Map();
  /** groupItemCounts 保存每章内部已经发现的有效链接数量。 */
  const groupItemCounts = new Map();
  /** groupSequence 是原侧栏中章级分组出现的稳定顺序。 */
  let groupSequence = 0;
  /** listLinePattern 匹配所有 Markdown 列表项，包括无链接的章标题。 */
  const listLinePattern = /^(\s*)[-*+]\s+(.+?)\s*$/gm;
  for (const listMatch of sidebarMarkdown.matchAll(listLinePattern)) {
    /** indentationWidth 是统一将制表符按两个空格计算的缩进宽度。 */
    const indentationWidth = listMatch[1].replace(/\t/g, "  ").length;
    /** depth 是当前列表项相对目录根部的层级。 */
    const depth = Math.max(0, Math.floor(indentationWidth / 2));
    /** listContent 是去除列表符号后的完整内容。 */
    const listContent = listMatch[2].trim();
    /** linkMatch 只在当前列表项本身是 Markdown 链接时命中。 */
    const linkMatch = listContent.match(/^\[([^\]]+)]\(([^)]+)\)$/);
    if (!linkMatch) {
      /** groupTitle 是可能作为章级父目录的纯文本标题。 */
      const groupTitle = cleanLabel(listContent);
      for (const knownDepth of [...groupByDepth.keys()]) {
        if (knownDepth >= depth) groupByDepth.delete(knownDepth);
      }
      if (/^第[一二三四五六七八九十百\d]+章(?:\s|$)/.test(groupTitle)) {
        groupSequence += 1;
        groupByDepth.set(depth, { title: groupTitle, order: groupSequence });
        groupItemCounts.set(groupTitle, 0);
      }
      continue;
    }
    /** resolvedLink 是经过同源和路径校验的章节地址。 */
    const resolvedLink = resolveChapterLink(linkMatch[2], baseUrl, publicBaseUrl);
    if (!resolvedLink || seenSourceUrls.has(resolvedLink.sourceUrl)) continue;
    seenSourceUrls.add(resolvedLink.sourceUrl);
    /** parentGroup 是缩进层级上距离当前链接最近的章级父标题。 */
    const parentGroup = [...groupByDepth.entries()]
      .filter(([groupDepth]) => groupDepth < depth)
      .sort(([leftDepth], [rightDepth]) => rightDepth - leftDepth)
      .at(0)?.[1] || null;
    /** groupItemOrder 是当前链接在所属章内的顺序。 */
    const groupItemOrder = parentGroup
      ? (groupItemCounts.get(parentGroup.title) || 0) + 1
      : chapters.length + 1;
    if (parentGroup) groupItemCounts.set(parentGroup.title, groupItemOrder);
    chapters.push({
      ...resolvedLink,
      title: cleanLabel(linkMatch[1]),
      depth,
      order: chapters.length + 1,
      groupTitle: parentGroup?.title || "",
      groupOrder: parentGroup?.order || 0,
      groupItemOrder,
    });
    if (chapters.length >= maximumDiscoveredChapters) break;
  }
  return chapters;
}

/**
 * 从教程 README 的章节导航中补充侧栏尚未收录的章级 Markdown。
 *
 * 只接受“第 X 章 标题”形式和 chapterN 目录，避免把贡献说明、下载链接或 WIP 附录误导入正文。
 *
 * @param {string} readmeMarkdown 教程首页 Markdown。
 * @param {URL} baseUrl Raw 文档根地址。
 * @param {URL} publicBaseUrl GitHub 文件浏览根地址。
 * @returns {Record<string, unknown>[]} 按 README 出现顺序返回的章级链接。
 */
export function parseReadmeChapterLinks(readmeMarkdown, baseUrl, publicBaseUrl = baseUrl) {
  /** chapters 是 README 中保持原始顺序的章节列表。 */
  const chapters = [];
  /** seenSourceUrls 避免同一章在导航和说明段落中重复出现。 */
  const seenSourceUrls = new Set();
  /** markdownLinkPattern 匹配 README 中的普通 Markdown 链接。 */
  const markdownLinkPattern = /\[([^\]]+)]\(([^)]+)\)/g;
  for (const linkMatch of String(readmeMarkdown || "").matchAll(markdownLinkPattern)) {
    /** title 是去除 Markdown 强调和 HTML 后的链接文字。 */
    const title = cleanLabel(linkMatch[1]);
    /** href 是目录声明的相对 Markdown 地址。 */
    const href = String(linkMatch[2] || "").trim();
    if (!/^第[一二三四五六七八九十百\d]+章\s+/.test(title)) continue;
    if (!/^\.?\/?chapter\d+\/.+\.md(?:[?#].*)?$/i.test(href)) continue;
    /** resolvedLink 是经过同源和目录穿越检查的章节地址。 */
    const resolvedLink = resolveChapterLink(href, baseUrl, publicBaseUrl);
    if (!resolvedLink || seenSourceUrls.has(resolvedLink.sourceUrl)) continue;
    seenSourceUrls.add(resolvedLink.sourceUrl);
    chapters.push({
      ...resolvedLink,
      title,
      depth: 1,
      order: chapters.length + 1,
      groupTitle: "",
      groupOrder: 0,
      groupItemOrder: chapters.length + 1,
    });
  }
  return chapters;
}

/**
 * 从 Markdown 中读取第一个一级或二级标题。
 *
 * @param {string} markdown 章节 Markdown。
 * @param {string} fallbackTitle 目录提供的备用标题。
 * @returns {string} 最终章节标题。
 */
function readMarkdownTitle(markdown, fallbackTitle) {
  /** headingMatch 是正文中的第一个 Markdown 标题。 */
  const headingMatch = String(markdown || "").match(/^#{1,2}\s+(.+)$/m);
  return cleanLabel(headingMatch?.[1] || fallbackTitle || "未命名章节").slice(0, 180);
}

/**
 * 分批并发执行异步任务，避免一次向同一站点发出过多连接。
 *
 * @template T,U
 * @param {T[]} items 输入项目。
 * @param {(item: T, index: number) => Promise<U>} worker 单项处理器。
 * @returns {Promise<U[]>} 与输入顺序一致的结果。
 */
async function mapWithConcurrency(items, worker) {
  /** results 是按原始索引保存的处理结果。 */
  const results = new Array(items.length);
  /** nextIndex 是下一个尚未领取的输入索引。 */
  let nextIndex = 0;
  /** runners 是固定数量的并发工作循环。 */
  const runners = Array.from(
    { length: Math.min(discoveryConcurrency, Math.max(items.length, 1)) },
    async () => {
      while (nextIndex < items.length) {
        /** currentIndex 是本轮工作器独占的输入索引。 */
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/**
 * 验证一个章节地址是否返回足够长度的 Markdown。
 *
 * @param {Record<string, unknown>} chapter 候选章节。
 * @returns {Promise<Record<string, unknown>>} 带验证状态的章节。
 */
async function validateChapter(chapter) {
  try {
    /** source 是章节公开 Markdown 响应。 */
    const source = await fetchPublicSource(chapter.sourceUrl);
    /** markdown 是章节原始 Markdown。 */
    const markdown = source.text.trim();
    if (markdown.length < minimumChapterLength) {
      return { ...chapter, valid: false, reason: "正文过短或仍在规划中" };
    }
    return {
      ...chapter,
      title: chapter.sourceKind === "github-docs"
        ? cleanLabel(chapter.title)
        : readMarkdownTitle(markdown, chapter.title),
      valid: true,
      characterCount: markdown.length,
    };
  } catch (error) {
    return {
      ...chapter,
      valid: false,
      reason: error instanceof Error ? error.message : "章节无法读取",
    };
  }
}

/**
 * 根据站点主题推荐知识库文件夹路径。
 *
 * @param {string} siteTitle 站点名称。
 * @param {string} route 可选单章路由。
 * @returns {string[]} 推荐路径。
 */
function recommendFolderPath(siteTitle, route) {
  /** searchableText 是用于识别 RAG、Agent 等技术主题的组合文本。 */
  const searchableText = `${siteTitle} ${route}`.toLowerCase();
  if (searchableText.includes("happy-llm") || searchableText.includes("happy llm")) {
    return ["AI", "LLM基础", "Happy-LLM"];
  }
  if (searchableText.includes("hello-agents") || searchableText.includes("hello agents")) {
    return ["AI", "Agent", "Hello-Agents"];
  }
  if (searchableText.includes("rag")) return ["AI", "RAG", siteTitle];
  if (searchableText.includes("agent")) return ["AI", "Agent", siteTitle];
  if (searchableText.includes("langchain")) return ["AI", "LangChain", siteTitle];
  return ["其它", siteTitle];
}

/**
 * 检查输入是否为可批量导入的 Docsify 站点，并返回导入预览。
 *
 * @param {string} inputUrl 用户输入根地址或章节地址。
 * @returns {Promise<Record<string, unknown>>} 站点、有效章节和跳过项。
 */
export async function inspectDocsifySource(inputUrl) {
  /** normalized 是输入对应的站点根地址和章节路由。 */
  const normalized = normalizeDocumentationSourceUrl(inputUrl);
  /** rootEntryUrl 是 Docsify 网站根地址或 GitHub docs 内的入口文件。 */
  const rootEntryUrl = normalized.sourceKind === "github-docs"
    ? new URL("index.html", normalized.baseUrl).href
    : normalized.baseUrl.href;
  /** rootSource 是不带 Hash 的 Docsify 入口页面。 */
  const rootSource = await fetchPublicSource(rootEntryUrl);
  if (!/window\.\$docsify|\$docsify\s*=|id=["']app["']/i.test(rootSource.text)) {
    throw new Error("该地址不是可识别的 Docsify 文档站。");
  }
  /** siteTitle 是预览和专题文件夹使用的站点名称。 */
  const siteTitle = readSiteTitle(rootSource.text, normalized.baseUrl);
  /** candidates 是单章输入或从侧栏发现的全部候选章节。 */
  let candidates;
  if (normalized.route) {
    /** resolvedChapter 是 Hash 路由对应的真实 Markdown 地址。 */
    const resolvedChapter = resolveChapterLink(
      normalized.route,
      normalized.baseUrl,
      normalized.publicBaseUrl,
    );
    if (!resolvedChapter) throw new Error("无法从当前链接识别章节地址。");
    candidates = [{ ...resolvedChapter, title: normalized.route.split("/").at(-1), depth: 0, order: 1 }];
  } else {
    /** sidebarUrl 是 Docsify 默认目录文件地址。 */
    const sidebarUrl = new URL("_sidebar.md", normalized.baseUrl);
    /** sidebarSource 是站点公开目录 Markdown。 */
    const sidebarSource = await fetchPublicSource(sidebarUrl.href);
    candidates = parseDocsifySidebar(
      sidebarSource.text,
      normalized.baseUrl,
      normalized.publicBaseUrl,
    );
    if (normalized.sourceKind === "github-docs") {
      try {
        /** readmeUrl 是 GitHub 教程的中文首页 Markdown。 */
        const readmeUrl = new URL("README.md", normalized.baseUrl);
        /** readmeSource 用于补齐侧栏尚未更新的新章级正文。 */
        const readmeSource = await fetchPublicSource(readmeUrl.href);
        /** readmeChapters 是 README 内容导航中符合章级规则的链接。 */
        const readmeChapters = parseReadmeChapterLinks(
          readmeSource.text,
          normalized.baseUrl,
          normalized.publicBaseUrl,
        );
        /** knownSourceUrls 是侧栏已经发现的 Markdown 地址集合。 */
        const knownSourceUrls = new Set(candidates.map((chapter) => chapter.sourceUrl));
        for (const chapter of readmeChapters) {
          if (knownSourceUrls.has(chapter.sourceUrl)) continue;
          knownSourceUrls.add(chapter.sourceUrl);
          candidates.push({ ...chapter, order: candidates.length + 1 });
        }
      } catch {
        // README 仅用于补充发现；侧栏有效时不因可选首页读取失败而中断导入。
      }
    }
    if (candidates.length === 0) throw new Error("站点目录中没有发现可导入章节。");
  }
  /** sourceCandidates 为每章附加来源类型，供文章详情页和原网页入口使用。 */
  const sourceCandidates = candidates.map((chapter) => ({
    ...chapter,
    sourceKind: normalized.sourceKind,
  }));
  /** validatedChapters 是逐项确认可访问性和正文长度后的目录。 */
  const validatedChapters = await mapWithConcurrency(sourceCandidates, validateChapter);
  /** chapters 是最终允许导入的有效章节。 */
  const chapters = validatedChapters.filter((chapter) => chapter.valid);
  /** skipped 是 404、占位或过短章节。 */
  const skipped = validatedChapters.filter((chapter) => !chapter.valid);
  if (chapters.length === 0) throw new Error("没有发现可导入的有效章节。");
  return {
    kind: normalized.route ? "chapter" : "site",
    siteTitle,
    baseUrl: normalized.displayBaseUrl,
    sourceKind: normalized.sourceKind,
    recommendedFolderPath: recommendFolderPath(
      `${siteTitle} ${normalized.repository}`,
      normalized.route,
    ),
    chapters,
    skipped,
  };
}

/**
 * 下载并转换一个已经验证的 Docsify Markdown 章节。
 *
 * @param {Record<string, unknown>} chapter 预览返回的章节信息。
 * @param {{ categoryHint?: string }} options 批量导入时可复用的一级分类提示。
 * @returns {Promise<Record<string, unknown>>} 可交给文章数据库保存的正文对象。
 */
export async function parseDocsifyChapter(chapter, options = {}) {
  /** source 是章节 Markdown 原文及最终地址。 */
  const source = await fetchPublicSource(String(chapter.sourceUrl || ""));
  /** markdown 是去除首尾空白后的完整章节。 */
  const markdown = source.text.trim();
  if (markdown.length < minimumChapterLength) throw new Error("章节正文过短，已停止导入。");
  /** renderedHtml 是 marked 生成、尚未清洗的 HTML。 */
  const renderedHtml = marked.parse(markdown, markedOptions);
  /** sanitized 是统一文章清洗器输出的安全 HTML 和纯文本。 */
  const sanitized = sanitizeArticleHtml(renderedHtml, source.finalUrl);
  if (!sanitized.html || sanitized.text.length < minimumChapterLength) {
    throw new Error("Markdown 渲染后没有得到足够正文。");
  }
  /** title 是正文标题优先、目录标题兜底的最终标题。 */
  const title = chapter.sourceKind === "github-docs"
    ? cleanLabel(chapter.title)
    : readMarkdownTitle(markdown, chapter.title);
  /** categoryHint 是整站目录已经确定时复用的一级分类，避免逐章调用 AI。 */
  const categoryHint = isDocumentCategory(options.categoryHint) ? options.categoryHint : "";
  /** classification 是目录提示或知序现有分类器给出的一级目录依据。 */
  const classification = categoryHint
    ? { category: categoryHint, source: "folder", confidence: 1 }
    : await classifyDocument({ fileName: title, text: sanitized.text });
  /** summarySource 是用于生成卡片简介的单行正文。 */
  const summarySource = sanitized.text.replace(/\s+/g, " ").trim();
  /** sourceLanguage 是文章阅读页翻译入口使用的语言代码。 */
  const sourceLanguage = detectArticleLanguage(sanitized.text);
  return {
    url: String(chapter.publicUrl || source.finalUrl.href),
    sourceType: String(chapter.sourceKind || "docsify"),
    title,
    summary: `${summarySource.slice(0, 220)}${summarySource.length > 220 ? "…" : ""}`,
    category: classification.category,
    categorySource: classification.source,
    categoryConfidence: classification.confidence,
    author: new URL(source.finalUrl.href).hostname,
    publishedAt: null,
    coverImageUrl: null,
    contentHtml: sanitized.html,
    contentText: sanitized.text,
    sourceLanguage,
    translationStatus: ["en", "mixed"].includes(sourceLanguage) ? "not_requested" : "not_required",
    wordCount: sanitized.text.length,
  };
}
