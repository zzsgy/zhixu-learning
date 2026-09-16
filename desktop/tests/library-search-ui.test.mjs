import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("论文保存目录位于导入表单内，沿用表单留白而非卡片边缘", () => {
  const controller = fs.readFileSync(new URL("../public/paper-library.js", import.meta.url), "utf8");
  assert.match(controller, /\$\("paper-import-form"\)\.prepend\(importDestination\)/);
  assert.doesNotMatch(controller, /\$\("paper-import-form"\)\.before\(/);
  const styles = fs.readFileSync(new URL("../public/paper-library.css", import.meta.url), "utf8");
  assert.match(styles, /#upload-view \.paper-import-destination/);
});

test("轻量搜索缺少大小或字数字段时不显示NaN和伪造零字数", () => {
  assert.match(source, /Number\.isFinite\(documentItem\.wordCount\)/);
  assert.match(source, /Number\.isFinite\(documentItem\.sizeBytes\)/);
  assert.doesNotMatch(source, /Number\(documentItem\.wordCount \|\| 0\)/);
});

test("分页隐藏属性不被工具栏样式覆盖，长路径不会撑开存储网格", () => {
  const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /#search-pagination\[hidden\], #search-load-more\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.storage-grid \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.storage-grid article \{ min-width: 0;/);
});
const functions = [
  /function getLibraryItemKey\(item\) \{[\s\S]*?\n\}/,
  /async function loadLibraryMetadataPages\(endpoint, key, sequence\) \{[\s\S]*?\n\}/,
  /async function loadLibrary\(\{ append = false \} = \{\}\) \{[\s\S]*?\n\}/,
].map((pattern) => { const match = source.match(pattern); assert.ok(match); return match[0]; }).join("\n");

test("普通文档元数据逐页加载超过1000项，不丢旧目录项", async () => {
  const calls = [];
  const context = vm.createContext({
    URLSearchParams,
    applicationState: { libraryRequestSequence: 1 },
    requestJson: async (url) => {
      const offset = Number(new URL(url, "http://example.test").searchParams.get("offset"));
      calls.push(offset);
      return {
        documents: Array.from({ length: Math.min(200, 1005 - offset) }, (_, index) => ({ id: `d-${offset + index}` })),
        hasMore: offset + 200 < 1005,
      };
    },
  });
  vm.runInContext(functions, context);
  const items = await vm.runInContext('loadLibraryMetadataPages("/api/documents", "documents", 1)', context);
  assert.equal(items.length, 1005);
  assert.equal(items.at(-1).id, "d-1004");
  assert.deepEqual(calls, [0, 200, 400, 600, 800, 1000]);
});

test("旧搜索响应迟到不会覆盖新搜索，加载更多保留前页和独立选择键", async () => {
  const pending = new Map();
  const state = {
    searchQuery: "旧查询", libraryRequestSequence: 0, searchResults: [], searchResultsQuery: "",
    searchLoading: false, searchHasMore: false, selectedLibraryItemKeys: new Set(),
  };
  const context = vm.createContext({
    URLSearchParams, applicationState: state, renderLibrary() {},
    requestJson: (url) => new Promise((resolve) => pending.set(url, resolve)),
  });
  vm.runInContext(functions, context);
  const oldRequest = vm.runInContext("loadLibrary()", context);
  state.searchQuery = "新查询";
  const newRequest = vm.runInContext("loadLibrary()", context);
  const newUrl = [...pending.keys()].find((url) => decodeURIComponent(url).includes("新查询"));
  pending.get(newUrl)({ results: [{ targetType: "document", targetId: "new-1", id: "new-1" }], total: 2, hasMore: true });
  await newRequest;
  const oldUrl = [...pending.keys()].find((url) => decodeURIComponent(url).includes("旧查询"));
  pending.get(oldUrl)({ results: [{ targetType: "document", targetId: "old", id: "old" }], total: 1, hasMore: false });
  await oldRequest;
  assert.equal(state.searchResults[0].id, "new-1");
  const more = vm.runInContext("loadLibrary({append:true})", context);
  const moreUrl = [...pending.keys()].find((url) => url.endsWith("offset=1"));
  pending.get(moreUrl)({ results: [{ targetType: "document", targetId: "new-2", id: "new-2" }], total: 2, hasMore: false });
  await more;
  assert.equal(state.searchResults.length, 2);
  assert.equal(new Set(state.searchResults.map((item) => `${item.targetType}:${item.id}`)).size, 2);
  assert.equal(state.searchHasMore, false);
});
