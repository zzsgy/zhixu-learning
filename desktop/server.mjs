/**
 * 知序电脑本地版 HTTP 服务。
 *
 * 服务只监听 127.0.0.1，浏览器页面、SQLite 和原始文档都保存在本机。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  articleImageDirectory,
  attachmentDirectory,
  paperDirectory,
  publicDirectory,
  serverConfig,
} from "./lib/config.mjs";
import {
  addContentTag,
  addTopicItem,
  assignContentToFolder,
  backfillArticleLanguages,
  createFolder,
  createImportJob,
  createReadingAnnotation,
  createDailyBackup,
  createKnowledgeCard,
  createTopic,
  clearPaperLibrary,
  confirmVideoImportJob,
  deleteEmptyFolder,
  deleteKnowledgeCard,
  deleteKnowledgeTarget,
  deleteReadingAnnotation,
  dismissPaperReminder,
  failDocumentOcr,
  getArticleById,
  getAiConversation,
  getDocumentById,
  getDocumentStatistics,
  getPaperById,
  getImportJob,
  getReadingWorkspace,
  getContentOrganization,
  insertDocument,
  ensureFolderPath,
  listArticles,
  listAiConversations,
  listDocuments,
  listDocumentPages,
  listFolders,
  listImportJobs,
  listKnowledgeCards,
  listPaperCandidates,
  listPendingPaperTranslations,
  listPendingFullPaperTranslations,
  listPendingArticleTranslations,
  listPapers,
  listContentTags,
  listTags,
  listTopicItems,
  listTopics,
  listBrowserClients,
  findBrowserClientByTokenHash,
  registerBrowserClient,
  queueDocumentOcr,
  saveArticle,
  saveDocumentOcrResult,
  saveAiExchange,
  searchKnowledgeBase,
  selectPaperCandidate,
  setFavorite,
  snoozePaperReminder,
  startDocumentOcr,
  updatePaperCandidateTranslation,
  updatePaperCategory,
  upsertImportedPaper,
  updatePaperFullTranslation,
  requestArticleTranslation,
  retryPaperFullTranslation,
  retryImportJob,
  updateArticleTranslation,
  updateDocumentCategory,
  updateReadingAnnotation,
  updateReadingState,
  removeContentTag,
  removeTopicItem,
  renameFolder,
  reviewKnowledgeCard,
  revokeBrowserClient,
  touchBrowserClient,
} from "./lib/database.mjs";
import {
  classifyDocument,
  DOCUMENT_CATEGORIES,
  isDocumentCategory,
} from "./lib/classifier.mjs";
import {
  createDocumentSummary,
  extractDocumentText,
  extractWordHtml,
} from "./lib/extractor.mjs";
import {
  detectArticleLanguage,
  fetchPublicImage,
  parseAndClassifyArticle,
} from "./lib/article-parser.mjs";
import {
  ensureDailyClassicPaperCandidate,
  fetchArxivPaperByUrl,
  getDailyClassicPaperReminder,
  getDailyPaperKey,
} from "./lib/paper-service.mjs";
import {
  getCachedPaperPdfPath,
  preparePaperFullText,
  preparePaperFullTextFromBuffer,
} from "./lib/paper-fulltext.mjs";
import { refreshMliPaperLibrary } from "./lib/mli-paper-service.mjs";
import { answerFromSources } from "./lib/ai-service.mjs";
import {
  getCodexPaperTranslationWorkerStatus,
  initializeCodexPaperTranslationWorker,
  triggerCodexPaperTranslationWorker,
} from "./lib/codex-paper-translator.mjs";
import {
  inspectDocsifySource,
  parseDocsifyChapter,
} from "./lib/docsify-importer.mjs";
import { createImportJobRunner } from "./lib/import-job-runner.mjs";
import {
  getOcrEngineStatus,
  isOcrSupportedExtension,
  recognizeDocument,
} from "./lib/ocr-service.mjs";
import {
  createVideoArticle,
  inspectVideoSource,
  normalizeVideoUrl,
} from "./lib/video-importer.mjs";

/** paperScheduleIntervalMilliseconds 是后台检查新自然周的间隔。 */
const paperScheduleIntervalMilliseconds = 6 * 60 * 60 * 1000;
/** backfilledArticleCount 是本次启动补齐语言状态的历史文章数量。 */
const backfilledArticleCount = backfillArticleLanguages(detectArticleLanguage);
if (backfilledArticleCount > 0) {
  console.log(`已识别 ${backfilledArticleCount} 篇历史文章的原文语言。`);
}

/**
 * 在 HTTP 响应之外下载、提取并分类论文 PDF，避免用户等待远程站点。
 *
 * @param {Record<string, unknown>} paper 已保存且包含 PDF 地址的论文记录。
 * @returns {void}
 */
function queuePaperPdfProcessing(paper) {
  if (!paper?.id || !paper?.pdfUrl) return;
  /** processingTask 是单篇论文的后台提取、分类和翻译唤醒流程。 */
  const processingTask = preparePaperFullText(paper.id)
    .then(async (extractedPaper) => {
      if (!extractedPaper?.sourceText) return extractedPaper;
      /** classification 是依据完整英文正文生成的技术分类。 */
      const classification = await classifyDocument({
        fileName: extractedPaper.title,
        text: extractedPaper.sourceText,
      });
      return updatePaperCategory(extractedPaper.id, classification.category);
    })
    .then(() => triggerCodexPaperTranslationWorker())
    .catch((error) => {
      console.error(`论文后台解析失败：${error.message}`);
    });
  void processingTask;
}

/** browserPairingCodeLifetimeMilliseconds 是一次性配对码的有效期。 */
const browserPairingCodeLifetimeMilliseconds = 10 * 60 * 1000;
/** browserPairingCodes 仅在内存中保存短期配对码，不写入数据库。 */
const browserPairingCodes = new Map();

/**
 * 生成不与当前有效配对码冲突的六位数字。
 *
 * @returns {string} 浏览器扩展中输入的一次性配对码。
 */
function createBrowserPairingCode() {
  /** now 是清理过期配对码时使用的当前时间。 */
  const now = Date.now();
  for (const [code, pairing] of browserPairingCodes) {
    if (pairing.expiresAt <= now) browserPairingCodes.delete(code);
  }
  let code = "";
  do {
    code = String(crypto.randomInt(100000, 1000000));
  } while (browserPairingCodes.has(code));
  browserPairingCodes.set(code, {
    expiresAt: now + browserPairingCodeLifetimeMilliseconds,
  });
  return code;
}

/**
 * 消费一次性配对码；无效、过期或已经使用时返回 false。
 *
 * @param {string} code 用户在扩展中输入的六位数字。
 * @returns {boolean} 配对码是否有效。
 */
function consumeBrowserPairingCode(code) {
  /** normalizedCode 是只允许六位数字的配对码。 */
  const normalizedCode = String(code || "").trim();
  if (!/^\d{6}$/.test(normalizedCode)) return false;
  /** pairing 是内存中保存的有效期记录。 */
  const pairing = browserPairingCodes.get(normalizedCode);
  browserPairingCodes.delete(normalizedCode);
  return Boolean(pairing && pairing.expiresAt > Date.now());
}

/**
 * 只接受 Chrome、Edge 或 Firefox 扩展来源，用于精确 CORS 响应。
 *
 * @param {http.IncomingMessage} request HTTP 请求。
 * @returns {string} 可信扩展来源或空字符串。
 */
function getBrowserExtensionOrigin(request) {
  /** origin 是浏览器发出的 Origin 请求头。 */
  const origin = String(request.headers.origin || "").trim();
  return /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin) ? origin : "";
}

/**
 * 向浏览器扩展发送仅允许当前扩展来源读取的 JSON。
 *
 * @param {http.IncomingMessage} request HTTP 请求。
 * @param {http.ServerResponse} response HTTP 响应。
 * @param {number} statusCode HTTP 状态码。
 * @param {unknown} payload JSON 内容。
 * @returns {void}
 */
function sendBrowserExtensionJson(request, response, statusCode, payload) {
  /** extensionOrigin 是经过协议白名单检查的扩展来源。 */
  const extensionOrigin = getBrowserExtensionOrigin(request);
  sendJson(response, statusCode, payload, extensionOrigin
    ? {
      "Access-Control-Allow-Origin": extensionOrigin,
      "Access-Control-Allow-Headers": "Content-Type, X-Zhixu-Capture-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      Vary: "Origin",
    }
    : {});
}

/**
 * 将浏览器客户端令牌转换为数据库保存和查询的 SHA-256 摘要。
 *
 * @param {string} token 原始随机令牌。
 * @returns {string} 十六进制摘要。
 */
function hashBrowserToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

/**
 * 验证快速收藏请求头并更新客户端最后使用时间。
 *
 * @param {http.IncomingMessage} request HTTP 请求。
 * @returns {Record<string, unknown> | null} 已认证客户端。
 */
function authenticateBrowserClient(request) {
  /** token 是扩展配对后保存在其本地存储中的随机值。 */
  const token = String(request.headers["x-zhixu-capture-token"] || "").trim();
  if (token.length < 32 || token.length > 256) return null;
  /** client 是令牌摘要对应的未撤销客户端。 */
  const client = findBrowserClientByTokenHash(hashBrowserToken(token));
  if (client) touchBrowserClient(client.id);
  return client;
}

/**
 * 执行浏览器快速收藏任务：抓取完整网页、收藏并尽可能标记用户选区。
 *
 * @param {Record<string, unknown>} job 数据库中的后台任务。
 * @param {{ updateProgress: Function }} context 进度更新接口。
 * @returns {Promise<Record<string, unknown>>} 导入目标和选区处理结果。
 */
async function processBrowserCaptureJob(job, context) {
  /** inputUrl 是扩展提交且由文章解析器再次校验的公开链接。 */
  const inputUrl = String(job.payload.url || job.sourceUrl || "").trim();
  if (!inputUrl) throw new Error("浏览器收藏缺少网页链接。");
  /** selectedText 是可选的用户选区，限制长度避免扩展提交超大正文。 */
  const selectedText = String(job.payload.selectedText || "").trim().slice(0, 8000);
  context.updateProgress({ stage: "fetching", progressPercent: 10 });
  /** parsedArticle 是现有安全抓取和分类流程生成的网页正文。 */
  const parsedArticle = await parseAndClassifyArticle(inputUrl);
  context.updateProgress({ stage: "saving", progressPercent: 75 });
  /** now 是文章保存或更新的时间。 */
  const now = new Date().toISOString();
  /** article 是去重写入后的最终文章。 */
  const article = saveArticle({
    id: `article_${crypto.randomUUID()}`,
    ...parsedArticle,
    createdAt: now,
    updatedAt: now,
  });
  setFavorite({ targetType: "article", targetId: article.id, active: true });
  /** selectionStart 是浏览器选区在清洗正文中的精确位置。 */
  const selectionStart = selectedText ? article.contentText.indexOf(selectedText) : -1;
  let selectionMatched = false;
  if (selectionStart >= 0) {
    /** workspace 用于避免同一选区被扩展重复保存为多条批注。 */
    const workspace = getReadingWorkspace("article", article.id);
    const duplicateAnnotation = workspace?.annotations?.some(
      (annotation) => annotation.quoteText === selectedText
        && annotation.noteText === "来自浏览器快速收藏",
    );
    if (!duplicateAnnotation) {
      createReadingAnnotation("article", article.id, {
        quoteText: selectedText,
        anchorStart: selectionStart,
        anchorEnd: selectionStart + selectedText.length,
        color: "yellow",
        noteText: "来自浏览器快速收藏",
      });
    }
    selectionMatched = true;
  }
  context.updateProgress({ stage: "indexing", progressPercent: 95 });
  createDailyBackup();
  return {
    targetType: "article",
    targetId: article.id,
    title: article.title,
    selectionMatched,
  };
}

/**
 * 执行图片或扫描 PDF 的分页 OCR，并把结果写回原文档。
 *
 * @param {Record<string, unknown>} job 数据库中的后台任务。
 * @param {{ updateProgress: Function }} context 进度更新接口。
 * @returns {Promise<Record<string, unknown>>} 完成后的文档摘要。
 */
async function processDocumentOcrJob(job, context) {
  /** documentId 是上传文档的稳定 ID。 */
  const documentId = String(job.payload.documentId || "").trim();
  /** document 是包含本地存储文件名的原始记录。 */
  const document = getDocumentById(documentId);
  if (!document) throw new Error("找不到需要 OCR 的文档记录。");
  if (!isOcrSupportedExtension(document.extension)) throw new Error("当前文件类型不支持 OCR。");
  /** filePath 是严格位于附件目录中的原始文件。 */
  const filePath = path.join(attachmentDirectory, document.storedName);
  if (!isPathInsideDirectory(filePath, attachmentDirectory)) throw new Error("OCR 原始文件路径无效。");
  startDocumentOcr(document.id);
  try {
    /** ocrResult 是逐页正文、坐标和置信度。 */
    const ocrResult = await recognizeDocument({
      filePath,
      extension: document.extension,
      language: String(job.payload.language || ""),
      onProgress(progress) {
        context.updateProgress(progress);
      },
    });
    /** combinedText 用于生成文档卡片摘要。 */
    const combinedText = ocrResult.pages.map((page) => page.text).join("\n\n");
    /** savedDocument 是更新正文、分页表和全文索引后的文档。 */
    const savedDocument = saveDocumentOcrResult(document.id, {
      ...ocrResult,
      summary: createDocumentSummary(combinedText, document.originalName),
    });
    createDailyBackup();
    return {
      targetType: "document",
      targetId: savedDocument.id,
      title: savedDocument.title,
      pageCount: savedDocument.ocrPageCount,
      averageConfidence: savedDocument.ocrAverageConfidence,
    };
  } catch (error) {
    failDocumentOcr(document.id, error);
    throw error;
  }
}

/**
 * 执行视频链接导入：只读取公开元数据与字幕，不默认下载视频或音频。
 *
 * @param {Record<string, unknown>} job 数据库中的后台任务。
 * @param {{ updateProgress: Function }} context 进度更新接口。
 * @returns {Promise<Record<string, unknown>>} 完成后的文章目标。
 */
async function processVideoTranscriptJob(job, context) {
  const inputUrl = String(job.payload.url || job.sourceUrl || "").trim();
  if (!inputUrl) throw new Error("视频导入缺少链接。");
  context.updateProgress({ stage: "reading_metadata", progressPercent: 8 });
  /** video 是平台元数据、所选字幕轨和时间戳片段。 */
  const video = await inspectVideoSource(inputUrl, {
    preferredLanguages: Array.isArray(job.payload.preferredLanguages)
      ? job.payload.preferredLanguages
      : undefined,
  });
  context.updateProgress({ stage: "reading_captions", progressPercent: 55 });
  /** articleInput 是经过统一 HTML 清洗与分类的本地文章数据。 */
  const articleInput = await createVideoArticle(video, {
    saveLinkOnly: job.payload.confirmationAction === "save_link",
  });
  context.updateProgress({ stage: "saving", progressPercent: 82 });
  const now = new Date().toISOString();
  const article = saveArticle({
    id: `article_${crypto.randomUUID()}`,
    ...articleInput,
    createdAt: now,
    updatedAt: now,
  });
  context.updateProgress({ stage: "indexing", progressPercent: 96 });
  createDailyBackup();
  return {
    targetType: "article",
    targetId: article.id,
    title: article.title,
    platform: video.platform,
    transcriptSegmentCount: articleInput.transcriptSegmentCount,
    savedLinkOnly: articleInput.transcriptSegmentCount === 0,
  };
}

/** importJobRunner 是 OCR、视频和浏览器收藏共用的顺序任务执行器。 */
const importJobRunner = createImportJobRunner({
  handlers: {
    browser_capture: processBrowserCaptureJob,
    document_ocr: processDocumentOcrJob,
    video_transcript: processVideoTranscriptJob,
  },
});

/** staticMimeTypes 是本地网页静态资源扩展名到 MIME 的映射。 */
const staticMimeTypes = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
});

/**
 * 向浏览器发送 JSON 响应。
 *
 * @param {http.ServerResponse} response HTTP 响应对象。
 * @param {number} statusCode HTTP 状态码。
 * @param {unknown} payload 可序列化数据。
 * @returns {void}
 */
function sendJson(response, statusCode, payload, additionalHeaders = {}) {
  /** body 是 UTF-8 JSON 响应正文。 */
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...additionalHeaders,
  });
  response.end(body);
}

/**
 * 读取请求正文，并执行上传容量限制。
 *
 * @param {http.IncomingMessage} request HTTP 请求对象。
 * @param {number} maximumBytes 允许的最大字节数。
 * @returns {Promise<Buffer>} 完整请求正文。
 */
function readRequestBuffer(request, maximumBytes) {
  return new Promise((resolve, reject) => {
    /** chunks 保存分段到达的请求数据。 */
    const chunks = [];
    /** receivedBytes 记录已接收字节数。 */
    let receivedBytes = 0;
    request.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maximumBytes) {
        reject(new Error("上传文件超过本地容量上限。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/**
 * 清理浏览器传入的文件名，阻止目录穿越和控制字符。
 *
 * @param {string} rawName 原始文件名。
 * @returns {string} 仅包含基础文件名的安全名称。
 */
function sanitizeFileName(rawName) {
  /** decodedName 是从请求头解码得到的文件名。 */
  const decodedName = decodeURIComponent(rawName || "未命名文档");
  /** baseName 丢弃了任何目录部分。 */
  const baseName = path.basename(decodedName).replace(/[\u0000-\u001f]/g, "");
  return baseName.slice(0, 240) || "未命名文档";
}

/**
 * 判断候选文件是否严格位于允许删除的本地目录中。
 *
 * @param {string} candidatePath 候选文件绝对或相对路径。
 * @param {string} allowedDirectory 允许删除文件的目录。
 * @returns {boolean} 是否位于目录内部。
 */
function isPathInsideDirectory(candidatePath, allowedDirectory) {
  /** resolvedCandidate 是标准化后的候选绝对路径。 */
  const resolvedCandidate = path.resolve(candidatePath);
  /** resolvedRootWithSeparator 是避免同名前缀误判的目录前缀。 */
  const resolvedRootWithSeparator = `${path.resolve(allowedDirectory)}${path.sep}`;
  return resolvedCandidate.startsWith(resolvedRootWithSeparator);
}

/**
 * 从文件名生成适合知识库展示的标题。
 *
 * @param {string} originalName 原始文件名。
 * @returns {string} 去除扩展名后的标题。
 */
function deriveDocumentTitle(originalName) {
  /** extension 是文件扩展名。 */
  const extension = path.extname(originalName);
  /** title 是移除扩展名并清理空白后的名称。 */
  const title = path.basename(originalName, extension).replace(/\s+/g, " ").trim();
  return title || originalName;
}

/**
 * 将完整文档对象转换为列表使用的轻量对象。
 *
 * @param {Record<string, unknown>} document 完整文档对象。
 * @returns {Record<string, unknown>} 不包含长正文的列表对象。
 */
function toDocumentListItem(document) {
  /** extractedText 被排除，避免文档列表响应随着知识库增长而过大。 */
  const { extractedText: _extractedText, ...listItem } = document;
  return { ...listItem, tags: listContentTags("document", document.id) };
}

/**
 * 将完整文章转换为列表使用的轻量对象。
 *
 * @param {Record<string, unknown>} article 完整文章。
 * @returns {Record<string, unknown>} 不包含长正文的文章摘要。
 */
function toArticleListItem(article) {
  /** contentHtml 和 contentText 被排除，避免列表响应过大。 */
  const {
    contentHtml: _contentHtml,
    contentText: _contentText,
    translatedHtml: _translatedHtml,
    translatedText: _translatedText,
    ...listItem
  } = article;
  return { ...listItem, tags: listContentTags("article", article.id) };
}

/**
 * 处理上传、列表、详情、下载和人工分类接口。
 *
 * @param {http.IncomingMessage} request HTTP 请求对象。
 * @param {http.ServerResponse} response HTTP 响应对象。
 * @param {URL} url 已解析请求地址。
 * @returns {Promise<boolean>} 是否已经处理本次请求。
 */
async function handleApiRequest(request, response, url) {
  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/browser/")) {
    /** extensionOrigin 是仅允许浏览器扩展跨源调用的来源。 */
    const extensionOrigin = getBrowserExtensionOrigin(request);
    if (!extensionOrigin) {
      sendJson(response, 403, { message: "只允许已安装的知序浏览器扩展访问。" });
      return true;
    }
    response.writeHead(204, {
      "Access-Control-Allow-Origin": extensionOrigin,
      "Access-Control-Allow-Headers": "Content-Type, X-Zhixu-Capture-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
    response.end();
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      storage: "SQLite 本地数据库",
      deepSeekConfigured: Boolean(serverConfig.deepSeekApiKey),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/import-jobs") {
    /** jobs 是前端任务中心最近的后台导入记录。 */
    const jobs = listImportJobs({
      status: url.searchParams.get("status") || "",
      jobType: url.searchParams.get("jobType") || "",
      limit: Number(url.searchParams.get("limit")) || 30,
    });
    sendJson(response, 200, { jobs, runner: importJobRunner.getStatus() });
    return true;
  }

  /** importJobMatch 匹配单个任务状态或重试接口。 */
  const importJobMatch = url.pathname.match(/^\/api\/import-jobs\/([^/]+)$/);
  if (request.method === "GET" && importJobMatch) {
    /** job 是指定 ID 的后台导入任务。 */
    const job = getImportJob(decodeURIComponent(importJobMatch[1]));
    if (!job) {
      sendJson(response, 404, { message: "找不到这项导入任务。" });
      return true;
    }
    sendJson(response, 200, { job });
    return true;
  }

  /** importJobRetryMatch 匹配失败任务重新排队地址。 */
  const importJobRetryMatch = url.pathname.match(/^\/api\/import-jobs\/([^/]+)\/retry$/);
  if (request.method === "POST" && importJobRetryMatch) {
    /** job 是重新进入队列的失败任务。 */
    const job = retryImportJob(decodeURIComponent(importJobRetryMatch[1]));
    if (!job) {
      sendJson(response, 409, { message: "只有失败的导入任务可以重试。" });
      return true;
    }
    importJobRunner.trigger();
    sendJson(response, 202, { job });
    return true;
  }

  /** importJobConfirmMatch 匹配无字幕视频的用户确认入口。 */
  const importJobConfirmMatch = url.pathname.match(/^\/api\/import-jobs\/([^/]+)\/confirm$/);
  if (request.method === "POST" && importJobConfirmMatch) {
    const requestBuffer = await readRequestBuffer(request, 16 * 1024);
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    if (payload.action !== "save_link") {
      sendJson(response, 400, { message: "当前只支持确认后仅保存视频链接。" });
      return true;
    }
    /** job 是用户明确选择仅保存链接后重新排队的任务。 */
    const job = confirmVideoImportJob(
      decodeURIComponent(importJobConfirmMatch[1]),
      String(payload.action || ""),
    );
    if (!job) {
      sendJson(response, 409, { message: "这项任务当前不需要视频导入确认。" });
      return true;
    }
    importJobRunner.trigger();
    sendJson(response, 202, { job });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/ocr/status") {
    /** ocr 是本机 Tesseract 与 PDF 渲染工具可用状态。 */
    const ocr = await getOcrEngineStatus();
    sendJson(response, 200, { ocr });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/videos/import") {
    const requestBuffer = await readRequestBuffer(request, 64 * 1024);
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** normalizedVideo 在任务入库前拒绝无效协议并统一平台链接。 */
    let normalizedVideo;
    try {
      normalizedVideo = normalizeVideoUrl(payload.url);
    } catch (error) {
      sendJson(response, 400, {
        message: error instanceof Error ? error.message : "视频链接无效。",
      });
      return true;
    }
    /** activeJob 避免同一规范链接被连续重复加入队列。 */
    const activeJob = listImportJobs({ jobType: "video_transcript", limit: 200 }).find(
      (job) => job.sourceUrl === normalizedVideo.canonicalUrl
        && (job.status === "queued" || job.status === "running"),
    );
    if (activeJob) {
      sendJson(response, 202, { job: activeJob, duplicate: true });
      return true;
    }
    const preferredLanguages = Array.isArray(payload.preferredLanguages)
      ? payload.preferredLanguages
        .map((value) => String(value || "").trim().slice(0, 20))
        .filter(Boolean)
        .slice(0, 12)
      : [];
    const platformLabels = { youtube: "YouTube", bilibili: "哔哩哔哩", generic: "视频链接" };
    const job = createImportJob({
      jobType: "video_transcript",
      sourceLabel: `${platformLabels[normalizedVideo.platform]} · ${normalizedVideo.videoId || new URL(normalizedVideo.canonicalUrl).hostname}`,
      sourceUrl: normalizedVideo.canonicalUrl,
      payload: {
        url: normalizedVideo.canonicalUrl,
        preferredLanguages,
      },
    });
    importJobRunner.trigger();
    sendJson(response, 202, { job, duplicate: false });
    return true;
  }

  /** documentOcrMatch 匹配单篇文档的 OCR 入队地址。 */
  const documentOcrMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/ocr$/);
  if (request.method === "POST" && documentOcrMatch) {
    /** documentId 是待识别文档 ID。 */
    const documentId = decodeURIComponent(documentOcrMatch[1]);
    /** document 是用于验证文件类型的文档。 */
    const document = getDocumentById(documentId);
    if (!document) {
      sendJson(response, 404, { message: "找不到需要 OCR 的文档。" });
      return true;
    }
    if (!isOcrSupportedExtension(document.extension)) {
      sendJson(response, 400, { message: "只有图片或 PDF 可以执行 OCR。" });
      return true;
    }
    /** activeJob 是同一文档尚未结束的 OCR 任务。 */
    const activeJob = listImportJobs({ jobType: "document_ocr", limit: 200 }).find(
      (job) => job.payload.documentId === document.id
        && (job.status === "queued" || job.status === "running"),
    );
    if (activeJob) {
      sendJson(response, 202, { job: activeJob, document });
      return true;
    }
    /** requestBuffer 是可选识别语言参数。 */
    const requestBuffer = await readRequestBuffer(request, 32 * 1024);
    /** payload 是用户指定的 OCR 语言。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    queueDocumentOcr(document.id);
    /** job 是持久化后的 OCR 后台任务。 */
    const job = createImportJob({
      jobType: "document_ocr",
      sourceLabel: document.title,
      payload: {
        documentId: document.id,
        language: String(payload.language || "").trim().slice(0, 80),
      },
    });
    importJobRunner.trigger();
    sendJson(response, 202, { job, document: getDocumentById(document.id) });
    return true;
  }

  /** documentPagesMatch 匹配逐页 OCR 结果查询地址。 */
  const documentPagesMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/pages$/);
  if (request.method === "GET" && documentPagesMatch) {
    /** documentId 是待查询的文档 ID。 */
    const documentId = decodeURIComponent(documentPagesMatch[1]);
    if (!getDocumentById(documentId)) {
      sendJson(response, 404, { message: "找不到这份文档。" });
      return true;
    }
    sendJson(response, 200, { pages: listDocumentPages(documentId) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/browser/pairing/start") {
    /** code 是十分钟内仅可使用一次的六位配对码。 */
    const code = createBrowserPairingCode();
    sendJson(response, 201, {
      code,
      expiresAt: new Date(Date.now() + browserPairingCodeLifetimeMilliseconds).toISOString(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/browser/pair") {
    if (!getBrowserExtensionOrigin(request)) {
      sendJson(response, 403, { message: "请从知序浏览器扩展完成配对。" });
      return true;
    }
    /** requestBuffer 是扩展提交的配对码和客户端名称。 */
    const requestBuffer = await readRequestBuffer(request, 32 * 1024);
    /** payload 是浏览器配对参数。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    if (!consumeBrowserPairingCode(payload.code)) {
      sendBrowserExtensionJson(request, response, 401, { message: "配对码无效或已经过期。" });
      return true;
    }
    /** token 是只在本次响应中返回给扩展的高强度随机令牌。 */
    const token = crypto.randomBytes(32).toString("base64url");
    /** client 是不包含令牌摘要的本地客户端记录。 */
    const client = registerBrowserClient({
      name: payload.name,
      tokenHash: hashBrowserToken(token),
    });
    sendBrowserExtensionJson(request, response, 201, { token, client });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/browser/clients") {
    sendJson(response, 200, { clients: listBrowserClients() });
    return true;
  }

  /** browserClientMatch 匹配本地页面撤销某个扩展权限的地址。 */
  const browserClientMatch = url.pathname.match(/^\/api\/browser\/clients\/([^/]+)$/);
  if (request.method === "DELETE" && browserClientMatch) {
    /** client 是撤销后的浏览器客户端。 */
    const client = revokeBrowserClient(decodeURIComponent(browserClientMatch[1]));
    if (!client) {
      sendJson(response, 404, { message: "找不到这个浏览器客户端。" });
      return true;
    }
    sendJson(response, 200, { client });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/browser/captures") {
    if (!getBrowserExtensionOrigin(request)) {
      sendJson(response, 403, { message: "请从知序浏览器扩展发送收藏。" });
      return true;
    }
    /** client 是令牌验证通过的扩展客户端。 */
    const client = authenticateBrowserClient(request);
    if (!client) {
      sendBrowserExtensionJson(request, response, 401, { message: "浏览器扩展尚未配对或权限已撤销。" });
      return true;
    }
    /** requestBuffer 是网页地址、标题和可选选区。 */
    const requestBuffer = await readRequestBuffer(request, 128 * 1024);
    /** payload 是扩展提交的快速收藏内容。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** captureUrl 是仅允许 HTTP(S) 的网页地址。 */
    let captureUrl;
    try {
      captureUrl = new URL(String(payload.url || "").trim());
    } catch {
      sendBrowserExtensionJson(request, response, 400, { message: "当前页面不是可收藏的网页链接。" });
      return true;
    }
    if (!["http:", "https:"].includes(captureUrl.protocol)) {
      sendBrowserExtensionJson(request, response, 400, { message: "只支持收藏 HTTP 或 HTTPS 网页。" });
      return true;
    }
    captureUrl.hash = "";
    /** job 是立即持久化、随后在后台执行的收藏任务。 */
    const job = createImportJob({
      jobType: "browser_capture",
      sourceLabel: String(payload.title || captureUrl.hostname),
      sourceUrl: captureUrl.toString(),
      payload: {
        url: captureUrl.toString(),
        title: String(payload.title || "").slice(0, 500),
        selectedText: String(payload.selectedText || "").slice(0, 8000),
        clientId: client.id,
      },
    });
    importJobRunner.trigger();
    sendBrowserExtensionJson(request, response, 202, { job });
    return true;
  }

  /** browserCaptureJobMatch 是扩展轮询自己提交任务的地址。 */
  const browserCaptureJobMatch = url.pathname.match(/^\/api\/browser\/captures\/([^/]+)$/);
  if (request.method === "GET" && browserCaptureJobMatch) {
    if (!getBrowserExtensionOrigin(request)) {
      sendJson(response, 403, { message: "请从知序浏览器扩展查询收藏状态。" });
      return true;
    }
    /** client 是令牌验证通过的扩展客户端。 */
    const client = authenticateBrowserClient(request);
    if (!client) {
      sendBrowserExtensionJson(request, response, 401, { message: "浏览器扩展尚未配对或权限已撤销。" });
      return true;
    }
    /** job 是扩展等待完成的后台收藏任务。 */
    const job = getImportJob(decodeURIComponent(browserCaptureJobMatch[1]));
    if (!job || job.jobType !== "browser_capture" || job.payload.clientId !== client.id) {
      sendBrowserExtensionJson(request, response, 404, { message: "找不到这项浏览器收藏任务。" });
      return true;
    }
    sendBrowserExtensionJson(request, response, 200, { job });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/categories") {
    sendJson(response, 200, { categories: DOCUMENT_CATEGORIES });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/folders") {
    sendJson(response, 200, { folders: listFolders() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/folders") {
    /** requestBuffer 是新文件夹名称和父级信息。 */
    const requestBuffer = await readRequestBuffer(request, 128 * 1024);
    /** payload 是浏览器提交的新文件夹参数。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** folder 是本地数据库创建后的文件夹。 */
    const folder = createFolder(payload);
    createDailyBackup();
    sendJson(response, 201, { folder, folders: listFolders() });
    return true;
  }

  /** folderMatch 匹配单个文件夹的重命名或删除地址。 */
  const folderMatch = url.pathname.match(/^\/api\/folders\/([^/]+)$/);
  if (request.method === "PATCH" && folderMatch) {
    /** requestBuffer 是文件夹新名称请求。 */
    const requestBuffer = await readRequestBuffer(request, 128 * 1024);
    /** payload 是文件夹修改参数。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** folder 是修改后的文件夹。 */
    const folder = renameFolder(decodeURIComponent(folderMatch[1]), payload.name);
    createDailyBackup();
    sendJson(response, 200, { folder, folders: listFolders() });
    return true;
  }

  if (request.method === "DELETE" && folderMatch) {
    /** deleted 表示空文件夹已经从本地数据库移除。 */
    const deleted = deleteEmptyFolder(decodeURIComponent(folderMatch[1]));
    createDailyBackup();
    sendJson(response, 200, { deleted, folders: listFolders() });
    return true;
  }

  if (request.method === "PATCH" && url.pathname === "/api/folder-items") {
    /** requestBuffer 是内容移动到目标文件夹的请求。 */
    const requestBuffer = await readRequestBuffer(request, 128 * 1024);
    /** payload 是目标内容和文件夹 ID。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** assignment 是保存后的唯一主要目录关系。 */
    const assignment = assignContentToFolder(
      payload.targetType,
      payload.targetId,
      payload.folderId,
    );
    createDailyBackup();
    sendJson(response, 200, { assignment, folders: listFolders() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/docsify/inspect") {
    /** requestBuffer 是待识别文档站地址。 */
    const requestBuffer = await readRequestBuffer(request, 128 * 1024);
    /** payload 是浏览器提交的站点地址。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** inputUrl 是去除首尾空白后的根站或章节地址。 */
    const inputUrl = String(payload.url || "").trim();
    if (!inputUrl) throw new Error("请输入文档站链接。");
    /** inspection 是目录、有效章节和推荐文件夹预览。 */
    const inspection = await inspectDocsifySource(inputUrl);
    sendJson(response, 200, { inspection });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/docsify/import") {
    /** requestBuffer 是整站导入地址和可选章节范围。 */
    const requestBuffer = await readRequestBuffer(request, 512 * 1024);
    /** payload 是浏览器确认后的导入参数。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** inputUrl 是重新检查的公开 Docsify 地址。 */
    const inputUrl = String(payload.url || "").trim();
    if (!inputUrl) throw new Error("请输入文档站链接。");
    /** inspection 在真正写入前重新验证目录，避免信任浏览器提交的源地址。 */
    const inspection = await inspectDocsifySource(inputUrl);
    /** selectedRoutes 是用户在预览中保留的章节路由；空数组表示全部。 */
    const selectedRoutes = new Set(
      Array.isArray(payload.routes) ? payload.routes.map((route) => String(route)) : [],
    );
    /** chapters 是最终允许写入的同源有效章节。 */
    const chapters = inspection.chapters.filter(
      (chapter) => selectedRoutes.size === 0 || selectedRoutes.has(chapter.route),
    );
    if (chapters.length === 0) throw new Error("没有选择可导入章节。");
    /** folderPathNames 是服务端检查结果给出的可信推荐路径。 */
    const folderPathNames = inspection.recommendedFolderPath;
    /** folderPath 是已经创建或复用的完整文件夹路径。 */
    const folderPath = ensureFolderPath(folderPathNames);
    /** importedArticles 保存成功写入的章节摘要。 */
    const importedArticles = [];
    /** failures 保存单章失败原因，避免一章故障使整站全部回滚。 */
    const failures = [];
    for (const chapter of chapters) {
      try {
        /** parsedArticle 是 Markdown 转换并安全清洗后的文章对象。 */
        const parsedArticle = await parseDocsifyChapter(chapter, {
          categoryHint: folderPathNames[0],
        });
        /** now 是当前章节保存时间。 */
        const now = new Date().toISOString();
        /** article 是新增或按 URL 更新后的本地文章。 */
        const article = saveArticle({
          id: `article_${crypto.randomUUID()}`,
          ...parsedArticle,
          createdAt: now,
          updatedAt: now,
        });
        /** chapterFolderPath 是站点目录、章级分组组成的最终文件夹路径。 */
        const chapterFolderPath = chapter.groupTitle
          ? ensureFolderPath(
            [...folderPathNames, chapter.groupTitle],
            [0, 0, 0, chapter.groupOrder],
          )
          : folderPath;
        /** chapterFolder 是当前小节实际进入的章级文件夹或站点根文件夹。 */
        const chapterFolder = chapterFolderPath.at(-1);
        assignContentToFolder(
          "article",
          article.id,
          chapterFolder.id,
          chapter.groupItemOrder || chapter.order,
        );
        for (const tagName of folderPathNames.slice(1)) {
          addContentTag("article", article.id, tagName);
        }
        importedArticles.push(toArticleListItem(getArticleById(article.id)));
      } catch (error) {
        failures.push({
          route: chapter.route,
          title: chapter.title,
          message: error instanceof Error ? error.message : "章节导入失败",
        });
      }
    }
    createDailyBackup();
    sendJson(response, failures.length === chapters.length ? 422 : 201, {
      siteTitle: inspection.siteTitle,
      folderPath,
      importedCount: importedArticles.length,
      skippedCount: inspection.skipped.length,
      articles: importedArticles,
      failures,
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/ai/sources") {
    /** sources 是可以被用户主动选入 AI 问答的本地内容摘要。 */
    const sources = [
      ...listDocuments({ limit: 1000 }).map((item) => ({
        targetType: "document", targetId: item.id, title: item.title,
        category: item.category, summary: item.summary,
      })),
      ...listArticles({ limit: 1000 }).map((item) => ({
        targetType: "article", targetId: item.id, title: item.title,
        category: item.category, summary: item.summary,
      })),
      ...listPapers().map((item) => ({
        targetType: "paper", targetId: item.id, title: item.titleZh || item.title,
        category: item.category, summary: item.abstractZh || item.abstract || item.curatorNote,
      })),
    ];
    sendJson(response, 200, {
      configured: Boolean(serverConfig.deepSeekApiKey),
      model: serverConfig.deepSeekModel,
      sources,
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/ai/conversations") {
    /** conversations 是可搜索的本地 AI 问答历史摘要。 */
    const conversations = listAiConversations({
      query: url.searchParams.get("q") ?? "",
      targetType: url.searchParams.get("targetType") ?? "",
      targetId: url.searchParams.get("targetId") ?? "",
    });
    sendJson(response, 200, { conversations });
    return true;
  }

  /** aiConversationMatch 匹配一条完整本地 AI 会话。 */
  const aiConversationMatch = url.pathname.match(/^\/api\/ai\/conversations\/([^/]+)$/);
  if (request.method === "GET" && aiConversationMatch) {
    /** conversationId 是地址中经过解码的会话 ID。 */
    const conversationId = decodeURIComponent(aiConversationMatch[1]);
    /** conversation 是包含全部问答消息的本地会话。 */
    const conversation = getAiConversation(conversationId);
    if (!conversation) {
      sendJson(response, 404, { message: "找不到这条问答记录。" });
      return true;
    }
    sendJson(response, 200, { conversation });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/ai/ask") {
    /** requestBuffer 是问题、模式和用户主动选择来源的 JSON。 */
    const requestBuffer = await readRequestBuffer(request, 512 * 1024);
    /** payload 是经过 JSON 解析的问答参数。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** requestedSources 是最多六份用户明确选择的本地来源。 */
    const requestedSources = Array.isArray(payload.sources)
      ? payload.sources.slice(0, 6)
      : [];
    /** resolvedSources 是从 SQLite 重新读取的真实正文，绝不信任浏览器提交正文。 */
    const resolvedSources = requestedSources.flatMap((sourceReference, index) => {
      /** targetType 是限定在三类内容中的来源类型。 */
      const targetType = ["document", "article", "paper"].includes(sourceReference?.targetType)
        ? sourceReference.targetType
        : "";
      /** targetId 是来源在本地数据库中的稳定 ID。 */
      const targetId = String(sourceReference?.targetId ?? "").trim();
      /** sourceKey 是本次请求内用于引用的短编号。 */
      const sourceKey = `S${index + 1}`;
      if (targetType === "document") {
        /** documentItem 是本地数据库中的完整文档。 */
        const documentItem = getDocumentById(targetId);
        return documentItem ? [{ sourceKey, targetType, targetId, title: documentItem.title, text: documentItem.extractedText || documentItem.summary }] : [];
      }
      if (targetType === "article") {
        /** articleItem 是本地数据库中的完整网页文章。 */
        const articleItem = getArticleById(targetId);
        return articleItem ? [{ sourceKey, targetType, targetId, title: articleItem.title, text: articleItem.contentText || articleItem.summary }] : [];
      }
      if (targetType === "paper") {
        /** paperItem 是本地数据库中的完整论文及可用译文。 */
        const paperItem = getPaperById(targetId);
        return paperItem ? [{ sourceKey, targetType, targetId, title: paperItem.titleZh || paperItem.title, text: paperItem.fullTranslationHtml || paperItem.sourceText || paperItem.abstractZh || paperItem.abstract }] : [];
      }
      return [];
    });
    if (resolvedSources.length !== requestedSources.length) {
      sendJson(response, 422, { message: "部分所选资料已不存在，请刷新资料列表后重试。" });
      return true;
    }
    /** existingConversation 是连续追问时的本地上下文。 */
    const existingConversation = payload.conversationId
      ? getAiConversation(String(payload.conversationId))
      : null;
    if (payload.conversationId && !existingConversation) {
      sendJson(response, 404, { message: "找不到要继续的问答记录。" });
      return true;
    }
    /** result 是 DeepSeek 回答及经过本地逐字校验的引用。 */
    const result = await answerFromSources({
      apiKey: serverConfig.deepSeekApiKey,
      model: serverConfig.deepSeekModel,
      question: payload.question,
      mode: payload.mode,
      sources: resolvedSources,
      selectedQuote: payload.selectedQuote,
      conversationMessages: existingConversation?.messages ?? [],
    });
    /** sourceReferenceMap 用于把引用短编号恢复为可打开的本地内容地址。 */
    const sourceReferenceMap = new Map(resolvedSources.map((source) => [source.sourceKey, source]));
    /** citations 是只包含已验证引文和本地跳转信息的前端响应。 */
    const citations = result.citations.map((citation) => {
      /** source 是该引文经过服务端确认的真实资料。 */
      const source = sourceReferenceMap.get(citation.sourceKey);
      return { ...citation, targetType: source.targetType, targetId: source.targetId };
    });
    /** savedConversation 是写入本机 SQLite 后的完整问答记录。 */
    const savedConversation = saveAiExchange({
      conversationId: existingConversation?.id,
      mode: payload.mode,
      sources: resolvedSources.map((source) => ({
        targetType: source.targetType,
        targetId: source.targetId,
        title: source.title,
      })),
      question: payload.question,
      selectedQuote: payload.selectedQuote,
      answer: result.answer,
      citations,
      insufficientEvidence: result.insufficientEvidence,
    });
    createDailyBackup();
    sendJson(response, 200, {
      ...result,
      citations,
      conversationId: savedConversation.id,
      conversation: savedConversation,
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/search") {
    /** results 是跨内容正文、阅读笔记和高亮批注的统一搜索结果。 */
    const results = searchKnowledgeBase({
      query: url.searchParams.get("q") ?? "",
      targetType: url.searchParams.get("targetType") ?? "",
      category: url.searchParams.get("category") ?? "",
      tagName: url.searchParams.get("tagName") ?? "",
    });
    sendJson(response, 200, { results });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/tags") {
    sendJson(response, 200, { tags: listTags() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/content-organization") {
    /** organization 是当前内容的标签和专题信息。 */
    const organization = getContentOrganization(
      url.searchParams.get("targetType") ?? "",
      url.searchParams.get("targetId") ?? "",
    );
    if (!organization) {
      sendJson(response, 404, { message: "找不到对应内容。" });
      return true;
    }
    sendJson(response, 200, { organization });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/content-tags") {
    /** requestBuffer 是新增标签的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 256 * 1024);
    /** payload 是标签和目标内容信息。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** tags 是保存后的最新标签列表。 */
    const tags = addContentTag(payload.targetType, payload.targetId, payload.tagName);
    createDailyBackup();
    sendJson(response, 201, { tags });
    return true;
  }

  if (request.method === "DELETE" && url.pathname === "/api/content-tags") {
    /** tags 是移除关联后的最新标签列表。 */
    const tags = removeContentTag(
      url.searchParams.get("targetType") ?? "",
      url.searchParams.get("targetId") ?? "",
      url.searchParams.get("tagName") ?? "",
    );
    createDailyBackup();
    sendJson(response, 200, { tags });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/topics") {
    sendJson(response, 200, { topics: listTopics() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/topics") {
    /** requestBuffer 是新专题的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 256 * 1024);
    /** payload 是专题名称和说明。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** topic 是创建后的本地专题。 */
    const topic = createTopic(payload);
    createDailyBackup();
    sendJson(response, 201, { topic });
    return true;
  }

  /** topicItemsMatch 匹配某个专题的内容列表地址。 */
  const topicItemsMatch = url.pathname.match(/^\/api\/topics\/([^/]+)\/items$/);
  if (request.method === "GET" && topicItemsMatch) {
    /** topicId 是地址中的专题 ID。 */
    const topicId = decodeURIComponent(topicItemsMatch[1]);
    sendJson(response, 200, { items: listTopicItems(topicId) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/topic-items") {
    /** requestBuffer 是专题内容关联的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 256 * 1024);
    /** payload 是专题和目标内容信息。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** items 是专题更新后的内容列表。 */
    const items = addTopicItem(payload.topicId, payload.targetType, payload.targetId);
    createDailyBackup();
    sendJson(response, 201, { items });
    return true;
  }

  if (request.method === "DELETE" && url.pathname === "/api/topic-items") {
    /** items 是移除关联后的专题内容列表。 */
    const items = removeTopicItem(
      url.searchParams.get("topicId") ?? "",
      url.searchParams.get("targetType") ?? "",
      url.searchParams.get("targetId") ?? "",
    );
    createDailyBackup();
    sendJson(response, 200, { items });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/knowledge-cards") {
    /** dueOnly 表示是否只返回已经到期的今日复习卡片。 */
    const dueOnly = url.searchParams.get("due") === "1";
    /** cards 是符合筛选条件的本地来源卡片。 */
    const cards = listKnowledgeCards({ dueOnly });
    sendJson(response, 200, { cards });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/knowledge-cards") {
    /** requestBuffer 是新卡片的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 256 * 1024);
    /** payload 是用户确认的问题、答案和来源锚点。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** card 是已保存到 SQLite 的来源卡片。 */
    const card = createKnowledgeCard(payload);
    createDailyBackup();
    sendJson(response, 201, { card });
    return true;
  }

  /** cardReviewMatch 匹配单张卡片的复习调度地址。 */
  const cardReviewMatch = url.pathname.match(
    /^\/api\/knowledge-cards\/([^/]+)\/review$/,
  );
  if (request.method === "POST" && cardReviewMatch) {
    /** cardId 是地址中经过解码的卡片 ID。 */
    const cardId = decodeURIComponent(cardReviewMatch[1]);
    /** requestBuffer 是复习结果的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 32 * 1024);
    /** payload 是 again、hard、good 或 easy 评价。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** card 是完成下一次调度后的卡片。 */
    const card = reviewKnowledgeCard(cardId, String(payload.rating || "good"));
    if (!card) {
      sendJson(response, 404, { message: "找不到这张知识卡片。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { card });
    return true;
  }

  /** cardDetailMatch 匹配单张知识卡片地址。 */
  const cardDetailMatch = url.pathname.match(/^\/api\/knowledge-cards\/([^/]+)$/);
  if (request.method === "DELETE" && cardDetailMatch) {
    /** cardId 是地址中经过解码的卡片 ID。 */
    const cardId = decodeURIComponent(cardDetailMatch[1]);
    createDailyBackup();
    /** deleted 表示是否实际删除了卡片。 */
    const deleted = deleteKnowledgeCard(cardId);
    if (!deleted) {
      sendJson(response, 404, { message: "找不到这张知识卡片。" });
      return true;
    }
    sendJson(response, 200, { deleted: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/reading-workspace") {
    /** targetType 是当前阅读内容所属的固定类型。 */
    const targetType = url.searchParams.get("targetType")?.trim() ?? "";
    /** targetId 是当前阅读内容的本地 ID。 */
    const targetId = url.searchParams.get("targetId")?.trim() ?? "";
    /** workspace 是该内容已经保存的阅读状态、笔记和批注。 */
    const workspace = getReadingWorkspace(targetType, targetId);
    if (!workspace) {
      sendJson(response, 404, { message: "找不到对应的阅读内容。" });
      return true;
    }
    sendJson(response, 200, { workspace });
    return true;
  }

  if (request.method === "PATCH" && url.pathname === "/api/reading-workspace") {
    /** requestBuffer 是阅读状态的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 256 * 1024);
    /** payload 是浏览器提交的进度、状态或个人笔记。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** state 是写入数据库后的最新阅读状态。 */
    const state = updateReadingState(
      String(payload.targetType ?? ""),
      String(payload.targetId ?? ""),
      payload,
    );
    if (!state) {
      sendJson(response, 404, { message: "找不到对应的阅读内容。" });
      return true;
    }
    sendJson(response, 200, { state });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/reading-annotations") {
    /** requestBuffer 是新高亮批注的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 256 * 1024);
    /** payload 是浏览器选区及高亮颜色。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** annotation 是成功保存的本地高亮批注。 */
    const annotation = createReadingAnnotation(
      String(payload.targetType ?? ""),
      String(payload.targetId ?? ""),
      payload,
    );
    if (!annotation) {
      sendJson(response, 404, { message: "找不到对应的阅读内容。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 201, { annotation });
    return true;
  }

  /** annotationMatch 匹配单条高亮批注的修改和删除地址。 */
  const annotationMatch = url.pathname.match(/^\/api\/reading-annotations\/([^/]+)$/);
  if (request.method === "PATCH" && annotationMatch) {
    /** annotationId 是地址中经过解码的批注 ID。 */
    const annotationId = decodeURIComponent(annotationMatch[1]);
    /** requestBuffer 是批注修改请求的 JSON 正文。 */
    const requestBuffer = await readRequestBuffer(request, 256 * 1024);
    /** payload 是新批注正文或高亮颜色。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** annotation 是修改后的完整批注。 */
    const annotation = updateReadingAnnotation(annotationId, payload);
    if (!annotation) {
      sendJson(response, 404, { message: "找不到这条批注。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { annotation });
    return true;
  }

  if (request.method === "DELETE" && annotationMatch) {
    /** annotationId 是地址中经过解码的批注 ID。 */
    const annotationId = decodeURIComponent(annotationMatch[1]);
    /** deleted 表示本次是否真正删除了批注记录。 */
    const deleted = deleteReadingAnnotation(annotationId);
    if (!deleted) {
      sendJson(response, 404, { message: "找不到这条批注。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { deleted: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/papers") {
    /** sourceType 是可选的论文来源过滤值。 */
    const sourceType = url.searchParams.get("source") ?? "";
    /** papers 是用户已经保存到统一论文库的论文。 */
    const papers = listPapers(sourceType).map((paper) => {
      /** sourceText 被排除，避免论文列表携带完整英文正文。 */
      const {
        sourceText: _sourceText,
        fullTranslationHtml: _fullTranslationHtml,
        ...listItem
      } = paper;
      return { ...listItem, tags: listContentTags("paper", paper.id) };
    });
    sendJson(response, 200, { papers });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/papers/mli/refresh") {
    /** synchronization 是李沐精读公开目录的本地同步结果。 */
    const synchronization = await refreshMliPaperLibrary();
    createDailyBackup();
    sendJson(response, 200, synchronization);
    return true;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/paper-full-translations/pending"
  ) {
    /** papers 是已经提取英文全文但等待 Codex 中文翻译的论文。 */
    const papers = listPendingFullPaperTranslations();
    sendJson(response, 200, { papers });
    return true;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/paper-translation-worker/status"
  ) {
    /** worker 是本机 Codex 后台翻译器的实时状态。 */
    const worker = getCodexPaperTranslationWorkerStatus();
    sendJson(response, 200, { worker });
    return true;
  }

  /** paperFullTranslationMatch 匹配单篇论文的 Codex 全文翻译写回地址。 */
  const paperFullTranslationMatch = url.pathname.match(
    /^\/api\/paper-full-translations\/([^/]+)$/,
  );
  if (request.method === "PATCH" && paperFullTranslationMatch) {
    /** paperId 是地址中经过解码的论文 ID。 */
    const paperId = decodeURIComponent(paperFullTranslationMatch[1]);
    /** requestBuffer 是全文中文翻译的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 8 * 1024 * 1024);
    /** payload 是 Codex 生成的安全阅读型 HTML。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** paper 是写入全文中文翻译后的论文。 */
    const paper = updatePaperFullTranslation(paperId, payload.translatedHtml);
    if (!paper) {
      sendJson(response, 404, { message: "找不到待翻译的论文。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { paper });
    return true;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/paper-translations/pending"
  ) {
    /** candidates 是尚未由 Codex 完成中文翻译的论文候选。 */
    const candidates = listPendingPaperTranslations();
    sendJson(response, 200, { candidates });
    return true;
  }

  /** paperTranslationMatch 匹配单篇候选论文的 Codex 翻译写回地址。 */
  const paperTranslationMatch = url.pathname.match(
    /^\/api\/paper-translations\/([^/]+)$/,
  );
  if (request.method === "PATCH" && paperTranslationMatch) {
    /** candidateId 是地址中经过解码的候选论文 ID。 */
    const candidateId = decodeURIComponent(paperTranslationMatch[1]);
    /** requestBuffer 是中文翻译请求的 JSON 正文。 */
    const requestBuffer = await readRequestBuffer(request, 128 * 1024);
    /** payload 是 Codex 提交的中文标题和中文摘要。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** candidate 是写入中文翻译后的候选论文。 */
    const candidate = updatePaperCandidateTranslation(candidateId, {
      titleZh: payload.titleZh,
      abstractZh: payload.abstractZh,
    });
    if (!candidate) {
      sendJson(response, 404, { message: "找不到待翻译的候选论文。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { candidate });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/paper-reminder") {
    /** reminder 是今天的经典论文和提醒状态。 */
    const reminder = await getDailyClassicPaperReminder();
    /** force 表示用户主动要求查看今日推荐，即使已经延后或跳过。 */
    const force = url.searchParams.get("force") === "1";
    if (force && reminder.candidates.length === 0) {
      reminder.candidates = listPaperCandidates(reminder.weekKey);
    }
    sendJson(response, 200, { reminder });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/paper-reminder/select") {
    /** requestBuffer 是选择候选论文请求的 JSON 正文。 */
    const requestBuffer = await readRequestBuffer(request, 32 * 1024);
    /** payload 是浏览器提交的候选论文 ID。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** candidateId 是清理后的候选论文 ID。 */
    const candidateId = String(payload.candidateId || "").trim();
    if (!candidateId) {
      sendJson(response, 400, { message: "请选择一篇论文。" });
      return true;
    }
    /** paper 是正式写入本地论文库的记录。 */
    const paper = selectPaperCandidate(candidateId);
    if (!paper) {
      sendJson(response, 404, { message: "候选论文不存在或已经失效。" });
      return true;
    }
    /** fullTextTask 在响应后继续下载并提取公开 PDF，不阻塞用户操作。 */
    const fullTextTask = preparePaperFullText(paper.id)
      .then(() => triggerCodexPaperTranslationWorker())
      .catch((error) => {
        console.error(`论文全文提取失败：${error.message}`);
      });
    void fullTextTask;
    createDailyBackup();
    sendJson(response, 201, { paper });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/papers/import/file") {
    /** originalName 是经过安全清理的本地论文文件名。 */
    const originalName = sanitizeFileName(String(request.headers["x-file-name"] ?? ""));
    if (path.extname(originalName).toLowerCase() !== ".pdf") {
      sendJson(response, 415, { message: "论文文件导入目前只支持 PDF。" });
      return true;
    }
    /** pdfBytes 是受上传上限约束的完整本地 PDF。 */
    const pdfBytes = await readRequestBuffer(
      request,
      Math.min(serverConfig.maxUploadBytes, 80 * 1024 * 1024),
    );
    /** sha256 是文件去重与稳定外部编号。 */
    const sha256 = crypto.createHash("sha256").update(pdfBytes).digest("hex");
    /** paperId 是在写入数据库前生成的稳定本地 ID。 */
    const paperId = `paper_${crypto.randomUUID()}`;
    /** initialPaper 是保存 PDF 缓存前的本地论文记录。 */
    const initialPaper = upsertImportedPaper({
      id: paperId,
      externalId: `manual-pdf:${sha256}`,
      title: path.basename(originalName, path.extname(originalName)),
      category: "其它",
      sourceUrl: `/api/papers/${encodeURIComponent(paperId)}/pdf`,
      sourceLanguage: "unknown",
    });
    /** extractedPaper 是从 PDF 完整提取正文后的记录。 */
    const extractedPaper = await preparePaperFullTextFromBuffer(initialPaper.id, pdfBytes);
    /** classification 是依据论文正文得到的自动技术分类。 */
    const classification = await classifyDocument({
      fileName: originalName,
      text: extractedPaper.sourceText,
    });
    /** paper 是完成分类后的最终论文。 */
    const paper = updatePaperCategory(initialPaper.id, classification.category);
    void triggerCodexPaperTranslationWorker();
    createDailyBackup();
    sendJson(response, 201, { paper });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/papers/import/url") {
    /** requestBuffer 是论文链接导入请求。 */
    const requestBuffer = await readRequestBuffer(request, 32 * 1024);
    /** payload 是浏览器提交的论文链接对象。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** inputUrl 是清理后的公开论文链接。 */
    const inputUrl = String(payload.url || "").trim();
    if (!inputUrl) {
      sendJson(response, 400, { message: "请输入论文链接。" });
      return true;
    }
    /** parsedUrl 用于区分 arXiv、直接 PDF 与普通论文网页。 */
    const parsedUrl = new URL(inputUrl);
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      sendJson(response, 400, { message: "论文链接必须使用 HTTP 或 HTTPS。" });
      return true;
    }
    /** arxivPaper 是通过官方接口读取的可选 arXiv 元数据。 */
    const arxivPaper = await fetchArxivPaperByUrl(inputUrl);
    /** isDirectPdf 表示链接直接指向 PDF 文件。 */
    const isDirectPdf = /\.pdf$/i.test(parsedUrl.pathname);
    let paper;
    if (arxivPaper) {
      paper = upsertImportedPaper({
        ...arxivPaper,
        sourceLanguage: "en",
      });
      queuePaperPdfProcessing(paper);
    } else if (isDirectPdf) {
      /** paperId 是直接 PDF 的本地稳定 ID。 */
      const paperId = `paper_${crypto.randomUUID()}`;
      paper = upsertImportedPaper({
        id: paperId,
        externalId: `manual-url:${parsedUrl.href}`,
        title: decodeURIComponent(path.basename(parsedUrl.pathname, ".pdf")) || "未命名论文",
        category: "其它",
        sourceUrl: parsedUrl.href,
        pdfUrl: parsedUrl.href,
        sourceLanguage: "unknown",
      });
      queuePaperPdfProcessing(paper);
    } else {
      /** parsedArticle 复用经过安全校验的网页正文解析能力。 */
      const parsedArticle = await parseAndClassifyArticle(inputUrl);
      paper = upsertImportedPaper({
        externalId: `manual-url:${parsedArticle.url}`,
        title: parsedArticle.title,
        abstract: parsedArticle.summary,
        authors: parsedArticle.author ? [parsedArticle.author] : [],
        category: parsedArticle.category,
        publishedAt: parsedArticle.publishedAt,
        sourceUrl: parsedArticle.url,
        sourceText: parsedArticle.contentText,
        sourceLanguage: parsedArticle.sourceLanguage,
        curatorNote: "从公开论文网页导入",
      });
    }
    if (!paper.pdfUrl) void triggerCodexPaperTranslationWorker();
    createDailyBackup();
    sendJson(response, paper.pdfUrl ? 202 : 201, {
      paper,
      processing: Boolean(paper.pdfUrl && !paper.sourceText),
    });
    return true;
  }

  /** paperExtractionRetryMatch 匹配失败论文重新下载和解析 PDF 的地址。 */
  const paperExtractionRetryMatch = url.pathname.match(
    /^\/api\/papers\/([^/]+)\/retry-extraction$/,
  );
  if (request.method === "POST" && paperExtractionRetryMatch) {
    /** paperId 是需要重新处理的本地论文 ID。 */
    const paperId = decodeURIComponent(paperExtractionRetryMatch[1]);
    /** paper 是必须包含公开 PDF 地址的现有论文。 */
    const paper = getPaperById(paperId);
    if (!paper) {
      sendJson(response, 404, { message: "论文不存在。" });
      return true;
    }
    if (!paper.pdfUrl) {
      sendJson(response, 400, { message: "该论文没有可重试的公开 PDF 地址。" });
      return true;
    }
    queuePaperPdfProcessing(paper);
    sendJson(response, 202, { paper, processing: true });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/papers/reset") {
    /** requestBuffer 是防止误触的清空确认请求。 */
    const requestBuffer = await readRequestBuffer(request, 16 * 1024);
    /** payload 是必须包含固定确认短语的请求对象。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    if (payload.confirm !== "DELETE_ALL_PAPERS") {
      sendJson(response, 400, { message: "缺少清空论文库确认。" });
      return true;
    }
    createDailyBackup();
    /** currentPapers 是删除前用于精确定位 PDF 缓存的论文集合。 */
    const currentPapers = listPapers();
    /** result 是数据库论文、关联数据和旧推荐状态的清理结果。 */
    const result = clearPaperLibrary();
    for (const paper of currentPapers) {
      /** cachedPdfPath 是当前论文的精确 PDF 缓存路径。 */
      const cachedPdfPath = getCachedPaperPdfPath(paper.id);
      if (cachedPdfPath && isPathInsideDirectory(cachedPdfPath, paperDirectory)) {
        fs.rmSync(cachedPdfPath, { force: true });
      }
    }
    sendJson(response, 200, result);
    return true;
  }

  /** paperPdfMatch 匹配本机缓存的公开论文 PDF。 */
  const paperPdfMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/pdf$/);
  if (request.method === "GET" && paperPdfMatch) {
    /** paperId 是地址中经过解码的论文 ID。 */
    const paperId = decodeURIComponent(paperPdfMatch[1]);
    /** paper 是待预览的论文记录。 */
    const paper = getPaperById(paperId);
    if (!paper) {
      sendJson(response, 404, { message: "找不到这篇论文。" });
      return true;
    }
    /** cachedPdfPath 是本地已缓存的 PDF 文件路径。 */
    const cachedPdfPath = getCachedPaperPdfPath(paperId);
    if (!cachedPdfPath) {
      sendJson(response, 404, { message: "这篇论文尚未缓存 PDF。" });
      return true;
    }
    /** pdfSize 是本地 PDF 的字节数。 */
    const pdfSize = fs.statSync(cachedPdfPath).size;
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": pdfSize,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${paper.title}.pdf`)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(cachedPdfPath).pipe(response);
    return true;
  }

  /** paperDetailMatch 匹配统一论文库的单篇详情地址。 */
  const paperDetailMatch = url.pathname.match(/^\/api\/papers\/([^/]+)$/);
  if (request.method === "GET" && paperDetailMatch) {
    /** paperId 是地址中经过解码的论文 ID。 */
    const paperId = decodeURIComponent(paperDetailMatch[1]);
    /** paper 是包含中文阅读正文的完整论文记录。 */
    const paper = getPaperById(paperId);
    if (!paper) {
      sendJson(response, 404, { message: "找不到这篇论文。" });
      return true;
    }
    sendJson(response, 200, { paper });
    return true;
  }

  /** paperTranslationRetryMatch 匹配单篇论文重新加入 Codex 队列的地址。 */
  const paperTranslationRetryMatch = url.pathname.match(
    /^\/api\/papers\/([^/]+)\/translation\/retry$/,
  );
  if (request.method === "POST" && paperTranslationRetryMatch) {
    /** paperId 是用户要求重新翻译的论文 ID。 */
    const paperId = decodeURIComponent(paperTranslationRetryMatch[1]);
    /** paper 是重新排队后的论文；缺少正文时不能开始翻译。 */
    const paper = retryPaperFullTranslation(paperId);
    if (!paper) {
      sendJson(response, 404, { message: "论文不存在或尚未提取出可翻译正文。" });
      return true;
    }
    void triggerCodexPaperTranslationWorker();
    sendJson(response, 200, { paper });
    return true;
  }
  if (request.method === "DELETE" && paperDetailMatch) {
    /** paperId 是用户确认要永久删除的论文 ID。 */
    const paperId = decodeURIComponent(paperDetailMatch[1]);
    /** cachedPdfPath 是删除数据库前读取到的可选本地 PDF 路径。 */
    const cachedPdfPath = getCachedPaperPdfPath(paperId);
    createDailyBackup();
    /** deletedTarget 是已删除论文的摘要。 */
    const deletedTarget = deleteKnowledgeTarget("paper", paperId);
    if (!deletedTarget) {
      sendJson(response, 404, { message: "找不到这篇论文。" });
      return true;
    }
    if (
      cachedPdfPath &&
      isPathInsideDirectory(cachedPdfPath, paperDirectory)
    ) {
      fs.rmSync(cachedPdfPath, { force: true });
    }
    sendJson(response, 200, { deleted: deletedTarget });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/paper-reminder/snooze") {
    /** weekKey 复用旧字段名保存当天的推荐键。 */
    const weekKey = getDailyPaperKey();
    /** snoozedUntil 是从当前时间起延后一天的提醒时间。 */
    const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    /** reminder 是更新后的本周提醒状态。 */
    const reminder = snoozePaperReminder(weekKey, snoozedUntil);
    createDailyBackup();
    sendJson(response, 200, { reminder });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/paper-reminder/dismiss") {
    /** weekKey 复用旧字段名保存当天的推荐键。 */
    const weekKey = getDailyPaperKey();
    /** reminder 是已经跳过的今日提醒状态。 */
    const reminder = dismissPaperReminder(weekKey);
    createDailyBackup();
    sendJson(response, 200, { reminder });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/documents") {
    /** category 是地址栏中的可选分类。 */
    const category = url.searchParams.get("category") ?? "";
    /** query 是地址栏中的可选搜索词。 */
    const query = url.searchParams.get("q") ?? "";
    /** documents 是符合条件的本地文档列表。 */
    const documents = listDocuments({ category, query }).map(toDocumentListItem);
    sendJson(response, 200, {
      documents,
      statistics: getDocumentStatistics(),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/articles") {
    /** category 是可选文章分类。 */
    const category = url.searchParams.get("category") ?? "";
    /** query 是可选文章搜索词。 */
    const query = url.searchParams.get("q") ?? "";
    /** articles 是符合条件的本地文章列表。 */
    const articles = listArticles({ category, query }).map(toArticleListItem);
    sendJson(response, 200, { articles });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/article-images") {
    /** remoteUrl 是文章正文中经过清洗的公开图片地址。 */
    const remoteUrl = url.searchParams.get("url")?.trim() ?? "";
    if (!remoteUrl) {
      sendJson(response, 400, { message: "缺少文章图片地址。" });
      return true;
    }
    /** imageHash 是不会暴露远程路径的稳定本地缓存名称。 */
    const imageHash = crypto.createHash("sha256").update(remoteUrl).digest("hex");
    /** cachedExtensions 是允许缓存的图片扩展名与 MIME 映射。 */
    const cachedExtensions = new Map([
      [".jpg", "image/jpeg"],
      [".png", "image/png"],
      [".gif", "image/gif"],
      [".webp", "image/webp"],
      [".svg", "image/svg+xml"],
    ]);
    /** cachedPath 是已经存在的本地图片缓存路径。 */
    let cachedPath = null;
    /** cachedContentType 是缓存文件对应的响应 MIME。 */
    let cachedContentType = null;
    for (const [extension, contentType] of cachedExtensions) {
      /** candidatePath 是当前格式的候选缓存路径。 */
      const candidatePath = path.join(articleImageDirectory, `${imageHash}${extension}`);
      if (fs.existsSync(candidatePath)) {
        cachedPath = candidatePath;
        cachedContentType = contentType;
        break;
      }
    }
    if (!cachedPath) {
      /** downloadedImage 是通过公网地址校验下载的远程图片。 */
      const downloadedImage = await fetchPublicImage(remoteUrl);
      /** extensionByType 把已允许的 MIME 转换为缓存扩展名。 */
      const extensionByType = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
      };
      /** imageExtension 是远程图片实际格式对应的扩展名。 */
      const imageExtension = extensionByType[downloadedImage.contentType];
      cachedPath = path.join(articleImageDirectory, `${imageHash}${imageExtension}`);
      cachedContentType = downloadedImage.contentType;
      fs.writeFileSync(cachedPath, downloadedImage.bytes, { flag: "wx" });
    }
    /** imageSize 是响应给浏览器的本地缓存图片容量。 */
    const imageSize = fs.statSync(cachedPath).size;
    response.writeHead(200, {
      "Content-Type": cachedContentType,
      "Content-Length": imageSize,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ...(cachedContentType === "image/svg+xml"
        ? { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" }
        : {}),
    });
    fs.createReadStream(cachedPath).pipe(response);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/articles/parse") {
    /** requestBuffer 是文章解析请求 JSON。 */
    const requestBuffer = await readRequestBuffer(request, 32 * 1024);
    /** payload 是浏览器提交的文章链接对象。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** inputUrl 是清理首尾空白后的链接。 */
    const inputUrl = typeof payload.url === "string" ? payload.url.trim() : "";
    if (!inputUrl) {
      sendJson(response, 400, { message: "请输入文章链接。" });
      return true;
    }
    /** parsedArticle 是完成抓取、清洗和分类后的文章。 */
    const parsedArticle = await parseAndClassifyArticle(inputUrl);
    /** now 是文章首次保存或重新解析时间。 */
    const now = new Date().toISOString();
    /** article 是写入本地 SQLite 后的最终记录。 */
    const article = saveArticle({
      id: `article_${crypto.randomUUID()}`,
      ...parsedArticle,
      createdAt: now,
      updatedAt: now,
    });
    createDailyBackup();
    sendJson(response, 201, { article });
    return true;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/article-translations/pending"
  ) {
    /** articles 是用户已经明确加入 Codex 翻译队列的英文文章。 */
    const articles = listPendingArticleTranslations();
    sendJson(response, 200, { articles });
    return true;
  }

  /** articleTranslationMatch 匹配单篇文章的 Codex 中文译文写回地址。 */
  const articleTranslationMatch = url.pathname.match(
    /^\/api\/article-translations\/([^/]+)$/,
  );
  if (request.method === "PATCH" && articleTranslationMatch) {
    /** articleId 是地址中经过解码的文章 ID。 */
    const articleId = decodeURIComponent(articleTranslationMatch[1]);
    /** requestBuffer 是完整文章中文译文的 JSON 请求正文。 */
    const requestBuffer = await readRequestBuffer(request, 12 * 1024 * 1024);
    /** payload 是 Codex 生成的中文标题、简介和安全语义 HTML。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** article 是写入中文译文后的最新文章。 */
    const article = updateArticleTranslation(articleId, {
      translatedTitle: payload.translatedTitle,
      translatedSummary: payload.translatedSummary,
      translatedHtml: payload.translatedHtml,
    });
    if (!article) {
      sendJson(response, 404, { message: "找不到待翻译的文章。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { article });
    return true;
  }

  /** articleTranslationRequestMatch 匹配用户主动加入 Codex 翻译队列的地址。 */
  const articleTranslationRequestMatch = url.pathname.match(
    /^\/api\/articles\/([^/]+)\/translation-request$/,
  );
  if (request.method === "POST" && articleTranslationRequestMatch) {
    /** articleId 是用户正在阅读的英文文章 ID。 */
    const articleId = decodeURIComponent(articleTranslationRequestMatch[1]);
    /** article 是进入等待状态后的完整文章。 */
    const article = requestArticleTranslation(articleId);
    if (!article) {
      sendJson(response, 404, { message: "找不到这篇文章。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { article });
    return true;
  }

  if (request.method === "PATCH" && url.pathname === "/api/favorites") {
    /** requestBuffer 是收藏状态请求的 JSON 二进制正文。 */
    const requestBuffer = await readRequestBuffer(request, 32 * 1024);
    /** payload 是浏览器提交的收藏对象、ID 与目标状态。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    /** favorite 是写入本地 SQLite 后的最终收藏状态。 */
    const favorite = setFavorite({
      targetType: payload.targetType,
      targetId: payload.targetId,
      active: payload.active,
    });
    if (!favorite) {
      sendJson(response, 404, { message: "找不到要收藏的文档。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { favorite });
    return true;
  }

  /** articleDetailMatch 匹配单篇文章详情地址。 */
  const articleDetailMatch = url.pathname.match(/^\/api\/articles\/([^/]+)$/);
  if (request.method === "GET" && articleDetailMatch) {
    /** articleId 是地址中经过解码的文章 ID。 */
    const articleId = decodeURIComponent(articleDetailMatch[1]);
    /** article 是本地 SQLite 中的完整文章。 */
    const article = getArticleById(articleId);
    if (!article) {
      sendJson(response, 404, { message: "找不到这篇文章。" });
      return true;
    }
    sendJson(response, 200, { article });
    return true;
  }
  if (request.method === "DELETE" && articleDetailMatch) {
    /** articleId 是用户确认要永久删除的文章 ID。 */
    const articleId = decodeURIComponent(articleDetailMatch[1]);
    createDailyBackup();
    /** deletedTarget 是已删除文章的摘要。 */
    const deletedTarget = deleteKnowledgeTarget("article", articleId);
    if (!deletedTarget) {
      sendJson(response, 404, { message: "找不到这篇文章。" });
      return true;
    }
    sendJson(response, 200, { deleted: deletedTarget });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/documents") {
    /** rawFileName 是前端进行 URI 编码后的原始文件名。 */
    const rawFileName = String(request.headers["x-file-name"] ?? "");
    /** originalName 是经过安全清理的原始文件名。 */
    const originalName = sanitizeFileName(rawFileName);
    /** mimeType 是浏览器报告的文件 MIME。 */
    const mimeType =
      String(request.headers["content-type"] ?? "application/octet-stream")
        .split(";")[0]
        .trim() || "application/octet-stream";
    /** fileBuffer 是完整文件二进制内容。 */
    const fileBuffer = await readRequestBuffer(
      request,
      serverConfig.maxUploadBytes,
    );
    if (fileBuffer.length === 0) {
      sendJson(response, 422, { message: "文件内容为空，无法保存。" });
      return true;
    }

    /** documentId 是本地文档的稳定随机 ID。 */
    const documentId = `doc_${crypto.randomUUID()}`;
    /** extension 是统一为小写的原文件扩展名。 */
    const extension = path.extname(originalName).toLowerCase();
    /** storedName 是避免文件名冲突且不暴露标题的磁盘文件名。 */
    const storedName = `${documentId}${extension}`;
    /** storedPath 是原文件保存的绝对路径。 */
    const storedPath = path.join(attachmentDirectory, storedName);
    /** sha256 是用于完整性校验和未来重复检测的摘要。 */
    const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    /** extractionResult 是文档解析后的正文和状态。 */
    const extractionResult = await extractDocumentText({
      buffer: fileBuffer,
      originalName,
      mimeType,
    });
    /** classification 是本地规则与可选 DeepSeek 得到的最终分类。 */
    const classification = await classifyDocument({
      fileName: originalName,
      text: extractionResult.text,
    });
    /** now 是文档创建和更新时间。 */
    const now = new Date().toISOString();

    fs.writeFileSync(storedPath, fileBuffer, { flag: "wx" });
    try {
      /** document 是即将写入 SQLite 的完整文档记录。 */
      let document = insertDocument({
        id: documentId,
        originalName,
        storedName,
        mimeType,
        extension,
        sizeBytes: fileBuffer.length,
        sha256,
        title: deriveDocumentTitle(originalName),
        category: classification.category,
        categorySource: classification.source,
        categoryConfidence: classification.confidence,
        summary: createDocumentSummary(extractionResult.text, originalName),
        extractedText: extractionResult.text,
        extractionStatus: extractionResult.status,
        createdAt: now,
        updatedAt: now,
      });
      /** needsOcr 表示图片或缺少可用文本层的 PDF 应进入后台识别。 */
      const needsOcr = isOcrSupportedExtension(extension)
        && (extension !== ".pdf" || extractionResult.text.trim().length < 80);
      let importJob = null;
      if (needsOcr) {
        document = queueDocumentOcr(document.id);
        importJob = createImportJob({
          jobType: "document_ocr",
          sourceLabel: document.title,
          payload: { documentId: document.id, language: "" },
        });
        importJobRunner.trigger();
      }
      createDailyBackup();
      sendJson(response, 201, { document, importJob });
    } catch (error) {
      fs.rmSync(storedPath, { force: true });
      throw error;
    }
    return true;
  }

  /** detailMatch 匹配单份文档详情地址。 */
  const detailMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (request.method === "GET" && detailMatch) {
    /** documentId 是地址中经过解码的文档 ID。 */
    const documentId = decodeURIComponent(detailMatch[1]);
    /** document 是本地 SQLite 中的完整文档。 */
    const document = getDocumentById(documentId);
    if (!document) {
      sendJson(response, 404, { message: "找不到这份文档。" });
      return true;
    }
    if (document.extension === ".docx") {
      /** filePath 是用于生成结构化 Word 阅读视图的本地原始文件。 */
      const filePath = path.join(attachmentDirectory, document.storedName);
      if (fs.existsSync(filePath)) {
        /** renderedHtml 保留 Word 中的段落、列表、表格和图片结构。 */
        document.renderedHtml = await extractWordHtml(fs.readFileSync(filePath));
      }
    }
    sendJson(response, 200, { document });
    return true;
  }
  if (request.method === "DELETE" && detailMatch) {
    /** documentId 是用户确认要永久删除的文档 ID。 */
    const documentId = decodeURIComponent(detailMatch[1]);
    /** existingDocument 是删除前用于定位附件的文档记录。 */
    const existingDocument = getDocumentById(documentId);
    if (!existingDocument) {
      sendJson(response, 404, { message: "找不到这份文档。" });
      return true;
    }
    createDailyBackup();
    /** deletedTarget 是已删除文档的摘要。 */
    const deletedTarget = deleteKnowledgeTarget("document", documentId);
    /** attachmentPath 是该文档的本地原始附件路径。 */
    const attachmentPath = path.resolve(
      attachmentDirectory,
      existingDocument.storedName,
    );
    if (isPathInsideDirectory(attachmentPath, attachmentDirectory)) {
      fs.rmSync(attachmentPath, { force: true });
    }
    sendJson(response, 200, { deleted: deletedTarget });
    return true;
  }

  /** downloadMatch 匹配原文件下载地址。 */
  const downloadMatch = url.pathname.match(
    /^\/api\/documents\/([^/]+)\/download$/,
  );
  if (request.method === "GET" && downloadMatch) {
    /** documentId 是待下载文档 ID。 */
    const documentId = decodeURIComponent(downloadMatch[1]);
    /** document 是待下载文档元数据。 */
    const document = getDocumentById(documentId);
    if (!document) {
      sendJson(response, 404, { message: "找不到这份文档。" });
      return true;
    }
    /** filePath 是原文件的本地绝对路径。 */
    const filePath = path.join(attachmentDirectory, document.storedName);
    if (!fs.existsSync(filePath)) {
      sendJson(response, 410, { message: "原始文件已不在附件目录中。" });
      return true;
    }
    response.writeHead(200, {
      "Content-Type": document.mimeType || "application/octet-stream",
      "Content-Length": document.sizeBytes,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(filePath).pipe(response);
    return true;
  }

  /** viewMatch 匹配在浏览器中原样预览文件的地址。 */
  const viewMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/view$/);
  if (request.method === "GET" && viewMatch) {
    /** documentId 是待预览文档 ID。 */
    const documentId = decodeURIComponent(viewMatch[1]);
    /** document 是待预览文档元数据。 */
    const document = getDocumentById(documentId);
    if (!document) {
      sendJson(response, 404, { message: "找不到这份文档。" });
      return true;
    }
    /** filePath 是原始附件的本地绝对路径。 */
    const filePath = path.join(attachmentDirectory, document.storedName);
    if (!fs.existsSync(filePath)) {
      sendJson(response, 410, { message: "原始文件已不在附件目录中。" });
      return true;
    }
    response.writeHead(200, {
      "Content-Type": document.mimeType || "application/octet-stream",
      "Content-Length": document.sizeBytes,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    });
    fs.createReadStream(filePath).pipe(response);
    return true;
  }

  /** categoryMatch 匹配人工修改分类地址。 */
  const categoryMatch = url.pathname.match(
    /^\/api\/documents\/([^/]+)\/category$/,
  );
  if (request.method === "PATCH" && categoryMatch) {
    /** requestBuffer 是分类请求 JSON 二进制正文。 */
    const requestBuffer = await readRequestBuffer(request, 32 * 1024);
    /** payload 是前端提交的分类对象。 */
    const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
    if (!isDocumentCategory(payload.category)) {
      sendJson(response, 422, { message: "文档分类不在允许范围内。" });
      return true;
    }
    /** document 是人工分类更新后的文档。 */
    const document = updateDocumentCategory(
      decodeURIComponent(categoryMatch[1]),
      payload.category,
    );
    if (!document) {
      sendJson(response, 404, { message: "找不到这份文档。" });
      return true;
    }
    createDailyBackup();
    sendJson(response, 200, { document });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/backups") {
    /** backupPath 是当天 SQLite 备份文件路径。 */
    const backupPath = createDailyBackup();
    sendJson(response, 200, {
      message: "本地数据库备份已确认。",
      backupName: path.basename(backupPath),
    });
    return true;
  }

  return false;
}

/**
 * 发送静态网页资源；未知路径回退到首页。
 *
 * @param {http.IncomingMessage} request HTTP 请求对象。
 * @param {http.ServerResponse} response HTTP 响应对象。
 * @param {URL} url 已解析请求地址。
 * @returns {void}
 */
function serveStaticFile(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { message: "不支持此请求方法。" });
    return;
  }
  /** requestedPath 是去除开头斜杠后的资源路径。 */
  const requestedPath =
    url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  /** resolvedPath 是经过标准化的候选文件路径。 */
  let resolvedPath = path.resolve(publicDirectory, requestedPath);
  if (!resolvedPath.startsWith(`${path.resolve(publicDirectory)}${path.sep}`)) {
    sendJson(response, 403, { message: "禁止访问此路径。" });
    return;
  }
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    resolvedPath = path.join(publicDirectory, "index.html");
  }
  /** fileExtension 是静态资源扩展名。 */
  const fileExtension = path.extname(resolvedPath).toLowerCase();
  /** contentType 是响应的 MIME 类型。 */
  const contentType =
    staticMimeTypes[fileExtension] || "application/octet-stream";
  /** stat 是静态文件元数据。 */
  const stat = fs.statSync(resolvedPath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    // 本地个人应用优先保证修改立即可见，避免 HTML 与旧 CSS/JS 混用。
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  fs.createReadStream(resolvedPath).pipe(response);
}

/**
 * 统一处理全部本地 HTTP 请求。
 *
 * @param {http.IncomingMessage} request HTTP 请求对象。
 * @param {http.ServerResponse} response HTTP 响应对象。
 * @returns {Promise<void>}
 */
async function handleRequest(request, response) {
  /** url 是基于本地服务地址解析后的请求 URL。 */
  const url = new URL(
    request.url ?? "/",
    `http://${serverConfig.host}:${serverConfig.port}`,
  );
  try {
    if (url.pathname.startsWith("/api/")) {
      /** handled 表示请求是否命中已知 API。 */
      const handled = await handleApiRequest(request, response, url);
      if (!handled) sendJson(response, 404, { message: "接口不存在。" });
      return;
    }
    serveStaticFile(request, response, url);
  } catch (error) {
    /** message 是向本地用户展示的错误说明。 */
    const message =
      error instanceof Error ? error.message : "本地服务发生未知错误。";
    if (!response.headersSent) sendJson(response, 500, { message });
    else response.destroy(error instanceof Error ? error : undefined);
  }
}

/**
 * 使用 Windows 默认浏览器打开本地知识库。
 *
 * @param {string} url 本地网页地址。
 * @returns {void}
 */
function openDefaultBrowser(url) {
  if (process.platform !== "win32" || process.env.ZHIXU_NO_BROWSER === "1") return;
  /** escapedUrl 是适合放入 PowerShell 单引号字符串的本地地址。 */
  const escapedUrl = url.replaceAll("'", "''");
  /** browserProcess 是隐藏运行且不阻塞本地服务的浏览器启动进程。 */
  const browserProcess = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `Start-Process '${escapedUrl}'`,
    ],
    {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    },
  );
  browserProcess.unref();
}

createDailyBackup();

/**
 * 在本地服务运行期间预先准备当天的经典论文。
 *
 * 网络暂时不可用不会影响知识库其他功能；下一次计划检查会自动重试。
 *
 * @returns {Promise<void>}
 */
async function runPaperSchedule() {
  try {
    await ensureDailyClassicPaperCandidate();
  } catch (error) {
    /** message 是仅写入本地终端的候选更新失败原因。 */
    const message = error instanceof Error ? error.message : "未知错误";
    console.warn(`今日经典论文暂未更新：${message}`);
  }
}

/** paperScheduleTimer 是服务运行期间每六小时执行一次的周任务。 */
const paperScheduleTimer = setInterval(
  () => void runPaperSchedule(),
  paperScheduleIntervalMilliseconds,
);
paperScheduleTimer.unref();
void runPaperSchedule();

/** codexWorkerTimer 定期检查登录恢复和未完成队列。 */
const codexWorkerTimer = setInterval(
  () => void triggerCodexPaperTranslationWorker(),
  60 * 1000,
);
codexWorkerTimer.unref();
initializeCodexPaperTranslationWorker();
importJobRunner.start();

/** server 是只监听本机回环地址的 HTTP 服务。 */
const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(serverConfig.port, serverConfig.host, () => {
  /** localUrl 是浏览器访问知序的本地地址。 */
  const localUrl = `http://${serverConfig.host}:${serverConfig.port}`;
  console.log(`知序本地知识库已启动：${localUrl}`);
  console.log(`数据库：本机 SQLite；上传上限：${Math.round(serverConfig.maxUploadBytes / 1024 / 1024)} MB`);
  openDefaultBrowser(localUrl);
});
