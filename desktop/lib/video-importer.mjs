/**
 * 公开视频链接与字幕导入。
 *
 * 默认只读取页面元数据和公开字幕，不下载视频或音频文件。
 */
import { classifyDocument } from "./classifier.mjs";
import { parseHTML } from "linkedom";
import {
  detectArticleLanguage,
  fetchExternalResource,
  sanitizeArticleHtml,
} from "./article-parser.mjs";

/** maximumVideoResponseBytes 限制平台元数据或字幕响应大小。 */
const maximumVideoResponseBytes = 8_000_000;
/** defaultPreferredLanguages 是中文优先、英文兜底的字幕顺序。 */
const defaultPreferredLanguages = Object.freeze([
  "zh-Hans",
  "zh-CN",
  "zh-Hant",
  "zh-TW",
  "zh",
  "en",
]);

/**
 * 表示视频可访问但没有公开字幕，需要用户决定是否只保存链接。
 */
export class VideoConfirmationRequiredError extends Error {
  constructor(message = "当前视频没有可读取的公开字幕。") {
    super(message);
    this.name = "VideoConfirmationRequiredError";
    this.code = "IMPORT_CONFIRMATION_REQUIRED";
  }
}

/**
 * 规范化受支持的视频链接并识别平台。
 *
 * @param {string} rawUrl 用户输入链接。
 * @returns {{ platform: "youtube" | "bilibili" | "generic", canonicalUrl: string, videoId: string }}
 */
export function normalizeVideoUrl(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(rawUrl || "").trim());
  } catch {
    throw new TypeError("请输入完整的视频链接。");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new TypeError("视频链接必须使用 http 或 https，且不能包含账号信息。");
  }
  parsedUrl.protocol = "https:";
  parsedUrl.hash = "";
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "youtu.be") {
    const videoId = parsedUrl.pathname.split("/").filter(Boolean)[0] || "";
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new TypeError("YouTube 视频编号无效。");
    return {
      platform: "youtube",
      canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      videoId,
    };
  }
  if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostname)) {
    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const videoId = parsedUrl.searchParams.get("v")
      || (["shorts", "embed", "live"].includes(pathParts[0]) ? pathParts[1] : "")
      || "";
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new TypeError("YouTube 视频编号无效。");
    return {
      platform: "youtube",
      canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      videoId,
    };
  }
  if (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) {
    const videoId = parsedUrl.pathname.match(/\/(BV[A-Za-z0-9]+)/i)?.[1] || "";
    if (!/^BV[A-Za-z0-9]{8,20}$/i.test(videoId)) throw new TypeError("哔哩哔哩视频编号无效。");
    return {
      platform: "bilibili",
      canonicalUrl: `https://www.bilibili.com/video/${videoId}`,
      videoId,
    };
  }
  return {
    platform: "generic",
    canonicalUrl: parsedUrl.toString(),
    videoId: "",
  };
}

/**
 * 读取大小受限的外部文本响应。
 *
 * @param {Response} response Fetch 响应。
 * @param {string} label 资源名称。
 * @returns {Promise<string>} 响应文本。
 */
async function readLimitedText(response, label) {
  if (!response?.ok) throw new Error(`${label}返回 HTTP ${response?.status || "错误"}。`);
  const contentLength = Number(response.headers?.get?.("content-length")) || 0;
  if (contentLength > maximumVideoResponseBytes) throw new Error(`${label}响应过大，已停止读取。`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumVideoResponseBytes) {
    throw new Error(`${label}响应过大，已停止读取。`);
  }
  return text;
}

/**
 * 从脚本变量后提取一个完整 JSON 对象，正确处理字符串内的括号。
 *
 * @param {string} source HTML 或脚本文本。
 * @param {string} marker JSON 变量标记。
 * @returns {Record<string, unknown> | null} 解析对象。
 */
function extractJsonObjectAfterMarker(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const startIndex = source.indexOf("{", markerIndex + marker.length);
  if (startIndex < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(startIndex, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * 按用户偏好和人工字幕优先级选择字幕轨。
 *
 * @param {Array<Record<string, unknown>>} tracks 字幕轨。
 * @param {Array<string>} preferredLanguages 语言顺序。
 * @returns {Record<string, unknown> | null} 最佳字幕轨。
 */
function chooseCaptionTrack(tracks, preferredLanguages) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const preferences = preferredLanguages.map((value) => String(value).toLowerCase());
  return [...tracks].sort((left, right) => {
    const languageRank = (track) => {
      const languageCode = String(track.languageCode || track.lan || "").toLowerCase();
      const exactIndex = preferences.indexOf(languageCode);
      if (exactIndex >= 0) return exactIndex;
      const baseIndex = preferences.findIndex(
        (preference) => preference.split("-")[0] === languageCode.split("-")[0],
      );
      return baseIndex >= 0 ? baseIndex + 0.25 : preferences.length + 1;
    };
    return languageRank(left) - languageRank(right)
      || Number(left.kind === "asr") - Number(right.kind === "asr");
  })[0];
}

/**
 * 解析 YouTube json3 字幕。
 *
 * @param {Record<string, unknown>} payload json3 响应。
 * @returns {Array<{ startSeconds: number, endSeconds: number, text: string }>} 字幕片段。
 */
function parseYoutubeJson3(payload) {
  const segments = [];
  for (const event of Array.isArray(payload?.events) ? payload.events : []) {
    const text = (Array.isArray(event.segs) ? event.segs : [])
      .map((segment) => String(segment.utf8 || ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const startSeconds = Math.max(Number(event.tStartMs) || 0, 0) / 1000;
    const endSeconds = startSeconds + Math.max(Number(event.dDurationMs) || 0, 0) / 1000;
    if (segments.at(-1)?.text === text) continue;
    segments.push({ startSeconds, endSeconds, text });
  }
  return segments;
}

/**
 * 解析 YouTube 仍可能返回的 timedtext XML 字幕。
 *
 * @param {string} source XML 字幕文本。
 * @returns {Array<{ startSeconds: number, endSeconds: number, text: string }>} 字幕片段。
 */
function parseYoutubeTimedText(source) {
  if (!/<(?:text|p)\b/i.test(source)) return [];
  const { document } = parseHTML(`<body>${source}</body>`);
  return Array.from(document.querySelectorAll("text, p")).map((element) => {
    const startSeconds = Math.max(
      Number(element.getAttribute("start"))
        || (Number(element.getAttribute("t")) || 0) / 1000,
      0,
    );
    const durationSeconds = Math.max(
      Number(element.getAttribute("dur"))
        || (Number(element.getAttribute("d")) || 0) / 1000,
      0,
    );
    return {
      startSeconds,
      endSeconds: startSeconds + durationSeconds,
      text: String(element.textContent || "").replace(/\s+/g, " ").trim(),
    };
  }).filter((item) => item.text);
}

/**
 * 获取 YouTube 页面元数据和公开字幕。
 *
 * @param {ReturnType<typeof normalizeVideoUrl>} normalized 规范化链接。
 * @param {Function} fetcher 外部请求函数。
 * @param {Array<string>} preferredLanguages 字幕偏好。
 * @returns {Promise<Record<string, unknown>>} 视频信息。
 */
async function inspectYoutube(normalized, fetcher, preferredLanguages) {
  const watchUrl = new URL(normalized.canonicalUrl);
  const pageResponse = await fetcher(watchUrl, {
    headers: {
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  }, "YouTube 视频页面");
  const pageText = await readLimitedText(pageResponse, "YouTube 视频页面");
  const playerResponse = extractJsonObjectAfterMarker(pageText, "ytInitialPlayerResponse =")
    || extractJsonObjectAfterMarker(pageText, "var ytInitialPlayerResponse =");
  if (!playerResponse) throw new Error("YouTube 页面未返回可识别的视频信息，请稍后重试。");
  const videoDetails = playerResponse.videoDetails || {};
  const captionTracks = playerResponse.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks || [];
  const selectedTrack = chooseCaptionTrack(captionTracks, preferredLanguages);
  let segments = [];
  if (selectedTrack?.baseUrl) {
    const captionUrl = new URL(selectedTrack.baseUrl);
    const captionHost = captionUrl.hostname.toLowerCase();
    if (!captionHost.endsWith("youtube.com") && !captionHost.endsWith("googlevideo.com")) {
      throw new Error("YouTube 返回了非预期的字幕地址，已停止访问。");
    }
    captionUrl.searchParams.set("fmt", "json3");
    const captionResponse = await fetcher(captionUrl, {
      headers: { "accept-language": "zh-CN,zh;q=0.9,en;q=0.7" },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    }, "YouTube 字幕");
    const captionText = await readLimitedText(captionResponse, "YouTube 字幕");
    try {
      segments = parseYoutubeJson3(JSON.parse(captionText));
    } catch {
      /** 部分公开视频仍返回 timedtext XML；空响应表示当前访客无法读取字幕。 */
      segments = parseYoutubeTimedText(captionText);
    }
  }
  return {
    ...normalized,
    title: String(videoDetails.title || "YouTube 视频").trim(),
    author: String(videoDetails.author || "").trim(),
    description: String(videoDetails.shortDescription || "").trim(),
    coverImageUrl: videoDetails.thumbnail?.thumbnails?.at?.(-1)?.url || null,
    durationSeconds: Number(videoDetails.lengthSeconds) || 0,
    captionLanguage: String(selectedTrack?.languageCode || ""),
    captionName: String(selectedTrack?.name?.simpleText || ""),
    segments,
  };
}

/**
 * 获取哔哩哔哩公开视频元数据和无需登录即可读取的字幕。
 *
 * @param {ReturnType<typeof normalizeVideoUrl>} normalized 规范化链接。
 * @param {Function} fetcher 外部请求函数。
 * @param {Array<string>} preferredLanguages 字幕偏好。
 * @returns {Promise<Record<string, unknown>>} 视频信息。
 */
async function inspectBilibili(normalized, fetcher, preferredLanguages) {
  const metadataUrl = new URL("https://api.bilibili.com/x/web-interface/view");
  metadataUrl.searchParams.set("bvid", normalized.videoId);
  const metadataResponse = await fetcher(metadataUrl, {
    headers: { referer: normalized.canonicalUrl, "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(25_000),
  }, "哔哩哔哩视频信息");
  const metadata = JSON.parse(await readLimitedText(metadataResponse, "哔哩哔哩视频信息"));
  if (Number(metadata.code) !== 0 || !metadata.data) {
    throw new Error(`哔哩哔哩视频信息读取失败：${metadata.message || "未知错误"}`);
  }
  const video = metadata.data;
  const cid = video.pages?.[0]?.cid || video.cid;
  let tracks = [];
  if (cid) {
    const playerUrl = new URL("https://api.bilibili.com/x/player/v2");
    playerUrl.searchParams.set("bvid", normalized.videoId);
    playerUrl.searchParams.set("cid", String(cid));
    const playerResponse = await fetcher(playerUrl, {
      headers: { referer: normalized.canonicalUrl, "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(25_000),
    }, "哔哩哔哩字幕信息");
    const player = JSON.parse(await readLimitedText(playerResponse, "哔哩哔哩字幕信息"));
    tracks = player.data?.subtitle?.subtitles || [];
  }
  const selectedTrack = chooseCaptionTrack(tracks, preferredLanguages);
  let segments = [];
  if (selectedTrack?.subtitle_url) {
    const rawSubtitleUrl = String(selectedTrack.subtitle_url);
    const subtitleUrl = new URL(rawSubtitleUrl.startsWith("//") ? `https:${rawSubtitleUrl}` : rawSubtitleUrl);
    const subtitleHost = subtitleUrl.hostname.toLowerCase();
    if (!subtitleHost.endsWith("hdslb.com") && !subtitleHost.endsWith("bilibili.com")) {
      throw new Error("哔哩哔哩返回了非预期的字幕地址，已停止访问。");
    }
    const subtitleResponse = await fetcher(subtitleUrl, {
      headers: { referer: normalized.canonicalUrl, "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(25_000),
    }, "哔哩哔哩字幕");
    const subtitle = JSON.parse(await readLimitedText(subtitleResponse, "哔哩哔哩字幕"));
    segments = (Array.isArray(subtitle.body) ? subtitle.body : [])
      .map((item) => ({
        startSeconds: Math.max(Number(item.from) || 0, 0),
        endSeconds: Math.max(Number(item.to) || 0, 0),
        text: String(item.content || "").replace(/\s+/g, " ").trim(),
      }))
      .filter((item) => item.text);
  }
  return {
    ...normalized,
    title: String(video.title || "哔哩哔哩视频").trim(),
    author: String(video.owner?.name || "").trim(),
    description: String(video.desc || "").trim(),
    publishedAt: video.pubdate ? new Date(Number(video.pubdate) * 1000).toISOString() : null,
    coverImageUrl: video.pic || null,
    durationSeconds: Number(video.duration) || 0,
    captionLanguage: String(selectedTrack?.lan || ""),
    captionName: String(selectedTrack?.lan_doc || ""),
    segments,
  };
}

/**
 * 检查视频链接并优先读取公开字幕。
 *
 * @param {string} rawUrl 视频链接。
 * @param {{ fetcher?: Function, preferredLanguages?: Array<string> }} options 测试注入与语言偏好。
 * @returns {Promise<Record<string, unknown>>} 统一视频元数据。
 */
export async function inspectVideoSource(rawUrl, options = {}) {
  const normalized = normalizeVideoUrl(rawUrl);
  const fetcher = options.fetcher || fetchExternalResource;
  const preferredLanguages = Array.isArray(options.preferredLanguages)
    && options.preferredLanguages.length > 0
    ? options.preferredLanguages.slice(0, 12)
    : [...defaultPreferredLanguages];
  if (normalized.platform === "youtube") {
    return inspectYoutube(normalized, fetcher, preferredLanguages);
  }
  if (normalized.platform === "bilibili") {
    return inspectBilibili(normalized, fetcher, preferredLanguages);
  }
  return {
    ...normalized,
    title: `视频链接 · ${new URL(normalized.canonicalUrl).hostname}`,
    author: "",
    description: "",
    coverImageUrl: null,
    durationSeconds: 0,
    captionLanguage: "",
    captionName: "",
    segments: [],
  };
}

/**
 * 把秒数格式化为字幕标题使用的时间戳。
 *
 * @param {number} seconds 起始秒数。
 * @returns {string} HH:MM:SS 或 MM:SS。
 */
export function formatVideoTimestamp(seconds) {
  const totalSeconds = Math.max(Math.floor(Number(seconds) || 0), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":")
    : [minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
}

/**
 * 为平台链接补充定位到当前字幕时间的参数。
 *
 * @param {Record<string, unknown>} video 视频信息。
 * @param {number} seconds 起始秒数。
 * @returns {string} 可打开的时间链接。
 */
function createTimestampUrl(video, seconds) {
  const timestampUrl = new URL(video.canonicalUrl);
  timestampUrl.searchParams.set("t", String(Math.max(Math.floor(Number(seconds) || 0), 0)));
  return timestampUrl.toString();
}

/**
 * 将字幕作为纯文本写入 HTML，防止平台字幕内容生成标签或远程资源。
 *
 * @param {unknown} value 字幕文本。
 * @returns {string} HTML 文本节点安全值。
 */
function escapeHtmlText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * 生成可由文章库安全保存、检索和阅读的视频字幕正文。
 *
 * @param {Record<string, unknown>} video 统一视频信息。
 * @param {{ saveLinkOnly?: boolean }} options 无字幕确认动作。
 * @returns {Promise<Record<string, unknown>>} saveArticle 所需字段。
 */
export async function createVideoArticle(video, options = {}) {
  const segments = Array.isArray(video.segments) ? video.segments : [];
  const saveLinkOnly = Boolean(options.saveLinkOnly);
  if (segments.length === 0 && !saveLinkOnly) throw new VideoConfirmationRequiredError();
  const rawHtml = segments.length > 0
    ? segments.map((segment) => {
      const timestamp = formatVideoTimestamp(segment.startSeconds);
      const timestampUrl = createTimestampUrl(video, segment.startSeconds);
      return `<section><h3><a href="${timestampUrl}">[${timestamp}]</a></h3><p>${escapeHtmlText(segment.text)}</p></section>`;
    }).join("\n")
    : `<section><p>该视频当前没有可读取的公开字幕。知序仅保存了原始链接，没有下载视频或音频。</p><p><a href="${video.canonicalUrl}">打开原视频</a></p></section>`;
  const sanitized = sanitizeArticleHtml(rawHtml, new URL(video.canonicalUrl));
  const transcriptText = segments.map((segment) => segment.text).join("\n");
  const contentText = sanitized.text || transcriptText;
  const classification = await classifyDocument({
    fileName: String(video.title || "视频字幕"),
    text: `${video.description || ""}\n${transcriptText}`.slice(0, 120_000),
  });
  const summarySource = String(video.description || transcriptText || contentText)
    .replace(/\s+/g, " ")
    .trim();
  const sourceLanguage = detectArticleLanguage(transcriptText || video.description || "");
  return {
    url: video.canonicalUrl,
    sourceType: "video",
    title: String(video.title || "视频字幕").slice(0, 300),
    summary: summarySource.slice(0, 320) || "已保存视频链接。",
    category: classification.category,
    categorySource: classification.source,
    categoryConfidence: classification.confidence,
    author: String(video.author || "").slice(0, 240) || null,
    publishedAt: video.publishedAt || null,
    coverImageUrl: video.coverImageUrl || null,
    contentHtml: sanitized.html,
    contentText,
    sourceLanguage,
    translationStatus: sourceLanguage === "en" || sourceLanguage === "mixed"
      ? "available"
      : "not_required",
    wordCount: contentText.length,
    transcriptSegmentCount: segments.length,
  };
}
