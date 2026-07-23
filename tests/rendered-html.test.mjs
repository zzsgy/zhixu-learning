/**
 * 知序生产构建的静态产物测试。
 *
 * Cloudflare Worker 使用 cloudflare:workers 运行时模块，不能由普通 Node
 * 直接 import；因此这里检查真实生产产物、路由和 D1 迁移是否齐全。
 */
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

/** 递归读取目录中的所有文本文件。 */
async function readDirectoryText(directoryUrl) {
  /** entries 是当前目录中的文件与子目录。 */
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  /** chunks 收集所有文本内容。 */
  const chunks = [];
  for (const entry of entries) {
    /** entryUrl 是当前条目的绝对 URL。 */
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) {
      chunks.push(await readDirectoryText(entryUrl));
    } else if (/\.(js|css|html)$/.test(entry.name)) {
      chunks.push(await readFile(entryUrl, "utf8"));
    }
  }
  return chunks.join("\n");
}

/** 生产构建应包含知序页面与全部共享数据接口。 */
test("build contains the Zhixu application and sync routes", async () => {
  /** distRoot 是 Sites 实际打包的生产目录。 */
  const distRoot = new URL("../dist/", import.meta.url);
  await access(new URL("server/index.js", distRoot));
  await access(new URL(".openai/hosting.json", distRoot));

  /** buildText 是客户端与服务端构建产物的合并文本。 */
  const buildText = await readDirectoryText(distRoot);
  assert.match(buildText, /正在整理今天的知识序列/);
  assert.match(buildText, /同步与导出/);
  assert.match(buildText, /api\/bootstrap/);
  assert.match(buildText, /api\/devices\/pair/);
  assert.match(buildText, /api\/generate\/deep-dive/);
  assert.match(buildText, /api\/import/);
  assert.doesNotMatch(buildText, /Your site is taking shape|Building your site/);
});

/** 数据库迁移应包含账号、卡片、深度内容、设备和 AI 对话表。 */
test("migration contains all cross-device persistence tables", async () => {
  /** migration 是当前生成的首个 D1 SQL 迁移。 */
  const migration = await readFile(
    new URL("../drizzle/0000_silly_typhoid_mary.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "users",
    "cards",
    "progress",
    "favorites",
    "deep_dives",
    "ai_messages",
    "settings",
    "device_pair_codes",
    "device_tokens",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE \\\`${table}\\\``));
  }
});

/** 起始卡片必须拆分写入，避免超过 Cloudflare D1 单条语句的绑定参数上限。 */
test("starter cards are inserted in bounded batches", async () => {
  /** repositorySource 是数据访问层的 TypeScript 源码。 */
  const repositorySource = await readFile(
    new URL("../lib/repository.ts", import.meta.url),
    "utf8",
  );
  assert.match(repositorySource, /STARTER_CARD_INSERT_BATCH_SIZE = 4/);
  assert.match(repositorySource, /starterRows\.slice\(/);
  assert.doesNotMatch(
    repositorySource,
    /insert\(cards\)\.values\(starterRows\)/,
  );
});

/** 快速收录应保留长回答原文，并仅在达到最低字数时建立深度内容。 */
test("quick import preserves eligible long-form answers", async () => {
  /** importRouteSource 是快速收录 API 的 TypeScript 源码。 */
  const importRouteSource = await readFile(
    new URL("../app/api/import/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(importRouteSource, /MIN_IMPORT_CONTENT_LENGTH = 300/);
  assert.match(importRouteSource, /MIN_DEEP_DIVE_LENGTH = 2000/);
  assert.match(importRouteSource, /content\.length >= MIN_DEEP_DIVE_LENGTH/);
  assert.doesNotMatch(importRouteSource, /MAX_DEEP|5000/);
});
