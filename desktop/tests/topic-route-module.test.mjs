import assert from "node:assert/strict";
import test from "node:test";
import { createTopicRouteHandler } from "../lib/http/routes/topic-routes.mjs";

const createRecorder = () => {
  const responses = [];
  return {
    responses,
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  };
};

test("专题列表和创建路由保持 256 KB 上限、201 响应及成功后备份", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const byteLimits = [];
  const topic = { id: "topic-1", name: "Agent" };
  const handler = createTopicRouteHandler({
    createBackup: () => sequence.push("backup"),
    createTopic: (payload) => {
      sequence.push("create");
      if (payload.name === "失败") throw new Error("模拟专题失败");
      return topic;
    },
    listTopics: () => [topic],
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/topics"),
  ), true);
  assert.deepEqual(recorder.responses.at(-1).payload, { topics: [topic] });
  assert.equal(await handler(
    { method: "POST", payload: { name: "Agent" } },
    {},
    new URL("http://local/api/topics"),
  ), true);
  assert.deepEqual(sequence, ["create", "backup"]);
  assert.equal(recorder.responses.at(-1).statusCode, 201);
  assert.deepEqual(byteLimits, [256 * 1024]);
  await assert.rejects(
    handler(
      { method: "POST", payload: { name: "失败" } },
      {},
      new URL("http://local/api/topics"),
    ),
    /模拟专题失败/,
  );
  assert.deepEqual(sequence, ["create", "backup", "create"]);
});

test("专题内容列表路由解码专题 ID 并原样返回摘要列表", async () => {
  const recorder = createRecorder();
  const requestedIds = [];
  const items = [{ targetType: "document", targetId: "document-1" }];
  const handler = createTopicRouteHandler({
    listItems: (topicId) => {
      requestedIds.push(topicId);
      return items;
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/topics/topic%2F1/items"),
  ), true);
  assert.deepEqual(requestedIds, ["topic/1"]);
  assert.deepEqual(recorder.responses.at(-1), {
    response: {},
    statusCode: 200,
    payload: { items },
  });
});

test("专题内容增删路由保持参数、请求上限、备份顺序和非目标放行", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const byteLimits = [];
  const addedItems = [{ targetId: "document-1" }];
  const remainingItems = [{ targetId: "article-1" }];
  const handler = createTopicRouteHandler({
    addItem: (...args) => {
      sequence.push(["add", ...args]);
      return addedItems;
    },
    createBackup: () => sequence.push(["backup"]),
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    removeItem: (...args) => {
      sequence.push(["remove", ...args]);
      return remainingItems;
    },
    sendJson: recorder.sendJson,
  });
  const payload = { topicId: "topic/1", targetType: "document", targetId: "document-1" };

  assert.equal(await handler(
    { method: "POST", payload },
    {},
    new URL("http://local/api/topic-items"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 201);
  assert.deepEqual(recorder.responses.at(-1).payload, { items: addedItems });
  assert.equal(await handler(
    { method: "DELETE" },
    {},
    new URL("http://local/api/topic-items?topicId=topic%2F1&targetType=document&targetId=document-1"),
  ), true);
  assert.deepEqual(recorder.responses.at(-1).payload, { items: remainingItems });
  assert.deepEqual(byteLimits, [256 * 1024]);
  assert.deepEqual(sequence, [
    ["add", "topic/1", "document", "document-1"],
    ["backup"],
    ["remove", "topic/1", "document", "document-1"],
    ["backup"],
  ]);
  assert.equal(await handler(
    { method: "PATCH" },
    {},
    new URL("http://local/api/topics"),
  ), false);
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/other"),
  ), false);
});
