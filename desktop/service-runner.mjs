/**
 * 知序本地服务守护进程。
 *
 * 守护进程负责在服务异常退出后自动重启，并把输出写入本地日志。
 * Windows 计划任务和桌面启动器都通过本文件启动服务。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/** projectDirectory 是知序桌面版项目根目录。 */
const projectDirectory = import.meta.dirname;
/** workDirectory 是运行日志和守护状态文件目录。 */
const workDirectory = path.join(projectDirectory, "work");
/** outputLogPath 是服务标准输出日志文件。 */
const outputLogPath = path.join(workDirectory, "zhixu-service.log");
/** errorLogPath 是服务错误输出日志文件。 */
const errorLogPath = path.join(workDirectory, "zhixu-service-error.log");
/** healthUrl 是确认端口上运行的确为知序的健康接口。 */
const healthUrl = "http://127.0.0.1:47821/api/health";
/** maximumRestartDelayMilliseconds 是连续故障时的最长重试间隔。 */
const maximumRestartDelayMilliseconds = 30_000;
/** stableRunMilliseconds 是把连续失败次数清零所需的稳定运行时间。 */
const stableRunMilliseconds = 60_000;
/** stopping 表示守护进程是否正在响应系统停止信号。 */
let stopping = false;
/** activeServerProcess 保存当前由守护进程管理的 Node 子进程。 */
let activeServerProcess = null;
/** consecutiveFailures 记录短时间内连续退出的次数。 */
let consecutiveFailures = 0;

fs.mkdirSync(workDirectory, { recursive: true });

/** outputLogStream 是以追加方式写入的标准输出日志流。 */
const outputLogStream = fs.createWriteStream(outputLogPath, {
  flags: "a",
  encoding: "utf8",
});
/** errorLogStream 是以追加方式写入的错误输出日志流。 */
const errorLogStream = fs.createWriteStream(errorLogPath, {
  flags: "a",
  encoding: "utf8",
});

/**
 * 生成带时间戳的单行守护日志。
 *
 * @param {string} message 需要写入日志的说明。
 * @returns {string} 可直接追加到日志文件的文本。
 */
function formatLogLine(message) {
  return `[${new Date().toISOString()}] ${message}\n`;
}

/**
 * 同时记录守护事件到普通日志和当前终端。
 *
 * @param {string} message 守护事件说明。
 * @returns {void}
 */
function writeRunnerLog(message) {
  /** logLine 是已附加 ISO 时间戳的日志行。 */
  const logLine = formatLogLine(message);
  outputLogStream.write(logLine);
  process.stdout.write(logLine);
}

/**
 * 等待指定毫秒数，供异常退出后的退避重试使用。
 *
 * @param {number} milliseconds 等待时长。
 * @returns {Promise<void>} 等待结束后的 Promise。
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 检查本机端口是否已有健康的知序服务。
 *
 * @returns {Promise<boolean>} 健康接口是否确认服务可用。
 */
async function isZhixuHealthy() {
  try {
    /** response 是限制在两秒内完成的本机健康请求。 */
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    /** payload 是健康接口返回的本机服务状态。 */
    const payload = await response.json();
    return payload?.status === "ok" && payload?.storage === "SQLite 本地数据库";
  } catch {
    return false;
  }
}

/**
 * 启动一次知序服务并等待它退出。
 *
 * @returns {Promise<{ exitCode: number, runMilliseconds: number }>} 退出信息。
 */
async function runServerOnce() {
  /** startedAt 是本轮服务启动的毫秒时间戳。 */
  const startedAt = Date.now();
  /** childEnvironment 禁止服务自行打开浏览器，并继承其他本机配置。 */
  const childEnvironment = { ...process.env, ZHIXU_NO_BROWSER: "1" };
  writeRunnerLog("正在启动知序本地服务。");
  /** serverProcess 是当前受守护的知序服务子进程。 */
  const serverProcess = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "server.mjs"],
    {
      cwd: projectDirectory,
      env: childEnvironment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeServerProcess = serverProcess;
  serverProcess.stdout.pipe(outputLogStream, { end: false });
  serverProcess.stderr.pipe(errorLogStream, { end: false });
  /** exitCode 是子进程正常退出代码或启动失败时使用的失败代码。 */
  const exitCode = await new Promise((resolve) => {
    serverProcess.once("error", (error) => {
      errorLogStream.write(formatLogLine(`服务进程启动失败：${error.message}`));
      resolve(1);
    });
    serverProcess.once("exit", (code, signal) => {
      if (signal) writeRunnerLog(`知序服务收到 ${signal} 信号后退出。`);
      resolve(code ?? 1);
    });
  });
  activeServerProcess = null;
  return { exitCode, runMilliseconds: Date.now() - startedAt };
}

/**
 * 持续监督服务，异常退出时采用指数退避自动重启。
 *
 * @returns {Promise<void>} 守护结束后的 Promise。
 */
async function superviseService() {
  if (await isZhixuHealthy()) {
    writeRunnerLog("检测到知序已经运行，本次守护任务无需重复启动。");
    return;
  }
  while (!stopping) {
    /** result 是本轮服务运行持续时间与退出代码。 */
    const result = await runServerOnce();
    if (stopping) break;
    if (result.runMilliseconds >= stableRunMilliseconds) consecutiveFailures = 0;
    else consecutiveFailures += 1;
    /** restartDelayMilliseconds 是根据连续失败次数计算的退避间隔。 */
    const restartDelayMilliseconds = Math.min(
      1_000 * 2 ** Math.min(consecutiveFailures, 5),
      maximumRestartDelayMilliseconds,
    );
    writeRunnerLog(
      `知序服务退出（代码 ${result.exitCode}，运行 ${Math.round(result.runMilliseconds / 1000)} 秒），将在 ${restartDelayMilliseconds / 1000} 秒后自动重启。`,
    );
    await delay(restartDelayMilliseconds);
  }
  writeRunnerLog("知序服务守护进程已停止。");
}

/**
 * 响应 Windows 或终端发出的停止信号，并转发给服务子进程。
 *
 * @param {NodeJS.Signals} signal 收到的系统信号。
 * @returns {void}
 */
function handleStopSignal(signal) {
  stopping = true;
  writeRunnerLog(`守护进程收到 ${signal}，正在停止知序服务。`);
  if (activeServerProcess && !activeServerProcess.killed) activeServerProcess.kill(signal);
}

process.once("SIGINT", () => handleStopSignal("SIGINT"));
process.once("SIGTERM", () => handleStopSignal("SIGTERM"));

await superviseService();
outputLogStream.end();
errorLogStream.end();
