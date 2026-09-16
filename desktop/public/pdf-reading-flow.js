/**
 * 为“单栏正文 + 局部图区”构建可重排的纵向流。
 *
 * 返回值只包含数据，不依赖 DOM，可在 Node 测试中校验顺序和裁剪范围。
 */

/** 合并旧版 API 中被中线拆开的同一视觉行。 */
function mergeLegacyColumnLines(pageData) {
  const sourceLines = ["left", "right"].flatMap((column) => (
    (pageData?.columns?.[column] || []).map((line) => ({ ...line, column }))
  ));
  const groups = [];
  for (const line of sourceLines.sort((left, right) => Number(right.y) - Number(left.y))) {
    let group = groups.find((candidate) => Math.abs(candidate.y - Number(line.y)) <= 0.6);
    if (!group) {
      group = { y: Number(line.y), lines: [] };
      groups.push(group);
    }
    group.lines.push(line);
  }
  return groups.map((group) => {
    const lines = group.lines.sort((left, right) => Number(left.x) - Number(right.x));
    const text = lines.reduce((combined, line) => {
      const current = String(line.text || "").trim();
      if (!current) return combined;
      if (!combined) return current;
      const needsSpace = /[A-Za-z0-9,.;:!?%)\]]$/.test(combined)
        && /^[A-Za-z0-9([]/.test(current);
      return `${combined}${needsSpace ? " " : ""}${current}`;
    }, "");
    return {
      text,
      x: Math.min(...lines.map((line) => Number(line.x) || 0)),
      y: group.y,
      fontSize: Math.max(...lines.map((line) => Number(line.fontSize) || 1)),
    };
  }).filter((line) => line.text);
}

/** 获取从页面顶部到底部排列的整行正文。 */
export function getSingleColumnPdfBodyLines(pageData) {
  const body = Array.isArray(pageData?.body) && pageData.body.length > 0
    ? pageData.body
    : mergeLegacyColumnLines(pageData);
  return [...body]
    .filter((line) => String(line?.text || "").trim())
    .sort((left, right) => Number(right.y) - Number(left.y));
}

/** 判断坐标文字是否已被局部图区覆盖。 */
function lineFallsInsideRegion(line, region, pageHeight) {
  const lineY = Number(line?.y);
  const topUserCoordinate = pageHeight - Number(region?.y);
  const bottomUserCoordinate = topUserCoordinate - Number(region?.height);
  return Number.isFinite(lineY)
    && Number.isFinite(topUserCoordinate)
    && Number.isFinite(bottomUserCoordinate)
    && lineY >= bottomUserCoordinate - 2
    && lineY <= topUserCoordinate + 2;
}

/**
 * 返回交错排列的文字段与图区。
 *
 * @param {Record<string, unknown>} pageData 单页结构化数据。
 * @param {Array<Record<string, unknown>>} figureRegions 当前需要展示的局部图区。
 * @returns {Array<{ type: "text", lines: Array<Record<string, unknown>> } | { type: "figure", figure: Record<string, unknown> }>}
 */
export function buildSingleColumnPdfFlow(pageData, figureRegions = []) {
  const pageHeight = Number(pageData?.pageHeight) || 0;
  if (pageHeight < 100) return [];
  const regions = (Array.isArray(figureRegions) ? figureRegions : [])
    .filter((region) => Number(region?.height) > 0 && Number(region?.width) > 0)
    .map((region) => ({ ...region, column: "both" }));
  const visibleLines = getSingleColumnPdfBodyLines(pageData)
    .filter((line) => !regions.some((region) => lineFallsInsideRegion(line, region, pageHeight)));
  const positionedItems = [
    ...visibleLines.map((line) => ({ type: "line", y: Number(line.y), line })),
    ...regions.map((figure) => ({
      type: "figure",
      y: pageHeight - Number(figure.y),
      figure,
    })),
  ].sort((left, right) => right.y - left.y);
  const flow = [];
  let pendingLines = [];
  const flushLines = () => {
    if (pendingLines.length === 0) return;
    flow.push({ type: "text", lines: pendingLines });
    pendingLines = [];
  };
  for (const item of positionedItems) {
    if (item.type === "line") {
      pendingLines.push(item.line);
      continue;
    }
    flushLines();
    flow.push({ type: "figure", figure: item.figure });
  }
  flushLines();
  return flow;
}
