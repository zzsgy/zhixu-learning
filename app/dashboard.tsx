"use client";

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
type ViewName = "today" | "library" | "deep" | "sync";

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
  { id: "library", label: "知识库", hint: "LIBRARY" },
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
  /** sections 是逐卡片生成的 Markdown 段落。 */
  const sections = data.cards.map((card) => {
    /** flow 是当前卡片流程步骤。 */
    const flow = parseStringArray(card.flowJson);
    /** sources 是当前卡片参考资料。 */
    const sources = parseStringArray(card.sourcesJson);
    /** deepDive 是当前卡片已保存的深度内容。 */
    const deepDive = deepByCard.get(card.id);
    return [
      `## ${card.title}`,
      "",
      `- 领域：${DOMAIN_LABELS[card.domain]}`,
      `- 系列：${card.series} · L${card.level}`,
      `- 收藏：${favoriteIds.has(card.id) ? "是" : "否"}`,
      "",
      card.content,
      card.formula ? `\n**公式**：${card.formula}` : "",
      flow.length ? `\n**流程**：${flow.join(" → ")}` : "",
      sources.length ? `\n**参考**：${sources.join("；")}` : "",
      deepDive
        ? `\n### 深度内容：${deepDive.title}\n\n${deepDive.content}`
        : "",
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

/** 右侧沉浸式阅读器。 */
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
  /** 关闭阅读器。 */
  onClose: () => void;
  /** 切换收藏。 */
  onFavorite: () => void;
  /** 标记完成。 */
  onComplete: () => void;
  /** 生成深度内容。 */
  onGenerateDeep: () => void;
  /** 提交追问。 */
  onAsk: (question: string) => void;
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
    <div className="reader-backdrop" role="presentation" onMouseDown={onClose}>
      <article
        aria-label={`${card.title} 阅读器`}
        className="reader-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="reader-header">
          <div>
            <p className="eyebrow">
              {DOMAIN_LABELS[card.domain]} · {card.series} · L{card.level}
            </p>
            <h2>{card.title}</h2>
          </div>
          <div className="reader-actions">
            <button
              aria-label={favorite ? "取消收藏" : "收藏"}
              className={`icon-button ${favorite ? "is-active" : ""}`}
              onClick={onFavorite}
              type="button"
            >
              <Icon name="bookmark" />
            </button>
            <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
              <Icon name="x" />
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
        </div>

        <footer className="reader-footer">
          <button className="complete-button" onClick={onComplete} type="button">
            <Icon name="check" />
            标记为已掌握
          </button>
        </footer>
      </article>
    </div>
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
  /** domainFilter 是知识库领域筛选。 */
  const [domainFilter, setDomainFilter] = useState<Domain | "ALL">("ALL");
  /** searchText 是知识库搜索词。 */
  const [searchText, setSearchText] = useState("");
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
      setData(payload);
      setSettingsDraft(payload.settings);
      setOffline(false);
      setUnauthorized(false);
      await writeOfflineSnapshot(payload);
    } catch (error) {
      /** cached 是最近一次成功同步的浏览器离线快照。 */
      const cached = await readOfflineSnapshot().catch(() => null);
      if (cached) {
        setData(cached);
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
  /** favoriteIds 是收藏卡片 ID 集合。 */
  const favoriteIds = useMemo(
    () => new Set(data?.favorites.map((item) => item.cardId) ?? []),
    [data],
  );
  /** completedIds 是已读卡片 ID 集合。 */
  const completedIds = useMemo(
    () =>
      new Set(
        data?.progress
          .filter((item) => item.status === "completed")
          .map((item) => item.cardId) ?? [],
      ),
    [data],
  );
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

  /** 把卡片标记为完成。 */
  async function markCompleted(cardId: string): Promise<void> {
    if (!data || offline) return;
    try {
      /** response 是数据库保存后的进度。 */
      const response = await requestJson<{ progress: Progress }>("/api/progress", {
        method: "POST",
        body: JSON.stringify({
          cardId,
          status: "completed",
          readingSeconds: 300,
        }),
      });
      /** nextProgress 替换同一卡片的旧状态。 */
      const nextProgress = [
        ...data.progress.filter((item) => item.cardId !== cardId),
        response.progress,
      ];
      setData({ ...data, progress: nextProgress });
      setNotice("已标记掌握，进度会同步到手机。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "进度同步失败。");
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
      setSelectedCardId(response.card.id);
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
      setSelectedCardId(response.card.id);
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
    downloadFile(
      `zhixu-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
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
              onClick={() => setActiveView(item.id)}
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
            <h1>{NAV_ITEMS.find((item) => item.id === activeView)?.label}</h1>
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

        {activeView === "today" ? (
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
                <button className="text-button" onClick={() => setActiveView("library")} type="button">
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
                    onOpen={() => setSelectedCardId(card.id)}
                  />
                ))}
              </div>
            </section>
          </>
        ) : null}

        {activeView === "library" ? (
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
                  onOpen={() => setSelectedCardId(card.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {activeView === "deep" ? (
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
                      onClick={() => setSelectedCardId(card.id)}
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

        {activeView === "sync" && settingsDraft ? (
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
                JSON 适合完整备份与迁移，Markdown 适合在 Obsidian、VS Code 或任意文本编辑器中长期阅读。
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

      {selectedCard ? (
        <Reader
          busyAction={busyAction}
          card={selectedCard}
          deepDive={data.deepDives.find((item) => item.cardId === selectedCard.id)}
          favorite={favoriteIds.has(selectedCard.id)}
          messages={data.aiMessages.filter((item) => item.cardId === selectedCard.id)}
          onAsk={(question) => void askAi(selectedCard.id, question)}
          onClose={() => setSelectedCardId(null)}
          onComplete={() => void markCompleted(selectedCard.id)}
          onFavorite={() => void toggleFavorite(selectedCard.id)}
          onGenerateDeep={() => void generateDeepDive(selectedCard.id)}
        />
      ) : null}
    </div>
  );
}
