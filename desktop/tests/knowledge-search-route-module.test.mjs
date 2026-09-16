import assert from "node:assert/strict";
import test from "node:test";
import { createKnowledgeSearchRouteHandler } from "../lib/http/routes/knowledge-search-routes.mjs";

test("统一搜索路由原样传递查询、过滤和分页参数并返回搜索页", async () => {
  const calls = [];
  const responses = [];
  const page = { results: [{ id: "document-1" }], total: 1, hasMore: false, offset: 20, limit: 10 };
  const handler = createKnowledgeSearchRouteHandler({
    searchPage: (filters) => {
      calls.push(filters);
      return page;
    },
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  });
  const response = {};

  assert.equal(await handler(
    { method: "GET" },
    response,
    new URL("http://local/api/search?q=MVCC&targetType=document&category=%E6%95%B0%E6%8D%AE%E5%BA%93&tagName=%E5%9B%9E%E5%BD%92&folderId=folder%2F1&limit=10&offset=20"),
  ), true);
  assert.deepEqual(calls, [{
    query: "MVCC",
    targetType: "document",
    category: "数据库",
    tagName: "回归",
    folderId: "folder/1",
    limit: "10",
    offset: "20",
  }]);
  assert.deepEqual(responses, [{ response, statusCode: 200, payload: page }]);
});

test("统一搜索路由为空参数提供原有默认值并放行非目标请求", async () => {
  const calls = [];
  const handler = createKnowledgeSearchRouteHandler({
    searchPage: (filters) => {
      calls.push(filters);
      return { results: [], total: 0, hasMore: false, offset: 0, limit: 200 };
    },
    sendJson: () => {},
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/search"),
  ), true);
  assert.deepEqual(calls, [{
    query: "",
    targetType: "",
    category: "",
    tagName: "",
    folderId: "",
    limit: null,
    offset: null,
  }]);
  assert.equal(await handler(
    { method: "POST" },
    {},
    new URL("http://local/api/search"),
  ), false);
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/other"),
  ), false);
});
