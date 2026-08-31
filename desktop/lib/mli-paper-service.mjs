/**
 * 李沐“深度学习论文精读”目录同步服务。
 *
 * 数据只来自公开 GitHub README；同步后论文元数据、视频入口和中文说明均保存在本地 SQLite。
 */
import crypto from "node:crypto";
import { upsertCuratedPaper } from "./database.mjs";
import { fetchExternalResource } from "./article-parser.mjs";

/** mliReadmeUrl 是李沐论文精读目录的公开原始 Markdown 地址。 */
const mliReadmeUrl =
  "https://raw.githubusercontent.com/mli/paper-reading/main/README.md";
/** mliRepositoryUrl 是没有独立论文链接时使用的公开目录页。 */
const mliRepositoryUrl = "https://github.com/mli/paper-reading";
/** mliRequestTimeoutMilliseconds 是同步 GitHub 目录的最长等待时间。 */
const mliRequestTimeoutMilliseconds = 30_000;

/**
 * 移除 Markdown 图片、链接标记和 HTML 标签，保留可读标题。
 *
 * @param {string} markdown 原始 Markdown 片段。
 * @returns {string} 清理后的纯文本。
 */
function stripMarkdown(markdown) {
  return String(markdown || "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从标题单元格中找到第一个非图片链接。
 *
 * @param {string} markdown 标题单元格 Markdown。
 * @returns {string | null} 论文或资料链接。
 */
function readFirstContentLink(markdown) {
  /** linkMatches 是标题单元格中的全部 Markdown 链接。 */
  const linkMatches = [...String(markdown || "").matchAll(/(?<!!)\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g)];
  return linkMatches[0]?.[1] ?? null;
}

/**
 * 将 PDF 地址转换为更适合浏览的论文来源页。
 *
 * @param {string} sourceUrl 原始论文或 PDF 地址。
 * @returns {{ sourceUrl: string, pdfUrl: string | null }} 分离后的来源地址。
 */
function splitPaperUrls(sourceUrl) {
  if (!sourceUrl) return { sourceUrl: mliRepositoryUrl, pdfUrl: null };
  /** isPdf 表示该链接直接指向 PDF 文件。 */
  const isPdf = /\.pdf(?:$|[?#])/i.test(sourceUrl) || /arxiv\.org\/pdf\//i.test(sourceUrl);
  /** readableSourceUrl 是 arXiv PDF 对应的摘要页，其他链接保持不变。 */
  const readableSourceUrl = /arxiv\.org\/pdf\//i.test(sourceUrl)
    ? sourceUrl.replace("/pdf/", "/abs/").replace(/\.pdf(?=$|[?#])/i, "")
    : sourceUrl;
  return { sourceUrl: readableSourceUrl, pdfUrl: isPdf ? sourceUrl : null };
}

/**
 * 解析 README 中“录制完成的论文”表格。
 *
 * @param {string} readmeText 完整 README Markdown。
 * @returns {Record<string, unknown>[]} 李沐精读论文列表。
 */
export function parseMliPaperReadme(readmeText) {
  /** recordedSection 是录制完成表格到下一主标题之间的 Markdown。 */
  const recordedSection =
    String(readmeText || "").split("## 录制完成的论文")[1]?.split("\n## ")[0] ?? "";
  /** tableLines 是可能包含录制记录的 Markdown 表格行。 */
  const tableLines = recordedSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\|\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*\|/.test(line));
  return tableLines.map((line) => {
    /** cells 是表格中的日期、标题、封面、时长和视频单元格。 */
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    /** recordedDate 是原目录中的录制日期。 */
    const recordedDate = cells[0] || "";
    /** titleCell 是保留论文链接的标题单元格。 */
    const titleCell = cells[1] || "未命名精读";
    /** title 是移除 Markdown 标记后的中文展示标题。 */
    const title = stripMarkdown(titleCell);
    /** originalSourceUrl 是标题中的论文或资料地址。 */
    const originalSourceUrl = readFirstContentLink(titleCell);
    /** separatedUrls 是拆分后的来源页与 PDF 地址。 */
    const separatedUrls = splitPaperUrls(originalSourceUrl);
    /** videoCell 是可能包含多个视频平台链接的最后一列。 */
    const videoCell = cells.slice(4).join("|");
    /** bilibiliMatch 是哔哩哔哩视频页面地址。 */
    const bilibiliMatch = videoCell.match(
      /\]\((https?:\/\/www\.bilibili\.com\/video\/[^)\s]+)\)/i,
    );
    /** youtubeMatch 是 YouTube 或 youtu.be 视频页面地址。 */
    const youtubeMatch = videoCell.match(
      /\]\((https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^)\s]+)\)/i,
    );
    /** stableKey 是不随本地数据库变化的目录记录指纹。 */
    const stableKey = crypto
      .createHash("sha256")
      .update(`${recordedDate}\n${title}\n${separatedUrls.sourceUrl}`)
      .digest("hex")
      .slice(0, 24);
    return {
      // 每次录制使用独立目录 ID；同一论文的上下集或系列视频不会互相覆盖。
      externalId: `mli:${stableKey}`,
      title,
      titleZh: title,
      abstract: "",
      abstractZh: `李沐“深度学习论文精读”目录中的中文讲解，录制日期为 ${recordedDate}。`,
      authors: [],
      category: "AI",
      publishedAt: null,
      sourceUrl: separatedUrls.sourceUrl,
      pdfUrl: separatedUrls.pdfUrl,
      curatorNote:
        `本条目来自李沐的“深度学习论文精读”公开目录。建议先看中文视频建立整体框架，再回到论文原文核对方法、实验与结论。`,
      videoUrl: bilibiliMatch?.[1] ?? null,
      videoAltUrl: youtubeMatch?.[1] ?? null,
      duration: cells[3] || null,
    };
  });
}

/**
 * 从 GitHub 同步李沐精读目录到本地论文库。
 *
 * @returns {Promise<{ imported: number, papers: Record<string, unknown>[] }>} 同步结果。
 */
export async function refreshMliPaperLibrary() {
  /** response 是 GitHub 原始 README 响应。 */
  const response = await fetchExternalResource(new URL(mliReadmeUrl), {
    headers: {
      Accept: "text/plain",
      "User-Agent": "ZhixuLocalKnowledge/1.0",
    },
    signal: AbortSignal.timeout(mliRequestTimeoutMilliseconds),
  }, "李沐精读目录");
  if (!response.ok) {
    throw new Error(`李沐精读目录暂时不可用（${response.status}）。`);
  }
  /** readmeText 是完整公开目录 Markdown。 */
  const readmeText = await response.text();
  /** parsedPapers 是解析出的已录制论文条目。 */
  const parsedPapers = parseMliPaperReadme(readmeText);
  if (parsedPapers.length === 0) {
    throw new Error("没有从李沐精读目录解析到有效条目。");
  }
  /** savedPapers 是幂等写入本地数据库后的记录。 */
  const savedPapers = parsedPapers.map((paper) => upsertCuratedPaper(paper));
  return { imported: savedPapers.length, papers: savedPapers };
}
