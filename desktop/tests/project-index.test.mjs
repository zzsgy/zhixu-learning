import test from "node:test";
import assert from "node:assert/strict";
import { getProjectPage } from "../public/project-index.js";

const projects = Array.from({ length: 237 }, (_, i) => ({
  id: String(i), fullName: `team/project-${i}`, stars: i,
  analyzedAt: new Date(2026, 0, i + 1).toISOString(),
  analysisSummary: i % 2 ? "Agent 工作流" : "数据库检索",
  primaryLanguage: i % 2 ? "Python" : "TypeScript",
}));
test("每页十项，末页边界和超过200项的项目可见", () => {
  const first = getProjectPage(projects);
  assert.equal(first.items.length, 10);
  assert.equal(first.total, 237);
  assert.equal(first.pages, 24);
  assert.equal(first.items[0].id, "236");
  const last = getProjectPage(projects, { page: 999 });
  assert.equal(last.page, 24);
  assert.equal(last.items.length, 7);
  assert.equal(last.items.at(-1).id, "0");
});
test("搜索忽略大小写并支持组织、简介和语言的组合", () => {
  const result = getProjectPage(projects, { query: " TEAM agent PYTHON " });
  assert.equal(result.total, 118);
  assert.ok(result.items.every((p) => p.primaryLanguage === "Python"));
  assert.equal(getProjectPage(projects, { query: "找不到", page: 9 }).page, 1);
  assert.equal(getProjectPage([], { page: -2 }).total, 0);
});
test("排序稳定、数字名称自然排序，不修改原始列表", () => {
  const original = projects.map((p) => p.id);
  assert.equal(getProjectPage(projects, { sort: "stars" }).items[0].stars, 236);
  assert.deepEqual(getProjectPage(projects, { sort: "name" }).items.slice(0, 3).map((p) => p.id), ["0", "1", "2"]);
  assert.deepEqual(projects.map((p) => p.id), original);
});
