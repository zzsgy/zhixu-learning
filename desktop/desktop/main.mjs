/**
 * 知序 Windows 桌面外壳。
 *
 * 桌面外壳复用现有本机 HTTP 服务，不复制数据库，也不改变资料目录。
 * 当本机服务尚未启动时，桌面外壳会用 Electron 内置的 Node 运行时启动服务；
 * 如果服务已经由计划任务托管，则直接连接现有实例。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  nativeImage,
  shell,
} from "electron";

/** projectDirectory 是知序源码及运行文件所在的根目录。 */
const projectDirectory = path.resolve(import.meta.dirname, "..");
/** desktopDirectory 是桌面外壳自身资源目录。 */
const desktopDirectory = import.meta.dirname;
/** serverUrl 是桌面窗口加载的知序本机地址。 */
const serverUrl = process.env.ZHIXU_DESKTOP_URL?.trim() || "http://127.0.0.1:47821";
/** healthUrl 用于确认端口上运行的是健康的知序服务。 */
const healthUrl = new URL("/api/health", serverUrl).toString();
/** serverOrigin 是主窗口唯一允许停留的应用来源。 */
const serverOrigin = new URL(serverUrl).origin;

/** mainWindow 是知序的主桌面窗口。 */
let mainWindow = null;
/** tray 是关闭窗口后仍可恢复应用的系统托盘入口。 */
let tray = null;
/** managedServerProcess 是仅在桌面版自行启动服务时保存的子进程。 */
let managedServerProcess = null;
/** isQuitting 区分隐藏到托盘和真正退出桌面应用。 */
let isQuitting = false;

/**
 * 暂停指定时间，供本机服务启动轮询使用。
 *
 * @param {number} milliseconds 等待毫秒数。
 * @returns {Promise<void>} 等待完成的 Promise。
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 返回桌面运行日志目录。
 *
 * 开发版沿用项目 work 目录；安装版写入当前 Windows 用户的应用数据目录，
 * 避免尝试修改 Program Files 中的程序文件。
 *
 * @returns {string} 可写的运行日志目录。
 */
function getWorkDirectory() {
  return app.isPackaged
    ? path.join(app.getPath("userData"), "logs")
    : path.join(projectDirectory, "work");
}

/**
 * 返回桌面服务日志文件路径。
 *
 * @param {"output" | "error"} kind 日志种类。
 * @returns {string} 日志文件绝对路径。
 */
function getDesktopLogPath(kind) {
  return path.join(
    getWorkDirectory(),
    kind === "error"
      ? "zhixu-desktop-service-error.log"
      : "zhixu-desktop-service.log",
  );
}

/**
 * 创建桌面版统一使用的品牌图标。
 *
 * @returns {Electron.NativeImage} 可供窗口和托盘复用的图标。
 */
function createBrandIcon() {
  /** iconPath 是优先使用的本地 PNG 图标。 */
  const iconPath = path.join(desktopDirectory, "assets", "zhixu-icon.png");
  /** icon 是 Electron 读取后的多平台图像对象。 */
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

/**
 * 检查当前端口是否已有健康的知序服务。
 *
 * @returns {Promise<boolean>} 健康接口是否返回知序标识。
 */
async function isZhixuHealthy() {
  try {
    /** response 是两秒内完成的本机健康请求。 */
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    /** payload 是健康接口返回的服务信息。 */
    const payload = await response.json();
    return payload?.status === "ok" && payload?.storage === "SQLite 本地数据库";
  } catch {
    return false;
  }
}

/**
 * 在限定时间内等待知序服务就绪。
 *
 * @param {number} timeoutMilliseconds 最长等待时间。
 * @returns {Promise<boolean>} 服务是否在期限内就绪。
 */
async function waitForZhixu(timeoutMilliseconds) {
  /** deadline 是本轮等待截止时间。 */
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await isZhixuHealthy()) return true;
    await delay(500);
  }
  return false;
}

/**
 * 在桌面进程内启动知序本地服务。
 *
 * Electron 通过 ELECTRON_RUN_AS_NODE 作为普通 Node 进程运行 server.mjs，
 * 避免引入第二套服务实现。
 *
 * @returns {Promise<boolean>} 是否由桌面外壳新启动了服务。
 */
async function ensureZhixuService() {
  if (await isZhixuHealthy()) return false;
  /** workDirectory 保存桌面启动的本地服务日志。 */
  const workDirectory = getWorkDirectory();
  /** desktopLogPath 是桌面启动服务的标准输出日志。 */
  const desktopLogPath = getDesktopLogPath("output");
  /** desktopErrorLogPath 是桌面启动服务的标准错误日志。 */
  const desktopErrorLogPath = getDesktopLogPath("error");
  fs.mkdirSync(workDirectory, { recursive: true });
  /** outputLog 是桌面启动服务的标准输出目标。 */
  const outputLog = fs.openSync(desktopLogPath, "a");
  /** errorLog 是桌面启动服务的标准错误目标。 */
  const errorLog = fs.openSync(desktopErrorLogPath, "a");
  /** childEnvironment 继承本机数据、代理和模型配置，并禁止自动打开浏览器。 */
  const childEnvironment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    ZHIXU_NO_BROWSER: "1",
  };
  if (app.isPackaged) {
    /** userDataDirectory 是安装版数据库、附件、配置和日志的用户级根目录。 */
    const userDataDirectory = app.getPath("userData");
    childEnvironment.ZHIXU_DATA_DIR ||= path.join(userDataDirectory, "data");
    childEnvironment.ZHIXU_ENV_FILE ||= path.join(userDataDirectory, ".env.local");
  }
  try {
    managedServerProcess = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", path.join(projectDirectory, "server.mjs")],
      {
        cwd: projectDirectory,
        env: childEnvironment,
        windowsHide: true,
        stdio: ["ignore", outputLog, errorLog],
      },
    );
  } finally {
    fs.closeSync(outputLog);
    fs.closeSync(errorLog);
  }
  managedServerProcess.once("exit", () => {
    managedServerProcess = null;
  });
  if (await waitForZhixu(30_000)) return true;
  throw new Error(`知序本地服务未能在 30 秒内启动。请查看 ${desktopErrorLogPath}`);
}

/**
 * 判断导航地址是否属于知序自身来源。
 *
 * @param {string} candidateUrl 待检查地址。
 * @returns {boolean} 是否允许在主窗口中打开。
 */
function isInternalUrl(candidateUrl) {
  try {
    return new URL(candidateUrl).origin === serverOrigin;
  } catch {
    return false;
  }
}

/**
 * 显示并聚焦知序主窗口。
 *
 * @returns {void}
 */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * 创建中文应用菜单。
 *
 * @returns {void}
 */
function installApplicationMenu() {
  /** applicationMenu 是桌面窗口顶部的精简菜单。 */
  const applicationMenu = Menu.buildFromTemplate([
    {
      label: "知序",
      submenu: [
        { label: "显示知序", accelerator: "Ctrl+Shift+Z", click: showMainWindow },
        { label: "在浏览器中打开", click: () => void shell.openExternal(serverUrl) },
        { type: "separator" },
        {
          label: "退出桌面版",
          accelerator: "Alt+F4",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "刷新", role: "reload" },
        { label: "强制刷新", role: "forceReload" },
        { type: "separator" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { label: "恢复默认缩放", role: "resetZoom" },
        { type: "separator" },
        { label: "全屏", role: "togglefullscreen" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "检查本地服务",
          click: async () => {
            /** healthy 是用户主动检查时的服务状态。 */
            const healthy = await isZhixuHealthy();
            await dialog.showMessageBox(mainWindow, {
              type: healthy ? "info" : "warning",
              title: "知序服务状态",
              message: healthy ? "知序本地服务运行正常。" : "暂时无法连接知序本地服务。",
              detail: healthy ? serverUrl : `请检查运行日志：${getDesktopLogPath("error")}`,
            });
          },
        },
        { label: "打开运行日志目录", click: () => void shell.openPath(getWorkDirectory()) },
      ],
    },
  ]);
  Menu.setApplicationMenu(applicationMenu);
}

/**
 * 创建系统托盘入口。
 *
 * @param {Electron.NativeImage} icon 品牌图标。
 * @returns {void}
 */
function createTray(icon) {
  if (icon.isEmpty()) return;
  tray = new Tray(icon.resize({ width: 24, height: 24 }));
  tray.setToolTip("知序 · 个人知识工作台");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开知序", click: showMainWindow },
    { label: "在浏览器中打开", click: () => void shell.openExternal(serverUrl) },
    { type: "separator" },
    {
      label: "退出桌面版",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("double-click", showMainWindow);
}

/**
 * 创建主窗口并加载启动页。
 *
 * @param {Electron.NativeImage} icon 品牌图标。
 * @returns {Promise<Electron.BrowserWindow>} 创建完成的窗口。
 */
async function createMainWindow(icon) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: "知序 · 个人知识工作台",
    icon: icon.isEmpty() ? undefined : icon,
    backgroundColor: "#eef5f1",
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadFile(path.join(desktopDirectory, "splash.html"));
  return mainWindow;
}

/**
 * 完成桌面外壳启动流程。
 *
 * @returns {Promise<void>} 启动完成的 Promise。
 */
async function startDesktopApplication() {
  app.setAppUserModelId("com.zhixu.desktop");
  /** icon 是窗口、任务栏和托盘共用的图标。 */
  const icon = createBrandIcon();
  installApplicationMenu();
  await createMainWindow(icon);
  createTray(icon);
  /** splashStartedAt 用于避免启动页短暂闪烁。 */
  const splashStartedAt = Date.now();
  await ensureZhixuService();
  await delay(Math.max(0, 850 - (Date.now() - splashStartedAt)));
  await mainWindow.loadURL(serverUrl);
  if (process.env.ZHIXU_DESKTOP_SMOKE_TEST === "1") {
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 750);
  }
}

/** singleInstanceLock 防止用户连续点击图标时打开多个桌面实例。 */
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.on("before-quit", () => {
    isQuitting = true;
  });
  app.on("will-quit", () => {
    if (managedServerProcess && !managedServerProcess.killed) {
      managedServerProcess.kill();
    }
  });
  app.on("activate", showMainWindow);
  app.on("window-all-closed", () => {
    // Windows 桌面版关闭窗口后保留托盘，不在此退出。
  });
  app.whenReady().then(startDesktopApplication).catch(async (error) => {
    if (process.env.ZHIXU_DESKTOP_SMOKE_TEST === "1") {
      console.error(error);
      isQuitting = true;
      app.exit(1);
      return;
    }
    await dialog.showMessageBox({
      type: "error",
      title: "知序桌面版启动失败",
      message: "暂时无法打开知序桌面版。",
      detail: error instanceof Error ? error.message : String(error),
    });
    isQuitting = true;
    app.quit();
  });
}
