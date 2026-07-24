/**
 * 知序 Windows 启动器。
 *
 * 启动前先检查本地服务：已经运行时只打开浏览器，未运行时再启动服务。
 */
import { spawn } from "node:child_process";

/** localUrl 是知序本地网页固定地址。 */
const localUrl = "http://127.0.0.1:47821";
/** healthUrl 是判断占用端口的进程是否为知序的健康接口。 */
const healthUrl = `${localUrl}/api/health`;

/**
 * 使用 Windows 默认浏览器打开知序页面。
 *
 * @returns {void}
 */
function openDefaultBrowser() {
  if (process.env.ZHIXU_NO_BROWSER === "1") return;
  /** escapedUrl 是适合 PowerShell 单引号字符串的本地地址。 */
  const escapedUrl = localUrl.replaceAll("'", "''");
  /** browserProcess 是隐藏运行的系统浏览器启动进程。 */
  const browserProcess = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `Start-Process '${escapedUrl}'`,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  browserProcess.unref();
}

/**
 * 检查当前端口上是否已经运行知序服务。
 *
 * @returns {Promise<boolean>} 健康接口是否确认是知序。
 */
async function isZhixuAlreadyRunning() {
  try {
    /** response 是限制在两秒内返回的本地健康检查。 */
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    /** payload 是本地服务健康信息。 */
    const payload = await response.json();
    return payload?.status === "ok" && payload?.storage === "SQLite 本地数据库";
  } catch {
    return false;
  }
}

/**
 * 执行“复用现有服务或启动新服务”的完整流程。
 *
 * @returns {Promise<void>}
 */
async function launchZhixu() {
  if (await isZhixuAlreadyRunning()) {
    console.log("知序已经在运行，正在打开浏览器……");
    openDefaultBrowser();
    return;
  }

  console.log("正在启动知序本地知识库……");
  /** serverProcess 是继承当前窗口输出的新服务进程。 */
  const serverProcess = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "server.mjs"],
    {
      cwd: import.meta.dirname,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    },
  );
  /** exitCode 是服务关闭时返回给批处理脚本的状态码。 */
  const exitCode = await new Promise((resolve) => {
    serverProcess.once("error", () => resolve(1));
    serverProcess.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
}

await launchZhixu();
