/**
 * 浏览器扩展配对、CORS、令牌和快速收藏入口集成测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

/** browserPort 是扩展集成测试的独占端口。 */
const browserPort = 47830;
/** browserBaseUrl 是测试服务地址。 */
const browserBaseUrl = `http://127.0.0.1:${browserPort}`;
/** extensionOrigin 模拟本地加载的 Manifest V3 扩展来源。 */
const extensionOrigin = "chrome-extension://abcdefghijklmnop";

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${browserBaseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // 子进程尚未监听时继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("浏览器收藏测试服务未能按时启动。");
}

test("浏览器扩展必须配对才能创建快速收藏任务", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内允许写入的临时数据根目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是本测试独占的数据库目录。 */
  const temporaryDirectory = fs.mkdtempSync(path.join(testDataRoot, "zhixu-browser-api-"));
  /** serverProcess 是运行本地 API 的隔离子进程。 */
  const serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      ZHIXU_DATA_DIR: temporaryDirectory,
      ZHIXU_PORT: String(browserPort),
      ZHIXU_NO_BROWSER: "1",
      ZHIXU_DISABLE_CODEX_WORKER: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: "ignore",
  });
  try {
    await waitForServer();
    /** manifest 是开发者模式加载扩展时使用的最小权限配置。 */
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectDirectory, "browser-extension", "manifest.json"), "utf8"),
    );
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1:47821/*"]);
    assert.equal(manifest.permissions.includes("activeTab"), true);
    assert.equal(manifest.permissions.includes("<all_urls>"), false);

    /** indexHtml 验证知序页面实际提供配对与任务中心入口。 */
    const indexResponse = await fetch(`${browserBaseUrl}/`);
    const indexHtml = await indexResponse.text();
    assert.match(indexHtml, /id="browser-pairing-button"/);
    assert.match(indexHtml, /id="import-job-list"/);

    /** preflight 验证只向扩展来源开放跨源请求。 */
    const preflight = await fetch(`${browserBaseUrl}/api/browser/captures`, {
      method: "OPTIONS",
      headers: { Origin: extensionOrigin },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), extensionOrigin);

    /** pairingStart 从知序同源页面生成一次性配对码。 */
    const pairingStart = await fetch(`${browserBaseUrl}/api/browser/pairing/start`, {
      method: "POST",
    });
    const pairingPayload = await pairingStart.json();
    assert.match(pairingPayload.code, /^\d{6}$/);

    /** rejectedPair 证明普通网页来源不能消费配对码。 */
    const rejectedPair = await fetch(`${browserBaseUrl}/api/browser/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairingPayload.code }),
    });
    assert.equal(rejectedPair.status, 403);

    /** acceptedPair 是扩展来源使用同一配对码换取令牌。 */
    const acceptedPair = await fetch(`${browserBaseUrl}/api/browser/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ code: pairingPayload.code, name: "测试扩展" }),
    });
    assert.equal(acceptedPair.status, 201);
    const acceptedPayload = await acceptedPair.json();
    assert.ok(acceptedPayload.token.length >= 32);
    assert.equal(acceptedPayload.client.name, "测试扩展");

    /** unauthorizedCapture 验证没有令牌时不能创建任务。 */
    const unauthorizedCapture = await fetch(`${browserBaseUrl}/api/browser/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(unauthorizedCapture.status, 401);

    /** invalidCapture 在令牌正确时仍拒绝浏览器内部页面。 */
    const invalidCapture = await fetch(`${browserBaseUrl}/api/browser/captures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        "X-Zhixu-Capture-Token": acceptedPayload.token,
      },
      body: JSON.stringify({ url: "chrome://settings" }),
    });
    assert.equal(invalidCapture.status, 400);

    /** clientsResponse 供知序页面展示和撤销客户端。 */
    const clientsResponse = await fetch(`${browserBaseUrl}/api/browser/clients`);
    const clientsPayload = await clientsResponse.json();
    assert.equal(clientsPayload.clients.length, 1);
    assert.equal(clientsPayload.clients[0].active, true);
    const revokeResponse = await fetch(
      `${browserBaseUrl}/api/browser/clients/${encodeURIComponent(acceptedPayload.client.id)}`,
      { method: "DELETE" },
    );
    assert.equal(revokeResponse.status, 200);
  } finally {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
