import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createImportJobStore } from "../lib/db/stores/import-jobs.mjs";

function createImportJobDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE import_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      source_label TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued', 'running', 'completed', 'failed')),
      stage TEXT NOT NULL DEFAULT 'queued',
      progress_percent REAL NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      target_type TEXT,
      target_id TEXT,
      error_message TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
  `);
  return database;
}

function createStore(database, initialTime = "2026-09-16T08:00:00.000Z") {
  let currentTime = initialTime;
  let uuidIndex = 0;
  return {
    store: createImportJobStore(database, {
      currentDate: () => new Date(currentTime),
      randomUUID: () => `uuid-${++uuidIndex}`,
    }),
    setTime: (value) => { currentTime = value; },
  };
}

test("后台任务仓储创建、规范化、筛选并安全处理损坏 JSON", () => {
  const database = createImportJobDatabase();
  try {
    const { store, setTime } = createStore(database);
    assert.throws(() => store.createImportJob({ jobType: "not valid!" }), /导入任务类型无效/);
    const first = store.createImportJob({
      jobType: "document_ocr",
      sourceLabel: "  扫描   文档  ",
      sourceUrl: "  https://example.com/a.pdf  ",
      payload: { documentId: "document-1" },
      targetType: "document",
      targetId: "document-1",
    });
    setTime("2026-09-16T09:00:00.000Z");
    const second = store.createImportJob({ jobType: "video_transcript", sourceLabel: "视频" });

    assert.equal(first.id, "import_uuid-1");
    assert.equal(first.sourceLabel, "扫描 文档");
    assert.equal(first.sourceUrl, "https://example.com/a.pdf");
    assert.deepEqual(first.payload, { documentId: "document-1" });
    assert.deepEqual(store.listImportJobs().map((job) => job.id), [second.id, first.id]);
    assert.deepEqual(store.listImportJobs({ jobType: "document_ocr" }).map((job) => job.id), [first.id]);
    assert.deepEqual(store.listImportJobs({ status: "queued", limit: 1 }).map((job) => job.id), [second.id]);

    database.prepare("UPDATE import_jobs SET payload_json = '{bad', result_json = '[]' WHERE id = ?")
      .run(first.id);
    assert.deepEqual(store.getImportJob(first.id).payload, {});
    assert.deepEqual(store.getImportJob(first.id).result, {});
    assert.equal(store.getImportJob("missing"), null);
  } finally {
    database.close();
  }
});

test("后台任务仓储原子领取、限制运行进度并完成任务", () => {
  const database = createImportJobDatabase();
  try {
    const { store, setTime } = createStore(database);
    const created = store.createImportJob({ jobType: "document_ocr", sourceLabel: "文档" });
    setTime("2026-09-16T08:05:00.000Z");
    const claimed = store.claimNextImportJob(["invalid type", "document_ocr", "document_ocr"]);
    assert.equal(claimed.id, created.id);
    assert.equal(claimed.status, "running");
    assert.equal(claimed.stage, "starting");
    assert.equal(claimed.progressPercent, 1);
    assert.equal(claimed.attemptCount, 1);
    assert.equal(store.claimNextImportJob(["document_ocr"]), null);
    assert.equal(store.claimNextImportJob([]), null);

    const progressed = store.updateImportJobProgress(created.id, {
      stage: "recognizing",
      progressPercent: 120,
    });
    assert.equal(progressed.stage, "recognizing");
    assert.equal(progressed.progressPercent, 99);
    const completed = store.completeImportJob(created.id, {
      targetType: "document",
      targetId: "document-1",
      pageCount: 4,
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.progressPercent, 100);
    assert.equal(completed.targetId, "document-1");
    assert.equal(completed.result.pageCount, 4);
  } finally {
    database.close();
  }
});

test("后台任务仓储持久化延迟重试并只在到期后重新领取", () => {
  const database = createImportJobDatabase();
  try {
    const { store, setTime } = createStore(database);
    const created = store.createImportJob({ jobType: "browser_capture" });
    store.claimNextImportJob(["browser_capture"]);
    setTime("2026-09-16T08:10:00.000Z");
    const deferred = store.deferImportJob(created.id, new Error("来源繁忙"), 5_000);
    assert.equal(deferred.status, "queued");
    assert.equal(deferred.stage, "waiting_retry");
    assert.equal(deferred.retryCount, 1);
    assert.equal(deferred.nextAttemptAt, "2026-09-16T08:10:05.000Z");
    assert.equal(store.getNextImportJobAttemptAt(["browser_capture"]), deferred.nextAttemptAt);
    assert.equal(store.getNextImportJobAttemptAt([]), null);
    assert.equal(store.claimNextImportJob(["browser_capture"]), null);

    setTime("2026-09-16T08:10:05.000Z");
    const claimedAgain = store.claimNextImportJob(["browser_capture"]);
    assert.equal(claimedAgain.id, created.id);
    assert.equal(claimedAgain.attemptCount, 2);
    assert.equal(claimedAgain.retryCount, 1);
    assert.equal(claimedAgain.nextAttemptAt, null);
  } finally {
    database.close();
  }
});

test("后台任务仓储区分失败重试与服务中断恢复", () => {
  const database = createImportJobDatabase();
  try {
    const { store, setTime } = createStore(database);
    const first = store.createImportJob({ jobType: "paper_import" });
    store.claimNextImportJob(["paper_import"]);
    const failed = store.failImportJob(first.id, new Error("解析失败"));
    assert.equal(failed.status, "failed");
    assert.equal(failed.stage, "failed");
    assert.equal(failed.errorMessage, "解析失败");
    assert.equal(store.retryImportJob("missing"), null);
    const retried = store.retryImportJob(first.id);
    assert.equal(retried.status, "queued");
    assert.equal(retried.errorMessage, "");

    const second = store.createImportJob({ jobType: "document_ocr" });
    store.claimNextImportJob(["document_ocr"]);
    setTime("2026-09-16T09:00:00.000Z");
    assert.equal(store.resetInterruptedImportJobs(), 1);
    const recovered = store.getImportJob(second.id);
    assert.equal(recovered.status, "queued");
    assert.equal(recovered.progressPercent, 0);
    assert.equal(recovered.startedAt, null);
  } finally {
    database.close();
  }
});

test("后台任务仓储只确认正在等待选择的无字幕视频", () => {
  const database = createImportJobDatabase();
  try {
    const { store } = createStore(database);
    const video = store.createImportJob({
      jobType: "video_transcript",
      payload: { videoUrl: "https://example.com/video" },
    });
    store.claimNextImportJob(["video_transcript"]);
    const confirmationError = new Error("没有可用字幕");
    confirmationError.code = "IMPORT_CONFIRMATION_REQUIRED";
    const waiting = store.failImportJob(video.id, confirmationError);
    assert.equal(waiting.stage, "awaiting_confirmation");
    assert.throws(() => store.confirmVideoImportJob(video.id, "invalid"), /不支持的视频确认动作/);
    const confirmed = store.confirmVideoImportJob(video.id, "generate_study_pdf");
    assert.equal(confirmed.status, "queued");
    assert.equal(confirmed.stage, "queued");
    assert.deepEqual(confirmed.payload, {
      videoUrl: "https://example.com/video",
      confirmationAction: "generate_study_pdf",
    });
    assert.equal(store.confirmVideoImportJob(video.id, "save_link"), null);

    const other = store.createImportJob({ jobType: "document_ocr" });
    assert.equal(store.confirmVideoImportJob(other.id, "save_link"), null);
  } finally {
    database.close();
  }
});
