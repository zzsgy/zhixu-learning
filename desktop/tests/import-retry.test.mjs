import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

async function waitFor(read, predicate, message) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

test("临时导入错误持久化退避、服务重启续跑并有界终止", async () => {
  const project = path.resolve(import.meta.dirname, "..");
  const testRoot = path.join(project, ".test-data");
  fs.mkdirSync(testRoot, { recursive: true });
  const dataDirectory = fs.mkdtempSync(path.join(testRoot, "import-retry-"));
  process.env.ZHIXU_DATA_DIR = dataDirectory;
  process.env.ZHIXU_ENV_FILE = path.join(dataDirectory, "absent.env");
  process.env.ZHIXU_DISABLE_CODEX_WORKER = "1";
  const db = await import("../lib/database.mjs");
  const { createImportJobRunner } = await import("../lib/import-job-runner.mjs");
  const { RetryableImportError } = await import("../lib/import-retry.mjs");
  try {
    const resumable = db.createImportJob({ jobType: "retry_resume", sourceLabel: "429 fixture" });
    const firstRunner = createImportJobRunner({
      handlers: {
        retry_resume: async () => {
          throw new RetryableImportError("HTTP 429", { retryAfterMs: 60_000, maxAttempts: 4 });
        },
      },
      getRetryDelay: () => 120,
    });
    firstRunner.start();
    const waiting = await waitFor(
      () => db.getImportJob(resumable.id),
      (job) => job?.stage === "waiting_retry",
      "临时错误未进入等待重试",
    );
    assert.equal(waiting.status, "queued");
    assert.equal(waiting.attemptCount, 1);
    assert.match(waiting.errorMessage, /429/);
    assert.ok(Date.parse(waiting.nextAttemptAt) > Date.now());
    firstRunner.stop();

    const resumedRunner = createImportJobRunner({
      handlers: { retry_resume: async () => ({ recovered: true }) },
      getRetryDelay: () => 10,
    });
    resumedRunner.start();
    const completed = await waitFor(
      () => db.getImportJob(resumable.id),
      (job) => job?.status === "completed",
      "重启后的任务未按期继续",
    );
    assert.equal(completed.attemptCount, 2);
    assert.equal(completed.nextAttemptAt, null);
    resumedRunner.stop();

    const exhausted = db.createImportJob({ jobType: "retry_exhaust", sourceLabel: "503 fixture" });
    const exhaustedRunner = createImportJobRunner({
      handlers: {
        retry_exhaust: async () => {
          throw new RetryableImportError("HTTP 503", { maxAttempts: 3 });
        },
      },
      getRetryDelay: () => 10,
    });
    exhaustedRunner.start();
    const failed = await waitFor(
      () => db.getImportJob(exhausted.id),
      (job) => job?.status === "failed",
      "超过重试上限后任务未终止",
    );
    assert.equal(failed.attemptCount, 3);
    assert.equal(failed.nextAttemptAt, null);
    exhaustedRunner.stop();
    const manuallyRetried = db.retryImportJob(exhausted.id);
    assert.equal(manuallyRetried.status, "queued");
    assert.equal(manuallyRetried.retryCount, 0, "人工重试应获得一组新的自动退避额度");
    assert.equal(manuallyRetried.nextAttemptAt, null);
  } finally {
    db.closeDatabase();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("arXiv Atom 被 429 限流时改读官方摘要页元数据", async () => {
  const { fetchArxivPaperByUrl } = await import("../lib/paper-service.mjs");
  const html = `<!doctype html><html><head>
    <meta name="citation_title" content="Scaling Laws for Neural Language Models">
    <meta name="citation_author" content="Jared Kaplan">
    <meta name="citation_author" content="Sam McCandlish">
    <meta name="citation_date" content="2020/01/23">
    <meta name="citation_pdf_url" content="https://arxiv.org/pdf/2001.08361">
  </head><body><blockquote class="abstract"><span class="descriptor">Abstract:</span> Scaling evidence.</blockquote></body></html>`;
  let calls = 0;
  const paper = await fetchArxivPaperByUrl("https://arxiv.org/abs/2001.08361", {
    fetchExternalResource: async () => {
      calls += 1;
      return calls === 1
        ? new Response("rate limited", { status: 429, headers: { "Retry-After": "60" } })
        : new Response(html, { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(paper.title, "Scaling Laws for Neural Language Models");
  assert.deepEqual(paper.authors, ["Jared Kaplan", "Sam McCandlish"]);
  assert.equal(paper.abstract, "Scaling evidence.");
  assert.equal(paper.metadataSource, "arxiv_abstract");
  assert.equal(paper.sourceUrl, "https://arxiv.org/abs/2001.08361");
});

test("arXiv 两条官方路径均临时失败时保留 Retry-After 供后台退避", async () => {
  const { fetchArxivPaperByUrl } = await import("../lib/paper-service.mjs");
  await assert.rejects(
    fetchArxivPaperByUrl("https://arxiv.org/abs/2001.08361", {
      fetchExternalResource: async () => new Response("busy", { status: 429, headers: { "Retry-After": "7" } }),
    }),
    (error) => error.code === "IMPORT_RETRYABLE" && error.retryAfterMs === 7_000 && error.maxAttempts === 5,
  );
});
