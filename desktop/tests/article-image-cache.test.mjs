/**
 * 文章图片首次并发缓存回归测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArticleImageCache } from "../lib/article-image-cache.mjs";

test("同一文章图片的首次并发请求只下载和写入一次", async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zhixu-article-image-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  let fetchCount = 0;
  const imageBytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const cache = createArticleImageCache({
    imageDirectory: temporaryDirectory,
    async fetchImage() {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { bytes: imageBytes, contentType: "image/png" };
    },
  });

  const results = await Promise.all(
    Array.from({ length: 12 }, () => cache.resolve("https://example.com/diagram.png")),
  );
  assert.equal(fetchCount, 1);
  assert.equal(new Set(results.map((result) => result.cachedPath)).size, 1);
  assert.equal(results.every((result) => result.contentType === "image/png"), true);
  assert.deepEqual(fs.readFileSync(results[0].cachedPath), imageBytes);

  await cache.resolve("https://example.com/diagram.png");
  assert.equal(fetchCount, 1);
});
