/**
 * 上传文档正文提取模块。
 *
 * 支持 PDF、Word、Excel、PowerPoint、纯文本、Markdown、HTML、JSON 和 CSV。
 */
import path from "node:path";
import { createRequire } from "node:module";
import JSZip from "jszip";
import mammoth from "mammoth";
// 直接导入解析实现，避免 pdf-parse 包入口在非打包环境中执行自带示例文件。
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/** require 用于复用 pdf-parse 随包提供的 PDF.js 读取原生书签。 */
const require = createRequire(import.meta.url);
/** pdfJs 是与正文提取器版本一致的 PDF.js，避免再引入一套解析依赖。 */
const pdfJs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
pdfJs.disableWorker = true;

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
 * 按 pdf-parse 的原始版面顺序提取单页文字。
 *
 * @param {object} pageData PDF.js 单页对象。
 * @returns {Promise<string>} 保留行边界的页面正文。
 */
async function renderPdfPageText(pageData) {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  let lastY;
  let text = "";
  for (const item of textContent.items) {
    const currentY = item.transform?.[5];
    text += lastY === undefined || lastY === currentY ? item.str : `\n${item.str}`;
    lastY = currentY;
  }
  return text;
}

/**
 * 将 PDF.js 文字项按视觉行归组，供复杂表格区域识别使用。
 *
 * @param {Array<Record<string, unknown>>} items PDF.js 文字项。
 * @returns {Array<Record<string, unknown>>} 从页面顶部到底部排列的文字行。
 */
function groupPdfTextRows(items) {
  const rows = new Map();
  for (const item of items) {
    const text = String(item.str || "");
    const x = Number(item.transform?.[4]);
    const y = Number(item.transform?.[5]);
    if (!text.trim() || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const rowKey = Math.round(y);
    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey).push(item);
  }
  return [...rows.entries()]
    .map(([rowKey, rowItems]) => {
      const sortedItems = rowItems.sort(
        (left, right) => Number(left.transform?.[4]) - Number(right.transform?.[4]),
      );
      return {
        y: Number(rowKey),
        items: sortedItems,
        text: sortedItems.map((item) => String(item.str || "")).join("").replace(/\s+/g, " ").trim(),
      };
    })
    .sort((left, right) => right.y - left.y);
}

/**
 * 根据文字坐标识别不适合扁平重排的多栏和编号标注版面。
 *
 * 这里只记录页级结构信号；是否使用原页保真模式还会在服务端结合内嵌图片数量判断。
 *
 * @param {{ pageWidth: number, pageHeight: number, rows: Array<Record<string, unknown>>, pageText: string }} input 页面结构。
 * @returns {{ pageWidth: number, pageHeight: number, textRowCount: number, splitRowCount: number, multiColumn: boolean, numberedCalloutCount: number, isolatedNumberCount: number }} 页级版面特征。
 */
export function detectPdfPageLayoutComplexity({ pageWidth, pageHeight, rows, pageText }) {
  const safePageWidth = Math.max(1, Number(pageWidth) || 1);
  const safeRows = Array.isArray(rows) ? rows : [];
  let splitRowCount = 0;
  let leftColumnRowCount = 0;
  let rightColumnRowCount = 0;
  for (const row of safeRows) {
    const items = [...(row.items || [])].sort(
      (left, right) => Number(left.transform?.[4]) - Number(right.transform?.[4]),
    );
    if (items.length === 0) continue;
    const firstX = Number(items[0].transform?.[4]) || 0;
    const lastItem = items.at(-1);
    const lastRight = (Number(lastItem.transform?.[4]) || 0) + (Number(lastItem.width) || 0);
    if (firstX < safePageWidth * 0.42 && lastRight < safePageWidth * 0.61) {
      leftColumnRowCount += 1;
    }
    if (firstX > safePageWidth * 0.39) rightColumnRowCount += 1;
    let previousRight = firstX + (Number(items[0].width) || 0);
    for (const item of items.slice(1)) {
      const itemX = Number(item.transform?.[4]) || 0;
      const gap = itemX - previousRight;
      if (
        gap >= safePageWidth * 0.1
        && previousRight < safePageWidth * 0.66
        && itemX > safePageWidth * 0.34
      ) {
        splitRowCount += 1;
        break;
      }
      previousRight = Math.max(previousRight, itemX + (Number(item.width) || 0));
    }
  }
  const textLines = String(pageText || "").replace(/\r\n?/g, "\n").split("\n");
  const numberedCalloutCount = textLines.filter((line) => /^\s*\d{1,2}[.、)]\s*\S/.test(line)).length;
  const isolatedNumberCount = textLines.filter((line) => /^\s*\d{1,2}\s*$/.test(line)).length;
  return {
    pageWidth: Number(safePageWidth.toFixed(2)),
    pageHeight: Number((Number(pageHeight) || 0).toFixed(2)),
    textRowCount: safeRows.length,
    splitRowCount,
    multiColumn: splitRowCount >= 3 || (leftColumnRowCount >= 5 && rightColumnRowCount >= 5),
    numberedCalloutCount,
    isolatedNumberCount,
  };
}

/**
 * 把复杂 PDF 页的坐标文字拆成可重排、可复制的页眉、左右栏和页脚。
 *
 * 这里只保留文字及相对顺序；插图仍由服务端从 PDF 内嵌资源中提取，不把整页栅格化。
 *
 * @param {{ pageWidth: number, pageHeight: number, rows: Array<Record<string, unknown>> }} input 页面结构。
 * @returns {{ header: Array<Record<string, unknown>>, columns: { left: Array<Record<string, unknown>>, right: Array<Record<string, unknown>> }, footer: Array<Record<string, unknown>> }} 结构化文字栏。
 */
export function createPdfStructuredTextColumns({ pageWidth, pageHeight, rows }) {
  const safePageWidth = Math.max(1, Number(pageWidth) || 1);
  const safePageHeight = Math.max(1, Number(pageHeight) || 1);
  const middleX = safePageWidth / 2;
  const result = { header: [], columns: { left: [], right: [] }, footer: [] };

  function createLine(items) {
    const sortedItems = [...items].sort(
      (left, right) => Number(left.transform?.[4]) - Number(right.transform?.[4]),
    );
    const text = sortedItems
      .map((item) => String(item.str || ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return null;
    return {
      text,
      x: Number((Number(sortedItems[0].transform?.[4]) || 0).toFixed(2)),
      y: Number((Number(sortedItems[0].transform?.[5]) || 0).toFixed(2)),
      fontSize: Number(Math.max(
        1,
        ...sortedItems.map((item) => Math.abs(Number(item.transform?.[3]) || Number(item.height) || 0)),
      ).toFixed(2)),
    };
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const rowY = Number(row.y) || 0;
    const rowItems = Array.isArray(row.items) ? row.items : [];
    if (rowY >= safePageHeight * 0.955) {
      const line = createLine(rowItems);
      if (line) result.header.push(line);
      continue;
    }
    if (rowY <= safePageHeight * 0.04) {
      const line = createLine(rowItems);
      if (line) result.footer.push(line);
      continue;
    }
    const leftItems = rowItems.filter((item) => {
      const x = Number(item.transform?.[4]) || 0;
      return x + (Number(item.width) || 0) / 2 < middleX;
    }).filter((item) => {
      const itemText = String(item.str || "").trim();
      const itemX = Number(item.transform?.[4]) || 0;
      /** 删除爆炸图引线旁的孤立数字，但保留右侧“10. 阀体”一类清单文字项。 */
      return !(
        /^\d{1,2}$/.test(itemText)
        && itemX < safePageWidth * 0.24
        && rowY > safePageHeight * 0.65
      );
    });
    const rightItems = rowItems.filter((item) => {
      const x = Number(item.transform?.[4]) || 0;
      return x + (Number(item.width) || 0) / 2 >= middleX;
    });
    for (const [columnName, items] of [["left", leftItems], ["right", rightItems]]) {
      const line = createLine(items);
      if (!line) continue;
      result.columns[columnName].push(line);
    }
  }
  return result;
}

/**
 * 识别带“表 3-8”一类题注的 PDF 表格，并计算只包含表格的裁剪区域。
 *
 * @param {object} pageData PDF.js 单页对象。
 * @param {Array<Record<string, unknown>>} items PDF.js 文字项。
 * @returns {Array<Record<string, unknown>>} 本页可安全裁剪的表格区域。
 */
function detectPdfTableRegions(pageData, items) {
  const viewport = pageData.getViewport(1);
  const rows = groupPdfTextRows(items);
  const regions = [];
  for (let captionIndex = 0; captionIndex < rows.length; captionIndex += 1) {
    const captionRow = rows[captionIndex];
    if (!/^(?:表|table)\s*\d+\s*[-－—.]\s*\d+/i.test(captionRow.text)) continue;
    let endIndex = Math.min(rows.length - 1, captionIndex + 28);
    for (let index = captionIndex + 4; index < endIndex; index += 1) {
      const gap = rows[index].y - rows[index + 1].y;
      if (gap >= 22) {
        endIndex = index;
        break;
      }
    }
    const tableRows = rows.slice(captionIndex, endIndex + 1);
    const hasColumnHeader = tableRows.slice(1, 9).some((row) => {
      let clusterCount = 0;
      let previousRight = -Infinity;
      for (const item of row.items) {
        const x = Number(item.transform?.[4]);
        const width = Math.max(0, Number(item.width) || 0);
        if (x > previousRight + 14) clusterCount += 1;
        previousRight = Math.max(previousRight, x + width);
      }
      return clusterCount >= 3;
    });
    if (tableRows.length < 5 || !hasColumnHeader) continue;
    const tableItems = tableRows.flatMap((row) => row.items);
    const left = Math.max(0, Math.min(...tableItems.map((item) => Number(item.transform?.[4]))) - 10);
    const right = Math.min(
      viewport.width,
      Math.max(...tableItems.map((item) => Number(item.transform?.[4]) + (Number(item.width) || 0))) + 10,
    );
    const topUserCoordinate = Math.min(
      viewport.height,
      Math.max(...tableItems.map((item) => Number(item.transform?.[5]) + (Number(item.height) || 0))) + 10,
    );
    const bottomUserCoordinate = Math.max(
      0,
      Math.min(...tableItems.map((item) => Number(item.transform?.[5]))) - 18,
    );
    if (right - left < 180 || topUserCoordinate - bottomUserCoordinate < 55) continue;
    regions.push({
      tableIndex: regions.length,
      caption: captionRow.text,
      x: Number(left.toFixed(2)),
      y: Number((viewport.height - topUserCoordinate).toFixed(2)),
      width: Number((right - left).toFixed(2)),
      height: Number((topUserCoordinate - bottomUserCoordinate).toFixed(2)),
      pageWidth: Number(viewport.width.toFixed(2)),
      pageHeight: Number(viewport.height.toFixed(2)),
      sourceTop: bottomUserCoordinate,
      sourceBottom: topUserCoordinate,
    });
  }
  return regions;
}

/**
 * 生成单页阅读正文，并用安全标记替换已识别的复杂表格文字碎片。
 *
 * @param {object} pageData PDF.js 单页对象。
 * @param {number} pageNumber 从 1 开始的物理页码。
 * @returns {Promise<{ text: string, tables: Array<Record<string, unknown>>, layout: Record<string, unknown> }>} 单页正文、表格和版面元数据。
 */
async function renderPdfPageReadingData(pageData, pageNumber) {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  const tables = detectPdfTableRegions(pageData, textContent.items);
  const insertedTables = new Set();
  let lastY;
  let text = "";
  for (const item of textContent.items) {
    const itemX = Number(item.transform?.[4]);
    const itemY = Number(item.transform?.[5]);
    const itemCenterX = itemX + (Number(item.width) || 0) / 2;
    const table = tables.find((candidate) => (
      itemY >= candidate.sourceTop
      && itemY <= candidate.sourceBottom
      && itemCenterX >= candidate.x
      && itemCenterX <= candidate.x + candidate.width
    ));
    if (table) {
      if (!insertedTables.has(table.tableIndex)) {
        text += `\n[[ZHIXU_PDF_TABLE:${pageNumber}:${table.tableIndex}]]\n`;
        insertedTables.add(table.tableIndex);
      }
      lastY = undefined;
      continue;
    }
    const currentY = item.transform?.[5];
    text += lastY === undefined || lastY === currentY ? item.str : `\n${item.str}`;
    lastY = currentY;
  }
  const viewport = pageData.getViewport(1);
  const textRows = groupPdfTextRows(textContent.items);
  const layout = detectPdfPageLayoutComplexity({
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    rows: textRows,
    pageText: text,
  });
  layout.structuredText = createPdfStructuredTextColumns({
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    rows: textRows,
  });
  return {
    text,
    tables: tables.map(({ sourceTop, sourceBottom, ...table }) => table),
    layout,
  };
}

/**
 * 为 PDF 阅读页生成带物理页码标记的正文。
 *
 * 标记只用于当前阅读响应，不写入搜索索引和摘要。
 *
 * @param {Buffer} buffer PDF 文件二进制内容。
 * @returns {Promise<string>} 含页码标记的完整正文。
 */
export async function extractPdfTextWithPageMarkers(buffer) {
  const readingStructure = await extractPdfReadingStructure(buffer);
  return readingStructure.markedText;
}

/**
 * 读取 PDF 内嵌书签并解析到真实物理页码。
 *
 * @param {Buffer} buffer PDF 文件二进制内容。
 * @returns {Promise<Array<{ title: string, level: number, pageNumber: number }>>} 展平后的原生书签。
 */
async function extractPdfOutline(buffer) {
  /** pdfDocument 是只用于读取目录目的地的轻量 PDF.js 文档。 */
  const pdfDocument = await pdfJs.getDocument(buffer);
  try {
    /** outline 是 PDF 作者写入文件的原生层级书签。 */
    const outline = await pdfDocument.getOutline() || [];
    const flattenedOutline = [];
    /** appendItems 保留原始书签顺序和层级。 */
    async function appendItems(items, level) {
      for (const item of items || []) {
        const title = String(item.title || "").replace(/\s+/g, " ").trim();
        let destination = item.dest;
        if (typeof destination === "string") {
          destination = await pdfDocument.getDestination(destination);
        }
        let pageNumber = 0;
        if (Array.isArray(destination) && destination[0] != null) {
          pageNumber = Number.isInteger(destination[0])
            ? destination[0] + 1
            : await pdfDocument.getPageIndex(destination[0]) + 1;
        }
        if (title && Number.isInteger(pageNumber) && pageNumber > 0) {
          flattenedOutline.push({ title, level, pageNumber });
        }
        if (item.items?.length) await appendItems(item.items, level + 1);
      }
    }
    await appendItems(outline, 0);
    return flattenedOutline;
  } finally {
    await pdfDocument.destroy();
  }
}

/**
 * 为 PDF 阅读页同时生成逐页正文、真实页码标记和复杂表格裁剪信息。
 *
 * @param {Buffer} buffer PDF 文件二进制内容。
 * @returns {Promise<{ markedText: string, tablesByPage: Record<string, Array<Record<string, unknown>>>, pageLayouts: Record<string, Record<string, unknown>>, outline: Array<{ title: string, level: number, pageNumber: number }> }>} 阅读结构。
 */
export async function extractPdfReadingStructure(buffer) {
  let pageNumber = 0;
  const tablesByPage = {};
  const pageLayouts = {};
  /** outlinePromise 与逐页正文提取并行读取原生书签，失败时仍可回退到正文标题识别。 */
  const outlinePromise = extractPdfOutline(buffer).catch(() => []);
  const result = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      pageNumber += 1;
      const pageDataResult = await renderPdfPageReadingData(pageData, pageNumber);
      if (pageDataResult.tables.length > 0) tablesByPage[pageNumber] = pageDataResult.tables;
      pageLayouts[pageNumber] = pageDataResult.layout;
      return `[[ZHIXU_PDF_PAGE:${pageNumber}]]\n${pageDataResult.text}`;
    },
  });
  return {
    markedText: normalizeExtractedText(result.text),
    tablesByPage,
    pageLayouts,
    outline: await outlinePromise,
  };
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
