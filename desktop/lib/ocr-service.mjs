/**
 * 本地图片与扫描 PDF OCR 服务。
 *
 * OCR 仅调用用户电脑上的 Tesseract；扫描 PDF 先由 pdftoppm 渲染为逐页 PNG。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ocrDirectory, serverConfig } from "./config.mjs";

/** imageExtensions 是 Tesseract 可直接读取的上传图片类型。 */
export const imageOcrExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
]);

/** commandOutputLimitBytes 防止异常工具输出耗尽 Node.js 内存。 */
const commandOutputLimitBytes = 64 * 1024 * 1024;
/** commandTimeoutMilliseconds 是单页识别或 PDF 渲染的最长时间。 */
const commandTimeoutMilliseconds = 10 * 60 * 1000;

/**
 * 返回正式命令或测试环境注入的 Node.js 模拟脚本。
 *
 * @param {"tesseract" | "pdftoppm"} tool 工具名称。
 * @returns {{ command: string, prefixArguments: string[] }} 命令定义。
 */
function resolveToolCommand(tool) {
  /** testScript 是测试环境显式提供的不联网模拟程序。 */
  const testScript = tool === "tesseract"
    ? process.env.ZHIXU_TESSERACT_CLI_JS
    : process.env.ZHIXU_PDFTOPPM_CLI_JS;
  if (testScript) return { command: process.execPath, prefixArguments: [path.resolve(testScript)] };
  return {
    command: tool === "tesseract" ? serverConfig.tesseractPath : serverConfig.pdfToPpmPath,
    prefixArguments: [],
  };
}

/**
 * 安全执行本地 OCR 工具并收集有限输出。
 *
 * @param {"tesseract" | "pdftoppm"} tool 工具名称。
 * @param {string[]} argumentsList 工具参数。
 * @returns {Promise<{ stdout: Buffer, stderr: string }>} 命令输出。
 */
function runTool(tool, argumentsList) {
  /** commandDefinition 包含实际命令和测试前缀参数。 */
  const commandDefinition = resolveToolCommand(tool);
  return new Promise((resolve, reject) => {
    /** child 是隐藏窗口运行的本地命令进程。 */
    const child = spawn(
      commandDefinition.command,
      [...commandDefinition.prefixArguments, ...argumentsList],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    /** stdoutChunks 保存 TSV 等标准输出。 */
    const stdoutChunks = [];
    /** stderrChunks 保存工具诊断信息。 */
    const stderrChunks = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    /** timeout 防止损坏文件让子进程永久挂起。 */
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`${tool} 处理超时，请检查文件大小或页面质量。`));
      }
    }, commandTimeoutMilliseconds);
    timeout.unref();
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > commandOutputLimitBytes) {
        child.kill();
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= 1024 * 1024) return;
      stderrBytes += chunk.length;
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (error.code === "ENOENT") {
        const settingName = tool === "tesseract"
          ? "ZHIXU_TESSERACT_PATH"
          : "ZHIXU_PDFTOPPM_PATH";
        reject(new Error(`未找到 ${tool}，请安装本地工具并在 .env.local 配置 ${settingName}。`));
        return;
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (outputBytes > commandOutputLimitBytes) {
        reject(new Error(`${tool} 输出超过安全上限。`));
        return;
      }
      /** stderr 是压缩空白后的工具诊断。 */
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (exitCode !== 0) {
        reject(new Error(`${tool} 执行失败${stderr ? `：${stderr.slice(0, 1200)}` : "。"}`));
        return;
      }
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr });
    });
  });
}

/**
 * 将 Tesseract TSV 转换为自然段文本、平均置信度和词语坐标。
 *
 * @param {string} tsv Tesseract TSV 文本。
 * @param {number} pageNumber 知序中的页码。
 * @returns {{ pageNumber: number, text: string, confidence: number, layout: Array<Record<string, unknown>> }} 单页结果。
 */
export function parseTesseractTsv(tsv, pageNumber = 1) {
  /** rows 是去除表头后的 TSV 行。 */
  const rows = String(tsv || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  /** headers 是列名到索引的映射基础。 */
  const headers = (rows.shift() || "").split("\t");
  /** indexOf 返回所需 Tesseract 标准列的位置。 */
  const indexOf = (name) => headers.indexOf(name);
  const requiredColumns = ["level", "block_num", "par_num", "line_num", "left", "top", "width", "height", "conf", "text"];
  if (requiredColumns.some((name) => indexOf(name) < 0)) {
    throw new Error("Tesseract 没有返回可识别的 TSV 格式。");
  }
  /** words 是置信度有效且包含文字的词语坐标。 */
  const words = [];
  /** lines 以版面行标识收集词语。 */
  const lines = new Map();
  for (const row of rows) {
    if (!row.trim()) continue;
    /** columns 是单行 TSV 字段。 */
    const columns = row.split("\t");
    if (columns[indexOf("level")] !== "5") continue;
    /** text 是识别出的单个词或汉字序列。 */
    const text = String(columns[indexOf("text")] || "").trim();
    if (!text) continue;
    /** confidence 是0到100之间的词语置信度。 */
    const confidence = Math.min(Math.max(Number(columns[indexOf("conf")]) || 0, 0), 100);
    /** word 是保留定位所需的轻量坐标。 */
    const word = {
      text,
      confidence,
      left: Number(columns[indexOf("left")]) || 0,
      top: Number(columns[indexOf("top")]) || 0,
      width: Number(columns[indexOf("width")]) || 0,
      height: Number(columns[indexOf("height")]) || 0,
    };
    words.push(word);
    /** lineKey 将块、段和行组合成稳定顺序键。 */
    const lineKey = ["block_num", "par_num", "line_num"]
      .map((name) => Number(columns[indexOf(name)]) || 0)
      .join(":");
    if (!lines.has(lineKey)) lines.set(lineKey, []);
    lines.get(lineKey).push(text);
  }
  /** text 是按版面行组合的可阅读正文。 */
  const text = [...lines.values()].map((lineWords) => lineWords.join(" ")).join("\n").trim();
  /** confidence 是全部有效词语的算术平均值。 */
  const confidence = words.length > 0
    ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
    : 0;
  return { pageNumber, text, confidence, layout: words };
}

/**
 * 判断上传文档是否属于当前 OCR 支持范围。
 *
 * @param {string} extension 小写或原始扩展名。
 * @returns {boolean} 是否为图片或 PDF。
 */
export function isOcrSupportedExtension(extension) {
  /** normalizedExtension 是包含句点的小写扩展名。 */
  const normalizedExtension = String(extension || "").trim().toLowerCase();
  return normalizedExtension === ".pdf" || imageOcrExtensions.has(normalizedExtension);
}

/**
 * 把扫描 PDF 渲染为受控临时目录中的逐页 PNG。
 *
 * @param {string} pdfPath 本地 PDF 绝对路径。
 * @returns {Promise<{ directoryPath: string, pagePaths: string[] }>} 临时目录与页面路径。
 */
async function renderPdfPages(pdfPath) {
  fs.mkdirSync(ocrDirectory, { recursive: true });
  /** directoryPath 是只用于本次任务的随机临时目录。 */
  const directoryPath = fs.mkdtempSync(path.join(ocrDirectory, "pages-"));
  /** outputPrefix 是 pdftoppm 生成 page-1.png 等文件的前缀。 */
  const outputPrefix = path.join(directoryPath, "page");
  await runTool("pdftoppm", [
    "-png",
    "-r",
    String(serverConfig.ocrDpi),
    pdfPath,
    outputPrefix,
  ]);
  /** pagePaths 是按数字页码排序的渲染结果。 */
  const pagePaths = fs.readdirSync(directoryPath)
    .filter((name) => /^page-\d+\.png$/i.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/\d+/)?.[0]) || 0;
      const rightNumber = Number(right.match(/\d+/)?.[0]) || 0;
      return leftNumber - rightNumber;
    })
    .map((name) => path.join(directoryPath, name));
  if (pagePaths.length === 0) throw new Error("PDF 页面渲染完成，但没有生成可识别图片。");
  if (pagePaths.length > serverConfig.ocrMaximumPages) {
    throw new Error(`扫描 PDF 共 ${pagePaths.length} 页，超过当前 OCR 上限 ${serverConfig.ocrMaximumPages} 页。`);
  }
  return { directoryPath, pagePaths };
}

/**
 * 对本地图片或扫描 PDF 执行逐页 OCR。
 *
 * @param {{ filePath: string, extension: string, language?: string, onProgress?: Function }} input OCR 参数。
 * @returns {Promise<{ pages: Array<Record<string, unknown>>, language: string, averageConfidence: number }>} OCR 结果。
 */
export async function recognizeDocument(input) {
  /** filePath 是数据库记录指向的本地原始附件。 */
  const filePath = path.resolve(String(input.filePath || ""));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error("找不到需要 OCR 的本地原始文件。");
  }
  /** extension 是决定直接识别或先渲染 PDF 的文件类型。 */
  const extension = String(input.extension || path.extname(filePath)).toLowerCase();
  if (!isOcrSupportedExtension(extension)) throw new Error("当前文件类型不支持 OCR。");
  /** language 是 Tesseract 多语言表达式。 */
  const language = String(input.language || serverConfig.ocrLanguages).trim() || "chi_sim+eng";
  let temporaryDirectory = "";
  try {
    /** pagePaths 是待逐页识别的图片路径。 */
    let pagePaths = [filePath];
    if (extension === ".pdf") {
      input.onProgress?.({ stage: "rendering", progressPercent: 5 });
      const rendered = await renderPdfPages(filePath);
      temporaryDirectory = rendered.directoryPath;
      pagePaths = rendered.pagePaths;
    }
    /** pages 保存所有有文字页面的识别结果。 */
    const pages = [];
    for (const [index, pagePath] of pagePaths.entries()) {
      /** progressPercent 为逐页处理预留10%到90%的进度区间。 */
      const progressPercent = 10 + Math.round((index / Math.max(pagePaths.length, 1)) * 80);
      input.onProgress?.({
        stage: "recognizing",
        progressPercent,
        pageNumber: index + 1,
        pageCount: pagePaths.length,
      });
      /** tesseractOutput 是标准 TSV，用于同时获得文字和坐标。 */
      const tesseractOutput = await runTool("tesseract", [
        pagePath,
        "stdout",
        "-l",
        language,
        "--dpi",
        String(serverConfig.ocrDpi),
        "tsv",
      ]);
      pages.push(parseTesseractTsv(tesseractOutput.stdout.toString("utf8"), index + 1));
    }
    /** recognizedWords 是所有页面用于计算总体置信度的词语坐标。 */
    const recognizedWords = pages.flatMap((page) => page.layout || []);
    const averageConfidence = recognizedWords.length > 0
      ? recognizedWords.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / recognizedWords.length
      : 0;
    if (!pages.some((page) => page.text)) throw new Error("OCR 已运行，但没有识别出文字。");
    input.onProgress?.({ stage: "saving", progressPercent: 92 });
    return { pages, language, averageConfidence };
  } finally {
    if (
      temporaryDirectory
      && path.resolve(temporaryDirectory).startsWith(`${path.resolve(ocrDirectory)}${path.sep}`)
    ) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

/**
 * 检查本机 OCR 命令是否可用，供设置页给出明确提示。
 *
 * @returns {Promise<Record<string, unknown>>} 工具可用状态。
 */
export async function getOcrEngineStatus() {
  const status = {
    tesseractAvailable: false,
    pdfRendererAvailable: false,
    language: serverConfig.ocrLanguages,
    dpi: serverConfig.ocrDpi,
  };
  try {
    await runTool("tesseract", ["--version"]);
    status.tesseractAvailable = true;
  } catch {
    status.tesseractAvailable = false;
  }
  try {
    await runTool("pdftoppm", ["-v"]);
    status.pdfRendererAvailable = true;
  } catch {
    status.pdfRendererAvailable = false;
  }
  return status;
}
