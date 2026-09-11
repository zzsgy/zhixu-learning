"use client";

/*
 * 外部文章图片来自任意公开域名，无法预先配置固定的 Next Image 主机白名单；
 * 服务端已过滤图片协议和属性，因此这里使用原生懒加载图片元素。
 */
/* eslint-disable @next/next/no-img-element */

/**
 * 知序网页端主界面。
 *
 * 该组件只通过同源 HTTPS API 访问数据，不接触数据库凭据。
 * IndexedDB 保存离线快照，但云端 D1 始终是唯一主数据源。
 */
import { useCallback, useEffect, useMemo, useState } from "react";

/** 一级领域。 */
type Domain = "AI" | "BIO" | "DB";

/** 主导航页面。 */
type ViewName =
  | "today"
  | "search"
  | "library"
  | "articles"
  | "collections"
  | "deep"
  | "sync";

/** 外部文章允许使用的一级领域。 */
type ArticleDomain = Domain | "OTHER";

/** 个人知识管理支持的目标类型。 */
type KnowledgeTargetType = "card" | "article";

/** 个人知识管理支持的学习状态。 */
type KnowledgeStatus =
  | "inbox"
  | "organizing"
  | "learning"
  | "mastered"
  | "archived";

/** 云端卡片结构。 */
type Card = {
  /** 稳定卡片 ID。 */
  id: string;
  /** null 表示公共卡片。 */
  ownerUserId: string | null;
  /** 一级领域。 */
  domain: Domain;
  /** 课程系列。 */
  series: string;
  /** 难度等级。 */
  level: number;
  /** 系列顺序。 */
  sequence: number;
  /** 标题。 */
  title: string;
  /** 摘要。 */
  summary: string;
  /** 技术正文。 */
  content: string;
  /** 可选公式。 */
  formula: string | null;
  /** JSON 编码的流程步骤。 */
  flowJson: string | null;
  /** JSON 编码的来源。 */
  sourcesJson: string;
  /** 内容来源。 */
  origin: string;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
};

/** 解析并保存的外部文章结构。 */
type Article = {
  /** 稳定文章 ID。 */
  id: string;
  /** 当前用户 ID。 */
  userId: string;
  /** 重定向后的最终原文链接。 */
  url: string;
  /** 普通网页或微信公众号来源。 */
  sourceType: "web" | "wechat";
  /** 文章标题。 */
  title: string;
  /** 自动生成的简介。 */
  summary: string;
  /** 自动识别的文章领域。 */
  domain: ArticleDomain;
  /** 作者或公众号名称。 */
  author: string | null;
  /** 原文发布时间。 */
  publishedAt: string | null;
  /** 原文封面图。 */
  coverImageUrl: string | null;
  /** 经过服务端安全过滤的正文 HTML。 */
  contentHtml: string;
  /** 纯文本正文。 */
  contentText: string;
  /** 正文字数。 */
  wordCount: number;
  /** JSON 编码的主题标签。 */
  tagsJson: string;
  /** 首次保存时间。 */
  createdAt: string;
  /** 最近重新解析时间。 */
  updatedAt: string;
};

/** 卡片或文章的个人学习状态。 */
type KnowledgeState = {
  /** 状态记录 ID。 */
  id: string;
  /** 当前用户 ID。 */
  userId: string;
  /** card 或 article。 */
  targetType: KnowledgeTargetType;
  /** 卡片或文章稳定 ID。 */
  targetId: string;
  /** 当前学习状态。 */
  status: KnowledgeStatus;
  /** 最近更新时间。 */
  updatedAt: string;
};

/** 带可选原文引用的个人批注。 */
type Annotation = {
  /** 批注稳定 ID。 */
  id: string;
  /** 当前用户 ID。 */
  userId: string;
  /** card 或 article。 */
  targetType: KnowledgeTargetType;
  /** 卡片或文章稳定 ID。 */
  targetId: string;
  /** 可选原文引用。 */
  quoteText: string | null;
  /** 用户自己的批注正文。 */
  noteText: string;
  /** 创建时间。 */
  createdAt: string;
  /** 最近更新时间。 */
  updatedAt: string;
};

/** 用户创建的知识专题。 */
type KnowledgeCollection = {
  /** 专题稳定 ID。 */
  id: string;
  /** 当前用户 ID。 */
  userId: string;
  /** 专题名称。 */
  name: string;
  /** 专题说明。 */
  description: string;
  /** 创建时间。 */
  createdAt: string;
  /** 最近更新时间。 */
  updatedAt: string;
};

/** 专题与卡片、文章之间的归属关系。 */
type CollectionItem = {
  /** 关系记录 ID。 */
  id: string;
  /** 当前用户 ID。 */
  userId: string;
  /** 所属专题 ID。 */
  collectionId: string;
  /** card 或 article。 */
  targetType: KnowledgeTargetType;
  /** 卡片或文章稳定 ID。 */
  targetId: string;
  /** 加入专题时间。 */
  createdAt: string;
};

/** 阅读进度结构。 */
type Progress = {
  /** 记录 ID。 */
  id: string;
  /** 用户 ID。 */
  userId: string;
  /** 卡片 ID。 */
  cardId: string;
  /** 阅读状态。 */
  status: "reading" | "completed";
  /** 阅读秒数。 */
  readingSeconds: number;
  /** 更新时间。 */
  updatedAt: string;
};

/** 收藏记录结构。 */
type Favorite = {
  /** 记录 ID。 */
  id: string;
  /** 卡片 ID。 */
  cardId: string;
};

/** 深度内容结构。 */
type DeepDive = {
  /** 记录 ID。 */
  id: string;
  /** 卡片 ID。 */
  cardId: string;
  /** 深度标题。 */
  title: string;
  /** 深度正文。 */
  content: string;
  /** JSON 编码的来源。 */
  sourcesJson: string;
  /** 内容来源。 */
  origin: string;
  /** 更新时间。 */
  updatedAt: string;
};

/** AI 追问消息结构。 */
type AiMessage = {
  /** 消息 ID。 */
  id: string;
  /** 卡片 ID。 */
  cardId: string;
  /** 消息角色。 */
  role: "user" | "assistant";
  /** 消息内容。 */
  content: string;
  /** 创建时间。 */
  createdAt: string;
};

/** 跨端推送设置结构。 */
type UserSettings = {
  /** 用户 ID。 */
  userId: string;
  /** 开始时间。 */
  startTime: string;
  /** 结束时间。 */
  endTime: string;
  /** 间隔分钟数。 */
  intervalMinutes: number;
  /** AI 权重。 */
  aiWeight: number;
  /** 生物工程权重。 */
  bioWeight: number;
  /** PostgreSQL 权重。 */
  dbWeight: number;
  /** 更新时间。 */
  updatedAt: string;
};

/** 已配对设备结构。 */
type Device = {
  /** 设备记录 ID。 */
  id: string;
  /** 设备显示名称。 */
  deviceName: string;
  /** 最近同步时间。 */
  lastSeenAt: string;
  /** 绑定时间。 */
  createdAt: string;
};

/** 启动快照结构。 */
type BootstrapData = {
  /** 当前账号。 */
  user: {
    /** 用户 ID。 */
    id: string;
    /** 邮箱。 */
    email: string;
    /** 显示名称。 */
    displayName: string;
  };
  /** 可见卡片。 */
  cards: Card[];
  /** 当前账号保存的外部文章。 */
  articles: Article[];
  /** 卡片与文章的个人学习状态。 */
  knowledgeStates: KnowledgeState[];
  /** 个人批注。 */
  annotations: Annotation[];
  /** 个人专题。 */
  collections: KnowledgeCollection[];
  /** 专题成员关系。 */
  collectionItems: CollectionItem[];
  /** 阅读进度。 */
  progress: Progress[];
  /** 收藏。 */
  favorites: Favorite[];
  /** 深度内容。 */
  deepDives: DeepDive[];
  /** AI 追问。 */
  aiMessages: AiMessage[];
  /** 推送设置。 */
  settings: UserSettings;
  /** 已配对设备。 */
  devices: Device[];
};

/** API 错误结构。 */
type ApiError = {
  /** 人类可读提示。 */
  message?: string;
};

/** 快速收录支持标记的回答来源。 */
type ImportSource = "Codex" | "ChatGPT" | "其他";

/** 快速收录表单的本地草稿结构。 */
type ImportDraft = {
  /** 可选标题；留空时服务端自动提取。 */
  title: string;
  /** 知识领域。 */
  domain: Domain;
  /** 回答来源。 */
  source: ImportSource;
  /** 从剪贴板读取或手动粘贴的完整回答。 */
  content: string;
};

/** 全局搜索返回的统一知识结果。 */
type GlobalSearchResult = {
  /** card、article、deep 或 annotation。 */
  kind: "card" | "article" | "deep" | "annotation";
  /** 搜索结果稳定键。 */
  id: string;
  /** 打开详情页时使用的目标类型。 */
  targetType: KnowledgeTargetType;
  /** 打开详情页时使用的目标 ID。 */
  targetId: string;
  /** 搜索结果标题。 */
  title: string;
  /** 搜索结果摘要或命中文本。 */
  excerpt: string;
  /** 领域中文标签。 */
  domainLabel: string;
  /** 当前个人学习状态。 */
  status: KnowledgeStatus;
  /** 简单相关性分数，用于客户端排序。 */
  score: number;
};

/** IndexedDB 数据库名。 */
const CACHE_DATABASE_NAME = "zhixu-offline-cache";
/** IndexedDB 对象仓库名。 */
const CACHE_STORE_NAME = "snapshots";
/** 当前账号快照键。 */
const CACHE_SNAPSHOT_KEY = "latest";

/** 导航项配置。 */
const NAV_ITEMS: Array<{
  /** 页面键。 */
  id: ViewName;
  /** 中文标签。 */
  label: string;
  /** 辅助说明。 */
  hint: string;
}> = [
  { id: "today", label: "今日卡片", hint: "TODAY" },
  { id: "search", label: "全局搜索", hint: "SEARCH" },
  { id: "library", label: "知识库", hint: "LIBRARY" },
  { id: "articles", label: "文章库", hint: "ARTICLES" },
  { id: "collections", label: "我的专题", hint: "TOPICS" },
  { id: "deep", label: "深度阅读", hint: "DEEP" },
  { id: "sync", label: "同步与导出", hint: "SYNC" },
];

/** 领域中文标签。 */
const DOMAIN_LABELS: Record<Domain, string> = {
  AI: "AI 技术",
  BIO: "生物工程",
  DB: "PostgreSQL",
};

/** 领域短编号。 */
const DOMAIN_NUMBERS: Record<Domain, string> = {
  AI: "01",
  BIO: "02",
  DB: "03",
};

/** 文章领域中文标签。 */
const ARTICLE_DOMAIN_LABELS: Record<ArticleDomain, string> = {
  AI: "AI 技术",
  BIO: "生物工程",
  DB: "PostgreSQL",
  OTHER: "其他",
};

/** 个人学习状态的中文名称。 */
const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  inbox: "收件箱",
  organizing: "待整理",
  learning: "学习中",
  mastered: "已掌握",
  archived: "已归档",
};

/** 全局搜索结果类型的中文名称。 */
const SEARCH_KIND_LABELS: Record<GlobalSearchResult["kind"], string> = {
  card: "知识卡片",
  article: "收藏文章",
  deep: "深度内容",
  annotation: "个人批注",
};

/** 安全解析 JSON 字符串数组。 */
function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    /** parsed 是解码后的未知 JSON。 */
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** 为旧版离线快照补齐后来新增的数据集合。 */
function normalizeBootstrapData(data: BootstrapData): BootstrapData {
  return {
    ...data,
    articles: Array.isArray(data.articles) ? data.articles : [],
    knowledgeStates: Array.isArray(data.knowledgeStates)
      ? data.knowledgeStates
      : [],
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    collections: Array.isArray(data.collections) ? data.collections : [],
    collectionItems: Array.isArray(data.collectionItems)
      ? data.collectionItems
      : [],
  };
}

/** 把 ISO 时间格式化为简洁中文时间。 */
function formatTime(value: string): string {
  /** date 是待显示的时间对象。 */
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** 从命中位置附近截取一段适合搜索结果展示的正文。 */
function createSearchExcerpt(value: string, query: string): string {
  /** normalizedValue 是移除多余空白后的可读文本。 */
  const normalizedValue = value.replace(/\s+/g, " ").trim();
  /** matchIndex 是忽略大小写后的首次命中位置。 */
  const matchIndex = normalizedValue.toLowerCase().indexOf(query.toLowerCase());
  /** start 是保留命中词前方上下文后的截取起点。 */
  const start = Math.max(0, matchIndex >= 0 ? matchIndex - 55 : 0);
  /** excerpt 是最多 180 字的结果摘要。 */
  const excerpt = normalizedValue.slice(start, start + 180);
  return `${start > 0 ? "…" : ""}${excerpt}${start + 180 < normalizedValue.length ? "…" : ""}`;
}

/** 根据标题与正文中的命中位置计算轻量客户端相关性。 */
function calculateSearchScore(
  title: string,
  body: string,
  query: string,
): number {
  /** normalizedTitle 是忽略大小写后的标题。 */
  const normalizedTitle = title.toLowerCase();
  /** normalizedBody 是忽略大小写后的正文。 */
  const normalizedBody = body.toLowerCase();
  /** normalizedQuery 是忽略大小写后的搜索词。 */
  const normalizedQuery = query.toLowerCase();
  if (normalizedTitle === normalizedQuery) return 100;
  if (normalizedTitle.startsWith(normalizedQuery)) return 80;
  if (normalizedTitle.includes(normalizedQuery)) return 60;
  if (normalizedBody.includes(normalizedQuery)) return 20;
  return 0;
}

/** 打开浏览器离线缓存数据库。 */
function openCacheDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    /** request 是 IndexedDB 打开请求。 */
    const request = indexedDB.open(CACHE_DATABASE_NAME, 1);
    /** 首次创建时建立快照仓库。 */
    request.onupgradeneeded = () => {
      /** database 是正在升级的本地数据库。 */
      const database = request.result;
      if (!database.objectStoreNames.contains(CACHE_STORE_NAME)) {
        database.createObjectStore(CACHE_STORE_NAME);
      }
    };
    /** 打开成功后返回数据库连接。 */
    request.onsuccess = () => resolve(request.result);
    /** 打开失败时向上抛出浏览器错误。 */
    request.onerror = () => reject(request.error);
  });
}

/** 把最新云端快照写入 IndexedDB，供断网浏览。 */
async function writeOfflineSnapshot(data: BootstrapData): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  /** database 是浏览器本地数据库连接。 */
  const database = await openCacheDatabase();
  await new Promise<void>((resolve, reject) => {
    /** transaction 是一次可回滚的写事务。 */
    const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
    /** store 是快照对象仓库。 */
    const store = transaction.objectStore(CACHE_STORE_NAME);
    store.put(data, CACHE_SNAPSHOT_KEY);
    /** 事务完成后关闭数据库连接。 */
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    /** 写入失败时关闭连接并上抛错误。 */
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

/** 从 IndexedDB 读取最近一次成功同步的快照。 */
async function readOfflineSnapshot(): Promise<BootstrapData | null> {
  if (typeof indexedDB === "undefined") return null;
  /** database 是浏览器本地数据库连接。 */
  const database = await openCacheDatabase();
  return new Promise((resolve, reject) => {
    /** transaction 是只读事务。 */
    const transaction = database.transaction(CACHE_STORE_NAME, "readonly");
    /** request 是按固定键读取快照的请求。 */
    const request = transaction.objectStore(CACHE_STORE_NAME).get(CACHE_SNAPSHOT_KEY);
    /** 读取成功后返回快照或 null。 */
    request.onsuccess = () => {
      database.close();
      resolve((request.result as BootstrapData | undefined) ?? null);
    };
    /** 读取失败后返回异常。 */
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

/** 发送 JSON API 请求，并把错误转换为可读提示。 */
async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  /** response 是同源 API 响应。 */
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  /** payload 是成功数据或错误结构。 */
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) {
    throw new Error(payload.message ?? `请求失败（${response.status}）`);
  }
  return payload;
}

/** 触发浏览器文件下载。 */
function downloadFile(
  filename: string,
  content: string,
  contentType: string,
): void {
  /** blob 是待下载的内存文件。 */
  const blob = new Blob([content], { type: contentType });
  /** url 是浏览器为内存文件创建的临时地址。 */
  const url = URL.createObjectURL(blob);
  /** anchor 是一次性下载链接。 */
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 把完整账号快照转换为可长期保存的 Markdown。 */
function snapshotToMarkdown(data: BootstrapData): string {
  /** favoriteIds 用于标记收藏卡片。 */
  const favoriteIds = new Set(data.favorites.map((item) => item.cardId));
  /** deepByCard 用于把深度内容附在对应卡片后。 */
  const deepByCard = new Map(data.deepDives.map((item) => [item.cardId, item]));
  /** stateByTarget 用于标记卡片和文章的个人学习状态。 */
  const stateByTarget = new Map(
    data.knowledgeStates.map((item) => [
      `${item.targetType}:${item.targetId}`,
      item.status,
    ]),
  );
  /** collectionNameById 用于把专题 ID 转换为可读名称。 */
  const collectionNameById = new Map(
    data.collections.map((collection) => [collection.id, collection.name]),
  );
  /** annotationMarkdown 为指定知识目标生成个人批注段落。 */
  const annotationMarkdown = (
    targetType: KnowledgeTargetType,
    targetId: string,
  ): string => {
    /** targetAnnotations 是当前知识目标的全部个人批注。 */
    const targetAnnotations = data.annotations.filter(
      (item) =>
        item.targetType === targetType && item.targetId === targetId,
    );
    if (!targetAnnotations.length) return "";
    return [
      "\n### 个人批注",
      "",
      ...targetAnnotations.flatMap((annotation) => [
        annotation.quoteText ? `> ${annotation.quoteText}` : "",
        annotation.noteText,
        "",
      ]),
    ].join("\n");
  };
  /** collectionNames 为指定知识目标返回所属专题名称。 */
  const collectionNames = (
    targetType: KnowledgeTargetType,
    targetId: string,
  ): string[] =>
    data.collectionItems
      .filter(
        (item) =>
          item.targetType === targetType && item.targetId === targetId,
      )
      .map((item) => collectionNameById.get(item.collectionId))
      .filter((name): name is string => Boolean(name));
  /** sections 是逐卡片生成的 Markdown 段落。 */
  const sections = data.cards.map((card) => {
    /** flow 是当前卡片流程步骤。 */
    const flow = parseStringArray(card.flowJson);
    /** sources 是当前卡片参考资料。 */
    const sources = parseStringArray(card.sourcesJson);
    /** deepDive 是当前卡片已保存的深度内容。 */
    const deepDive = deepByCard.get(card.id);
    /** status 是当前卡片的个人学习状态。 */
    const status =
      stateByTarget.get(`card:${card.id}`) ??
      (data.progress.some(
        (item) => item.cardId === card.id && item.status === "completed",
      )
        ? "mastered"
        : "inbox");
    /** topics 是当前卡片所属专题名称。 */
    const topics = collectionNames("card", card.id);
    return [
      `## ${card.title}`,
      "",
      `- 领域：${DOMAIN_LABELS[card.domain]}`,
      `- 系列：${card.series} · L${card.level}`,
      `- 收藏：${favoriteIds.has(card.id) ? "是" : "否"}`,
      `- 状态：${KNOWLEDGE_STATUS_LABELS[status]}`,
      topics.length ? `- 专题：${topics.join("、")}` : "",
      "",
      card.content,
      card.formula ? `\n**公式**：${card.formula}` : "",
      flow.length ? `\n**流程**：${flow.join(" → ")}` : "",
      sources.length ? `\n**参考**：${sources.join("；")}` : "",
      deepDive
        ? `\n### 深度内容：${deepDive.title}\n\n${deepDive.content}`
        : "",
      annotationMarkdown("card", card.id),
      "",
    ].join("\n");
  });
  /** articleSections 是外部文章的 Markdown 备份段落。 */
  const articleSections = data.articles.map((article) => {
    /** tags 是当前文章的主题标签。 */
    const tags = parseStringArray(article.tagsJson);
    /** status 是当前文章的个人学习状态。 */
    const status = stateByTarget.get(`article:${article.id}`) ?? "inbox";
    /** topics 是当前文章所属专题名称。 */
    const topics = collectionNames("article", article.id);
    return [
      `## ${article.title}`,
      "",
      `- 领域：${ARTICLE_DOMAIN_LABELS[article.domain]}`,
      `- 作者：${article.author || "未标注"}`,
      `- 原文：${article.url}`,
      `- 状态：${KNOWLEDGE_STATUS_LABELS[status]}`,
      tags.length ? `- 标签：${tags.join("、")}` : "",
      topics.length ? `- 专题：${topics.join("、")}` : "",
      "",
      `> ${article.summary}`,
      "",
      article.contentText,
      annotationMarkdown("article", article.id),
      "",
    ].join("\n");
  });
  /** collectionSections 是所有个人专题及其成员标题。 */
  const collectionSections = data.collections.map((collection) => {
    /** itemTitles 是当前专题中全部卡片和文章标题。 */
    const itemTitles = data.collectionItems
      .filter((item) => item.collectionId === collection.id)
      .map((item) =>
        item.targetType === "card"
          ? data.cards.find((card) => card.id === item.targetId)?.title
          : data.articles.find((article) => article.id === item.targetId)?.title,
      )
      .filter((title): title is string => Boolean(title));
    return [
      `## ${collection.name}`,
      "",
      collection.description,
      "",
      ...itemTitles.map((title) => `- ${title}`),
      "",
    ].join("\n");
  });
  return [
    "# 知序知识库导出",
    "",
    `导出账号：${data.user.email}`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    ...sections,
    "# 文章库",
    "",
    ...articleSections,
    "# 我的专题",
    "",
    ...collectionSections,
  ].join("\n");
}

/** 显示统一的内联图标。 */
function Icon({
  name,
}: {
  /** 图标名称。 */
  name:
    | "arrow"
    | "bookmark"
    | "check"
    | "cloud"
    | "download"
    | "menu"
    | "spark"
    | "sync"
    | "x";
}): React.ReactNode {
  /** paths 是各图标的 SVG 路径。 */
  const paths: Record<typeof name, React.ReactNode> = {
    arrow: <path d="m5 12 14 0m-5-5 5 5-5 5" />,
    bookmark: <path d="M6.5 4.5h11v15l-5.5-3-5.5 3z" />,
    check: <path d="m5 12 4 4L19 6" />,
    cloud: <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 8.1 5 5 0 0 0 7 18Z" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M5 21h14" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    spark: <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />,
    sync: <path d="M20 7h-6V1M4 17h6v6M19 12a7 7 0 0 0-12-5l-3 3m1 2a7 7 0 0 0 12 5l3-3" />,
    x: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}

/** 未登录时显示的安全登录入口。 */
function SignInScreen(): React.ReactNode {
  return (
    <main className="signin-shell">
      <section className="signin-panel">
        <div className="brand-mark" aria-hidden="true">
          知
        </div>
        <p className="eyebrow">ZHIXU · PERSONAL KNOWLEDGE SYSTEM</p>
        <h1>手机接收知识，<br />电脑完成深入理解。</h1>
        <p className="signin-copy">
          一个账号同步卡片、收藏、阅读进度、深度内容和 AI 追问。
          数据库凭据只存在于服务端。
        </p>
        <a className="primary-button" href="/signin-with-chatgpt?return_to=%2F">
          登录并进入知序
          <Icon name="arrow" />
        </a>
        <p className="privacy-note">首次登录后，可在“同步与导出”中绑定华为 Mate 40 Pro。</p>
      </section>
      <section className="signin-visual" aria-label="产品结构示意">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="visual-card visual-card-top">
          <span>07:30</span>
          <strong>Attention 的计算本质</strong>
          <small>AI · L1</small>
        </div>
        <div className="visual-card visual-card-middle">
          <span>11:30</span>
          <strong>CIP 的四个关键变量</strong>
          <small>BIO · L1</small>
        </div>
        <div className="visual-card visual-card-bottom">
          <span>16:30</span>
          <strong>MVCC 与快照可见性</strong>
          <small>DB · L1</small>
        </div>
      </section>
    </main>
  );
}

/** 页面加载时显示的骨架状态。 */
function LoadingScreen(): React.ReactNode {
  return (
    <main className="loading-shell" aria-live="polite">
      <div className="loading-mark">知</div>
      <p>正在整理今天的知识序列…</p>
    </main>
  );
}

/** 单张卡片的紧凑预览。 */
function CardTile({
  card,
  completed,
  favorite,
  onOpen,
  onFavorite,
}: {
  /** 当前卡片。 */
  card: Card;
  /** 是否已读。 */
  completed: boolean;
  /** 是否收藏。 */
  favorite: boolean;
  /** 打开阅读器。 */
  onOpen: () => void;
  /** 切换收藏。 */
  onFavorite: () => void;
}): React.ReactNode {
  return (
    <article className={`knowledge-card domain-${card.domain.toLowerCase()}`}>
      <div className="card-index">
        <span>{DOMAIN_NUMBERS[card.domain]}</span>
        <span>{card.series}</span>
      </div>
      <button
        aria-label={favorite ? "取消收藏" : "收藏"}
        className={`bookmark-button ${favorite ? "is-active" : ""}`}
        onClick={onFavorite}
        type="button"
      >
        <Icon name="bookmark" />
      </button>
      <button className="card-body-button" onClick={onOpen} type="button">
        <div className="card-meta">
          <span>{DOMAIN_LABELS[card.domain]}</span>
          <span>L{card.level}</span>
          {completed ? <span className="read-pill">已读</span> : null}
        </div>
        <h3>{card.title}</h3>
        <p>{card.summary}</p>
        <div className="card-footer">
          <span>{Math.max(3, Math.ceil(card.content.length / 220))} 分钟</span>
          <span className="read-link">
            阅读卡片 <Icon name="arrow" />
          </span>
        </div>
      </button>
    </article>
  );
}

/** 详情页中的个人知识整理面板。 */
function KnowledgeWorkbench({
  status,
  annotations,
  collections,
  collectionIds,
  offline,
  busyAction,
  onStatusChange,
  onAddAnnotation,
  onDeleteAnnotation,
  onToggleCollection,
}: {
  /** 当前知识目标的个人学习状态。 */
  status: KnowledgeStatus;
  /** 当前知识目标的全部个人批注。 */
  annotations: Annotation[];
  /** 当前用户建立的全部专题。 */
  collections: KnowledgeCollection[];
  /** 当前知识目标已经加入的专题 ID 集合。 */
  collectionIds: Set<string>;
  /** 是否正在使用只读离线快照。 */
  offline: boolean;
  /** 当前正在执行的异步动作。 */
  busyAction: string | null;
  /** 修改当前知识目标的学习状态。 */
  onStatusChange: (status: KnowledgeStatus) => void;
  /** 新增一条个人批注并返回是否保存成功。 */
  onAddAnnotation: (noteText: string, quoteText: string | null) => Promise<boolean>;
  /** 删除一条个人批注。 */
  onDeleteAnnotation: (annotationId: string) => void;
  /** 把当前知识目标加入专题或从专题移除。 */
  onToggleCollection: (collectionId: string, active: boolean) => void;
}): React.ReactNode {
  /** noteText 是尚未保存的个人批注草稿。 */
  const [noteText, setNoteText] = useState("");
  /** quoteText 是从当前正文选取的引用草稿。 */
  const [quoteText, setQuoteText] = useState<string | null>(null);

  /** 读取当前页面选中的正文并作为批注引用。 */
  function captureSelection(): void {
    /** selectedText 是浏览器当前选区中的纯文本。 */
    const selectedText = window.getSelection()?.toString().trim() ?? "";
    setQuoteText(selectedText ? selectedText.slice(0, 1000) : null);
  }

  /** 保存批注，成功后清空本地草稿。 */
  async function submitAnnotation(): Promise<void> {
    /** normalizedNote 是移除首尾空白后的批注正文。 */
    const normalizedNote = noteText.trim();
    if (!normalizedNote) return;
    /** saved 表示云端是否成功创建本条批注。 */
    const saved = await onAddAnnotation(normalizedNote, quoteText);
    if (saved) {
      setNoteText("");
      setQuoteText(null);
    }
  }

  return (
    <section className="knowledge-workbench">
      <div className="workbench-heading">
        <div>
          <p className="eyebrow">MY KNOWLEDGE LAYER</p>
          <h3>把阅读变成自己的知识</h3>
        </div>
        <label className="status-control">
          <span>当前状态</span>
          <select
            disabled={offline || busyAction === "state"}
            onChange={(event) =>
              onStatusChange(event.target.value as KnowledgeStatus)
            }
            value={status}
          >
            {(Object.keys(KNOWLEDGE_STATUS_LABELS) as KnowledgeStatus[]).map(
              (statusOption) => (
                <option key={statusOption} value={statusOption}>
                  {KNOWLEDGE_STATUS_LABELS[statusOption]}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      <div className="workbench-grid">
        <div className="annotation-editor">
          <div className="workbench-subheading">
            <strong>个人批注</strong>
            <button
              disabled={offline}
              onClick={captureSelection}
              type="button"
            >
              引用当前选中文字
            </button>
          </div>
          {quoteText ? (
            <blockquote>
              {quoteText}
              <button
                aria-label="移除引用"
                onClick={() => setQuoteText(null)}
                type="button"
              >
                ×
              </button>
            </blockquote>
          ) : null}
          <textarea
            disabled={offline}
            maxLength={4000}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="记录你的理解、疑问、实验经验或下一步行动……"
            value={noteText}
          />
          <div className="annotation-editor-footer">
            <span>{noteText.length.toLocaleString("zh-CN")} / 4000</span>
            <button
              className="secondary-button"
              disabled={
                offline ||
                busyAction === "annotation" ||
                !noteText.trim()
              }
              onClick={() => void submitAnnotation()}
              type="button"
            >
              {busyAction === "annotation" ? "正在保存…" : "保存批注"}
            </button>
          </div>
        </div>

        <div className="collection-picker">
          <div className="workbench-subheading">
            <strong>所属专题</strong>
            <span>{collectionIds.size} 个</span>
          </div>
          {collections.length ? (
            <div className="collection-chip-list">
              {collections.map((collection) => {
                /** active 表示当前知识目标是否属于本专题。 */
                const active = collectionIds.has(collection.id);
                return (
                  <button
                    className={active ? "is-active" : ""}
                    disabled={offline || busyAction === "collection-item"}
                    key={collection.id}
                    onClick={() => onToggleCollection(collection.id, !active)}
                    type="button"
                  >
                    <span>{active ? "✓" : "+"}</span>
                    {collection.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="muted">先到“我的专题”中创建一个专题。</p>
          )}
        </div>
      </div>

      {annotations.length ? (
        <div className="annotation-list">
          {annotations.map((annotation) => (
            <article key={annotation.id}>
              <div>
                <span>{formatTime(annotation.createdAt)}</span>
                <button
                  disabled={offline || busyAction === "annotation-delete"}
                  onClick={() => onDeleteAnnotation(annotation.id)}
                  type="button"
                >
                  删除
                </button>
              </div>
              {annotation.quoteText ? (
                <blockquote>{annotation.quoteText}</blockquote>
              ) : null}
              <p>{annotation.noteText}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="workbench-empty">还没有个人批注。选中正文后可以连同原文一起记录。</p>
      )}
    </section>
  );
}

/** 站内卡片详情页。 */
function Reader({
  card,
  deepDive,
  messages,
  favorite,
  busyAction,
  onClose,
  onFavorite,
  onComplete,
  onGenerateDeep,
  onAsk,
  managementPanel,
}: {
  /** 当前卡片。 */
  card: Card;
  /** 已保存深度内容。 */
  deepDive: DeepDive | undefined;
  /** 当前卡片追问消息。 */
  messages: AiMessage[];
  /** 是否收藏。 */
  favorite: boolean;
  /** 正在执行的异步动作。 */
  busyAction: string | null;
  /** 返回卡片列表。 */
  onClose: () => void;
  /** 切换收藏。 */
  onFavorite: () => void;
  /** 标记完成。 */
  onComplete: () => void;
  /** 生成深度内容。 */
  onGenerateDeep: () => void;
  /** 提交追问。 */
  onAsk: (question: string) => void;
  /** 状态、批注与专题管理面板。 */
  managementPanel: React.ReactNode;
}): React.ReactNode {
  /** question 是当前输入框内容。 */
  const [question, setQuestion] = useState("");
  /** flow 是卡片流程步骤。 */
  const flow = parseStringArray(card.flowJson);
  /** sources 是卡片参考资料。 */
  const sources = parseStringArray(card.sourcesJson);

  /** 提交追问并清空输入框。 */
  function submitQuestion(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    /** normalizedQuestion 是去除首尾空格后的问题。 */
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) return;
    onAsk(normalizedQuestion);
    setQuestion("");
  }

  return (
    <article aria-label={`${card.title} 详情页`} className="reader-panel">
        <header className="reader-header">
          <div>
            <p className="eyebrow">
              {DOMAIN_LABELS[card.domain]} · {card.series} · L{card.level}
            </p>
            <h2>{card.title}</h2>
          </div>
          <div className="reader-actions">
            <button
              className="reader-back-button"
              onClick={onClose}
              type="button"
            >
              ← 返回卡片列表
            </button>
            <button
              aria-label={favorite ? "取消收藏" : "收藏"}
              className={`icon-button ${favorite ? "is-active" : ""}`}
              onClick={onFavorite}
              type="button"
            >
              <Icon name="bookmark" />
            </button>
          </div>
        </header>

        <div className="reader-scroll">
          <section className="reader-lead">
            <span className="lead-number">{DOMAIN_NUMBERS[card.domain]}</span>
            <p>{card.summary}</p>
          </section>
          <section className="prose-section">
            <p>{card.content}</p>
          </section>

          {card.formula ? (
            <section className="formula-block">
              <span>FORMULA</span>
              <strong>{card.formula}</strong>
            </section>
          ) : null}

          {flow.length ? (
            <section className="flow-section">
              <div className="section-heading">
                <span>PROCESS</span>
                <h3>过程与判断链路</h3>
              </div>
              <div className="flow-line">
                {flow.map((step, index) => (
                  <div className="flow-step" key={`${step}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {deepDive ? (
            <section className="deep-reader">
              <div className="section-heading">
                <span>DEEP DIVE</span>
                <h3>{deepDive.title}</h3>
              </div>
              {deepDive.content
                .split(/\n{2,}/)
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={`${paragraph.slice(0, 20)}-${index}`}>{paragraph}</p>
                ))}
            </section>
          ) : (
            <section className="deep-invite">
              <div>
                <span>想继续深入？</span>
                <h3>生成不少于 2000 字的深度内容</h3>
                <p>只保留最低字数要求，不再设置 5000 字上限。</p>
              </div>
              <button
                className="secondary-button"
                disabled={busyAction === "deep"}
                onClick={onGenerateDeep}
                type="button"
              >
                <Icon name="spark" />
                {busyAction === "deep" ? "正在生成…" : "开始深挖"}
              </button>
            </section>
          )}

          <section className="ask-section">
            <div className="section-heading">
              <span>ASK AI</span>
              <h3>围绕这个知识点继续追问</h3>
            </div>
            {messages.length ? (
              <div className="message-list">
                {messages.map((message) => (
                  <div className={`message message-${message.role}`} key={message.id}>
                    <span>{message.role === "user" ? "你" : "知序 AI"}</span>
                    <p>{message.content}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <form className="ask-form" onSubmit={submitQuestion}>
              <input
                aria-label="追问内容"
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="例如：这个参数在放大生产中如何验证？"
                value={question}
              />
              <button
                disabled={busyAction === "ask" || !question.trim()}
                type="submit"
              >
                {busyAction === "ask" ? "回答中…" : "提问"}
              </button>
            </form>
          </section>

          {sources.length ? (
            <section className="source-section">
              <span>REFERENCES</span>
              {sources.map((source, index) => (
                <p key={`${source}-${index}`}>
                  {String(index + 1).padStart(2, "0")} · {source}
                </p>
              ))}
            </section>
          ) : null}

          {managementPanel}
        </div>

        <footer className="reader-footer">
          <button className="complete-button" onClick={onComplete} type="button">
            <Icon name="check" />
            标记为已掌握
          </button>
        </footer>
    </article>
  );
}

/** 文章库中的单篇文章预览。 */
function ArticleTile({
  article,
  onOpen,
}: {
  /** 当前文章。 */
  article: Article;
  /** 打开文章详情页。 */
  onOpen: () => void;
}): React.ReactNode {
  /** tags 是从数据库 JSON 恢复的主题标签。 */
  const tags = parseStringArray(article.tagsJson);
  /** sourceHost 是用于界面展示的原文域名。 */
  const sourceHost = new URL(article.url).hostname.replace(/^www\./, "");

  return (
    <button
      className={`article-tile article-domain-${article.domain.toLowerCase()}`}
      onClick={onOpen}
      type="button"
    >
      {article.coverImageUrl ? (
        <img
          alt=""
          className="article-tile-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={article.coverImageUrl}
        />
      ) : (
        <span className="article-cover-fallback">
          {ARTICLE_DOMAIN_LABELS[article.domain]}
        </span>
      )}
      <div className="article-tile-body">
        <div className="article-tile-meta">
          <span>{ARTICLE_DOMAIN_LABELS[article.domain]}</span>
          <span>{article.sourceType === "wechat" ? "微信公众号" : sourceHost}</span>
        </div>
        <h3>{article.title}</h3>
        <p>{article.summary}</p>
        <div className="article-tile-footer">
          <span>
            {article.author || "来源未标注"} ·{" "}
            {Math.max(2, Math.ceil(article.wordCount / 420))} 分钟
          </span>
          <span>{tags.slice(0, 2).join(" · ") || "待读"}</span>
        </div>
      </div>
    </button>
  );
}

/** 站内文章阅读详情页。 */
function ArticleDetail({
  article,
  onClose,
  managementPanel,
}: {
  /** 当前阅读的文章。 */
  article: Article;
  /** 返回文章列表。 */
  onClose: () => void;
  /** 状态、批注与专题管理面板。 */
  managementPanel: React.ReactNode;
}): React.ReactNode {
  /** tags 是从数据库 JSON 恢复的主题标签。 */
  const tags = parseStringArray(article.tagsJson);
  /** sourceHost 是用于界面展示的原文域名。 */
  const sourceHost = new URL(article.url).hostname.replace(/^www\./, "");
  /**
   * safeArticleMarkup 只来自服务端白名单清洗后的 HTML。
   * 外部网页的 script、style、事件属性和危险 URL 已在保存前删除。
   */
  const safeArticleMarkup = { __html: article.contentHtml };

  return (
    <article className="article-detail-page">
      <header className="article-detail-header">
        <button className="reader-back-button" onClick={onClose} type="button">
          ← 返回文章库
        </button>
        <div className="article-detail-kicker">
          <span>{ARTICLE_DOMAIN_LABELS[article.domain]}</span>
          <span>{article.sourceType === "wechat" ? "微信公众号" : sourceHost}</span>
          <span>{article.wordCount.toLocaleString("zh-CN")} 字</span>
        </div>
        <h2>{article.title}</h2>
        <p>{article.summary}</p>
        <div className="article-byline">
          <span>{article.author || "原文作者未标注"}</span>
          {article.publishedAt ? <span>{article.publishedAt}</span> : null}
          <a href={article.url} rel="noopener noreferrer" target="_blank">
            查看原文 ↗
          </a>
        </div>
      </header>

      {article.coverImageUrl ? (
        <img
          alt=""
          className="article-detail-cover"
          referrerPolicy="no-referrer"
          src={article.coverImageUrl}
        />
      ) : null}

      <div className="article-reading-layout">
        <aside className="article-reading-aside">
          <span>ARTICLE INDEX</span>
          <strong>{ARTICLE_DOMAIN_LABELS[article.domain]}</strong>
          {tags.map((tag) => (
            <small key={tag}>#{tag}</small>
          ))}
        </aside>
        <div
          className="article-prose"
          dangerouslySetInnerHTML={safeArticleMarkup}
        />
      </div>

      <footer className="article-detail-footer">
        <span>原文内容版权归原作者及发布平台所有。</span>
        <a href={article.url} rel="noopener noreferrer" target="_blank">
          回到 {sourceHost}
        </a>
      </footer>

      {managementPanel}
    </article>
  );
}

/** 主仪表盘组件。 */
export function Dashboard(): React.ReactNode {
  /** data 是当前云端或离线快照。 */
  const [data, setData] = useState<BootstrapData | null>(null);
  /** activeView 是当前导航页。 */
  const [activeView, setActiveView] = useState<ViewName>("today");
  /** selectedCardId 是阅读器正在展示的卡片。 */
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  /** selectedArticleId 是文章详情页正在展示的文章。 */
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  /** articleUrl 是文章解析输入框中的链接。 */
  const [articleUrl, setArticleUrl] = useState("");
  /** domainFilter 是知识库领域筛选。 */
  const [domainFilter, setDomainFilter] = useState<Domain | "ALL">("ALL");
  /** searchText 是知识库搜索词。 */
  const [searchText, setSearchText] = useState("");
  /** globalSearchText 是跨卡片、文章、深度内容和批注的搜索词。 */
  const [globalSearchText, setGlobalSearchText] = useState("");
  /** collectionName 是新建专题的名称草稿。 */
  const [collectionName, setCollectionName] = useState("");
  /** collectionDescription 是新建专题的说明草稿。 */
  const [collectionDescription, setCollectionDescription] = useState("");
  /** activeCollectionId 是专题页当前展开的专题。 */
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null,
  );
  /** loading 表示首次数据加载中。 */
  const [loading, setLoading] = useState(true);
  /** unauthorized 表示生产环境尚未登录。 */
  const [unauthorized, setUnauthorized] = useState(false);
  /** offline 表示当前展示 IndexedDB 快照。 */
  const [offline, setOffline] = useState(false);
  /** notice 是顶部短暂状态提示。 */
  const [notice, setNotice] = useState<string | null>(null);
  /** busyAction 表示当前异步动作。 */
  const [busyAction, setBusyAction] = useState<string | null>(null);
  /** pairCode 是网页创建的六位手机配对码。 */
  const [pairCode, setPairCode] = useState<string | null>(null);
  /** settingsDraft 是设置表单草稿。 */
  const [settingsDraft, setSettingsDraft] = useState<UserSettings | null>(null);
  /** importDraft 是 Codex/ChatGPT 快速收录表单草稿。 */
  const [importDraft, setImportDraft] = useState<ImportDraft>({
    title: "",
    domain: "AI",
    source: "Codex",
    content: "",
  });

  /** loadData 从云端刷新，断网时回退到本地快照。 */
  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      /** response 是受保护的启动接口。 */
      const response = await fetch("/api/bootstrap", { cache: "no-store" });
      if (response.status === 401) {
        setUnauthorized(true);
        return;
      }
      /** payload 是最新云端快照或错误。 */
      const payload = (await response.json()) as BootstrapData & ApiError;
      if (!response.ok) throw new Error(payload.message ?? "同步失败");
      /** normalizedPayload 为旧客户端结构补齐新增的数据集合。 */
      const normalizedPayload = normalizeBootstrapData(payload);
      setData(normalizedPayload);
      setSettingsDraft(payload.settings);
      setOffline(false);
      setUnauthorized(false);
      await writeOfflineSnapshot(normalizedPayload);
    } catch (error) {
      /** cached 是最近一次成功同步的浏览器离线快照。 */
      const cached = await readOfflineSnapshot().catch(() => null);
      if (cached) {
        /** normalizedCached 为旧版 IndexedDB 快照补齐文章数组。 */
        const normalizedCached = normalizeBootstrapData(cached);
        setData(normalizedCached);
        setSettingsDraft(cached.settings);
        setOffline(true);
      } else {
        /** failureMessage 区分云端接口故障与真正的浏览器网络故障。 */
        const failureMessage =
          error instanceof Error && error.message
            ? `云端数据加载失败：${error.message}`
            : "暂时无法连接云端，请检查网络后刷新。";
        setNotice(failureMessage);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /** 组件首次挂载时加载账号数据。 */
  useEffect(() => {
    /** timer 把异步加载放到浏览器任务队列，避免在 effect 主体同步触发状态级联。 */
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  /** selectedCard 是阅读器当前卡片。 */
  const selectedCard = useMemo(
    () => data?.cards.find((card) => card.id === selectedCardId),
    [data, selectedCardId],
  );
  /** selectedArticle 是站内文章阅读页当前展示的文章。 */
  const selectedArticle = useMemo(
    () => data?.articles.find((article) => article.id === selectedArticleId),
    [data, selectedArticleId],
  );
  /** pageTitle 是顶部工具栏当前显示的页面名称。 */
  const pageTitle = selectedCard
    ? "卡片详情"
    : selectedArticle
      ? "文章阅读"
      : NAV_ITEMS.find((item) => item.id === activeView)?.label;
  /** favoriteIds 是收藏卡片 ID 集合。 */
  const favoriteIds = useMemo(
    () => new Set(data?.favorites.map((item) => item.cardId) ?? []),
    [data],
  );
  /** completedIds 是已读卡片 ID 集合。 */
  const completedIds = useMemo(() => {
    /** result 先兼容 Android 使用的旧进度记录。 */
    const result = new Set(
      data?.progress
        .filter((item) => item.status === "completed")
        .map((item) => item.cardId) ?? [],
    );
    for (const state of data?.knowledgeStates ?? []) {
      if (state.targetType !== "card") continue;
      if (state.status === "mastered") result.add(state.targetId);
      else result.delete(state.targetId);
    }
    return result;
  }, [data]);
  /** knowledgeStateMap 按“目标类型:目标 ID”索引个人学习状态。 */
  const knowledgeStateMap = useMemo(
    () =>
      new Map(
        data?.knowledgeStates.map((item) => [
          `${item.targetType}:${item.targetId}`,
          item.status,
        ]) ?? [],
      ),
    [data],
  );
  /** collectionItemsByTarget 按知识目标索引其所属专题 ID。 */
  const collectionItemsByTarget = useMemo(() => {
    /** result 收集每个知识目标对应的专题 ID 集合。 */
    const result = new Map<string, Set<string>>();
    for (const item of data?.collectionItems ?? []) {
      /** targetKey 是 card:ID 或 article:ID。 */
      const targetKey = `${item.targetType}:${item.targetId}`;
      /** collectionIds 是当前目标已经加入的专题集合。 */
      const collectionIds = result.get(targetKey) ?? new Set<string>();
      collectionIds.add(item.collectionId);
      result.set(targetKey, collectionIds);
    }
    return result;
  }, [data]);
  /** activeCollection 是专题页当前展开的专题记录。 */
  const activeCollection = useMemo(
    () =>
      data?.collections.find((collection) => collection.id === activeCollectionId) ??
      data?.collections[0] ??
      null,
    [activeCollectionId, data],
  );
  /** globalSearchResults 是跨全部知识类型的相关性排序结果。 */
  const globalSearchResults = useMemo<GlobalSearchResult[]>(() => {
    /** query 是移除首尾空白后的搜索词。 */
    const query = globalSearchText.trim();
    if (!data || !query) return [];
    /** results 收集卡片、文章、深度内容和个人批注的统一结果。 */
    const results: GlobalSearchResult[] = [];

    for (const card of data.cards) {
      /** body 是卡片摘要、正文与系列名称的合并搜索文本。 */
      const body = `${card.summary} ${card.content} ${card.series}`;
      /** score 是当前卡片的简单相关性分数。 */
      const score = calculateSearchScore(card.title, body, query);
      if (score > 0) {
        results.push({
          kind: "card",
          id: `card:${card.id}`,
          targetType: "card",
          targetId: card.id,
          title: card.title,
          excerpt: createSearchExcerpt(body, query),
          domainLabel: DOMAIN_LABELS[card.domain],
          status:
            knowledgeStateMap.get(`card:${card.id}`) ??
            (completedIds.has(card.id) ? "mastered" : "inbox"),
          score,
        });
      }
    }

    for (const article of data.articles) {
      /** body 是文章简介与纯文本正文的合并搜索文本。 */
      const body = `${article.summary} ${article.contentText}`;
      /** score 是当前文章的简单相关性分数。 */
      const score = calculateSearchScore(article.title, body, query);
      if (score > 0) {
        results.push({
          kind: "article",
          id: `article:${article.id}`,
          targetType: "article",
          targetId: article.id,
          title: article.title,
          excerpt: createSearchExcerpt(body, query),
          domainLabel: ARTICLE_DOMAIN_LABELS[article.domain],
          status: knowledgeStateMap.get(`article:${article.id}`) ?? "inbox",
          score,
        });
      }
    }

    for (const deepDive of data.deepDives) {
      /** card 是当前深度内容对应的知识卡片。 */
      const card = data.cards.find((item) => item.id === deepDive.cardId);
      if (!card) continue;
      /** score 是当前深度内容的简单相关性分数。 */
      const score = calculateSearchScore(deepDive.title, deepDive.content, query);
      if (score > 0) {
        results.push({
          kind: "deep",
          id: `deep:${deepDive.id}`,
          targetType: "card",
          targetId: card.id,
          title: deepDive.title,
          excerpt: createSearchExcerpt(deepDive.content, query),
          domainLabel: `${DOMAIN_LABELS[card.domain]} · 深度内容`,
          status:
            knowledgeStateMap.get(`card:${card.id}`) ??
            (completedIds.has(card.id) ? "mastered" : "learning"),
          score: score + 5,
        });
      }
    }

    for (const annotation of data.annotations) {
      /** targetTitle 是批注对应卡片或文章的标题。 */
      const targetTitle =
        annotation.targetType === "card"
          ? data.cards.find((item) => item.id === annotation.targetId)?.title
          : data.articles.find((item) => item.id === annotation.targetId)?.title;
      if (!targetTitle) continue;
      /** body 是原文引用与个人批注正文的合并搜索文本。 */
      const body = `${annotation.quoteText ?? ""} ${annotation.noteText}`;
      /** score 是当前批注的简单相关性分数。 */
      const score = calculateSearchScore(targetTitle, body, query);
      if (score > 0) {
        results.push({
          kind: "annotation",
          id: `annotation:${annotation.id}`,
          targetType: annotation.targetType,
          targetId: annotation.targetId,
          title: `我的批注 · ${targetTitle}`,
          excerpt: createSearchExcerpt(body, query),
          domainLabel: "个人理解",
          status:
            knowledgeStateMap.get(
              `${annotation.targetType}:${annotation.targetId}`,
            ) ?? "organizing",
          score: score + 10,
        });
      }
    }

    return results.sort((left, right) => right.score - left.score).slice(0, 80);
  }, [
    completedIds,
    data,
    globalSearchText,
    knowledgeStateMap,
  ]);
  /** filteredCards 是知识库筛选结果。 */
  const filteredCards = useMemo(() => {
    /** normalizedSearch 是大小写无关搜索词。 */
    const normalizedSearch = searchText.trim().toLowerCase();
    return (
      data?.cards.filter((card) => {
        /** matchesDomain 表示领域筛选通过。 */
        const matchesDomain =
          domainFilter === "ALL" || card.domain === domainFilter;
        /** haystack 是参与搜索的主要文本。 */
        const haystack =
          `${card.title} ${card.summary} ${card.content} ${card.series}`.toLowerCase();
        return matchesDomain && (!normalizedSearch || haystack.includes(normalizedSearch));
      }) ?? []
    );
  }, [data, domainFilter, searchText]);
  /** todayCards 是首页展示的 5 张近期卡片。 */
  const todayCards = data?.cards.slice(0, 5) ?? [];
  /** completionRate 是已掌握卡片百分比。 */
  const completionRate = data?.cards.length
    ? Math.round((completedIds.size / data.cards.length) * 100)
    : 0;

  /** 打开站内卡片详情页，并关闭可能存在的文章详情页。 */
  function openCard(cardId: string): void {
    setSelectedArticleId(null);
    setSelectedCardId(cardId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** 打开站内文章详情页，并关闭可能存在的卡片详情页。 */
  function openArticle(articleId: string): void {
    setSelectedCardId(null);
    setSelectedArticleId(articleId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** 返回当前主导航页面。 */
  function closeDetailPage(): void {
    setSelectedCardId(null);
    setSelectedArticleId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** 打开统一搜索结果对应的卡片或文章详情页。 */
  function openKnowledgeTarget(
    targetType: KnowledgeTargetType,
    targetId: string,
  ): void {
    if (targetType === "card") openCard(targetId);
    else openArticle(targetId);
  }

  /** 返回目标的显式知识状态，缺失时使用兼容旧进度的默认状态。 */
  function statusForTarget(
    targetType: KnowledgeTargetType,
    targetId: string,
  ): KnowledgeStatus {
    /** explicitStatus 是知识状态表中保存的当前值。 */
    const explicitStatus = knowledgeStateMap.get(`${targetType}:${targetId}`);
    if (explicitStatus) return explicitStatus;
    if (targetType === "card" && completedIds.has(targetId)) return "mastered";
    return "inbox";
  }

  /** 保存卡片或文章的个人学习状态。 */
  async function persistKnowledgeStatus(
    targetType: KnowledgeTargetType,
    targetId: string,
    status: KnowledgeStatus,
  ): Promise<void> {
    if (!data || offline) return;
    setBusyAction("state");
    try {
      /** response 是知识状态表保存后的最终记录。 */
      const response = await requestJson<{ state: KnowledgeState }>(
        "/api/knowledge/state",
        {
          method: "POST",
          body: JSON.stringify({ targetType, targetId, status }),
        },
      );
      /** nextStates 替换同一知识目标的旧状态。 */
      const nextStates = [
        response.state,
        ...data.knowledgeStates.filter(
          (item) =>
            item.targetType !== targetType || item.targetId !== targetId,
        ),
      ];
      /** nextData 是立即反映状态变化的账号快照。 */
      let nextData: BootstrapData = {
        ...data,
        knowledgeStates: nextStates,
      };

      if (targetType === "card" && status === "mastered") {
        /** progressResponse 兼容 Android 当前使用的卡片完成状态。 */
        const progressResponse = await requestJson<{ progress: Progress }>(
          "/api/progress",
          {
            method: "POST",
            body: JSON.stringify({
              cardId: targetId,
              status: "completed",
              readingSeconds: 300,
            }),
          },
        );
        nextData = {
          ...nextData,
          progress: [
            progressResponse.progress,
            ...data.progress.filter((item) => item.cardId !== targetId),
          ],
        };
      }

      setData(nextData);
      await writeOfflineSnapshot(nextData);
      setNotice(`已更新为“${KNOWLEDGE_STATUS_LABELS[status]}”。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "知识状态保存失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 新增当前卡片或文章的个人批注。 */
  async function addAnnotation(
    targetType: KnowledgeTargetType,
    targetId: string,
    noteText: string,
    quoteText: string | null,
  ): Promise<boolean> {
    if (!data || offline) return false;
    setBusyAction("annotation");
    try {
      /** response 是数据库新建的个人批注。 */
      const response = await requestJson<{ annotation: Annotation }>(
        "/api/annotations",
        {
          method: "POST",
          body: JSON.stringify({
            targetType,
            targetId,
            noteText,
            quoteText,
          }),
        },
      );
      /** nextData 是加入新批注后的账号快照。 */
      const nextData = {
        ...data,
        annotations: [response.annotation, ...data.annotations],
      };
      setData(nextData);
      await writeOfflineSnapshot(nextData);
      setNotice("个人批注已保存并同步。");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批注保存失败。");
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  /** 删除当前账号拥有的一条个人批注。 */
  async function removeAnnotation(annotationId: string): Promise<void> {
    if (!data || offline) return;
    setBusyAction("annotation-delete");
    try {
      await requestJson<{ deleted: boolean }>(
        `/api/annotations?id=${encodeURIComponent(annotationId)}`,
        { method: "DELETE" },
      );
      /** nextData 是移除目标批注后的账号快照。 */
      const nextData = {
        ...data,
        annotations: data.annotations.filter((item) => item.id !== annotationId),
      };
      setData(nextData);
      await writeOfflineSnapshot(nextData);
      setNotice("批注已删除。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批注删除失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 新建一个个人知识专题。 */
  async function createCollection(): Promise<void> {
    if (!data || offline || !collectionName.trim()) return;
    setBusyAction("collection");
    try {
      /** response 是数据库新建或更新后的专题。 */
      const response = await requestJson<{ collection: KnowledgeCollection }>(
        "/api/collections",
        {
          method: "POST",
          body: JSON.stringify({
            name: collectionName,
            description: collectionDescription,
          }),
        },
      );
      /** nextCollections 替换同名或同 ID 专题，并把最新专题放到首位。 */
      const nextCollections = [
        response.collection,
        ...data.collections.filter(
          (item) =>
            item.id !== response.collection.id &&
            item.name !== response.collection.name,
        ),
      ];
      /** nextData 是立即反映专题变化的账号快照。 */
      const nextData = { ...data, collections: nextCollections };
      setData(nextData);
      await writeOfflineSnapshot(nextData);
      setActiveCollectionId(response.collection.id);
      setCollectionName("");
      setCollectionDescription("");
      setNotice("专题已创建，可以从卡片或文章详情页加入内容。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "专题创建失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 把知识目标加入专题，或从专题中移除。 */
  async function toggleKnowledgeCollection(
    collectionId: string,
    targetType: KnowledgeTargetType,
    targetId: string,
    active: boolean,
  ): Promise<void> {
    if (!data || offline) return;
    setBusyAction("collection-item");
    try {
      /** response 是数据库保存后的专题成员状态。 */
      const response = await requestJson<{
        active: boolean;
        item: CollectionItem | null;
      }>("/api/collections/items", {
        method: "POST",
        body: JSON.stringify({
          collectionId,
          targetType,
          targetId,
          active,
        }),
      });
      /** remainingItems 移除同一专题与目标的旧关系。 */
      const remainingItems = data.collectionItems.filter(
        (item) =>
          item.collectionId !== collectionId ||
          item.targetType !== targetType ||
          item.targetId !== targetId,
      );
      /** nextItems 在加入专题时附加服务端返回的正式关系记录。 */
      const nextItems =
        response.active && response.item
          ? [response.item, ...remainingItems]
          : remainingItems;
      /** nextData 是立即反映专题关系变化的账号快照。 */
      const nextData = { ...data, collectionItems: nextItems };
      setData(nextData);
      await writeOfflineSnapshot(nextData);
      setNotice(response.active ? "已加入专题。" : "已从专题移除。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "专题关系保存失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 在本地状态中乐观切换收藏，并同步到云端。 */
  async function toggleFavorite(cardId: string): Promise<void> {
    if (!data || offline) return;
    /** active 是切换后的目标状态。 */
    const active = !favoriteIds.has(cardId);
    /** previousData 用于请求失败时恢复。 */
    const previousData = data;
    /** nextFavorites 是乐观更新后的收藏数组。 */
    const nextFavorites = active
      ? [...data.favorites, { id: `pending-${cardId}`, cardId }]
      : data.favorites.filter((item) => item.cardId !== cardId);
    setData({ ...data, favorites: nextFavorites });
    try {
      await requestJson("/api/favorites", {
        method: "POST",
        body: JSON.stringify({ cardId, active }),
      });
      setNotice(active ? "已收藏，手机端会同步看到。" : "已取消收藏。");
    } catch (error) {
      setData(previousData);
      setNotice(error instanceof Error ? error.message : "收藏同步失败。");
    }
  }

  /** 通过服务端 DeepSeek 生成一张实时卡片。 */
  async function generateCard(): Promise<void> {
    if (!data || offline) return;
    setBusyAction("card");
    try {
      /** response 是新生成并保存的卡片。 */
      const response = await requestJson<{ card: Card }>("/api/generate/card", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setData({ ...data, cards: [response.card, ...data.cards] });
      openCard(response.card.id);
      setNotice("新卡片已实时生成并写入云端。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "卡片生成失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 为当前卡片生成无上限的深度内容。 */
  async function generateDeepDive(cardId: string): Promise<void> {
    if (!data || offline) return;
    setBusyAction("deep");
    try {
      /** response 是生成并保存后的深度内容。 */
      const response = await requestJson<{ deepDive: DeepDive }>(
        "/api/generate/deep-dive",
        {
          method: "POST",
          body: JSON.stringify({ cardId }),
        },
      );
      /** nextDeepDives 替换同一卡片的旧深度内容。 */
      const nextDeepDives = [
        response.deepDive,
        ...data.deepDives.filter((item) => item.cardId !== cardId),
      ];
      setData({ ...data, deepDives: nextDeepDives });
      setNotice("深度内容已保存，手机和电脑均可查看。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "深度生成失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 提交当前卡片的 AI 追问。 */
  async function askAi(cardId: string, question: string): Promise<void> {
    if (!data || offline) return;
    setBusyAction("ask");
    try {
      /** response 包含本轮问答两条持久化消息。 */
      const response = await requestJson<{
        userMessage: AiMessage;
        assistantMessage: AiMessage;
      }>("/api/ai/ask", {
        method: "POST",
        body: JSON.stringify({ cardId, question }),
      });
      setData({
        ...data,
        aiMessages: [
          ...data.aiMessages,
          response.userMessage,
          response.assistantMessage,
        ],
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI 回答失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 创建十分钟有效的手机配对码。 */
  async function createPairingCode(): Promise<void> {
    if (offline) return;
    setBusyAction("pair");
    try {
      /** response 是六位配对码和到期时间。 */
      const response = await requestJson<{ code: string; expiresAt: string }>(
        "/api/devices/pair",
        { method: "POST", body: "{}" },
      );
      setPairCode(response.code);
      setNotice("请在手机端输入配对码，十分钟内有效。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "配对码创建失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 解析公开网页或微信公众号链接并保存到文章库。 */
  async function parseArticleUrl(): Promise<void> {
    if (!data || offline) return;
    /** normalizedUrl 是移除首尾空白后的文章链接。 */
    const normalizedUrl = articleUrl.trim();
    if (!normalizedUrl) {
      setNotice("请先输入文章链接。");
      return;
    }

    setBusyAction("article");
    try {
      /** response 包含完成正文提取、分类和保存后的文章。 */
      const response = await requestJson<{ article: Article }>(
        "/api/articles/parse",
        {
          method: "POST",
          body: JSON.stringify({ url: normalizedUrl }),
        },
      );
      /** nextArticles 替换同一文章旧记录并把最新结果放到最前面。 */
      const nextArticles = [
        response.article,
        ...data.articles.filter((article) => article.id !== response.article.id),
      ];
      /** nextData 是立即反映解析结果的界面快照。 */
      const nextData = { ...data, articles: nextArticles };
      setData(nextData);
      await writeOfflineSnapshot(nextData);
      setArticleUrl("");
      openArticle(response.article.id);
      setNotice("文章已解析、分类并保存到文章库。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文章解析失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 读取系统剪贴板中的 Codex 或 ChatGPT 回答。 */
  async function readAnswerFromClipboard(): Promise<void> {
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error("当前浏览器不支持直接读取剪贴板，请手动粘贴。");
      }
      /** clipboardText 是用户本次授权读取的纯文本内容。 */
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        throw new Error("剪贴板里没有可收录的文字。");
      }
      setImportDraft({ ...importDraft, content: clipboardText });
      setNotice("已读取剪贴板，请确认标题和领域后保存。");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "读取剪贴板失败，请在正文框内手动粘贴。",
      );
    }
  }

  /** 把快速收录草稿写入云端知识库。 */
  async function importAnswer(): Promise<void> {
    if (!data || offline) return;
    if (importDraft.content.trim().length < 300) {
      setNotice("收录内容至少需要 300 个字符。");
      return;
    }

    setBusyAction("import");
    try {
      /** response 包含新卡片，以及可能自动建立的深度内容。 */
      const response = await requestJson<{
        card: Card;
        deepDive: DeepDive | null;
      }>("/api/import", {
        method: "POST",
        body: JSON.stringify(importDraft),
      });
      /** nextDeepDives 是加入本次长回答后的深度内容列表。 */
      const nextDeepDives = response.deepDive
        ? [response.deepDive, ...data.deepDives]
        : data.deepDives;
      /** nextData 是立即反映本次收录结果的界面快照。 */
      const nextData = {
        ...data,
        cards: [response.card, ...data.cards],
        deepDives: nextDeepDives,
      };
      setData(nextData);
      await writeOfflineSnapshot(nextData);
      openCard(response.card.id);
      setImportDraft({ ...importDraft, title: "", content: "" });
      setNotice(
        response.deepDive
          ? "已保存为知识卡片，并同步加入深度阅读。"
          : "已保存到知识库，手机端下次同步后也能看到。",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "快速收录失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 保存跨端推送设置。 */
  async function persistSettings(): Promise<void> {
    if (!data || !settingsDraft || offline) return;
    setBusyAction("settings");
    try {
      /** response 是数据库中的最终设置。 */
      const response = await requestJson<{ settings: UserSettings }>(
        "/api/settings",
        {
          method: "PATCH",
          body: JSON.stringify(settingsDraft),
        },
      );
      setData({ ...data, settings: response.settings });
      setSettingsDraft(response.settings);
      setNotice("推送设置已保存，手机下次同步后生效。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "设置保存失败。");
    } finally {
      setBusyAction(null);
    }
  }

  /** 导出完整 JSON，适合备份和程序迁移。 */
  function exportJson(): void {
    if (!data) return;
    /** backup 是带格式版本和导出时间的完整可迁移快照。 */
    const backup = {
      format: "zhixu-knowledge-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      data,
    };
    downloadFile(
      `zhixu-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      "application/json;charset=utf-8",
    );
  }

  /** 导出 Markdown，适合在电脑上长期阅读。 */
  function exportMarkdown(): void {
    if (!data) return;
    downloadFile(
      `zhixu-notes-${new Date().toISOString().slice(0, 10)}.md`,
      snapshotToMarkdown(data),
      "text/markdown;charset=utf-8",
    );
  }

  /** 为指定卡片或文章建立统一的个人知识整理面板。 */
  function renderKnowledgeWorkbench(
    targetType: KnowledgeTargetType,
    targetId: string,
  ): React.ReactNode {
    /** targetAnnotations 是当前知识目标的全部个人批注。 */
    const targetAnnotations = data?.annotations.filter(
      (item) =>
        item.targetType === targetType && item.targetId === targetId,
    ) ?? [];
    /** targetCollectionIds 是当前知识目标已经加入的专题集合。 */
    const targetCollectionIds =
      collectionItemsByTarget.get(`${targetType}:${targetId}`) ??
      new Set<string>();
    return (
      <KnowledgeWorkbench
        annotations={targetAnnotations}
        busyAction={busyAction}
        collectionIds={targetCollectionIds}
        collections={data?.collections ?? []}
        offline={offline}
        onAddAnnotation={(noteText, quoteText) =>
          addAnnotation(targetType, targetId, noteText, quoteText)
        }
        onDeleteAnnotation={(annotationId) =>
          void removeAnnotation(annotationId)
        }
        onStatusChange={(status) =>
          void persistKnowledgeStatus(targetType, targetId, status)
        }
        onToggleCollection={(collectionId, active) =>
          void toggleKnowledgeCollection(
            collectionId,
            targetType,
            targetId,
            active,
          )
        }
        status={statusForTarget(targetType, targetId)}
      />
    );
  }

  if (loading) return <LoadingScreen />;
  if (unauthorized) return <SignInScreen />;
  if (!data) {
    return (
      <main className="loading-shell">
        <div className="loading-mark">!</div>
        <p>{notice ?? "暂时无法读取数据。"}</p>
        <button className="secondary-button" onClick={() => void loadData()} type="button">
          重新连接
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">知</div>
          <div>
            <strong>知序</strong>
            <span>ZHIXU</span>
          </div>
        </div>
        <nav aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              className={activeView === item.id ? "is-active" : ""}
              key={item.id}
              onClick={() => {
                setActiveView(item.id);
                closeDetailPage();
              }}
              type="button"
            >
              <span>{item.hint}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>
        <div className="sidebar-progress">
          <div className="progress-ring" style={{ "--progress": `${completionRate * 3.6}deg` } as React.CSSProperties}>
            <span>{completionRate}%</span>
          </div>
          <div>
            <strong>本期掌握度</strong>
            <span>{completedIds.size} / {data.cards.length} 张</span>
          </div>
        </div>
        <div className="sidebar-account">
          <span>{data.user.displayName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{data.user.displayName}</strong>
            <small>{data.user.email}</small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="菜单">
            <Icon name="menu" />
          </button>
          <div>
            <p className="eyebrow">
              {new Intl.DateTimeFormat("zh-CN", {
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}
            </p>
            <h1>{pageTitle}</h1>
          </div>
          <div className={`sync-state ${offline ? "is-offline" : ""}`}>
            <Icon name={offline ? "cloud" : "sync"} />
            <span>{offline ? "离线快照" : "云端已连接"}</span>
          </div>
        </header>

        {notice ? (
          <button className="notice-bar" onClick={() => setNotice(null)} type="button">
            {notice}
            <Icon name="x" />
          </button>
        ) : null}

        {selectedCard ? (
          <Reader
            busyAction={busyAction}
            card={selectedCard}
            deepDive={data.deepDives.find((item) => item.cardId === selectedCard.id)}
            favorite={favoriteIds.has(selectedCard.id)}
            messages={data.aiMessages.filter((item) => item.cardId === selectedCard.id)}
            onAsk={(question) => void askAi(selectedCard.id, question)}
            onClose={closeDetailPage}
            onComplete={() =>
              void persistKnowledgeStatus("card", selectedCard.id, "mastered")
            }
            onFavorite={() => void toggleFavorite(selectedCard.id)}
            onGenerateDeep={() => void generateDeepDive(selectedCard.id)}
            managementPanel={renderKnowledgeWorkbench("card", selectedCard.id)}
          />
        ) : selectedArticle ? (
          <ArticleDetail
            article={selectedArticle}
            managementPanel={renderKnowledgeWorkbench(
              "article",
              selectedArticle.id,
            )}
            onClose={closeDetailPage}
          />
        ) : null}

        {!selectedCard && !selectedArticle && activeView === "today" ? (
          <>
            <section className="hero-strip">
              <div>
                <p className="eyebrow">DAILY KNOWLEDGE STREAM</p>
                <h2>从 07:30 到 17:30，<br />每小时打开一个技术窗口。</h2>
                <p>
                  当前按 AI 40%、生物工程 45%、PostgreSQL 15% 编排，
                  难度会随你的阅读进度逐步上升。
                </p>
              </div>
              <div className="hero-stat">
                <span>11</span>
                <strong>个推送时段</strong>
                <small>{data.settings.startTime} — {data.settings.endTime}</small>
              </div>
              <button
                className="primary-button"
                disabled={busyAction === "card" || offline}
                onClick={() => void generateCard()}
                type="button"
              >
                <Icon name="spark" />
                {busyAction === "card" ? "正在实时生成…" : "现在生成一张"}
              </button>
            </section>
            <section className="section-block">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">TODAY&apos;S SEQUENCE</p>
                  <h2>今天的知识序列</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => setActiveView("library")}
                  type="button"
                >
                  查看全部 <Icon name="arrow" />
                </button>
              </div>
              <div className="card-grid">
                {todayCards.map((card) => (
                  <CardTile
                    card={card}
                    completed={completedIds.has(card.id)}
                    favorite={favoriteIds.has(card.id)}
                    key={card.id}
                    onFavorite={() => void toggleFavorite(card.id)}
                    onOpen={() => openCard(card.id)}
                  />
                ))}
              </div>
            </section>
          </>
        ) : null}

        {!selectedCard && !selectedArticle && activeView === "search" ? (
          <section className="global-search-page">
            <div className="global-search-hero">
              <div>
                <p className="eyebrow">SEARCH EVERYTHING</p>
                <h2>从你的全部知识中，找到真正需要的那一段。</h2>
                <p>
                  一次搜索卡片、文章、深度内容与个人批注。搜索完全基于当前账号数据，
                  离线快照也可以使用。
                </p>
              </div>
              <label>
                <span>全局搜索</span>
                <input
                  autoFocus
                  onChange={(event) => setGlobalSearchText(event.target.value)}
                  placeholder="例如：CIP 湍流、Agent 状态机、MVCC……"
                  value={globalSearchText}
                />
              </label>
            </div>

            <div className="search-summary-row">
              <span>
                {!globalSearchText.trim()
                  ? "输入关键词开始搜索"
                  : `找到 ${globalSearchResults.length} 条相关内容`}
              </span>
              <small>标题命中优先，其次是正文与个人批注</small>
            </div>

            {globalSearchResults.length ? (
              <div className="global-search-results">
                {globalSearchResults.map((result) => (
                  <button
                    className="global-search-result"
                    key={result.id}
                    onClick={() =>
                      openKnowledgeTarget(result.targetType, result.targetId)
                    }
                    type="button"
                  >
                    <div className="search-result-meta">
                      <span>{SEARCH_KIND_LABELS[result.kind]}</span>
                      <span>{result.domainLabel}</span>
                      <span>{KNOWLEDGE_STATUS_LABELS[result.status]}</span>
                    </div>
                    <h3>{result.title}</h3>
                    <p>{result.excerpt}</p>
                    <strong>
                      打开详情 <Icon name="arrow" />
                    </strong>
                  </button>
                ))}
              </div>
            ) : globalSearchText.trim() ? (
              <div className="empty-state">
                <span>搜</span>
                <h3>暂时没有匹配内容</h3>
                <p>可以缩短关键词，或换用技术术语和英文缩写。</p>
              </div>
            ) : (
              <div className="search-guide-grid">
                <article>
                  <span>01</span>
                  <strong>跨内容搜索</strong>
                  <p>同时检索卡片、收藏文章和深度内容。</p>
                </article>
                <article>
                  <span>02</span>
                  <strong>找回个人理解</strong>
                  <p>你写下的批注也会成为可搜索知识。</p>
                </article>
                <article>
                  <span>03</span>
                  <strong>离线可用</strong>
                  <p>断网时仍能搜索最近一次同步的本地快照。</p>
                </article>
              </div>
            )}
          </section>
        ) : null}

        {!selectedCard && !selectedArticle && activeView === "library" ? (
          <section className="section-block library-block">
            <div className="library-tools">
              <div className="filter-tabs">
                {(["ALL", "AI", "BIO", "DB"] as const).map((domain) => (
                  <button
                    className={domainFilter === domain ? "is-active" : ""}
                    key={domain}
                    onClick={() => setDomainFilter(domain)}
                    type="button"
                  >
                    {domain === "ALL" ? "全部" : DOMAIN_LABELS[domain]}
                  </button>
                ))}
              </div>
              <input
                aria-label="搜索知识库"
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="搜索标题、系列或技术正文"
                value={searchText}
              />
            </div>
            <div className="section-title-row compact">
              <p>{filteredCards.length} 张卡片</p>
              <p>{favoriteIds.size} 张收藏 · {completedIds.size} 张已掌握</p>
            </div>
            <div className="card-grid">
              {filteredCards.map((card) => (
                <CardTile
                  card={card}
                  completed={completedIds.has(card.id)}
                  favorite={favoriteIds.has(card.id)}
                  key={card.id}
                  onFavorite={() => void toggleFavorite(card.id)}
                  onOpen={() => openCard(card.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {!selectedCard && !selectedArticle && activeView === "articles" ? (
          <section className="article-library-page">
            <div className="article-import-hero">
              <div>
                <p className="eyebrow">ARTICLE INBOX</p>
                <h2>把公开文章，整理成自己的长期阅读库。</h2>
                <p>
                  支持普通网页和微信公众号文章。系统会提取正文、过滤脚本，
                  再生成简介、主题标签并自动归入对应领域。
                </p>
              </div>
              <div className="article-import-panel">
                <label htmlFor="article-url">文章链接</label>
                <div className="article-url-row">
                  <input
                    id="article-url"
                    onChange={(event) => setArticleUrl(event.target.value)}
                    placeholder="https://... 或 mp.weixin.qq.com/s/..."
                    type="url"
                    value={articleUrl}
                  />
                  <button
                    className="primary-button"
                    disabled={busyAction === "article" || offline || !articleUrl.trim()}
                    onClick={() => void parseArticleUrl()}
                    type="button"
                  >
                    {busyAction === "article" ? "正在解析…" : "解析并保存"}
                  </button>
                </div>
                <p>
                  仅支持无需登录即可公开访问的正文；付费墙、登录页或强反爬页面可能无法读取。
                </p>
              </div>
            </div>

            <div className="article-library-heading">
              <div>
                <p className="eyebrow">SAVED READING</p>
                <h2>我的文章库</h2>
              </div>
              <span>{data.articles.length} 篇已保存文章</span>
            </div>

            {data.articles.length ? (
              <div className="article-grid">
                {data.articles.map((article) => (
                  <ArticleTile
                    article={article}
                    key={article.id}
                    onOpen={() => openArticle(article.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state article-empty-state">
                <span>文</span>
                <h3>文章库还是空的</h3>
                <p>把一篇公开文章链接粘贴到上方，即可开始整理。</p>
              </div>
            )}
          </section>
        ) : null}

        {!selectedCard && !selectedArticle && activeView === "collections" ? (
          <section className="collections-page">
            <div className="collection-create-panel">
              <div>
                <p className="eyebrow">KNOWLEDGE TOPICS</p>
                <h2>用专题组织项目、问题与长期研究方向。</h2>
                <p>
                  一张卡片或一篇文章可以同时属于多个专题。专题关系会随账号同步，
                  并进入本地备份。
                </p>
              </div>
              <div className="collection-create-form">
                <label>
                  <span>专题名称</span>
                  <input
                    maxLength={48}
                    onChange={(event) => setCollectionName(event.target.value)}
                    placeholder="例如：发酵罐放大与验证"
                    value={collectionName}
                  />
                </label>
                <label>
                  <span>专题说明</span>
                  <textarea
                    maxLength={300}
                    onChange={(event) =>
                      setCollectionDescription(event.target.value)
                    }
                    placeholder="记录这个专题要解决的问题或最终目标。"
                    value={collectionDescription}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={
                    offline ||
                    busyAction === "collection" ||
                    !collectionName.trim()
                  }
                  onClick={() => void createCollection()}
                  type="button"
                >
                  {busyAction === "collection" ? "正在创建…" : "创建专题"}
                </button>
              </div>
            </div>

            {data.collections.length ? (
              <div className="collection-workspace">
                <aside className="collection-list">
                  {data.collections.map((collection) => {
                    /** itemCount 是当前专题中的知识目标数量。 */
                    const itemCount = data.collectionItems.filter(
                      (item) => item.collectionId === collection.id,
                    ).length;
                    /** selected 表示专题是否正在右侧展开。 */
                    const selected = activeCollection?.id === collection.id;
                    return (
                      <button
                        className={selected ? "is-active" : ""}
                        key={collection.id}
                        onClick={() => setActiveCollectionId(collection.id)}
                        type="button"
                      >
                        <span>{String(itemCount).padStart(2, "0")}</span>
                        <div>
                          <strong>{collection.name}</strong>
                          <small>{collection.description || "暂无专题说明"}</small>
                        </div>
                      </button>
                    );
                  })}
                </aside>

                {activeCollection ? (
                  <div className="collection-detail">
                    <header>
                      <div>
                        <p className="eyebrow">ACTIVE TOPIC</p>
                        <h2>{activeCollection.name}</h2>
                        <p>{activeCollection.description || "暂无专题说明。"}</p>
                      </div>
                      <span>
                        {
                          data.collectionItems.filter(
                            (item) => item.collectionId === activeCollection.id,
                          ).length
                        }{" "}
                        条知识
                      </span>
                    </header>

                    <div className="collection-detail-items">
                      {data.collectionItems
                        .filter(
                          (item) => item.collectionId === activeCollection.id,
                        )
                        .map((item) => {
                          /** card 是专题成员对应的可选卡片。 */
                          const card =
                            item.targetType === "card"
                              ? data.cards.find(
                                  (candidate) => candidate.id === item.targetId,
                                )
                              : undefined;
                          /** article 是专题成员对应的可选文章。 */
                          const article =
                            item.targetType === "article"
                              ? data.articles.find(
                                  (candidate) => candidate.id === item.targetId,
                                )
                              : undefined;
                          /** title 是当前专题成员的可读标题。 */
                          const title = card?.title ?? article?.title;
                          /** summary 是当前专题成员的简要说明。 */
                          const summary = card?.summary ?? article?.summary;
                          if (!title || !summary) return null;
                          return (
                            <article key={item.id}>
                              <button
                                onClick={() =>
                                  openKnowledgeTarget(
                                    item.targetType,
                                    item.targetId,
                                  )
                                }
                                type="button"
                              >
                                <span>
                                  {item.targetType === "card" ? "知识卡片" : "收藏文章"}
                                </span>
                                <h3>{title}</h3>
                                <p>{summary}</p>
                              </button>
                              <button
                                className="collection-remove-button"
                                disabled={
                                  offline || busyAction === "collection-item"
                                }
                                onClick={() =>
                                  void toggleKnowledgeCollection(
                                    activeCollection.id,
                                    item.targetType,
                                    item.targetId,
                                    false,
                                  )
                                }
                                type="button"
                              >
                                移出专题
                              </button>
                            </article>
                          );
                        })}
                    </div>

                    {data.collectionItems.every(
                      (item) => item.collectionId !== activeCollection.id,
                    ) ? (
                      <div className="empty-state collection-empty-state">
                        <span>集</span>
                        <h3>这个专题还是空的</h3>
                        <p>打开任意卡片或文章，在个人知识面板中把它加入本专题。</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">
                <span>题</span>
                <h3>先建立第一个专题</h3>
                <p>专题适合组织长期研究方向、工作问题和项目资料。</p>
              </div>
            )}
          </section>
        ) : null}

        {!selectedCard && !selectedArticle && activeView === "deep" ? (
          <section className="section-block">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">LONG-FORM NOTES</p>
                <h2>已保存的深度内容</h2>
              </div>
              <p>最低 2000 字 · 不设最大字数</p>
            </div>
            {data.deepDives.length ? (
              <div className="deep-list">
                {data.deepDives.map((deepDive, index) => {
                  /** card 是当前深度内容对应的卡片。 */
                  const card = data.cards.find((item) => item.id === deepDive.cardId);
                  if (!card) return null;
                  return (
                    <button
                      className="deep-list-item"
                      key={deepDive.id}
                      onClick={() => openCard(card.id)}
                      type="button"
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <small>{DOMAIN_LABELS[card.domain]} · {card.series}</small>
                        <h3>{deepDive.title}</h3>
                        <p>{deepDive.content.slice(0, 180)}…</p>
                      </div>
                      <strong>{deepDive.content.length.toLocaleString("zh-CN")} 字</strong>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <span>深</span>
                <h3>还没有深度内容</h3>
                <p>打开任意卡片，选择“开始深挖”即可生成并保存。</p>
              </div>
            )}
          </section>
        ) : null}

        {!selectedCard &&
        !selectedArticle &&
        activeView === "sync" &&
        settingsDraft ? (
          <section className="settings-grid">
            <article className="settings-card import-card">
              <div className="import-card-heading">
                <div>
                  <p className="eyebrow">QUICK CAPTURE</p>
                  <h2>快速收录 Codex / ChatGPT 回答</h2>
                </div>
                <p>
                  复制一段满意的回答后读取剪贴板即可。正文不少于 300 字；
                  达到 2000 字时会同时保存完整的深度内容，不设最大字数。
                </p>
              </div>
              <div className="import-form">
                <div className="import-meta-row">
                  <label>
                    <span>来源</span>
                    <select
                      onChange={(event) =>
                        setImportDraft({
                          ...importDraft,
                          source: event.target.value as ImportSource,
                        })
                      }
                      value={importDraft.source}
                    >
                      <option value="Codex">Codex</option>
                      <option value="ChatGPT">ChatGPT</option>
                      <option value="其他">其他</option>
                    </select>
                  </label>
                  <label>
                    <span>领域</span>
                    <select
                      onChange={(event) =>
                        setImportDraft({
                          ...importDraft,
                          domain: event.target.value as Domain,
                        })
                      }
                      value={importDraft.domain}
                    >
                      <option value="AI">AI 技术</option>
                      <option value="BIO">生物工程</option>
                      <option value="DB">PostgreSQL</option>
                    </select>
                  </label>
                  <label className="import-title-field">
                    <span>标题（可留空）</span>
                    <input
                      maxLength={42}
                      onChange={(event) =>
                        setImportDraft({ ...importDraft, title: event.target.value })
                      }
                      placeholder="留空时从正文第一行提取"
                      value={importDraft.title}
                    />
                  </label>
                </div>
                <label className="import-content-field">
                  <span>回答正文</span>
                  <textarea
                    onChange={(event) =>
                      setImportDraft({ ...importDraft, content: event.target.value })
                    }
                    placeholder="先在 Codex 或 ChatGPT 中复制回答，再点击“读取剪贴板”；也可以直接粘贴到这里。"
                    value={importDraft.content}
                  />
                </label>
                <div className="import-actions">
                  <span>
                    {importDraft.content.trim().length.toLocaleString("zh-CN")} 字
                  </span>
                  <button
                    className="secondary-button"
                    disabled={busyAction === "import"}
                    onClick={() => void readAnswerFromClipboard()}
                    type="button"
                  >
                    读取剪贴板
                  </button>
                  <button
                    className="primary-button"
                    disabled={
                      busyAction === "import" ||
                      offline ||
                      importDraft.content.trim().length < 300
                    }
                    onClick={() => void importAnswer()}
                    type="button"
                  >
                    {busyAction === "import" ? "正在保存…" : "保存到知序"}
                  </button>
                </div>
              </div>
            </article>

            <article className="settings-card">
              <p className="eyebrow">ANDROID PAIRING</p>
              <h2>绑定你的 Mate 40 Pro</h2>
              <p>
                网页生成一次性配对码，手机领取可撤销令牌。数据库地址、密码和网页登录凭据都不会进入 APK。
              </p>
              {pairCode ? (
                <div className="pair-code" aria-label={`配对码 ${pairCode}`}>
                  {pairCode.split("").map((digit, index) => (
                    <span key={`${digit}-${index}`}>{digit}</span>
                  ))}
                </div>
              ) : (
                <button
                  className="primary-button"
                  disabled={busyAction === "pair" || offline}
                  onClick={() => void createPairingCode()}
                  type="button"
                >
                  <Icon name="sync" />
                  {busyAction === "pair" ? "正在创建…" : "生成手机配对码"}
                </button>
              )}
              <div className="device-list">
                {data.devices.length ? (
                  data.devices.map((device) => (
                    <div key={device.id}>
                      <span className="device-dot" />
                      <div>
                        <strong>{device.deviceName}</strong>
                        <small>最近同步 {formatTime(device.lastSeenAt)}</small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">当前还没有已绑定设备。</p>
                )}
              </div>
            </article>

            <article className="settings-card">
              <p className="eyebrow">PUSH SCHEDULE</p>
              <h2>推送时间与内容配比</h2>
              <div className="settings-form">
                <label>
                  <span>开始时间</span>
                  <input
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, startTime: event.target.value })
                    }
                    type="time"
                    value={settingsDraft.startTime}
                  />
                </label>
                <label>
                  <span>结束时间</span>
                  <input
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, endTime: event.target.value })
                    }
                    type="time"
                    value={settingsDraft.endTime}
                  />
                </label>
                <label>
                  <span>推送间隔（分钟）</span>
                  <input
                    min="30"
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        intervalMinutes: Number(event.target.value),
                      })
                    }
                    step="30"
                    type="number"
                    value={settingsDraft.intervalMinutes}
                  />
                </label>
                <div className="weight-row">
                  {(["aiWeight", "bioWeight", "dbWeight"] as const).map((key) => {
                    /** label 是当前权重的中文名称。 */
                    const label =
                      key === "aiWeight"
                        ? "AI"
                        : key === "bioWeight"
                          ? "生物工程"
                          : "PostgreSQL";
                    return (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          min="0"
                          onChange={(event) =>
                            setSettingsDraft({
                              ...settingsDraft,
                              [key]: Number(event.target.value),
                            })
                          }
                          type="number"
                          value={settingsDraft[key]}
                        />
                      </label>
                    );
                  })}
                </div>
                <button
                  className="secondary-button"
                  disabled={busyAction === "settings" || offline}
                  onClick={() => void persistSettings()}
                  type="button"
                >
                  保存并同步
                </button>
              </div>
            </article>

            <article className="settings-card export-card">
              <p className="eyebrow">LOCAL EXPORT</p>
              <h2>保存到你的电脑</h2>
              <p>
                JSON 会完整保存卡片、文章、状态、批注、专题与同步数据；
                Markdown 适合在 Obsidian、VS Code 或任意文本编辑器中长期阅读。
              </p>
              <div className="export-actions">
                <button className="secondary-button" onClick={exportJson} type="button">
                  <Icon name="download" />
                  导出 JSON
                </button>
                <button className="secondary-button" onClick={exportMarkdown} type="button">
                  <Icon name="download" />
                  导出 Markdown
                </button>
              </div>
              <p className="muted">
                浏览器还会自动维护一份 IndexedDB 离线快照；它不是云数据库的替代品。
              </p>
            </article>
          </section>
        ) : null}
      </main>

    </div>
  );
}
