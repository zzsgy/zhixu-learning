/**
 * 公开论文 PDF 下载与全文提取服务。
 *
 * 模块只负责保存英文原文；中文译文必须由 Codex 队列写回，避免调用第三方翻译服务。
 */
import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { parseHTML } from "linkedom";
import { paperDirectory } from "./config.mjs";
import {
  detectArticleLanguage,
  fetchExternalResource,
  normalizeArticleMath,
  normalizeLegacyHtmlImages,
  parseAndClassifyArticle,
  sanitizeArticleHtml,
} from "./article-parser.mjs";
import {
  getPaperById,
  markPaperExtractionFailed,
  updatePaperSourceText,
} from "./database.mjs";
import {
  analyzePaperHtmlStructure,
  createPaperHtmlFromPlainText,
} from "./paper-structure.mjs";

/** maximumPaperPdfBytes 是单篇公开论文 PDF 的最大下载容量。 */
const maximumPaperPdfBytes = 80 * 1024 * 1024;
/** paperDownloadTimeoutMilliseconds 是公开 PDF 的最长下载时间。 */
const paperDownloadTimeoutMilliseconds = 45_000;
/** extractionPromises 防止同一篇论文被重复并发下载。 */
const extractionPromises = new Map();

/**
 * 判断结构化论文来源是否真的保留了题注对应的图表资产。
 *
 * @param {Record<string, number>} structure 论文结构清单。
 * @returns {boolean} 是否存在只有题注、没有图片或表格的空图。
 */
function hasMissingPaperFigureAssets(structure) {
  return Math.max(0, Number(structure?.emptyFigureCount) || 0) > 0;
}

/**
 * 删除出版商推荐卡片等没有图注、没有替代文字的装饰图，保留论文正文图。
 *
 * @param {string} sourceHtml 已经过文章安全清洗的 HTML。
 * @returns {{ html: string, text: string }} 论文正文结构与对应纯文本。
 */
function normalizePaperPublisherHtml(sourceHtml) {
  const { document } = parseHTML(`<main>${String(sourceHtml || "")}</main>`);
  const root = document.querySelector("main");
  if (!root) return { html: "", text: "" };
  for (const image of Array.from(root.querySelectorAll("img"))) {
    if (image.closest("figure") || String(image.getAttribute("alt") || "").trim()) continue;
    const parent = image.parentElement;
    image.remove();
    if (parent && !String(parent.textContent || "").trim() && parent.children.length === 0) {
      parent.remove();
    }
  }
  const text = String(root.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { html: root.innerHTML.trim(), text };
}

/**
 * 校验、缓存并提取用户上传或远程下载的论文 PDF。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @param {Buffer} pdfBytes PDF 二进制内容。
 * @returns {Promise<Record<string, unknown> | null>} 更新后的论文。
 */
export async function preparePaperFullTextFromBuffer(paperId, pdfBytes, options = {}) {
  if (
    !Buffer.isBuffer(pdfBytes) ||
    pdfBytes.length === 0 ||
    pdfBytes.length > maximumPaperPdfBytes ||
    pdfBytes.subarray(0, 4).toString("ascii") !== "%PDF"
  ) {
    throw new Error("文件不是有效 PDF，或容量超过 80 MB。");
  }
  /** cachedPdfPath 是按照论文 ID 命名的本地原文缓存。 */
  const cachedPdfPath = path.join(paperDirectory, `${paperId}.pdf`);
  fs.writeFileSync(cachedPdfPath, pdfBytes);
  try {
    /** parsedPaper 是 pdf-parse 提取出的页数与纯文本。 */
    const parsedPaper = await pdfParse(pdfBytes);
    /** sourceText 是规范空白后的论文正文。 */
    const sourceText = String(parsedPaper.text || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (sourceText.length < 1_000) {
      throw new Error("PDF 中未提取到足够的可读正文。");
    }
    /** wordCount 是正文翻译与展示的近似工作量。 */
    const wordCount = sourceText.split(/\s+/).filter(Boolean).length;
    /** sourceHtml 保留段落边界；PDF 未提供可验证图像或公式结构时不进行猜测。 */
    const sourceHtml = createPaperHtmlFromPlainText(sourceText);
    /** sourceStructure 明确记录 PDF 文字层的保真限制，防止后续误报完整。 */
    const sourceStructure = {
      ...analyzePaperHtmlStructure(sourceHtml),
      sourceKind: "pdf_text",
      structureFidelity: "degraded",
      structureMessage: "PDF 文字层未提供可验证的图片与公式结构；译文必须显示降级提示。",
    };
    return updatePaperSourceText(paperId, {
      sourceText,
      sourceHtml,
      sourceStructure,
      wordCount,
      sourceLanguage: detectArticleLanguage(sourceText),
      resetTranslation: Boolean(options.resetTranslation),
    });
  } catch (error) {
    markPaperExtractionFailed(paperId, error.message);
    throw error;
  }
}

/**
 * 校验论文 PDF 地址，只允许公开 HTTPS 资源。
 *
 * @param {string} rawUrl 待校验地址。
 * @returns {URL} 可安全请求的 HTTPS 地址。
 */
function validatePaperPdfUrl(rawUrl) {
  /** parsedUrl 是标准化后的论文地址。 */
  const parsedUrl = new URL(String(rawUrl || ""));
  if (parsedUrl.protocol !== "https:") {
    throw new TypeError("论文 PDF 必须使用 HTTPS 地址。");
  }
  return parsedUrl;
}

/**
 * 下载公开论文 PDF，并在内存中执行容量约束。
 *
 * @param {string} pdfUrl 公开 PDF 地址。
 * @returns {Promise<Buffer>} PDF 二进制内容。
 */
async function downloadPaperPdf(pdfUrl) {
  /** requestUrl 是已通过协议校验的公开地址。 */
  const requestUrl = validatePaperPdfUrl(pdfUrl);
  /** response 是远程 PDF 响应。 */
  const response = await fetchExternalResource(requestUrl, {
    headers: {
      Accept: "application/pdf",
      "User-Agent": "ZhixuLocalKnowledge/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(paperDownloadTimeoutMilliseconds),
  }, "论文 PDF");
  if (!response.ok) {
    throw new Error(`论文 PDF 下载失败（${response.status}）。`);
  }
  /** declaredLength 是服务器声明的文件容量。 */
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumPaperPdfBytes) {
    throw new Error("论文 PDF 超过 80 MB，未自动下载。");
  }
  /** pdfBytes 是完整 PDF 二进制内容。 */
  const pdfBytes = Buffer.from(await response.arrayBuffer());
  if (
    pdfBytes.length > maximumPaperPdfBytes ||
    pdfBytes.subarray(0, 4).toString("ascii") !== "%PDF"
  ) {
    throw new Error("下载内容不是有效 PDF，或文件容量超过 80 MB。");
  }
  return pdfBytes;
}

/**
 * 生成按保真优先级排列的公开结构化正文地址。
 *
 * @param {Record<string, unknown>} paper 论文记录。
 * @returns {string[]} 去重后的 HTTPS 地址。
 */
function createStructuredSourceUrls(paper) {
  const urls = [];
  const sourceUrl = String(paper.sourceUrl || "").trim();
  const arxivMatch = sourceUrl.match(/^https:\/\/arxiv\.org\/abs\/([^?#]+)/i);
  if (arxivMatch) {
    urls.push(`https://arxiv.org/html/${arxivMatch[1]}`);
    /** 较早论文没有官方 HTML 时，ar5iv 提供由同一 arXiv 源文件生成的结构化后备页。 */
    urls.push(`https://ar5iv.labs.arxiv.org/html/${arxivMatch[1]}`);
  }
  if (/^https:\/\//i.test(sourceUrl) && sourceUrl !== paper.pdfUrl) urls.push(sourceUrl);
  return [...new Set(urls)];
}

/**
 * 读取 ar5iv 后备页的论文主体，避免通用 Readability 在旧页面中丢掉主图和公式。
 * 官方 arXiv HTML 已由通用解析器验证，继续使用其正文过滤以排除导航和布局结构。
 */
async function parseStructuredPaperSource(sourceUrl, parseSourcePage) {
  if (!/^https:\/\/ar5iv\.labs\.arxiv\.org\/html\//i.test(sourceUrl)) {
    const article = await parseSourcePage(sourceUrl);
    return { html: article.contentHtml, text: article.contentText };
  }
  const response = await fetchExternalResource(new URL(sourceUrl), {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "ZhixuLocalKnowledge/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(paperDownloadTimeoutMilliseconds),
  }, "论文结构化正文");
  if (!response.ok) throw new Error(`论文结构化正文下载失败（${response.status}）。`);
  const rawHtml = await response.text();
  if (rawHtml.length > 8 * 1024 * 1024) throw new Error("论文结构化正文超过 8 MB。");
  const { document } = parseHTML(rawHtml);
  normalizeLegacyHtmlImages(document);
  normalizeArticleMath(document);
  const root = document.querySelector("article.ltx_document, main.ltx_document, .ltx_document, article, main");
  if (!root) throw new Error("论文结构化页面中没有识别到正文主体。");
  return sanitizeArticleHtml(
    root.innerHTML,
    new URL(response.url || sourceUrl),
  );
}

/**
 * 下载并提取一篇论文的英文全文。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @returns {Promise<Record<string, unknown> | null>} 更新后的论文。
 */
export async function preparePaperFullText(paperId, dependencies = {}) {
  if (extractionPromises.has(paperId)) return extractionPromises.get(paperId);
  /** downloadPdf 和 parseSourcePage 可在测试中替换，生产环境使用真实安全抓取器。 */
  const downloadPdf = dependencies.downloadPdf ?? downloadPaperPdf;
  const parseSourcePage = dependencies.parseSourcePage ?? parseAndClassifyArticle;
  /** extractionPromise 是当前论文唯一的提取任务。 */
  const extractionPromise = (async () => {
    /** paper 是待提取的论文记录。 */
    const paper = getPaperById(paperId);
    if (!paper) return null;
    if (paper.sourceText?.trim() && !dependencies.force) return paper;
    /**
     * 出版商开放正文通常比 PDF 文字层更能保留图片、上下标与章节。
     * 只有正文足够长且确实包含结构资产时才优先采用，arXiv 摘要页等短页面仍走 PDF。
     */
    for (const structuredSourceUrl of createStructuredSourceUrls(paper)) {
      try {
        const sourceArticle = await parseStructuredPaperSource(
          structuredSourceUrl,
          parseSourcePage,
        );
        const normalizedSource = normalizePaperPublisherHtml(sourceArticle.html);
        const sourceText = normalizedSource.text || String(sourceArticle.text || "").trim();
        const sourceHtml = normalizedSource.html || createPaperHtmlFromPlainText(sourceText);
        const sourceStructure = analyzePaperHtmlStructure(sourceHtml);
        const minimumComparableLength = Math.max(
          5_000,
          Math.floor(String(paper.sourceText || "").length * 0.5),
        );
        if (
          sourceText.length >= minimumComparableLength
          && (sourceStructure.imageCount > 0 || sourceStructure.headingCount >= 2)
          && !hasMissingPaperFigureAssets(sourceStructure)
        ) {
          const wordCount = sourceText.split(/\s+/).filter(Boolean).length;
          return updatePaperSourceText(paperId, {
            sourceText,
            sourceHtml,
            sourceStructure: {
              ...sourceStructure,
              sourceKind: structuredSourceUrl.includes("arxiv.org/html/")
                ? "arxiv_html"
                : "publisher_html",
              structureFidelity: "complete",
              structureMessage: "已从出版商公开正文页保留图文语义结构。",
            },
            wordCount,
            sourceLanguage: detectArticleLanguage(sourceText),
            resetTranslation: Boolean(dependencies.resetTranslation ?? dependencies.force),
          });
        }
      } catch {
        /** 出版商正文不可用时继续尝试公开 PDF，不提前把可恢复任务标记失败。 */
      }
    }
    /** 本地上传论文和已经缓存过的远程论文优先复用原始 PDF。 */
    const cachedPdfPath = getCachedPaperPdfPath(paperId);
    if (cachedPdfPath) {
      return preparePaperFullTextFromBuffer(
        paperId,
        fs.readFileSync(cachedPdfPath),
        { resetTranslation: Boolean(dependencies.resetTranslation ?? dependencies.force) },
      );
    }
    if (!paper.pdfUrl) {
      return markPaperExtractionFailed(
        paperId,
        "缺少可下载的论文 PDF，尚未取得可翻译全文。",
      );
    }
    try {
      /** pdfBytes 是从公开来源下载的原始论文。 */
      const pdfBytes = await downloadPdf(paper.pdfUrl);
      return await preparePaperFullTextFromBuffer(paperId, pdfBytes, {
        resetTranslation: Boolean(dependencies.resetTranslation ?? dependencies.force),
      });
    } catch (pdfError) {
      if (paper.sourceUrl && paper.sourceUrl !== paper.pdfUrl) {
        try {
          /** sourceArticle 是出版商公开文章页的正文后备来源。 */
          const sourceArticle = await parseSourcePage(paper.sourceUrl);
          /** sourceText 是经过网页正文提取与安全清洗后的论文全文。 */
          const normalizedSource = normalizePaperPublisherHtml(sourceArticle.contentHtml);
          const sourceText = normalizedSource.text || String(sourceArticle.contentText || "").trim();
          /** sourceHtml 保留出版商正文中的图片、表格、上下标和 LaTeX。 */
          const sourceHtml = normalizedSource.html || createPaperHtmlFromPlainText(sourceText);
          if (sourceText.length < 1_000) {
            throw new Error("论文网页中未提取到足够的可读正文。");
          }
          /** wordCount 是提供给翻译队列和界面展示的英文词数。 */
          const wordCount = sourceText.split(/\s+/).filter(Boolean).length;
          return updatePaperSourceText(paperId, {
            sourceText,
            sourceHtml,
            sourceStructure: (() => {
              const structure = analyzePaperHtmlStructure(sourceHtml);
              const complete = Boolean(normalizedSource.html)
                && (structure.imageCount > 0 || structure.headingCount >= 2)
                && !hasMissingPaperFigureAssets(structure);
              return {
                ...structure,
                sourceKind: complete ? "publisher_html" : "publisher_text",
                structureFidelity: complete ? "complete" : "degraded",
                structureMessage: complete
                  ? "已从出版商公开正文页保留图文语义结构。"
                  : "出版商正文只提供可读文本，图片或公式结构可能不完整。",
              };
            })(),
            wordCount,
            sourceLanguage: detectArticleLanguage(sourceText),
            resetTranslation: Boolean(dependencies.resetTranslation ?? dependencies.force),
          });
        } catch (sourceError) {
          /** combinedError 同时说明 PDF 和网页两条公开全文路径均失败。 */
          const combinedError = new Error(
            `PDF 获取失败：${pdfError.message}；论文网页获取失败：${sourceError.message}`,
          );
          markPaperExtractionFailed(paperId, combinedError.message);
          throw combinedError;
        }
      }
      markPaperExtractionFailed(paperId, pdfError.message);
      throw pdfError;
    }
  })().finally(() => extractionPromises.delete(paperId));
  extractionPromises.set(paperId, extractionPromise);
  return extractionPromise;
}

/**
 * 返回本机缓存的论文 PDF 路径。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @returns {string | null} 存在时返回绝对路径。
 */
export function getCachedPaperPdfPath(paperId) {
  /** cachedPdfPath 是按照论文 ID 命名的缓存文件。 */
  const cachedPdfPath = path.join(paperDirectory, `${paperId}.pdf`);
  return fs.existsSync(cachedPdfPath) ? cachedPdfPath : null;
}
