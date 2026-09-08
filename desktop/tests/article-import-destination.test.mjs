import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test, { mock } from "node:test";

// 子进程只替换外部解析边界，HTTP 路由、事务与目录数据使用真实实现。
if (process.env.ZHIXU_DESTINATION_FIXTURE === "1") {
  const parser = await import("../lib/article-parser.mjs");
  const docsify = await import("../lib/docsify-importer.mjs");
  const paper = await import("../lib/paper-service.mjs");
  const database = await import("../lib/database.mjs");
  const article = (url) => ({
    url, sourceType: "web", title: `测试文章 ${url}`, summary: "目录保存测试",
    category: "AI", categorySource: "rules", categoryConfidence: 0.9,
    author: null, publishedAt: null, coverImageUrl: null,
    contentHtml: `<p>独立的测试正文 ${url}</p>`, contentText: `独立的测试正文 ${url}`,
    sourceLanguage: "zh", translationStatus: "not_required", wordCount: 100,
  });
  mock.module("../lib/article-parser.mjs", { namedExports: {
    ...parser,
    parseAndClassifyArticle: async (url) => {
      // 模拟网络等待期间，另一个页面删除了尚为空的目标目录。
      if (url.includes("deleted-during-fetch")) {
        const folder = database.listFolders().find((item) => item.name === "即将删除");
        database.deleteEmptyFolder(folder.id);
      }
      return article(url);
    },
  } });
  mock.module("../lib/docsify-importer.mjs", { namedExports: {
    ...docsify,
    inspectDocsifySource: async (url) => ({
      siteTitle: "测试教程", recommendedFolderPath: ["AI", "教程", "测试教程"], skipped: [],
      chapters: [
        { url: `${url}/one`, route: "one", title: "第一节", groupTitle: "第一章", groupOrder: 1, groupItemOrder: 1, order: 1 },
        { url: `${url}/two`, route: "two", title: "第二节", groupTitle: "", order: 2 },
      ],
    }),
    parseDocsifyChapter: async (chapter) => article(chapter.url),
  } });
  mock.module("../lib/paper-service.mjs", { namedExports: { ...paper, ensureDailyClassicPaperCandidate: async () => null } });
  await import("../server.mjs");
} else {
  test("网页和教程保存位置：自动、指定、多级同名目录、查重与失效回滚", { timeout: 30000 }, async (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zhixu-destination-"));
    const child = spawn(process.execPath, ["--experimental-test-module-mocks", import.meta.filename], {
      cwd: path.resolve(import.meta.dirname, ".."), windowsHide: true,
      env: { ...process.env, ZHIXU_DESTINATION_FIXTURE: "1", ZHIXU_PORT: "47837",
        ZHIXU_DATA_DIR: temp, ZHIXU_ENV_FILE: path.join(temp, "absent.env"),
        ZHIXU_NO_BROWSER: "1", ZHIXU_DISABLE_CODEX_WORKER: "1", DEEPSEEK_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    t.after(async () => {
      if (child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
      fs.rmSync(temp, { recursive: true, force: true });
    });
    const base = "http://127.0.0.1:47837";
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, output);
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
      if (attempt === 99) assert.fail(output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    async function request(route, body) {
      const response = await fetch(base + route, body ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      } : {});
      return { status: response.status, ...await response.json() };
    }
    const folders = async () => (await request("/api/folders")).folders;
    const root = (await request("/api/folders", { name: "我的知识库" })).folder;
    const selected = (await request("/api/folders", { name: "学习笔记", parentId: root.id })).folder;
    const otherRoot = (await request("/api/folders", { name: "另一知识库" })).folder;
    await request("/api/folders", { name: "学习笔记", parentId: otherRoot.id });
    const manualUrl = "https://example.com/manual";
    const manual = await request("/api/articles/parse", { url: manualUrl, targetFolderId: selected.id });
    assert.equal(manual.status, 201, JSON.stringify(manual));
    assert.equal(manual.article.folderId, selected.id);
    assert.equal((await request(`/api/articles/${manual.article.id}`)).article.folderId, selected.id);
    const duplicate = await request("/api/articles/parse", { url: manualUrl, targetFolderId: otherRoot.id });
    assert.equal(duplicate.status, 409);
    assert.equal((await request(`/api/articles/${manual.article.id}`)).article.folderId, selected.id);

    for (const targetFolderId of [undefined, ""]) {
      const auto = await request("/api/articles/parse", { url: `https://example.com/auto-${String(targetFolderId)}`, targetFolderId });
      assert.equal(auto.status, 201);
      const location = (await folders()).find((folder) => folder.id === auto.article.folderId);
      assert.deepEqual(location.path.map((part) => part.name), ["待整理", "AI"]);
    }
    for (const route of ["/api/articles/parse", "/api/docsify/import"]) {
      const invalid = await request(route, { url: "https://example.com/invalid", targetFolderId: "missing-folder" });
      assert.equal(invalid.status, 400);
      assert.match(invalid.message, /目录已不存在/);
    }
    const doomed = (await request("/api/folders", { name: "即将删除" })).folder;
    const countBefore = (await request("/api/articles")).articles.length;
    const failed = await request("/api/articles/parse", { url: "https://example.com/deleted-during-fetch", targetFolderId: doomed.id });
    assert.ok(failed.status >= 400);
    assert.equal((await request("/api/articles")).articles.length, countBefore, "目录失效不能留下半保存文章");
    const retried = await request("/api/articles/parse", { url: "https://example.com/after-rollback", targetFolderId: selected.id });
    assert.equal(retried.status, 201, "回滚后仍可正常保存");

    const series = await request("/api/docsify/import", { url: "https://example.com/docs", targetFolderId: selected.id, routes: ["one", "two"] });
    assert.equal(series.status, 201, JSON.stringify(series));
    assert.equal(series.importedCount, 2);
    assert.equal(series.folderPath.at(-1).id, selected.id);
    const group = (await folders()).find((folder) => folder.id === series.articles[0].folderId);
    assert.equal(group.parentId, selected.id);
    assert.equal(group.name, "第一章");
    assert.equal(series.articles[1].folderId, selected.id);
    const automaticSeries = await request("/api/docsify/import", { url: "https://example.com/auto-docs", routes: ["two"] });
    assert.equal(automaticSeries.importedCount, 1);
    assert.deepEqual(automaticSeries.folderPath.map((folder) => folder.name), ["待整理", "AI", "教程", "测试教程"]);
    assert.equal(automaticSeries.articles[0].folderId, automaticSeries.folderPath.at(-1).id);
  });
}
