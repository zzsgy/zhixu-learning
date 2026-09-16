/**
 * PDF 阅读页的图区识别。
 *
 * 这里只处理坐标和文本特征，不读取文件或修改数据，便于用真实页面特征做回归测试。
 */

/** 题注“图 0-1”、“图1.2”和英文 Figure 形式。 */
const figureCaptionPattern = /^(?:图\s*\d+(?:\s*[-－—.]\s*\d+|(?:\.\d+)+)?|figure\s*\d+(?:\.\d+)*)/i;

/**
 * 识别图表上方已回到正文段落的第一行。
 *
 * 正文通常从页面左边距附近开始，字号与题注相当，且文本足够长。
 * 图内标签多为居中/缩进短行，不应提前终止裁剪区。
 */
function looksLikeBodyLine(line, pageWidth, captionFontSize) {
  const text = String(line?.text || "").replace(/\s+/g, " ").trim();
  const x = Number(line?.x);
  const fontSize = Number(line?.fontSize);
  if (!text || !Number.isFinite(x) || !Number.isFinite(fontSize)) return false;
  return x <= pageWidth * 0.17
    && fontSize >= Math.max(8.2, captionFontSize * 0.82)
    && [...text].length >= 18
    && !figureCaptionPattern.test(text);
}

/**
 * 根据 PDF 文字坐标生成可安全裁剪的局部图区。
 *
 * 单栏页的图默认按跨栏处理；双栏页只在图例同时覆盖两栏时扩展。
 * 这避免把整页居中架构图错剪成左半幅，也不会把图上方的正文一起裁入。
 *
 * @param {Record<string, unknown>} layout PDF.js 页级版面特征。
 * @returns {Array<Record<string, unknown>>} 从页面左上角计算的裁剪区。
 */
export function createPdfFigureRegions(layout) {
  const pageWidth = Number(layout?.pageWidth) || 0;
  const pageHeight = Number(layout?.pageHeight) || 0;
  if (pageWidth < 100 || pageHeight < 100) return [];
  const isMultiColumn = Boolean(layout?.multiColumn);
  const bodyLines = Array.isArray(layout?.structuredText?.body)
    ? layout.structuredText.body
    : [];
  const columnEntries = ["left", "right"].map((column) => ({
    column,
    lines: Array.isArray(layout?.structuredText?.columns?.[column])
      ? layout.structuredText.columns[column]
      : [],
  }));
  const captionGroups = isMultiColumn
    ? columnEntries
    : [{ column: "both", lines: bodyLines }];
  const regions = [];

  for (const { column: columnName, lines } of captionGroups) {
    const captions = lines
      .filter((line) => figureCaptionPattern.test(String(line?.text || "").trim()))
      .sort((left, right) => Number(right.y) - Number(left.y));
    captions.forEach((caption, captionIndex) => {
      const previousCaption = captions[captionIndex - 1];
      const defaultTopUserCoordinate = captionIndex === 0
        ? pageHeight * 0.948
        : Number(previousCaption.y) - Math.max(18, Number(previousCaption.fontSize) * 2.6);
      const bottomUserCoordinate = Number(caption.y)
        - Math.max(14, Number(caption.fontSize) * 2.2);
      const candidateLines = isMultiColumn
        ? columnEntries.flatMap(({ column, lines: candidateLines }) => (
          candidateLines.map((line) => ({ ...line, column }))
        ))
        : bodyLines.map((line) => ({ ...line, column: "both" }));
      const nearbyLines = candidateLines
        .filter((line) => (
          Number(line.y) > Number(caption.y) + 8
          && Number(line.y) < defaultTopUserCoordinate
        ))
        .sort((left, right) => Number(left.y) - Number(right.y));
      const numericLabels = nearbyLines.filter((line) => (
        /^(?:\d{1,2}(?:\s+|$)){1,12}$/.test(String(line.text || "").trim())
      ));
      const labelColumns = new Set(numericLabels.map((line) => line.column));
      /** 单栏页的图必须使用整行；真双栏页仍依据两侧图例判断。 */
      const spansBothColumns = !isMultiColumn || labelColumns.size > 1;
      const relevantLines = spansBothColumns
        ? nearbyLines
        : nearbyLines.filter((line) => line.column === columnName);
      const nearestBodyLine = relevantLines.find((line) => (
        looksLikeBodyLine(line, pageWidth, Number(caption.fontSize) || 9)
      ));
      const topUserCoordinate = Math.min(
        defaultTopUserCoordinate,
        nearestBodyLine
          ? Number(nearestBodyLine.y)
            - Math.max(16, Number(nearestBodyLine.fontSize) * 1.8)
          : defaultTopUserCoordinate,
      );
      const x = spansBothColumns
        ? pageWidth * 0.065
        : (columnName === "left" ? pageWidth * 0.065 : pageWidth * 0.5);
      const width = pageWidth * (spansBothColumns ? 0.87 : 0.435);
      const height = topUserCoordinate - bottomUserCoordinate;
      if (height < 45) return;
      regions.push({
        regionIndex: regions.length,
        column: spansBothColumns ? "both" : columnName,
        caption: String(caption.text || "").replace(/\s+/g, " ").trim(),
        x: Number(x.toFixed(2)),
        y: Number((pageHeight - topUserCoordinate).toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
      });
    });
  }
  return regions;
}
