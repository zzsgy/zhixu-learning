/**
 * 视频后台任务、无字幕确认与文章落库集成测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

/** videoPort 是本测试独占端口。 */
const videoPort = 47834;
/** videoBaseUrl 是隔离服务地址。 */
const videoBaseUrl = `http://127.0.0.1:${videoPort}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${videoBaseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // 子进程尚未监听时继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("视频导入测试服务未能按时启动。");
}

/**
 * 等待后台任务达到指定阶段或完成状态。
 *
 * @param {string} jobId 任务 ID。
 * @param {Function} predicate 结束条件。
 * @returns {Promise<Record<string, unknown>>} 最新任务。
 */
async function waitForJob(jobId, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${videoBaseUrl}/api/import-jobs/${encodeURIComponent(jobId)}`);
    const payload = await response.json();
    if (predicate(payload.job)) return payload.job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("视频导入任务未在预期时间内更新。");
}

test("无公开字幕的视频等待确认，确认后仅保存链接文章", async () => {
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(path.join(testDataRoot, "zhixu-video-api-"));
  const serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      ZHIXU_DATA_DIR: temporaryDirectory,
      ZHIXU_PORT: String(videoPort),
      ZHIXU_NO_BROWSER: "1",
      ZHIXU_DISABLE_CODEX_WORKER: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: "ignore",
  });
  try {
    await waitForServer();
    const indexHtml = await (await fetch(`${videoBaseUrl}/`)).text();
    assert.match(indexHtml, /id="video-import-form"/);

    const createResponse = await fetch(`${videoBaseUrl}/api/videos/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/public-video" }),
    });
    assert.equal(createResponse.status, 202);
    const createPayload = await createResponse.json();
    const waitingJob = await waitForJob(
      createPayload.job.id,
      (job) => job.stage === "awaiting_confirmation",
    );
    assert.equal(waitingJob.status, "failed");
    assert.match(waitingJob.errorMessage, /独立字幕轨/);

    const confirmResponse = await fetch(
      `${videoBaseUrl}/api/import-jobs/${encodeURIComponent(waitingJob.id)}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_link" }),
      },
    );
    assert.equal(confirmResponse.status, 202);
    const completedJob = await waitForJob(
      waitingJob.id,
      (job) => job.status === "completed",
    );
    assert.equal(completedJob.result.savedLinkOnly, true);
    assert.equal(completedJob.targetType, "article");

    const articleResponse = await fetch(
      `${videoBaseUrl}/api/articles/${encodeURIComponent(completedJob.targetId)}`,
    );
    const articlePayload = await articleResponse.json();
    assert.equal(articlePayload.article.sourceType, "video");
    assert.match(articlePayload.article.contentText, /没有下载视频或音频/);
  } finally {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
