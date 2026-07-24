/**
 * 公开论文 PDF 下载与全文提取服务。
 *
 * 模块只负责保存英文原文；中文译文必须由 Codex 队列写回，避免调用第三方翻译服务。
 */
import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { paperDirectory } from "./config.mjs";
import {
  getPaperById,
  markPaperExtractionFailed,
  updatePaperSourceText,
} from "./database.mjs";

/** maximumPaperPdfBytes 是单篇公开论文 PDF 的最大下载容量。 */
const maximumPaperPdfBytes = 80 * 1024 * 1024;
/** paperDownloadTimeoutMilliseconds 是公开 PDF 的最长下载时间。 */
const paperDownloadTimeoutMilliseconds = 45_000;
/** extractionPromises 防止同一篇论文被重复并发下载。 */
const extractionPromises = new Map();

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
  const response = await fetch(requestUrl, {
    headers: {
      Accept: "application/pdf",
      "User-Agent": "ZhixuLocalKnowledge/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(paperDownloadTimeoutMilliseconds),
  });
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
 * 下载并提取一篇论文的英文全文。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @returns {Promise<Record<string, unknown> | null>} 更新后的论文。
 */
export async function preparePaperFullText(paperId) {
  if (extractionPromises.has(paperId)) return extractionPromises.get(paperId);
  /** extractionPromise 是当前论文唯一的提取任务。 */
  const extractionPromise = (async () => {
    /** paper 是待提取的论文记录。 */
    const paper = getPaperById(paperId);
    if (!paper || !paper.pdfUrl) return paper;
    if (paper.sourceText?.trim()) return paper;
    try {
      /** pdfBytes 是从公开来源下载的原始论文。 */
      const pdfBytes = await downloadPaperPdf(paper.pdfUrl);
      /** cachedPdfPath 是论文 PDF 的本地缓存路径。 */
      const cachedPdfPath = path.join(paperDirectory, `${paper.id}.pdf`);
      fs.writeFileSync(cachedPdfPath, pdfBytes);
      /** parsedPaper 是 pdf-parse 提取出的页数与纯文本。 */
      const parsedPaper = await pdfParse(pdfBytes);
      /** sourceText 是规范空白后的英文论文正文。 */
      const sourceText = String(parsedPaper.text || "")
        .replace(/\u0000/g, "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (sourceText.length < 1_000) {
        throw new Error("PDF 中未提取到足够的可读正文。");
      }
      /** wordCount 是用于判断翻译工作量的近似英文词数。 */
      const wordCount = sourceText.split(/\s+/).filter(Boolean).length;
      return updatePaperSourceText(paperId, { sourceText, wordCount });
    } catch (error) {
      markPaperExtractionFailed(paperId, error.message);
      throw error;
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
