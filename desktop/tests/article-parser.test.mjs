/**
 * 网页正文清洗器测试。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  createExternalFetchError,
  detectArticleLanguage,
  readNetworkErrorCode,
  sanitizeArticleHtml,
} from "../lib/article-parser.mjs";

/**
 * 验证解析异常产生的空列表项不会变成阅读页中的连续黑点。
 */
test("清理空列表项并保留真实列表和代码块", () => {
  /** result 是含空列表、真实列表和代码块的清洗结果。 */
  const result = sanitizeArticleHtml(
    `<p>正文</p><ul><li></li><li> </li></ul>
     <ul><li>真实知识点</li></ul><pre><code>print("hello")</code></pre>`,
    new URL("https://example.com/article"),
  );
  assert.doesNotMatch(result.html, /<li>\s*<\/li>/);
  assert.match(result.html, /真实知识点/);
  assert.match(result.html, /print\("hello"\)/);
});

/**
 * 验证 Fetch 顶层通用异常可以追溯到底层 socket 错误。
 */
test("读取嵌套网络错误代码并生成可操作提示", () => {
  /** networkError 模拟 Node Fetch 的 TypeError -> cause 异常链。 */
  const networkError = new TypeError("fetch failed", {
    cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
  });
  assert.equal(readNetworkErrorCode(networkError), "ECONNRESET");
  assert.equal(
    createExternalFetchError(networkError, "文章网页").message,
    "文章网页连接被中途重置，请检查网络或代理后重试。",
  );
});

/**
 * 验证代理未启动时不会继续向用户展示笼统的 fetch failed。
 */
test("代理连接失败时提示检查代理进程", () => {
  /** proxyError 模拟代理端口没有进程监听的错误。 */
  const proxyError = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  assert.equal(
    createExternalFetchError(proxyError, "文章网页").message,
    "文章网页连接被拒绝，请检查代理是否正在运行。",
  );
});

/**
 * 验证技术文章中的英文模型名不会让中文正文被误判为英文。
 */
test("识别中文、英文和中英混合技术文章", () => {
  /** chineseText 是包含大量英文缩写的中文技术正文。 */
  const chineseText = "Transformer 模型通过 Attention、MoE 和 Router 处理令牌。".repeat(80);
  /** englishText 是等待 Codex 翻译的英文技术正文。 */
  const englishText = "The mixture of experts model routes every token to specialized neural network experts. ".repeat(60);
  /** mixedText 是中文讲解和英文原文比例接近的双语正文。 */
  const mixedText = `${"混合专家模型通过路由器选择不同专家完成计算。".repeat(30)} ${englishText}`;
  assert.equal(detectArticleLanguage(chineseText), "zh");
  assert.equal(detectArticleLanguage(englishText), "en");
  assert.equal(detectArticleLanguage(mixedText), "mixed");
});
