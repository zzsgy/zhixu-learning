import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import katex from "katex";
import { normalizePaperReadingLayout } from "../public/paper-layout.js";
import { parsePaperAssetUrl } from "../public/paper-assets.js";
import { normalizePaperMath } from "../public/paper-math.js";

const directory = path.resolve(import.meta.dirname, "..");
const serverSource = fs.readFileSync(path.join(directory, "server.mjs"), "utf8");
const exportSource = fs.readFileSync(path.join(directory, "public/paper-export.js"), "utf8");
const chromePath = [process.env.ZHIXU_CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean).find((file) => fs.existsSync(file));
const start = serverSource.indexOf("function escapePaperExportText(");
const end = serverSource.indexOf("\nfunction findLocalChrome(", start);
assert(start >= 0 && end > start);

function generateHtml(body, metadata = {}) {
  const context = vm.createContext({ parseHTML, normalizePaperReadingLayout, parsePaperAssetUrl, crypto, path, paperChinesePdfDirectory: "fixture-pdfs" });
  vm.runInContext(serverSource.slice(start, end), context);
  return {
    html: context.createChinesePaperExportHtml({ id: "paper_fixture", title: "Math export", fullTranslationHtml: body, ...metadata }, "http://127.0.0.1:47821"),
    paths: context.getChinesePaperPdfPaths({ id: "paper_fixture", title: "Math export", fullTranslationHtml: body, ...metadata }),
  };
}

/** 执行生成页面实际引用的导出脚本，仅将浏览器绝对路径导入接到本地同版 KaTeX。 */
function executeExport(html, renderer) {
  const { document } = parseHTML(html);
  const scripts = [...document.querySelectorAll('script[type="module"]')];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].getAttribute("src"), "/paper-export.js");
  assert.equal(scripts[0].textContent, "");
  const executable = exportSource.replace(
    'import renderMathInElement from "/vendor/katex/contrib/auto-render.mjs";',
    "const renderMathInElement = globalThis.testRenderer;",
  ).replace('import { normalizePaperMath } from "./paper-math.js";', "const normalizePaperMath = globalThis.testPreprocess;");
  assert.notEqual(executable, exportSource);
  const context = vm.createContext({ document, testRenderer: renderer, testPreprocess: normalizePaperMath });
  vm.runInContext(executable, context);
  assert.equal(document.documentElement.dataset.pdfReady, "true");
  return document;
}

test("中文导出实际脚本保留四种公式分隔符，不将普通括号作为公式", () => {
  const { html } = generateHtml("<p>(Author, 2023) [ordinary text]</p>");
  let received;
  executeExport(html, (element, options) => { received = options; });
  assert.deepEqual(JSON.parse(JSON.stringify(received.delimiters)), [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
    { left: "$", right: "$", display: false },
  ]);
  assert.equal(received.trust, false);
});

test("中文导出在真实 Chrome 中执行 KaTeX，保留普通括号、方括号与代码块", { skip: !chromePath, timeout: 45000 }, async () => {
  const body = String.raw`<p>(Author, 2023) [ordinary text]</p><p>\(x+y\)</p><p>\[x^2\]</p><p>$$a+b$$</p><p>$a^2$</p><pre>\(code\)</pre><code>\[sample\]</code><p>\({\color[rgb]{0.72,0,0}\mathtt{(B,L,N)}}\)</p>`;
  const html = generateHtml(body, { abstractZh: String.raw`摘要也包含公式 \(R^2=0.413\)` }).html;
  const katexDirectory = path.dirname(fileURLToPath(import.meta.resolve("katex")));
  const staticFiles = new Map([
    ["/paper-export.js", path.join(directory, "public/paper-export.js")],
    ["/paper-math.js", path.join(directory, "public/paper-math.js")],
  ]);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html); return; }
    let file = staticFiles.get(pathname);
    if (pathname.startsWith("/vendor/katex/")) {
      const candidate = path.resolve(katexDirectory, pathname.slice("/vendor/katex/".length));
      if (candidate.startsWith(katexDirectory + path.sep)) file = candidate;
    }
    if (!file || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    const type = file.endsWith(".css") ? "text/css" : /\.m?js$/.test(file) ? "text/javascript" : "application/octet-stream";
    response.writeHead(200, { "content-type": type }); response.end(fs.readFileSync(file));
  });
  const testRoot = path.join(directory, ".test-data");
  fs.mkdirSync(testRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(testRoot, "paper-export-math-chrome-"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { stdout } = await promisify(execFile)(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--virtual-time-budget=3000", "--dump-dom", `http://127.0.0.1:${server.address().port}/`], { windowsHide: true, encoding: "utf8", maxBuffer: 5_000_000, timeout: 30000 });
    const { document } = parseHTML(stdout);
    assert.equal(document.documentElement.dataset.pdfReady, "true");
    assert.equal(document.querySelectorAll(".katex").length, 6);
    assert.equal(document.querySelectorAll("header .katex").length, 1);
    assert.equal(document.querySelectorAll(".katex-display").length, 2);
    assert.equal(document.querySelectorAll(".katex-error").length, 0);
    assert.equal(document.querySelector("main>p").textContent, "(Author, 2023) [ordinary text]");
    assert.equal(document.querySelector("main>p").querySelector(".katex"), null);
    assert.equal(document.querySelector("pre").textContent, String.raw`\(code\)`);
    assert.equal(document.querySelector("code").textContent, String.raw`\[sample\]`);
    assert.match(document.querySelector("main").innerHTML, /#b80000/i);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("导出 RGB 兼容转换仅处理有效 xcolor 三元组且保留其他公式", () => {
  let options;
  executeExport(generateHtml("<p>RGB fixture</p>").html, (_, config) => { options = config; });
  const original = String.raw`{\color[rgb]{0.72,0,0}\mathtt{(B,L,N)}}`;
  assert.throws(() => katex.renderToString(original), /Invalid color/);
  assert.equal(options.preProcess(original), String.raw`{\color{#b80000}\mathtt{(B,L,N)}}`);
  assert.doesNotThrow(() => katex.renderToString(options.preProcess(original)));
  for (const untouched of [String.raw`\color{red} x`, String.raw`\color[rgb]{2,0,0} x`, String.raw`\color[rgb]{0,0} x`, String.raw`\mathbf{x}+y`]) {
    assert.equal(options.preProcess(untouched), untouched);
  }
});

test("修复渲染器后中文 PDF 缓存键不再复用旧的正文单独哈希", () => {
  const body = String.raw`<p>\(x\)</p>`;
  const { paths } = generateHtml(body);
  const oldHash = crypto.createHash("sha256").update(body).digest("hex");
  assert.notEqual(paths.hash, oldHash);
  assert.equal(paths.hash, generateHtml(body).paths.hash);
  assert.notEqual(paths.hash, generateHtml(body, { abstractZh: "已修复的中文摘要" }).paths.hash);
  assert.notEqual(paths.hash, generateHtml(body, { titleZh: "已修复的中文标题" }).paths.hash);
});

test("主阅读页复用同一 RGB 预处理函数且不改变既有分隔符与信任边界", () => {
  const appSource = fs.readFileSync(path.join(directory, "public/app.js"), "utf8");
  assert.match(appSource, /import \{ normalizePaperMath \} from "\.\/paper-math\.js"/);
  const functionSource = appSource.match(/function renderReadingMath\(readingSurface\) \{[\s\S]*?\n\}/)?.[0];
  assert(functionSource);
  let received;
  const context = vm.createContext({ normalizePaperMath, renderMathInElement: (_, options) => { received = options; } });
  vm.runInContext(functionSource + "\nrenderReadingMath({});", context);
  assert.equal(received.preProcess, normalizePaperMath);
  assert.equal(received.delimiters[2].left, "\\(");
  assert.equal(received.trust, false);
  assert.equal(received.preProcess(String.raw`\color[rgb]{0,1,0} x`), String.raw`\color{#00ff00} x`);
});
