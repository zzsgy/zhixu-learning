/**
 * 通用后台导入任务与浏览器客户端授权测试。
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 等待异步任务达到指定状态。
 *
 * @param {object} databaseModule 数据库模块。
 * @param {string} jobId 任务 ID。
 * @param {string} expectedStatus 目标状态。
 * @returns {Promise<Record<string, unknown>>} 最终任务。
 */
async function waitForJob(databaseModule, jobId, expectedStatus) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    /** job 是当前轮询读取的任务状态。 */
    const job = databaseModule.getImportJob(jobId);
    if (job?.status === expectedStatus) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`任务未进入状态：${expectedStatus}`);
}

test("后台导入任务可恢复重试，浏览器令牌可验证撤销", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内允许写入的测试根目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是本测试独占的 SQLite 目录。 */
  const temporaryDirectory = fs.mkdtempSync(path.join(testDataRoot, "zhixu-import-jobs-"));
  process.env.ZHIXU_DATA_DIR = temporaryDirectory;
  /** databaseModule 是隔离数据目录加载的数据库模块。 */
  const databaseModule = await import("../lib/database.mjs");
  /** runnerModule 是通用任务执行器。 */
  const runnerModule = await import("../lib/import-job-runner.mjs");
  try {
    /** interruptedJob 模拟服务异常退出时仍处于 running 的任务。 */
    const interruptedJob = databaseModule.createImportJob({
      jobType: "test_import",
      sourceLabel: "中断恢复测试",
      payload: { value: 1 },
    });
    databaseModule.claimNextImportJob(["test_import"]);
    assert.equal(databaseModule.getImportJob(interruptedJob.id).status, "running");

    /** runner 启动时应恢复中断任务并顺序完成。 */
    const runner = runnerModule.createImportJobRunner({
      handlers: {
        async test_import(job, context) {
          context.updateProgress({ stage: "recognizing", progressPercent: 55 });
          return {
            targetType: "article",
            targetId: `result_${job.payload.value}`,
            title: job.sourceLabel,
          };
        },
      },
    });
    runner.start();
    const recoveredResult = await waitForJob(
      databaseModule,
      interruptedJob.id,
      "completed",
    );
    assert.equal(recoveredResult.progressPercent, 100);
    assert.equal(recoveredResult.targetId, "result_1");
    assert.equal(recoveredResult.attemptCount, 2);

    /** failedJob 验证失败信息和人工重试状态。 */
    const failedJob = databaseModule.createImportJob({
      jobType: "unsupported_test",
      sourceLabel: "失败重试测试",
    });
    databaseModule.claimNextImportJob(["unsupported_test"]);
    databaseModule.failImportJob(failedJob.id, new Error("模拟识别失败"));
    assert.match(databaseModule.getImportJob(failedJob.id).errorMessage, /模拟识别失败/);
    const retriedJob = databaseModule.retryImportJob(failedJob.id);
    assert.equal(retriedJob.status, "queued");
    assert.equal(retriedJob.errorMessage, "");

    /** confirmationJob 验证无字幕视频必须显式确认后才能仅保存链接。 */
    const confirmationJob = databaseModule.createImportJob({
      jobType: "video_transcript",
      sourceLabel: "无字幕视频",
      sourceUrl: "https://example.com/video",
      payload: { url: "https://example.com/video" },
    });
    databaseModule.claimNextImportJob(["video_transcript"]);
    const confirmationError = new Error("当前视频没有可读取的独立字幕轨；画面中可能仍有硬字幕。");
    confirmationError.code = "IMPORT_CONFIRMATION_REQUIRED";
    databaseModule.failImportJob(confirmationJob.id, confirmationError);
    const waitingJob = databaseModule.getImportJob(confirmationJob.id);
    assert.equal(waitingJob.status, "failed");
    assert.equal(waitingJob.stage, "awaiting_confirmation");
    const confirmedJob = databaseModule.confirmVideoImportJob(
      confirmationJob.id,
      "save_link",
    );
    assert.equal(confirmedJob.status, "queued");
    assert.equal(confirmedJob.payload.confirmationAction, "save_link");
    databaseModule.claimNextImportJob(["video_transcript"]);
    databaseModule.completeImportJob(confirmedJob.id, { savedLinkOnly: true });

    /** pdfConfirmationJob 验证用户也可明确选择本地转写与图文 PDF。 */
    const pdfConfirmationJob = databaseModule.createImportJob({
      jobType: "video_transcript",
      sourceLabel: "硬字幕视频",
      sourceUrl: "https://example.com/hard-subtitle-video",
      payload: { url: "https://example.com/hard-subtitle-video" },
    });
    databaseModule.claimNextImportJob(["video_transcript"]);
    databaseModule.failImportJob(pdfConfirmationJob.id, confirmationError);
    const pdfConfirmedJob = databaseModule.confirmVideoImportJob(
      pdfConfirmationJob.id,
      "generate_study_pdf",
    );
    assert.equal(pdfConfirmedJob.status, "queued");
    assert.equal(pdfConfirmedJob.payload.confirmationAction, "generate_study_pdf");

    /** rawToken 只用于模拟扩展本地保存的随机令牌。 */
    const rawToken = crypto.randomBytes(32).toString("base64url");
    /** tokenHash 是知序数据库唯一保存的不可逆摘要。 */
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const client = databaseModule.registerBrowserClient({
      name: "测试浏览器",
      tokenHash,
    });
    assert.equal(client.active, true);
    assert.equal(Object.hasOwn(client, "tokenHash"), false);
    assert.equal(databaseModule.findBrowserClientByTokenHash(tokenHash).id, client.id);
    databaseModule.touchBrowserClient(client.id);
    assert.ok(databaseModule.listBrowserClients()[0].lastUsedAt);
    assert.equal(databaseModule.revokeBrowserClient(client.id).active, false);
    assert.equal(databaseModule.findBrowserClientByTokenHash(tokenHash), null);
  } finally {
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
