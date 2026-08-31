/**
 * 网页正文清洗器测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseHTML } from "linkedom";

import {
  createExternalFetchError,
  detectArticleLanguage,
  lookupPublicAddresses,
  normalizeLegacyHtmlImages,
  parseAndClassifyCapturedArticle,
  persistEmbeddedArticleImages,
  readNetworkErrorCode,
  sanitizeArticleHtml,
} from "../lib/article-parser.mjs";

test("解析浏览器已加载网页并执行同一安全清洗", async () => {
  const article = await parseAndClassifyCapturedArticle(
    "https://93.184.216.34/postgresql-hot",
    `<html><head><title>HOT updates</title><meta name="author" content="Laurenz Albe"></head>
     <body><main><h1>HOT updates</h1><p>${"PostgreSQL Heap Only Tuple improves update performance. ".repeat(12)}</p>
     <script>alert("blocked")</script></main></body></html>`,
  );
  assert.equal(article.title, "HOT updates");
  assert.equal(article.author, "Laurenz Albe");
  assert.match(article.contentText, /Heap Only Tuple/);
  assert.doesNotMatch(article.contentHtml, /script|alert/);
});

/**
 * 验证旧博客误用的 HTML image 标签会在 Readability 前变成标准图片。
 */
test("规范化旧式 HTML image 标签且不改写 SVG image", () => {
  /** document 同时包含正文旧式图片和具有独立语义的 SVG 图片。 */
  const { document } = parseHTML(`
    <main>
      <image src="/images/diagram.png" alt="架构图"></image>
      <svg><image src="/images/vector-layer.png"></image></svg>
    </main>
  `);
  assert.equal(normalizeLegacyHtmlImages(document), 1);
  assert.equal(document.querySelectorAll("main > img").length, 1);
  assert.equal(document.querySelector("main > img")?.getAttribute("src"), "/images/diagram.png");
  assert.equal(document.querySelectorAll("svg image").length, 1);
});

/**
 * 验证 Notebook 内嵌 PNG 会落入隔离缓存，正文不再保存大段 Base64。
 */
test("持久化 Base64 内嵌图片并改写为受控虚拟地址", () => {
  /** temporaryDirectory 是本测试独占的图片缓存目录。 */
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zhixu-embedded-image-"));
  try {
    /** onePixelPng 是具有合法 PNG 文件签名的 1×1 图片。 */
    const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const { document } = parseHTML(
      `<main><p>Diagram</p><img alt="pixel" src="data:image/png;base64,${onePixelPng}"></main>`,
    );
    assert.equal(persistEmbeddedArticleImages(document, temporaryDirectory), 1);
    const image = document.querySelector("img");
    assert.match(image?.getAttribute("src") || "", /^https:\/\/embedded\.zhixu\.invalid\/[a-f0-9]{64}\.png$/);
    const cachedFiles = fs.readdirSync(temporaryDirectory);
    assert.equal(cachedFiles.length, 1);
    assert.equal(path.extname(cachedFiles[0]), ".png");
    assert.ok(fs.statSync(path.join(temporaryDirectory, cachedFiles[0])).size > 8);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

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
 * 验证目标站证书链不完整时不会误导用户检查本机代理。
 */
test("HTTPS 证书链失败时提示网站证书问题", () => {
  /** certificateError 模拟服务器漏发中间证书时的 Node TLS 异常。 */
  const certificateError = new TypeError("fetch failed", {
    cause: Object.assign(new Error("unable to verify the first certificate"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    }),
  });
  assert.equal(
    createExternalFetchError(certificateError, "文章网页").message,
    "文章网页的 HTTPS 证书链无法验证，请稍后重试或联系网站维护者。",
  );
});

/**
 * 验证系统 DNS 短暂失败时会重试，而不是立即让整次文章导入失败。
 */
test("DNS 短暂失败后重试并返回公网地址", async () => {
  /** attempts 记录模拟 DNS 被调用的次数。 */
  let attempts = 0;
  /** lookup 前两次失败，第三次模拟 GitHub Pages 的公网解析结果。 */
  const lookup = async () => {
    attempts += 1;
    if (attempts < 3) {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), {
        code: "ENOTFOUND",
      });
    }
    return [{ address: "185.199.110.153", family: 4 }];
  };
  assert.deepEqual(
    await lookupPublicAddresses("lilianweng.github.io", lookup),
    [{ address: "185.199.110.153", family: 4 }],
  );
  assert.equal(attempts, 3);
});

/**
 * 验证 DNS 持续失败时不会把 getaddrinfo 等底层英文错误暴露给页面。
 */
test("DNS 持续失败时返回可操作的中文提示", async () => {
  /** lookup 始终模拟系统解析失败。 */
  const lookup = async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });
  };
  await assert.rejects(
    lookupPublicAddresses("missing.example", lookup),
    /文章网页域名解析失败，请检查 DNS 或网络连接。/,
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
