import assert from "node:assert/strict";
import test from "node:test";
import { createKnowledgeCardRouteHandler } from "../lib/http/routes/knowledge-card-routes.mjs";

const createRecorder = () => {
  const responses = [];
  return {
    responses,
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  };
};

test("知识卡片列表和创建路由保持到期参数、256 KB 上限及成功后备份", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const listFilters = [];
  const byteLimits = [];
  const card = { id: "card-1" };
  const handler = createKnowledgeCardRouteHandler({
    createBackup: () => sequence.push("backup"),
    createCard: (payload) => {
      sequence.push(["create", payload.question]);
      if (payload.question === "失败") throw new Error("模拟创建失败");
      return card;
    },
    listCards: (filters) => {
      listFilters.push(filters);
      return [card];
    },
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/knowledge-cards?due=1"),
  ), true);
  assert.deepEqual(listFilters, [{ dueOnly: true }]);
  assert.deepEqual(recorder.responses.at(-1).payload, { cards: [card] });
  assert.equal(await handler(
    { method: "POST", payload: { question: "问题" } },
    {},
    new URL("http://local/api/knowledge-cards"),
  ), true);
  assert.deepEqual(sequence, [["create", "问题"], "backup"]);
  assert.equal(recorder.responses.at(-1).statusCode, 201);
  assert.deepEqual(byteLimits, [256 * 1024]);
  await assert.rejects(
    handler(
      { method: "POST", payload: { question: "失败" } },
      {},
      new URL("http://local/api/knowledge-cards"),
    ),
    /模拟创建失败/,
  );
  assert.deepEqual(sequence, [["create", "问题"], "backup", ["create", "失败"]]);
});

test("知识卡片复习路由解码 ID、限制 32 KB、默认评价并仅在成功后备份", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const byteLimits = [];
  const handler = createKnowledgeCardRouteHandler({
    createBackup: () => sequence.push(["backup"]),
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    reviewCard: (cardId, rating) => {
      sequence.push(["review", cardId, rating]);
      return cardId === "missing" ? null : { id: cardId, rating };
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "POST", payload: {} },
    {},
    new URL("http://local/api/knowledge-cards/card%2F1/review"),
  ), true);
  assert.deepEqual(sequence, [["review", "card/1", "good"], ["backup"]]);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.deepEqual(byteLimits, [32 * 1024]);
  assert.equal(await handler(
    { method: "POST", payload: { rating: "again" } },
    {},
    new URL("http://local/api/knowledge-cards/missing/review"),
  ), true);
  assert.deepEqual(sequence.at(-1), ["review", "missing", "again"]);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到这张知识卡片。" });
  assert.deepEqual(byteLimits, [32 * 1024, 32 * 1024]);
});

test("知识卡片删除保持删除前备份、404 文案、ID 解码和非目标放行", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const handler = createKnowledgeCardRouteHandler({
    createBackup: () => sequence.push(["backup"]),
    deleteCard: (cardId) => {
      sequence.push(["delete", cardId]);
      return cardId !== "missing";
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "DELETE" },
    {},
    new URL("http://local/api/knowledge-cards/card%2F1"),
  ), true);
  assert.deepEqual(sequence, [["backup"], ["delete", "card/1"]]);
  assert.deepEqual(recorder.responses.at(-1).payload, { deleted: true });
  assert.equal(await handler(
    { method: "DELETE" },
    {},
    new URL("http://local/api/knowledge-cards/missing"),
  ), true);
  assert.deepEqual(sequence.slice(-2), [["backup"], ["delete", "missing"]]);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到这张知识卡片。" });
  assert.equal(await handler(
    { method: "PATCH" },
    {},
    new URL("http://local/api/knowledge-cards/card-1"),
  ), false);
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/other"),
  ), false);
});
