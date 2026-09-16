import assert from "node:assert/strict";
import test from "node:test";
import { createImportJobRouteHandler } from "../lib/http/routes/import-job-routes.mjs";

function createRecorder() {
  const responses = [];
  return {
    responses,
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  };
}

function createDependencies(overrides = {}) {
  return {
    attachLocations: (jobs) => jobs.map((job) => ({ ...job, location: "待整理" })),
    confirmVideoJob: () => null,
    getJob: () => null,
    getRunnerStatus: () => ({ running: false }),
    listJobs: () => [],
    readRequestBuffer: async () => Buffer.from("{}"),
    retryJob: () => null,
    sendJson: () => {},
    triggerRunner: () => {},
    ...overrides,
  };
}

test("后台任务列表路由透传筛选、补齐位置并返回执行器状态", async () => {
  const recorder = createRecorder();
  const filters = [];
  const handler = createImportJobRouteHandler(createDependencies({
    getRunnerStatus: () => ({ running: true, currentJobId: "job-1" }),
    listJobs: (value) => {
      filters.push(value);
      return [{ id: "job-1" }];
    },
    sendJson: recorder.sendJson,
  }));

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/import-jobs?status=failed&jobType=video_transcript&limit=12"),
  ), true);
  assert.deepEqual(filters, [{ status: "failed", jobType: "video_transcript", limit: 12 }]);
  assert.deepEqual(recorder.responses[0], {
    response: {},
    statusCode: 200,
    payload: {
      jobs: [{ id: "job-1", location: "待整理" }],
      runner: { running: true, currentJobId: "job-1" },
    },
  });
});

test("后台任务详情路由解码 ID 并保留成功和 404 语义", async () => {
  const recorder = createRecorder();
  const ids = [];
  const handler = createImportJobRouteHandler(createDependencies({
    getJob: (id) => {
      ids.push(id);
      return id === "missing" ? null : { id };
    },
    sendJson: recorder.sendJson,
  }));

  assert.equal(await handler(
    { method: "GET" }, {}, new URL("http://local/api/import-jobs/job%2F1"),
  ), true);
  assert.deepEqual(ids, ["job/1"]);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.equal(recorder.responses.at(-1).payload.job.location, "待整理");
  assert.equal(await handler(
    { method: "GET" }, {}, new URL("http://local/api/import-jobs/missing"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到这项导入任务。" });
});

test("后台任务重试路由只在重新排队成功后唤醒执行器", async () => {
  const recorder = createRecorder();
  const ids = [];
  let triggerCount = 0;
  const handler = createImportJobRouteHandler(createDependencies({
    retryJob: (id) => {
      ids.push(id);
      return id === "failed/job" ? { id, status: "queued" } : null;
    },
    sendJson: recorder.sendJson,
    triggerRunner: () => { triggerCount += 1; },
  }));

  assert.equal(await handler(
    { method: "POST" }, {}, new URL("http://local/api/import-jobs/failed%2Fjob/retry"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 202);
  assert.equal(triggerCount, 1);
  assert.equal(await handler(
    { method: "POST" }, {}, new URL("http://local/api/import-jobs/running/retry"),
  ), true);
  assert.deepEqual(ids, ["failed/job", "running"]);
  assert.equal(recorder.responses.at(-1).statusCode, 409);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "只有失败的导入任务可以重试。" });
  assert.equal(triggerCount, 1);
});

test("视频确认路由校验动作、限制请求体并只在确认成功后唤醒执行器", async () => {
  const recorder = createRecorder();
  const calls = [];
  const limits = [];
  let requestPayload = { action: "invalid" };
  let triggerCount = 0;
  const handler = createImportJobRouteHandler(createDependencies({
    confirmVideoJob: (id, action) => {
      calls.push({ id, action });
      return id === "video/1" ? { id, status: "queued" } : null;
    },
    readRequestBuffer: async (request, limit) => {
      limits.push(limit);
      return Buffer.from(JSON.stringify(requestPayload));
    },
    sendJson: recorder.sendJson,
    triggerRunner: () => { triggerCount += 1; },
  }));

  assert.equal(await handler(
    { method: "POST" }, {}, new URL("http://local/api/import-jobs/video%2F1/confirm"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 400);
  assert.deepEqual(calls, []);
  requestPayload = { action: "generate_study_pdf" };
  assert.equal(await handler(
    { method: "POST" }, {}, new URL("http://local/api/import-jobs/video%2F1/confirm"),
  ), true);
  assert.deepEqual(calls, [{ id: "video/1", action: "generate_study_pdf" }]);
  assert.equal(recorder.responses.at(-1).statusCode, 202);
  assert.equal(triggerCount, 1);
  requestPayload = { action: "save_link" };
  assert.equal(await handler(
    { method: "POST" }, {}, new URL("http://local/api/import-jobs/other/confirm"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 409);
  assert.equal(triggerCount, 1);
  assert.deepEqual(limits, [16 * 1024, 16 * 1024, 16 * 1024]);
  assert.equal(await handler(
    { method: "DELETE" }, {}, new URL("http://local/api/import-jobs/video%2F1"),
  ), false);
});
