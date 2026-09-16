import assert from "node:assert/strict";
import test from "node:test";
import { createReadingRouteHandler } from "../lib/http/routes/reading-routes.mjs";

const createRecorder = () => {
  const responses = [];
  return {
    responses,
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  };
};

test("阅读工作区路由保留查询清理、请求上限和未找到响应", async () => {
  const recorder = createRecorder();
  const workspaceCalls = [];
  const stateCalls = [];
  const byteLimits = [];
  const workspace = { targetType: "article", targetId: "article-1" };
  const state = { ...workspace, progressPercent: 75 };
  const handler = createReadingRouteHandler({
    getWorkspace: (targetType, targetId) => {
      workspaceCalls.push([targetType, targetId]);
      return targetId === "article-1" ? workspace : null;
    },
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    sendJson: recorder.sendJson,
    updateState: (targetType, targetId, payload) => {
      stateCalls.push([targetType, targetId, payload]);
      return targetId === "article-1" ? state : null;
    },
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/reading-workspace?targetType=%20article%20&targetId=%20article-1%20"),
  ), true);
  assert.deepEqual(recorder.responses.at(-1), {
    response: {},
    statusCode: 200,
    payload: { workspace },
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/reading-workspace?targetType=article&targetId=missing"),
  ), true);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到对应的阅读内容。" });
  assert.equal(recorder.responses.at(-1).statusCode, 404);

  const payload = { targetType: "article", targetId: "article-1", progressPercent: 75 };
  assert.equal(await handler(
    { method: "PATCH", payload },
    {},
    new URL("http://local/api/reading-workspace"),
  ), true);
  assert.deepEqual(recorder.responses.at(-1).payload, { state });
  assert.equal(recorder.responses.at(-1).statusCode, 200);

  assert.equal(await handler(
    { method: "PATCH", payload: { targetType: "article", targetId: "missing" } },
    {},
    new URL("http://local/api/reading-workspace"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(workspaceCalls, [
    ["article", "article-1"],
    ["article", "missing"],
  ]);
  assert.deepEqual(stateCalls, [
    ["article", "article-1", payload],
    ["article", "missing", { targetType: "article", targetId: "missing" }],
  ]);
  assert.deepEqual(byteLimits, [8_500_000, 8_500_000]);
});

test("阅读会话路由保留进度转换、会话 ID 解码和 404 语义", async () => {
  const recorder = createRecorder();
  const byteLimits = [];
  const startCalls = [];
  const updateCalls = [];
  const createdSession = { id: "session-1", progressPercent: 42 };
  const updatedSession = { id: "session/1", activeSeconds: 30 };
  const handler = createReadingRouteHandler({
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    sendJson: recorder.sendJson,
    startSession: (targetType, targetId, progressPercent) => {
      startCalls.push([targetType, targetId, progressPercent]);
      return targetId === "article-1" ? createdSession : null;
    },
    updateSession: (sessionId, payload) => {
      updateCalls.push([sessionId, payload]);
      return sessionId === "session/1" ? updatedSession : null;
    },
  });

  const createPayload = { targetType: "article", targetId: "article-1", progressPercent: "42" };
  assert.equal(await handler(
    { method: "POST", payload: createPayload },
    {},
    new URL("http://local/api/reading-sessions"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 201);
  assert.deepEqual(recorder.responses.at(-1).payload, { session: createdSession });

  assert.equal(await handler(
    { method: "POST", payload: { targetType: "article", targetId: "missing", progressPercent: "bad" } },
    {},
    new URL("http://local/api/reading-sessions"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到对应的阅读内容。" });

  const updatePayload = { progressPercent: 60, activeSeconds: 30 };
  assert.equal(await handler(
    { method: "POST", payload: updatePayload },
    {},
    new URL("http://local/api/reading-sessions/session%2F1"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.deepEqual(recorder.responses.at(-1).payload, { session: updatedSession });

  assert.equal(await handler(
    { method: "POST", payload: {} },
    {},
    new URL("http://local/api/reading-sessions/missing"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到对应的阅读会话。" });
  assert.deepEqual(startCalls, [
    ["article", "article-1", 42],
    ["article", "missing", 0],
  ]);
  assert.deepEqual(updateCalls, [
    ["session/1", updatePayload],
    ["missing", {}],
  ]);
  assert.deepEqual(byteLimits, [64 * 1024, 64 * 1024, 64 * 1024, 64 * 1024]);
});

test("高亮批注路由在成功写入后备份，并保留请求上限和 ID 解码", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const byteLimits = [];
  const created = { id: "annotation-1", quoteText: "片段" };
  const updated = { id: "annotation/1", noteText: "说明" };
  const handler = createReadingRouteHandler({
    createAnnotation: (targetType, targetId, payload) => {
      sequence.push(["create", targetType, targetId, payload]);
      return created;
    },
    createBackup: () => sequence.push(["backup"]),
    deleteAnnotation: (annotationId) => {
      sequence.push(["delete", annotationId]);
      return true;
    },
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    sendJson: recorder.sendJson,
    updateAnnotation: (annotationId, payload) => {
      sequence.push(["update", annotationId, payload]);
      return updated;
    },
  });

  const createPayload = { targetType: "article", targetId: "article-1", quoteText: "片段" };
  assert.equal(await handler(
    { method: "POST", payload: createPayload },
    {},
    new URL("http://local/api/reading-annotations"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 201);
  assert.deepEqual(recorder.responses.at(-1).payload, { annotation: created });

  const updatePayload = { noteText: "说明" };
  assert.equal(await handler(
    { method: "PATCH", payload: updatePayload },
    {},
    new URL("http://local/api/reading-annotations/annotation%2F1"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.deepEqual(recorder.responses.at(-1).payload, { annotation: updated });

  assert.equal(await handler(
    { method: "DELETE" },
    {},
    new URL("http://local/api/reading-annotations/annotation%2F1"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.deepEqual(recorder.responses.at(-1).payload, { deleted: true });
  assert.deepEqual(sequence, [
    ["create", "article", "article-1", createPayload],
    ["backup"],
    ["update", "annotation/1", updatePayload],
    ["backup"],
    ["delete", "annotation/1"],
    ["backup"],
  ]);
  assert.deepEqual(byteLimits, [256 * 1024, 256 * 1024]);
});

test("高亮批注失败时不备份，非目标请求不被路由接管", async () => {
  const recorder = createRecorder();
  let backupCount = 0;
  const handler = createReadingRouteHandler({
    createAnnotation: () => null,
    createBackup: () => { backupCount += 1; },
    deleteAnnotation: () => false,
    readRequestBuffer: async () => Buffer.from("{}", "utf8"),
    sendJson: recorder.sendJson,
    updateAnnotation: () => null,
  });

  assert.equal(await handler(
    { method: "POST" },
    {},
    new URL("http://local/api/reading-annotations"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到对应的阅读内容。" });

  assert.equal(await handler(
    { method: "PATCH" },
    {},
    new URL("http://local/api/reading-annotations/missing"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到这条批注。" });

  assert.equal(await handler(
    { method: "DELETE" },
    {},
    new URL("http://local/api/reading-annotations/missing"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.equal(backupCount, 0);
  assert.equal(await handler(
    { method: "PUT" },
    {},
    new URL("http://local/api/reading-workspace"),
  ), false);
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/other"),
  ), false);
});
