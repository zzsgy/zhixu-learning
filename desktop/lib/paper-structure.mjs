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
      tableCount: 0,
      headingCount: 0,
      formulaCount: 0,
      semanticSubscriptCount: 0,
      semanticSuperscriptCount: 0,
      declaredFigureCount: 0,
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
  const declaredFigures = new Set(
    Array.from(root.textContent?.matchAll(/\b(?:fig(?:ure)?\.?)[\s\u00a0]*(\d+[a-z]?)/gi) || [],
      (match) => match[1].toLowerCase()),
  );
  return {
    imageCount: root.querySelectorAll("img").length,
    tableCount: root.querySelectorAll("table").length,
    headingCount: root.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    formulaCount: latexCount + semanticSubscriptCount + semanticSuperscriptCount,
    semanticSubscriptCount,
    semanticSuperscriptCount,
    declaredFigureCount: figureCaptions > 0 ? figureCaptions : declaredFigures.size,
  };
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
  for (const [field, label] of [
    ["imageCount", "图片"],
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
