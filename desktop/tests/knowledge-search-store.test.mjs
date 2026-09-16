import assert from "node:assert/strict";
import test from "node:test";
import { createKnowledgeSearchStore } from "../lib/db/stores/knowledge-search.mjs";

test("统一搜索仓储把共享连接和原筛选条件交给查询引擎", () => {
  const database = { name: "shared-database" };
  const calls = [];
  const page = {
    results: [{ id: "document-1" }],
    total: 1,
    hasMore: false,
    offset: 20,
    limit: 10,
  };
  const store = createKnowledgeSearchStore(database, {
    searchPage: (...args) => {
      calls.push(args);
      return page;
    },
  });
  const filters = { query: "MVCC", targetType: "document", limit: 10, offset: 20 };

  assert.equal(store.searchKnowledgeBasePage(filters), page);
  assert.deepEqual(calls, [[database, filters]]);
});

test("统一搜索仓储保留旧数组返回形式和默认空筛选", () => {
  const database = {};
  const calls = [];
  const results = [{ id: "paper-1" }, { id: "article-1" }];
  const store = createKnowledgeSearchStore(database, {
    searchPage: (...args) => {
      calls.push(args);
      return { results, total: 2, hasMore: false, offset: 0, limit: 200 };
    },
  });

  assert.equal(Object.isFrozen(store), true);
  assert.equal(store.searchKnowledgeBase(), results);
  assert.deepEqual(calls, [[database, {}]]);
});
