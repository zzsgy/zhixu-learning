import assert from "node:assert/strict";
import test from "node:test";
import { createActivityDashboardRouteHandler } from "../lib/http/routes/activity-dashboard-routes.mjs";
import { createGitHubProjectRouteHandler } from "../lib/http/routes/github-project-routes.mjs";

/** 路由模块使用纯依赖注入，专项测试不会初始化 SQLite 或访问公网。 */

const createRecorder = () => {
  const responses = [];
  return {
    responses,
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  };
};

test("学习统计路由只接管目标 GET 接口并原样传递时间范围", async () => {
  const recorder = createRecorder();
  const requestedDays = [];
  const handler = createActivityDashboardRouteHandler({
    getDashboard: (days) => {
      requestedDays.push(days);
      return { range: { days } };
    },
    sendJson: recorder.sendJson,
  });
  const response = {};

  assert.equal(await handler(
    { method: "GET" },
    response,
    new URL("http://local/api/activity-dashboard?days=14"),
  ), true);
  assert.deepEqual(requestedDays, [14]);
  assert.deepEqual(recorder.responses, [{
    response,
    statusCode: 200,
    payload: { dashboard: { range: { days: 14 } } },
  }]);
  assert.equal(await handler(
    { method: "POST" },
    response,
    new URL("http://local/api/activity-dashboard"),
  ), false);
  assert.equal(await handler(
    { method: "GET" },
    response,
    new URL("http://local/api/other"),
  ), false);
});

test("GitHub 项目路由保持列表、详情、解码和未找到响应契约", async () => {
  const recorder = createRecorder();
  const requestedIds = [];
  const projects = [{ id: "project-1", fullName: "openai/project-1" }];
  const handler = createGitHubProjectRouteHandler({
    getProject: (id) => {
      requestedIds.push(id);
      return id === "project/1" ? projects[0] : null;
    },
    listProjects: (limit) => {
      assert.equal(limit, null);
      return projects;
    },
    readRequestBuffer: async () => Buffer.alloc(0),
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/github-projects"),
  ), true);
  assert.deepEqual(recorder.responses.at(-1), {
    response: {},
    statusCode: 200,
    payload: { projects },
  });
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/github-projects/project%2F1"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.equal(recorder.responses.at(-1).payload.project.id, "project-1");
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/github-projects/missing"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(requestedIds, ["project/1", "missing"]);
});

test("GitHub 分析路由保持请求上限、密钥边界、备份顺序和 201 响应", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const analysisCalls = [];
  const snapshot = { id: "snapshot-1", fullName: "openai/zhixu" };
  const storedProject = { ...snapshot, analyzedAt: "2026-09-16T08:00:00.000Z" };
  const handler = createGitHubProjectRouteHandler({
    analyzeRepository: async (url, options) => {
      analysisCalls.push({ url, options });
      sequence.push("analyze");
      return snapshot;
    },
    config: {
      githubToken: "github-test-token",
      deepSeekApiKey: "deepseek-test-key",
      deepSeekModel: "deepseek-test-model",
    },
    createBackup: () => sequence.push("backup"),
    getProject: () => null,
    listProjects: () => [],
    readRequestBuffer: async (request, byteLimit) => {
      assert.equal(byteLimit, 64 * 1024);
      return Buffer.from(JSON.stringify({ url: request.repositoryUrl }), "utf8");
    },
    saveProject: (project) => {
      sequence.push("save");
      assert.equal(project, snapshot);
      return storedProject;
    },
    sendJson: recorder.sendJson,
  });
  const response = {};

  assert.equal(await handler(
    { method: "POST", repositoryUrl: "https://github.com/openai/zhixu" },
    response,
    new URL("http://local/api/github-projects/analyze"),
  ), true);
  assert.deepEqual(analysisCalls, [{
    url: "https://github.com/openai/zhixu",
    options: {
      githubToken: "github-test-token",
      deepSeekApiKey: "deepseek-test-key",
      deepSeekModel: "deepseek-test-model",
    },
  }]);
  assert.deepEqual(sequence, ["analyze", "backup", "save"]);
  assert.deepEqual(recorder.responses, [{
    response,
    statusCode: 201,
    payload: { project: storedProject },
  }]);
  assert.equal(await handler(
    { method: "POST" },
    {},
    new URL("http://local/api/github-projects/project-1"),
  ), false);
});
