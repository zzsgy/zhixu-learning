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
  publicDirectory,
  serverConfig,
} from "./lib/config.mjs";
import {
  createDailyBackup,
  dismissPaperReminder,
  getArticleById,
  getDocumentById,
  getDocumentStatistics,
  getPaperById,
  insertDocument,
  listArticles,
  listDocuments,
  listPaperCandidates,
  listPendingPaperTranslations,
  listPendingFullPaperTranslations,
  listPapers,
  saveArticle,
  selectPaperCandidate,
  setFavorite,
  snoozePaperReminder,
  updatePaperCandidateTranslation,
  updatePaperFullTranslation,
  updateDocumentCategory,
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
  fetchPublicImage,
  parseAndClassifyArticle,
} from "./lib/article-parser.mjs";
import {
  ensureWeeklyPaperCandidates,
  getIsoWeekKey,
  getWeeklyPaperReminder,
} from "./lib/paper-service.mjs";
import {
  getCachedPaperPdfPath,
  preparePaperFullText,
} from "./lib/paper-fulltext.mjs";
import { refreshMliPaperLibrary } from "./lib/mli-paper-service.mjs";

/** paperScheduleIntervalMilliseconds 是后台检查新自然周的间隔。 */
const paperScheduleIntervalMilliseconds = 6 * 60 * 60 * 1000;

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
function sendJson(response, statusCode, payload) {
  /** body 是 UTF-8 JSON 响应正文。 */
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
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
  return listItem;
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
    ...listItem
  } = article;
  return listItem;
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
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      storage: "SQLite 本地数据库",
      deepSeekConfigured: Boolean(serverConfig.deepSeekApiKey),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/categories") {
    sendJson(response, 200, { categories: DOCUMENT_CATEGORIES });
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
      return listItem;
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
    /** reminder 是当前自然周的候选论文和提醒状态。 */
    const reminder = await getWeeklyPaperReminder();
    /** force 表示用户主动要求查看本周候选，即使已经延后或跳过。 */
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
    const fullTextTask = preparePaperFullText(paper.id).catch((error) => {
      console.error(`论文全文提取失败：${error.message}`);
    });
    void fullTextTask;
    createDailyBackup();
    sendJson(response, 201, { paper });
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

  if (request.method === "POST" && url.pathname === "/api/paper-reminder/snooze") {
    /** weekKey 是只允许延后当前自然周的周标识。 */
    const weekKey = getIsoWeekKey();
    /** snoozedUntil 是从当前时间起延后一天的提醒时间。 */
    const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    /** reminder 是更新后的本周提醒状态。 */
    const reminder = snoozePaperReminder(weekKey, snoozedUntil);
    createDailyBackup();
    sendJson(response, 200, { reminder });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/paper-reminder/dismiss") {
    /** weekKey 是当前自然周标识。 */
    const weekKey = getIsoWeekKey();
    /** reminder 是已经跳过的本周提醒状态。 */
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
      const document = insertDocument({
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
      createDailyBackup();
      sendJson(response, 201, { document });
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
    "Cache-Control":
      fileExtension === ".html" ? "no-cache" : "public, max-age=3600",
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
 * 在本地服务运行期间预先准备当前周的候选论文。
 *
 * 网络暂时不可用不会影响知识库其他功能；下一次计划检查会自动重试。
 *
 * @returns {Promise<void>}
 */
async function runPaperSchedule() {
  try {
    await ensureWeeklyPaperCandidates();
  } catch (error) {
    /** message 是仅写入本地终端的候选更新失败原因。 */
    const message = error instanceof Error ? error.message : "未知错误";
    console.warn(`本周论文候选暂未更新：${message}`);
  }
}

/** paperScheduleTimer 是服务运行期间每六小时执行一次的周任务。 */
const paperScheduleTimer = setInterval(
  () => void runPaperSchedule(),
  paperScheduleIntervalMilliseconds,
);
paperScheduleTimer.unref();
void runPaperSchedule();

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
