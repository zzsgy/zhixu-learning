import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/** stagedProjectDirectory 是桌面原型暂存项目根目录。 */
const stagedProjectDirectory = path.resolve(import.meta.dirname, "..");

test("desktop shell keeps the knowledge service local and isolates web content", () => {
  /** source 是桌面主进程源码。 */
  const source = fs.readFileSync(path.join(stagedProjectDirectory, "desktop", "main.mjs"), "utf8");
  assert.match(source, /http:\/\/127\.0\.0\.1:47821/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /ZHIXU_NO_BROWSER:\s*"1"/);
  assert.match(source, /app\.isPackaged/);
  assert.match(source, /ZHIXU_DATA_DIR/);
  assert.match(source, /ZHIXU_ENV_FILE/);
  assert.match(source, /requestSingleInstanceLock/);
});

test("desktop shell includes a native startup surface and brand asset", () => {
  /** splash 是本地启动页。 */
  const splash = fs.readFileSync(path.join(stagedProjectDirectory, "desktop", "splash.html"), "utf8");
  /** icon 是不依赖网络资源的矢量品牌图标。 */
  const icon = fs.readFileSync(path.join(stagedProjectDirectory, "desktop", "assets", "zhixu-icon.svg"), "utf8");
  assert.match(splash, /正在连接你的本地知识库/);
  assert.match(splash, /本机数据/);
  assert.match(icon, /知序桌面版图标/);
});

test("Windows installer excludes local knowledge data and private configuration", () => {
  /** packageManifest 是桌面打包入口和 electron-builder 文件白名单。 */
  const packageManifest = JSON.parse(
    fs.readFileSync(path.join(stagedProjectDirectory, "package.json"), "utf8"),
  );
  assert.equal(packageManifest.main, "desktop/main.mjs");
  assert.equal(packageManifest.build.asar, false);
  assert.equal(packageManifest.build.nsis.createDesktopShortcut, true);
  assert.ok(packageManifest.build.files.includes("certificates/**/*"));
  assert.ok(packageManifest.build.files.includes("!data/**/*"));
  assert.ok(packageManifest.build.files.includes("!.env.local"));
  assert.ok(packageManifest.build.files.includes("!work/**/*"));
});
