/**
 * 论文图文结构清单与翻译完整性校验。
 *
 * 结构清单只统计可核验的语义资产，不尝试根据纯文本猜测原图或公式。
 */
import { parseHTML } from "linkedom";

/** LaTeX 定界符匹配器，与阅读页 KaTeX 支持范围保持一致。 */
const latexPattern = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)(?:\\.|[^$\r\n])+?\$/g;

/**
 * 把纯文本转换为最低限度的安全语义 HTML；不会伪造图片或公式。
 *
 * @param {string} sourceText 论文纯文本。
 * @returns {string} 段落化 HTML。
 */
export function createPaperHtmlFromPlainText(sourceText) {
  const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
  return String(sourceText || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");
}

/**
 * 统计论文 HTML 中必须在译文里保持的图、表、公式和章节结构。
 *
 * @param {string} sourceHtml 安全语义 HTML。
 * @returns {Record<string, number>} 结构计数。
 */
export function analyzePaperHtmlStructure(sourceHtml) {
  const html = String(sourceHtml || "");
  const { document } = parseHTML(`<main>${html}</main>`);
  const root = document.querySelector("main");
  if (!root) {
    return {
      imageCount: 0,
      uniqueImageCount: 0,
      tableCount: 0,
      headingCount: 0,
      formulaCount: 0,
      semanticSubscriptCount: 0,
      semanticSuperscriptCount: 0,
      declaredFigureCount: 0,
      figureCaptionCount: 0,
      imageFigureCount: 0,
      tableFigureCount: 0,
      emptyFigureCount: 0,
    };
  }
  /** citationSuperscripts 不属于数学公式，不纳入公式完整性门禁。 */
  const citationSuperscripts = Array.from(root.querySelectorAll("sup")).filter(
    (element) => element.querySelector("a"),
  );
  const allSuperscripts = Array.from(root.querySelectorAll("sup"));
  const semanticSuperscriptCount = Math.max(
    0,
    allSuperscripts.length - citationSuperscripts.length,
  );
  const semanticSubscriptCount = root.querySelectorAll("sub").length;
  const latexCount = (html.match(latexPattern) || []).length;
  const figureCaptions = root.querySelectorAll("figcaption").length;
  const figures = Array.from(root.querySelectorAll("figure"));
  const images = Array.from(root.querySelectorAll("img"));
  const uniqueImageSources = new Set(
    images.map((image) => String(image.getAttribute("src") || "").trim()).filter(Boolean),
  );
  const ownsElement = (figure, selector) => Array.from(figure.querySelectorAll(selector))
    .some((element) => element.closest("figure") === figure);
  const imageFigureCount = figures.filter((figure) => ownsElement(figure, "img")).length;
  const tableFigureCount = figures.filter((figure) => ownsElement(figure, "table")).length;
  const emptyFigureCount = figures.filter((figure) => (
    Array.from(figure.querySelectorAll("figcaption")).some((caption) => caption.closest("figure") === figure)
    && !ownsElement(figure, "img, table")
  )).length;
  const declaredFigures = new Set(
    Array.from(root.textContent?.matchAll(/\b(?:fig(?:ure)?\.?)[\s\u00a0]*(\d+[a-z]?)/gi) || [],
      (match) => match[1].toLowerCase()),
  );
  return {
    imageCount: images.length,
    uniqueImageCount: uniqueImageSources.size,
    tableCount: root.querySelectorAll("table").length,
    headingCount: root.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    formulaCount: latexCount + semanticSubscriptCount + semanticSuperscriptCount,
    semanticSubscriptCount,
    semanticSuperscriptCount,
    declaredFigureCount: figureCaptions > 0 ? figureCaptions : declaredFigures.size,
    figureCaptionCount: figureCaptions,
    imageFigureCount,
    tableFigureCount,
    emptyFigureCount,
  };
}

/** @param {string} caption @returns {string} */
function readFigureLabel(caption) {
  return String(caption || "").replace(/\s+/g, " ").trim()
    .match(/^(?:figure|fig\.?|图)\s*(\d+[a-z]?)/i)?.[1]?.toLowerCase() || "";
}

/**
 * 根据图号把来源论文图补到译文题注前。新翻译通常已由媒体锚点保留图片；本函数
 * 也能修复旧译文，且只复制来源中已安全清洗的 HTTPS 图片。
 *
 * @param {string} sourceHtml 论文英文安全 HTML。
 * @param {string} translatedHtml 论文中文语义 HTML。
 * @returns {string} 补齐图片后的译文 HTML。
 */
export function restorePaperFiguresByCaption(sourceHtml, translatedHtml) {
  const { document: sourceDocument } = parseHTML(`<main>${String(sourceHtml || "")}</main>`);
  const { document: translatedDocument } = parseHTML(`<main>${String(translatedHtml || "")}</main>`);
  const sourceRoot = sourceDocument.querySelector("main");
  const translatedRoot = translatedDocument.querySelector("main");
  if (!sourceRoot || !translatedRoot) return String(translatedHtml || "");
  const existingSources = new Set(Array.from(translatedRoot.querySelectorAll("img"), (image) => image.getAttribute("src") || ""));
  const translatedCaptions = new Map();
  for (const candidate of Array.from(translatedRoot.querySelectorAll("p, figcaption"))) {
    const label = readFigureLabel(candidate.textContent || "");
    if (label && !translatedCaptions.has(label)) translatedCaptions.set(label, candidate);
  }
  for (const figure of Array.from(sourceRoot.querySelectorAll("figure"))) {
    const caption = figure.querySelector("figcaption");
    const label = readFigureLabel(caption?.textContent || "");
    const targetCaption = translatedCaptions.get(label);
    if (!label || !targetCaption) continue;
    for (const image of Array.from(figure.querySelectorAll("img"))) {
      const source = image.getAttribute("src") || "";
      if (!/^https:\/\//i.test(source) || existingSources.has(source)) continue;
      const safeImage = translatedDocument.createElement("img");
      safeImage.setAttribute("src", source);
      const alternativeText = image.getAttribute("alt") || caption?.textContent || `Figure ${label}`;
      safeImage.setAttribute("alt", String(alternativeText).replace(/\s+/g, " ").trim().slice(0, 500));
      targetCaption.before(safeImage);
      existingSources.add(source);
    }
  }
  return translatedRoot.innerHTML.trim();
}

/**
 * 规范论文译文中由 MathML 后备层造成的相邻重复上下标，并约束表格跨列属性。
 *
 * @param {string} translatedHtml 论文中文语义 HTML。
 * @returns {string} 规范后的安全语义 HTML。
 */
export function normalizePaperTranslationHtml(translatedHtml) {
  const { document } = parseHTML(`<main>${String(translatedHtml || "")}</main>`);
  const root = document.querySelector("main");
  if (!root) return "";
  for (const script of Array.from(root.querySelectorAll("sup, sub"))) {
    let sibling = script.nextElementSibling;
    while (
      sibling
      && sibling.tagName === script.tagName
      && String(sibling.textContent || "").trim() === String(script.textContent || "").trim()
    ) {
      const duplicate = sibling;
      sibling = sibling.nextElementSibling;
      duplicate.remove();
    }
  }
  for (const cell of Array.from(root.querySelectorAll("td, th"))) {
    for (const attributeName of ["colspan", "rowspan"]) {
      const value = Number(cell.getAttribute(attributeName));
      if (Number.isInteger(value) && value >= 1 && value <= 20) {
        cell.setAttribute(attributeName, String(value));
      } else {
        cell.removeAttribute(attributeName);
      }
    }
  }
  for (const table of Array.from(root.querySelectorAll("table"))) {
    const rows = Array.from(table.querySelectorAll("tr"));
    for (let index = 0; index < rows.length - 1; index += 1) {
      const cells = Array.from(rows[index].children).filter((element) => /^(TD|TH)$/.test(element.tagName));
      const nextCells = Array.from(rows[index + 1].children).filter((element) => /^(TD|TH)$/.test(element.tagName));
      if (cells.length === 1 && nextCells.length > 1 && !cells[0].hasAttribute("colspan")) {
        cells[0].setAttribute("colspan", String(Math.min(20, nextCells.length)));
      }
    }
  }
  for (const image of Array.from(root.querySelectorAll("img"))) {
    const source = image.getAttribute("src") || "";
    if (!/^https:\/\//i.test(source)) {
      image.remove();
      continue;
    }
    image.setAttribute("src", source);
  }
  return root.innerHTML.trim();
}

/**
 * 比较原文与译文结构；任何可核验资产缺失时拒绝“完整”状态。
 *
 * @param {Record<string, number>} source 原文结构清单。
 * @param {string} translatedHtml 中文语义 HTML。
 * @returns {{ fidelity: "complete" | "degraded", message: string, translation: Record<string, number>, missing: string[] }} 校验结果。
 */
export function validatePaperTranslationStructure(source, translatedHtml) {
  const expected = source && typeof source === "object" ? source : {};
  const translation = analyzePaperHtmlStructure(translatedHtml);
  const missing = [];
  const expectedImageField = Object.hasOwn(expected, "uniqueImageCount")
    ? "uniqueImageCount"
    : "imageCount";
  for (const [field, label] of [
    [expectedImageField, "图片"],
    ["tableCount", "表格"],
    ["formulaCount", "公式结构"],
    ["semanticSubscriptCount", "下标结构"],
    ["semanticSuperscriptCount", "上标结构"],
  ]) {
    const sourceCount = Math.max(0, Number(expected[field]) || 0);
    const translatedCount = Math.max(0, Number(translation[field]) || 0);
    if (translatedCount < sourceCount) {
      missing.push(`${label} ${translatedCount}/${sourceCount}`);
    }
  }
  /*
   * declaredFigureCount 只用于诊断来源页是否可能漏抓正文图，不能拿来和
   * <img> 数量做翻译门禁。论文常把 a/b/c 等多个子图合并在一张图片里，
   * 也会在正文中多次引用同一幅图；把图号数量当图片数量会产生大量误报。
   * 翻译是否丢图只比较上面的 source.imageCount 与 translation.imageCount。
   */
  const sourceHeadingCount = Math.max(0, Number(expected.headingCount) || 0);
  if (
    sourceHeadingCount >= 3
    && translation.headingCount < Math.max(1, Math.floor(sourceHeadingCount * 0.7))
  ) {
    missing.push(`章节标题 ${translation.headingCount}/${sourceHeadingCount}`);
  }
  /** sourceLimitation 表示来源本身只有 PDF 文字层等不可验证结构。 */
  const sourceLimitation = expected.structureFidelity === "degraded"
    ? String(expected.structureMessage || "原始来源未提供可验证的完整图文结构。").trim()
    : "";
  const fidelity = missing.length === 0 && !sourceLimitation ? "complete" : "degraded";
  const message = sourceLimitation
    ? missing.length > 0
      ? `${sourceLimitation}；译文结构仍缺少：${missing.join("，")}。`
      : sourceLimitation
    : missing.length > 0
      ? `结构未完整保留：${missing.join("，")}。`
      : "图片、公式、表格和章节结构已通过完整性校验。";
  return {
    fidelity,
    message,
    translation,
    missing,
  };
}
