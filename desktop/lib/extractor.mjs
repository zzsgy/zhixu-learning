/**
 * 上传文档正文提取模块。
 *
 * 支持 PDF、Word、Excel、PowerPoint、纯文本、Markdown、HTML、JSON 和 CSV。
 */
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
// 直接导入解析实现，避免 pdf-parse 包入口在非打包环境中执行自带示例文件。
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/** 文本类扩展名集合。 */
const textExtensions = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".log",
  ".sql",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".kt",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".sh",
  ".ps1",
]);

/**
 * 解码常见 HTML/XML 实体并移除标签。
 *
 * @param {string} markup HTML 或 XML 文本。
 * @returns {string} 可检索的纯文本。
 */
function stripMarkup(markup) {
  return markup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

/**
 * 规范化文档正文中的空白，保留自然段。
 *
 * @param {string} value 原始提取文本。
 * @returns {string} 清理后的正文。
 */
function normalizeExtractedText(value) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 从 PowerPoint 压缩包中的幻灯片 XML 提取文字。
 *
 * @param {Buffer} buffer PPTX 文件二进制内容。
 * @returns {Promise<string>} 按幻灯片顺序组合的正文。
 */
async function extractPowerPointText(buffer) {
  /** archive 是 PPTX 对应的 ZIP 文档结构。 */
  const archive = await JSZip.loadAsync(buffer);
  /** slidePaths 是按数字顺序排列的幻灯片 XML 路径。 */
  const slidePaths = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => {
      /** leftNumber 是左侧幻灯片序号。 */
      const leftNumber = Number.parseInt(left.match(/\d+/)?.[0] ?? "0", 10);
      /** rightNumber 是右侧幻灯片序号。 */
      const rightNumber = Number.parseInt(right.match(/\d+/)?.[0] ?? "0", 10);
      return leftNumber - rightNumber;
    });
  /** slides 是所有幻灯片的纯文本列表。 */
  const slides = [];
  for (const [index, slidePath] of slidePaths.entries()) {
    /** slideXml 是单页幻灯片 XML。 */
    const slideXml = await archive.file(slidePath)?.async("text");
    if (!slideXml) continue;
    /** textRuns 是该幻灯片所有文本节点。 */
    const textRuns = [...slideXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(
      (match) => stripMarkup(match[1]),
    );
    slides.push(`第 ${index + 1} 页\n${textRuns.join(" ")}`);
  }
  return slides.join("\n\n");
}

/**
 * 从 Office XML 节点中提取全部文本节点。
 *
 * @param {string} xml XML 文本。
 * @returns {string[]} 已解码的文本节点。
 */
function extractXmlTextNodes(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) =>
    stripMarkup(match[1]),
  );
}

/**
 * 从 XLSX 压缩包提取共享字符串与单元格值。
 *
 * @param {Buffer} buffer XLSX 文件二进制内容。
 * @returns {Promise<string>} 按工作表组合的文本。
 */
async function extractSpreadsheetText(buffer) {
  /** archive 是 XLSX 对应的 ZIP 文档结构。 */
  const archive = await JSZip.loadAsync(buffer);
  /** sharedStringsXml 是可选的共享字符串 XML。 */
  const sharedStringsXml = await archive
    .file("xl/sharedStrings.xml")
    ?.async("text");
  /** sharedStrings 是按索引排列的共享字符串。 */
  const sharedStrings = sharedStringsXml
    ? [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
        extractXmlTextNodes(match[1]).join(""),
      )
    : [];
  /** worksheetPaths 是按名称排列的工作表 XML 路径。 */
  const worksheetPaths = Object.keys(archive.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
  /** worksheets 是所有工作表的纯文本。 */
  const worksheets = [];
  for (const [index, worksheetPath] of worksheetPaths.entries()) {
    /** worksheetXml 是当前工作表的 XML 内容。 */
    const worksheetXml = await archive.file(worksheetPath)?.async("text");
    if (!worksheetXml) continue;
    /** rows 是当前工作表的行文本。 */
    const rows = [...worksheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map(
      (rowMatch) => {
        /** cells 是当前行的单元格文本。 */
        const cells = [...rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map(
          (cellMatch) => {
            /** attributes 是单元格 XML 属性。 */
            const attributes = cellMatch[1];
            /** body 是单元格 XML 正文。 */
            const body = cellMatch[2];
            /** value 是单元格底层值。 */
            const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
            if (/\bt="s"/.test(attributes)) {
              /** sharedIndex 是共享字符串表索引。 */
              const sharedIndex = Number.parseInt(value, 10);
              return sharedStrings[sharedIndex] ?? "";
            }
            if (/\bt="inlineStr"/.test(attributes)) {
              return extractXmlTextNodes(body).join("");
            }
            return stripMarkup(value);
          },
        );
        return cells.join("\t");
      },
    );
    worksheets.push(`工作表 ${index + 1}\n${rows.join("\n")}`);
  }
  return worksheets.join("\n\n");
}

/**
 * 根据扩展名提取文档正文。
 *
 * @param {{ buffer: Buffer, originalName: string, mimeType: string }} input 文件信息。
 * @returns {Promise<{ text: string, status: string }>} 提取结果。
 */
export async function extractDocumentText(input) {
  /** extension 是统一为小写的文件扩展名。 */
  const extension = path.extname(input.originalName).toLowerCase();
  try {
    if (textExtensions.has(extension)) {
      return {
        text: normalizeExtractedText(input.buffer.toString("utf8")),
        status: "complete",
      };
    }
    if (extension === ".html" || extension === ".htm") {
      return {
        text: normalizeExtractedText(stripMarkup(input.buffer.toString("utf8"))),
        status: "complete",
      };
    }
    if (extension === ".pdf") {
      /** result 是 pdf-parse 返回的文本与页数信息。 */
      const result = await pdfParse(input.buffer);
      return {
        text: normalizeExtractedText(result.text),
        status: result.text.trim() ? "complete" : "empty",
      };
    }
    if (extension === ".docx") {
      /** result 是 mammoth 返回的 Word 纯文本。 */
      const result = await mammoth.extractRawText({ buffer: input.buffer });
      return {
        text: normalizeExtractedText(result.value),
        status: result.value.trim() ? "complete" : "empty",
      };
    }
    if (extension === ".xlsx") {
      /** spreadsheetText 是工作簿所有单元格的组合文本。 */
      const spreadsheetText = await extractSpreadsheetText(input.buffer);
      return {
        text: normalizeExtractedText(spreadsheetText),
        status: spreadsheetText.trim() ? "complete" : "empty",
      };
    }
    if (extension === ".pptx") {
      /** presentationText 是所有幻灯片文本。 */
      const presentationText = await extractPowerPointText(input.buffer);
      return {
        text: normalizeExtractedText(presentationText),
        status: presentationText.trim() ? "complete" : "empty",
      };
    }
    return { text: "", status: "unsupported" };
  } catch (error) {
    /** errorName 是适合记录在状态中的安全错误名称。 */
    const errorName =
      error instanceof Error ? error.name.toLowerCase() : "unknown";
    return { text: "", status: `failed:${errorName}` };
  }
}

/**
 * 将 Word 文档转换为保留标题、段落、列表、表格和图片结构的 HTML。
 *
 * 返回内容仍会在浏览器端经过标签白名单重建，避免直接注入原始 HTML。
 *
 * @param {Buffer} buffer DOCX 文件二进制内容。
 * @returns {Promise<string>} Mammoth 转换后的结构化 HTML。
 */
export async function extractWordHtml(buffer) {
  /** result 是 Mammoth 根据 Word 原始语义结构生成的 HTML。 */
  const result = await mammoth.convertToHtml({ buffer });
  return result.value;
}

/**
 * 从文档正文生成简短摘要。
 *
 * @param {string} text 已提取正文。
 * @param {string} fallbackName 无正文时使用的文件名。
 * @returns {string} 不超过 220 字符的简介。
 */
export function createDocumentSummary(text, fallbackName) {
  /** normalizedText 是合并连续空白后的单行正文。 */
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) return `已保存原始文件：${fallbackName}`;
  return `${normalizedText.slice(0, 220)}${normalizedText.length > 220 ? "…" : ""}`;
}
