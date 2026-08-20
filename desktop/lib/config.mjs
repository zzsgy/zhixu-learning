/**
 * 知序本地版配置模块。
 *
 * 所有配置项都通过环境变量或 .env.local 读取，避免把 API Key 写入代码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 当前模块文件的绝对路径。 */
const moduleFilePath = fileURLToPath(import.meta.url);
/** 当前模块所在目录。 */
const moduleDirectory = path.dirname(moduleFilePath);
/** 桌面版项目根目录。 */
export const projectDirectory = path.resolve(moduleDirectory, "..");
/** 本地私密环境变量文件路径。 */
const localEnvironmentPath = path.join(projectDirectory, ".env.local");
/** externallyConfiguredDataDirectory 用于让测试或系统级数据目录保持完整隔离。 */
const externallyConfiguredDataDirectory = process.env.ZHIXU_DATA_DIR?.trim() || "";

/**
 * 清理环境变量文本两端的可选引号。
 *
 * @param {string} value 原始配置值。
 * @returns {string} 清理后的配置值。
 */
function unquoteEnvironmentValue(value) {
  /** trimmedValue 是移除首尾空白后的配置值。 */
  const trimmedValue = value.trim();
  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }
  return trimmedValue;
}

/**
 * 加载 .env.local 中尚未存在于系统环境变量的配置项。
 *
 * @returns {void}
 */
function loadLocalEnvironment() {
  if (!fs.existsSync(localEnvironmentPath)) return;
  /** environmentText 是本地私密配置文件的完整文本。 */
  const environmentText = fs.readFileSync(localEnvironmentPath, "utf8");
  for (const line of environmentText.split(/\r?\n/)) {
    /** normalizedLine 是去除首尾空白后的单行配置。 */
    const normalizedLine = line.trim();
    if (!normalizedLine || normalizedLine.startsWith("#")) continue;
    /** separatorIndex 是配置名称与配置值之间第一个等号的位置。 */
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) continue;
    /** key 是环境变量名称。 */
    const key = normalizedLine.slice(0, separatorIndex).trim();
    /** value 是环境变量文本值。 */
    const value = unquoteEnvironmentValue(normalizedLine.slice(separatorIndex + 1));
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * 将配置读取为限定范围内的整数。
 *
 * @param {string | undefined} rawValue 原始环境变量值。
 * @param {number} fallbackValue 缺失或无效时使用的默认值。
 * @param {number} minimumValue 允许的最小值。
 * @param {number} maximumValue 允许的最大值。
 * @returns {number} 安全的整数配置值。
 */
function readBoundedInteger(
  rawValue,
  fallbackValue,
  minimumValue,
  maximumValue,
) {
  /** parsedValue 是尝试转换得到的整数。 */
  const parsedValue = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(parsedValue)) return fallbackValue;
  return Math.min(Math.max(parsedValue, minimumValue), maximumValue);
}

loadLocalEnvironment();

/** dataDirectory 是本地数据根目录；测试时允许通过环境变量隔离到临时目录。 */
export const dataDirectory = process.env.ZHIXU_DATA_DIR
  ? path.resolve(process.env.ZHIXU_DATA_DIR)
  : path.join(projectDirectory, "data");
/** SQLite 数据库文件路径。 */
export const databasePath = path.join(dataDirectory, "zhixu.db");
/** 上传原文件保存目录。 */
export const attachmentDirectory = path.join(dataDirectory, "attachments");
/** articleImageDirectory 是网页文章远程图片的本地缓存目录。 */
export const articleImageDirectory = path.join(dataDirectory, "article-images");
/** paperDirectory 是公开论文 PDF 与全文提取结果的本地缓存目录。 */
export const paperDirectory = path.join(dataDirectory, "papers");
/** ocrDirectory 是扫描 PDF 页面渲染和 OCR 临时文件的受控目录。 */
export const ocrDirectory = path.join(dataDirectory, "ocr");
/** videoRuntimeDirectory 把大体积工具、模型和临时媒体集中到可迁移目录。 */
export const videoRuntimeDirectory = !externallyConfiguredDataDirectory
  && process.env.ZHIXU_VIDEO_RUNTIME_DIR
  ? path.resolve(process.env.ZHIXU_VIDEO_RUNTIME_DIR)
  : path.join(dataDirectory, "video-runtime");
/** videoReportDirectory 是生成 PDF 正式进入文档库前的短期暂存目录。 */
export const videoReportDirectory = path.join(videoRuntimeDirectory, "reports");
/** videoWorkDirectory 只保存处理中的临时媒体、音频和关键帧。 */
export const videoWorkDirectory = path.join(videoRuntimeDirectory, "work");
/** videoToolDirectory 是知序本地安装的 FFmpeg 与 yt-dlp 目录。 */
export const videoToolDirectory = path.join(videoRuntimeDirectory, "tools");
/** videoPythonDirectory 是隔离安装语音转写和 PDF 依赖的 Python 环境。 */
export const videoPythonDirectory = path.join(videoRuntimeDirectory, "python");
/** videoModelDirectory 保存本地 Whisper 模型缓存。 */
export const videoModelDirectory = path.join(videoRuntimeDirectory, "models");
/** SQLite 自动备份目录。 */
export const backupDirectory = path.join(dataDirectory, "backups");

/** serverConfig 汇总本地 HTTP 服务、上传和备份配置。 */
export const serverConfig = Object.freeze({
  /** host 固定到回环地址时，局域网和公网设备无法访问。 */
  host: process.env.ZHIXU_HOST?.trim() || "127.0.0.1",
  /** port 是浏览器访问本地知识库使用的端口。 */
  port: readBoundedInteger(process.env.ZHIXU_PORT, 47821, 1024, 65535),
  /** maxUploadBytes 是单个文档允许上传的最大字节数。 */
  maxUploadBytes:
    readBoundedInteger(process.env.ZHIXU_MAX_UPLOAD_MB, 200, 1, 1024) *
    1024 *
    1024,
  /** backupRetentionDays 是自动备份的保留天数。 */
  backupRetentionDays: readBoundedInteger(
    process.env.ZHIXU_BACKUP_DAYS,
    30,
    1,
    3650,
  ),
  /** deepSeekApiKey 是仅在本机服务端读取的 DeepSeek 密钥。 */
  deepSeekApiKey: process.env.DEEPSEEK_API_KEY?.trim() || "",
  /** deepSeekModel 是有出处问答使用的模型名称，可在本机环境文件中覆盖。 */
  deepSeekModel: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
  /** tesseractPath 是可由用户覆盖的本机 OCR 命令。 */
  tesseractPath: process.env.ZHIXU_TESSERACT_PATH?.trim() || "tesseract",
  /** pdfToPpmPath 是扫描 PDF 转换为逐页图片的本机命令。 */
  pdfToPpmPath: process.env.ZHIXU_PDFTOPPM_PATH?.trim() || "pdftoppm",
  /** ocrLanguages 默认同时识别简体中文与英文。 */
  ocrLanguages: process.env.ZHIXU_OCR_LANGUAGES?.trim() || "chi_sim+eng",
  /** ocrDpi 是扫描页渲染和识别采用的分辨率。 */
  ocrDpi: readBoundedInteger(process.env.ZHIXU_OCR_DPI, 300, 150, 600),
  /** ocrMaximumPages 防止误导入超大扫描件长期占用电脑。 */
  ocrMaximumPages: readBoundedInteger(process.env.ZHIXU_OCR_MAX_PAGES, 300, 1, 2000),
  /** ffmpegPath 可覆盖本地安装的 FFmpeg。 */
  ffmpegPath: process.env.ZHIXU_FFMPEG_PATH?.trim()
    || path.join(videoToolDirectory, "ffmpeg", "bin", "ffmpeg.exe"),
  /** ytDlpPath 可覆盖本地安装的 yt-dlp。 */
  ytDlpPath: process.env.ZHIXU_YTDLP_PATH?.trim()
    || path.join(videoToolDirectory, "yt-dlp.exe"),
  /** videoPythonPath 指向隔离的本地语音转写环境。 */
  videoPythonPath: process.env.ZHIXU_VIDEO_PYTHON_PATH?.trim()
    || path.join(videoPythonDirectory, "Scripts", "python.exe"),
  /** whisperModel 首次使用时下载到本机，small 在中文质量和 CPU 开销之间折中。 */
  whisperModel: process.env.ZHIXU_WHISPER_MODEL?.trim() || "small",
  /** videoFrameIntervalSeconds 控制候选画面的采样频率。 */
  videoFrameIntervalSeconds: readBoundedInteger(
    process.env.ZHIXU_VIDEO_FRAME_INTERVAL_SECONDS,
    8,
    3,
    60,
  ),
});

/** publicDirectory 是本地网页静态文件所在目录。 */
export const publicDirectory = path.join(projectDirectory, "public");

/**
 * 确保本地数据、附件和备份目录已经创建。
 *
 * @returns {void}
 */
export function ensureLocalDirectories() {
  for (const directoryPath of [
    dataDirectory,
    attachmentDirectory,
    articleImageDirectory,
    paperDirectory,
    ocrDirectory,
    videoRuntimeDirectory,
    videoReportDirectory,
    videoWorkDirectory,
    videoToolDirectory,
    videoPythonDirectory,
    videoModelDirectory,
    backupDirectory,
  ]) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}
