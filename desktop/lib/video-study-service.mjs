/**
 * 无独立字幕视频的本地学习资料生成器。
 *
 * 只有用户在任务中心明确确认后才会运行。媒体、音频和候选帧只保存在
 * data/video-work 的单任务目录，成功或失败后都会删除；最终只保留 PDF。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  projectDirectory,
  serverConfig,
  videoModelDirectory,
  videoReportDirectory,
  videoWorkDirectory,
} from "./config.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const generatorScriptPath = path.join(projectDirectory, "scripts", "video-study-export.py");
const maximumCapturedOutputBytes = 2_000_000;
const allowedVideoExtensions = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v"]);

/**
 * 以参数数组运行本机命令，禁止 shell 拼接。
 *
 * @param {string} command 可执行文件。
 * @param {Array<string>} args 参数。
 * @param {{ cwd?: string, timeoutMs?: number, env?: Record<string, string> }} options 运行选项。
 * @returns {Promise<{ stdout: string, stderr: string }>} 命令输出。
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || moduleDirectory,
      windowsHide: true,
      shell: false,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const appendLimited = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      return Buffer.byteLength(next, "utf8") > maximumCapturedOutputBytes
        ? next.slice(-maximumCapturedOutputBytes)
        : next;
    };
    child.stdout.on("data", (chunk) => { stdout = appendLimited(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendLimited(stderr, chunk); });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(command)} 运行超时。`));
    }, options.timeoutMs || 6 * 60 * 60 * 1000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`无法启动 ${path.basename(command)}：${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        `${path.basename(command)} 处理失败（${code ?? "未知"}）：${stderr.trim().slice(-1200) || "没有错误详情"}`,
      ));
    });
  });
}

/**
 * 确认任务临时目录始终位于 videoWorkDirectory 内。
 *
 * @param {string} jobId 导入任务 ID。
 * @returns {string} 安全临时目录。
 */
function createSafeWorkDirectory(jobId) {
  const safeName = String(jobId || "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  if (!safeName) throw new TypeError("视频任务 ID 无效。");
  const workDirectory = path.resolve(videoWorkDirectory, safeName);
  const workRoot = `${path.resolve(videoWorkDirectory)}${path.sep}`;
  if (!`${workDirectory}${path.sep}`.startsWith(workRoot)) {
    throw new Error("视频临时目录超出允许范围。");
  }
  fs.mkdirSync(workDirectory, { recursive: true });
  return workDirectory;
}

/**
 * 从 yt-dlp 输出目录中选择已经完成的媒体文件。
 *
 * @param {string} workDirectory 单任务目录。
 * @returns {string} 媒体文件路径。
 */
function findDownloadedMedia(workDirectory) {
  const candidates = fs.readdirSync(workDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && allowedVideoExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(workDirectory, entry.name))
    .sort((left, right) => fs.statSync(right).size - fs.statSync(left).size);
  if (!candidates[0]) throw new Error("视频平台没有返回可处理的媒体文件。");
  return candidates[0];
}

/**
 * 返回本地视频分析依赖状态，不触发模型下载。
 *
 * @returns {Promise<Record<string, unknown>>} 工具状态。
 */
export async function getVideoStudyEngineStatus() {
  const paths = {
    ffmpeg: serverConfig.ffmpegPath,
    ytDlp: serverConfig.ytDlpPath,
    python: serverConfig.videoPythonPath,
    generator: generatorScriptPath,
  };
  const exists = Object.fromEntries(
    Object.entries(paths).map(([key, value]) => [key, fs.existsSync(value)]),
  );
  let pythonModulesReady = false;
  let moduleError = "";
  if (exists.python) {
    try {
      await runCommand(serverConfig.videoPythonPath, [
        "-c",
        "import faster_whisper, reportlab, PIL, pypdf; print('ok')",
      ], { timeoutMs: 30_000 });
      pythonModulesReady = true;
    } catch (error) {
      moduleError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    ready: exists.ffmpeg && exists.ytDlp && exists.python && exists.generator && pythonModulesReady,
    paths,
    exists,
    pythonModulesReady,
    model: serverConfig.whisperModel,
    moduleError,
  };
}

/**
 * 临时下载公开视频，转写音频、提取关键画面并生成可检索 PDF。
 *
 * @param {Record<string, unknown>} video 统一视频信息。
 * @param {{ jobId: string, updateProgress?: Function }} options 任务信息。
 * @returns {Promise<Record<string, unknown>>} 转写段落与 PDF 结果。
 */
export async function createVideoStudyPdf(video, options) {
  if (!["youtube", "bilibili"].includes(video.platform)) {
    throw new Error("图文学习 PDF 当前只支持 YouTube 和哔哩哔哩公开视频。");
  }
  const status = await getVideoStudyEngineStatus();
  if (!status.ready) {
    throw new Error("本地视频分析工具尚未安装完整，请先完成 FFmpeg、yt-dlp 和语音转写依赖安装。");
  }
  const updateProgress = typeof options.updateProgress === "function"
    ? options.updateProgress
    : () => {};
  const workDirectory = createSafeWorkDirectory(options.jobId);
  const framesDirectory = path.join(workDirectory, "frames");
  const audioPath = path.join(workDirectory, "audio.wav");
  const metadataPath = path.join(workDirectory, "metadata.json");
  const resultPath = path.join(workDirectory, "analysis.json");
  const reportName = `${String(options.jobId).replace(/[^a-z0-9_-]/gi, "_")}.pdf`;
  const reportPath = path.join(videoReportDirectory, reportName);
  fs.mkdirSync(framesDirectory, { recursive: true });
  fs.mkdirSync(videoReportDirectory, { recursive: true });
  try {
    updateProgress({ stage: "downloading_video", progressPercent: 12 });
    await runCommand(serverConfig.ytDlpPath, [
      "--no-playlist",
      "--no-progress",
      "--no-warnings",
      "--ffmpeg-location", path.dirname(serverConfig.ffmpegPath),
      "--format", "bv*[height<=1080]+ba/b[height<=1080]",
      "--merge-output-format", "mp4",
      "--output", path.join(workDirectory, "source.%(ext)s"),
      "--", video.canonicalUrl,
    ], { cwd: workDirectory });
    const mediaPath = findDownloadedMedia(workDirectory);

    updateProgress({ stage: "extracting_audio", progressPercent: 28 });
    await runCommand(serverConfig.ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", mediaPath,
      "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
      audioPath,
    ]);

    updateProgress({ stage: "extracting_frames", progressPercent: 38 });
    await runCommand(serverConfig.ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", mediaPath,
      "-vf", `fps=1/${serverConfig.videoFrameIntervalSeconds},scale=1280:-2`,
      "-q:v", "3",
      path.join(framesDirectory, "frame-%05d.jpg"),
    ]);

    fs.writeFileSync(metadataPath, JSON.stringify({
      title: video.title,
      author: video.author,
      description: video.description,
      canonicalUrl: video.canonicalUrl,
      platform: video.platform,
      durationSeconds: video.durationSeconds,
    }, null, 2), "utf8");

    updateProgress({ stage: "transcribing_audio", progressPercent: 48 });
    fs.mkdirSync(videoModelDirectory, { recursive: true });
    await runCommand(serverConfig.videoPythonPath, [
      generatorScriptPath,
      "--audio", audioPath,
      "--frames", framesDirectory,
      "--frame-interval", String(serverConfig.videoFrameIntervalSeconds),
      "--metadata", metadataPath,
      "--output-pdf", reportPath,
      "--output-json", resultPath,
      "--model", serverConfig.whisperModel,
      "--tesseract", serverConfig.tesseractPath,
      "--ocr-languages", serverConfig.ocrLanguages,
      "--max-frames", "60",
    ], {
      env: { ...process.env, HF_HOME: videoModelDirectory },
    });
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    updateProgress({ stage: "rendering_study_pdf", progressPercent: 88 });
    if (!fs.existsSync(reportPath) || fs.statSync(reportPath).size < 10_000) {
      throw new Error("图文学习 PDF 未正确生成。");
    }
    return {
      ...result,
      pdfPath: reportPath,
      pdfUrl: `/api/video-reports/${encodeURIComponent(reportName)}`,
      pdfFileName: reportName,
    };
  } finally {
    const workRoot = `${path.resolve(videoWorkDirectory)}${path.sep}`;
    if (`${path.resolve(workDirectory)}${path.sep}`.startsWith(workRoot)) {
      fs.rmSync(workDirectory, { recursive: true, force: true });
    }
  }
}
