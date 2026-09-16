/**
 * 返回一页 PDF 坐标文字的可视字号统计。
 *
 * PDF 中的流程图、信息图经常把图内标签暴露成大量 3–6pt 的文字行。
 * 这些行如果继续按正文双栏重排，会把标题、作者、图注和图中文字交错在一起。
 *
 * @param {Record<string, unknown>} layout PDF.js 页级版面信息。
 * @returns {{ lineCount: number, tinyLineCount: number, tinyLineRatio: number }} 字号统计。
 */
export function getPdfPageLineStatistics(layout) {
  const structuredText = layout?.structuredText || {};
  const lines = [
    ...(structuredText.header || []),
    ...(structuredText.columns?.left || []),
    ...(structuredText.columns?.right || []),
    ...(structuredText.footer || []),
  ];
  const tinyLineCount = lines.filter((line) => {
    const fontSize = Number(line?.fontSize);
    return Number.isFinite(fontSize) && fontSize <= 6.5;
  }).length;
  return {
    lineCount: lines.length,
    tinyLineCount,
    tinyLineRatio: lines.length > 0 ? tinyLineCount / lines.length : 0,
  };
}

/**
 * 判断复杂 PDF 页是否应该直接保留原页版式。
 *
 * 这里只处理两类重排置信度很低的页面：
 * 1. 大量小字号标签组成的流程图、信息图；
 * 2. 被 pdfimages 拆成大量零散图片资源的复合页面。
 * 已识别出可靠局部图框的页面不改成整页图，避免影响现有正常图文重排。
 *
 * @param {Record<string, unknown>} layout PDF.js 页级版面信息。
 * @param {Array<Record<string, unknown>>} figures 本页内嵌图片。
 * @param {Array<Record<string, unknown>>} figureRegions 已识别的可靠图框。
 * @returns {boolean} 是否使用原页保真显示。
 */
export function shouldUsePdfPageFacsimile(layout, figures = [], figureRegions = []) {
  if (figureRegions.length > 0) return false;
  const { lineCount, tinyLineCount, tinyLineRatio } = getPdfPageLineStatistics(layout);
  const denseDiagramLabels = lineCount >= 60
    && tinyLineCount >= 20
    && tinyLineRatio >= 0.28;
  const fragmentedIllustrations = lineCount >= 40 && figures.length >= 8;
  return denseDiagramLabels || fragmentedIllustrations;
}

/**
 * 创建整页 PDF 的安全裁剪区域，供按需栅格化显示。
 *
 * @param {Record<string, unknown>} layout PDF.js 页级版面信息。
 * @returns {Array<Record<string, unknown>>} 单个整页区域；尺寸无效时返回空数组。
 */
export function createPdfPageFacsimileRegion(layout) {
  const width = Number(layout?.pageWidth) || 0;
  const height = Number(layout?.pageHeight) || 0;
  if (width < 100 || height < 100) return [];
  return [{
    regionIndex: 0,
    column: "both",
    caption: "",
    x: 0,
    y: 0,
    width: Number(width.toFixed(2)),
    height: Number(height.toFixed(2)),
  }];
}
