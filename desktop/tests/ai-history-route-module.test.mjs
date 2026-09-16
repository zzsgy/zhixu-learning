import assert from "node:assert/strict";
import test from "node:test";
import { createAiHistoryRouteHandler } from "../lib/http/routes/ai-history-routes.mjs";

const createRecorder = () => {
  const responses = [];
  return {
    responses,
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  };
};

test("AI 问答历史列表路由原样传递搜索和来源过滤参数", async () => {
  const recorder = createRecorder();
  const filters = [];
  const conversations = [{ id: "conversation-1" }];
  const handler = createAiHistoryRouteHandler({
    listConversations: (value) => {
      filters.push(value);
      return conversations;
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/ai/conversations?q=%E6%A3%80%E6%9F%A5%E7%82%B9&targetType=article&targetId=article%2F1"),
  ), true);
  assert.deepEqual(filters, [{ query: "检查点", targetType: "article", targetId: "article/1" }]);
  assert.deepEqual(recorder.responses.at(-1).payload, { conversations });
  assert.equal(recorder.responses.at(-1).statusCode, 200);
});

test("AI 问答历史详情路由解码 ID 并保留成功、404 与非目标语义", async () => {
  const recorder = createRecorder();
  const ids = [];
  const handler = createAiHistoryRouteHandler({
    getConversation: (conversationId) => {
      ids.push(conversationId);
      return conversationId === "missing" ? null : { id: conversationId, messages: [] };
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/ai/conversations/conversation%2F1"),
  ), true);
  assert.deepEqual(ids, ["conversation/1"]);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/ai/conversations/missing"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到这条问答记录。" });
  assert.equal(await handler(
    { method: "POST" },
    {},
    new URL("http://local/api/ai/conversations"),
  ), false);
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/ai/sources"),
  ), false);
});
