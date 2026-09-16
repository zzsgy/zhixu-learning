/**
 * 判断文本块是否具有真正的数据清单结构。
 *
 * 英文字母本身不是数据特征；普通英文论文段落不能仅因拉丁字母占比高而被套用数据卡片。
 * 只有同时出现多组数值，并具有百分比、字段分隔、单位或很高的数字密度时才成立。
 *
 * @param {string} value 待判断文本。
 * @returns {boolean} 是否为高密度数据块。
 */
export function isDenseDataBlock(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < 90) return false;
  const numericTokens = text.match(/[-+]?\d+(?:[.,]\d+)?%?/g) || [];
  if (numericTokens.length < 6) return false;
  const numericCharacters = (text.match(/[\d%+−-]/g) || []).length;
  const numericRatio = numericCharacters / text.length;
  const percentCount = (text.match(/\d(?:[.,]\d+)?%/g) || []).length;
  const fieldSeparatorCount = (text.match(/[：:；;|｜]/g) || []).length;
  const unitCount = (text.match(/\b(?:ms|s|MB|GB|TB|Hz|kHz|MHz|GHz|req\/s|tokens?\/s)\b/gi) || []).length;
  return numericRatio >= 0.18
    || percentCount >= 2
    || fieldSeparatorCount >= 3
    || unitCount >= 3;
}

/**
 * 清理长文档阅读页的行级提取噪声。
 *
 * PDF 常把项目符号和正文拆成相邻两行；这里仅合并孤立项目符号与紧随其后的
 * 非结构行，不吞并普通段落，也不改写页码、表格等知序内部标记。
 *
 * @param {string} value 提取后的文档正文。
 * @returns {string[]} 保留自然空行的规范行。
 */
export function normalizeReadableLines(value) {
  const sourceLines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  const normalizedLines = [];
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    const isolatedBullet = line.match(/^([•●▪◦])$/);
    const nextLine = sourceLines[index + 1] || "";
    if (
      isolatedBullet
      && nextLine
      && !/^\[\[ZHIXU_[A-Z_]+:/.test(nextLine)
    ) {
      normalizedLines.push(`${isolatedBullet[1]} ${nextLine}`);
      index += 1;
      continue;
    }
    normalizedLines.push(line.replace(/^([•●▪◦])(?=\S)/, "$1 "));
  }
  return normalizedLines;
}

/**
 * 连接由 PDF 强制换行拆开的自然语言正文。
 *
 * 英文标点后的新文字项需要补空格，而行尾连字符应原样连到下一行。
 * 中文行连接不主动插入空格。
 *
 * @param {string[]} lines 同一自然段的行。
 * @returns {string} 规范后的自然段。
 */
export function joinReadableTextLines(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((combinedText, currentValue) => {
    const currentLine = String(currentValue || "").trim();
    if (!currentLine) return combinedText;
    if (!combinedText) return currentLine;
    const previousEndsWithHyphen = /[-‐‑‒–]$/.test(combinedText);
    const needsLatinSpace = !previousEndsWithHyphen
      && /[A-Za-z0-9,.;:!?%)\]]$/.test(combinedText)
      && /^[A-Za-z0-9([]/.test(currentLine);
    return `${combinedText}${needsLatinSpace ? " " : ""}${currentLine}`;
  }, "").trim();
}

/**
 * 用互斥优先级确定一个正文块的展示类型。
 *
 * @param {string} value 正文块。
 * @param {{ heading?: boolean }} options 已由上下文确认的标题信号。
 * @returns {"list" | "heading" | "data" | "paragraph"} 唯一展示类型。
 */
export function classifyReadableBlock(value, options = {}) {
  const text = String(value || "").trim();
  if (/^[•●▪◦]\s*\S/.test(text)) return "list";
  if (options.heading) return "heading";
  if (isDenseDataBlock(text)) return "data";
  return "paragraph";
}

/** 将 PDF 提取标题和目录标题规范成可比较的键。 */
export function normalizeReadableHeadingKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s*[（(]\d+\s*\/\s*\d+[）)]\s*$/, "")
    .replace(/\s+/g, "")
    .replace(/[：:]/g, ":")
    .trim();
}

/** 判断页首短行是否就是当前章节的权威目录标题。 */
export function matchesReadableChapterHeading(line, chapterTitle) {
  const lineKey = normalizeReadableHeadingKey(line);
  const chapterKey = normalizeReadableHeadingKey(chapterTitle);
  return Boolean(lineKey && chapterKey && lineKey === chapterKey);
}

/**
 * 把因性能分块产生的“(1/4)…(4/4)”合并为一个目录入口。
 * 正文仍保留所有分块，只精简导航噪声。
 */
export function createDocumentChapterTocEntries(chapters, maximumEntries = 500) {
  const entries = [];
  (Array.isArray(chapters) ? chapters : []).slice(0, maximumEntries)
    .forEach((chapter, chapterIndex) => {
      const rawTitle = String(chapter?.title || "").trim();
      const chunkMatch = rawTitle.match(/^(.*?)\s*（(\d+)\s*\/\s*(\d+)）$/);
      const title = (chunkMatch?.[1] || rawTitle).trim();
      const chunkIndex = Number(chunkMatch?.[2] || 1);
      const chunkCount = Number(chunkMatch?.[3] || 1);
      const previous = entries.at(-1);
      if (
        chunkMatch
        && chunkIndex > 1
        && previous
        && previous.title === title
        && previous.chunkCount === chunkCount
      ) {
        previous.endIndex = chapterIndex;
        return;
      }
      entries.push({
        title,
        startIndex: chapterIndex,
        endIndex: chapterIndex,
        chunkCount,
      });
    });
  return entries;
}
