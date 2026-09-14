import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseArxivIdentity, parseDoiIdentity, getPaperIdentityKey } from "../lib/paper-identity.mjs";

test("arXiv 身份统一但保留请求版本；DOI 不丢版本后缀", () => {
  for (const url of ["http://arxiv.org/abs/2512.08296v2", "https://arxiv.org/pdf/2512.08296v2.pdf?download=1", "https://arxiv.org/html/2512.08296v2#section"]) {
    const identity = parseArxivIdentity(url);
    assert.equal(identity.identityKey, "arxiv:2512.08296");
    assert.equal(identity.requestedVersion, "v2");
    assert.equal(identity.pdfUrl, "https://arxiv.org/pdf/2512.08296v2");
  }
  assert.equal(parseArxivIdentity("https://arxiv.org/abs/hep-th/9901001v3").arxivId, "hep-th/9901001");
  assert.equal(parseArxivIdentity("https://arxiv.org.attacker.test/abs/2512.08296"), null);
  assert.equal(parseArxivIdentity("https://user@arxiv.org/abs/2512.08296"), null);
  assert.equal(getPaperIdentityKey({ externalId: "manual-url:http://arxiv.org/abs/2512.08296v1" }), "arxiv:2512.08296");
  assert.equal(parseDoiIdentity("https://doi.org/10.1234/Example.v2?download=1").identityKey, "doi:10.1234/example.v2");
  assert.equal(parseDoiIdentity("doi:10.1234/Example.v2").doi, "10.1234/example.v2");
});

test("论文导入网络边界、来源范围与真实回退均在隔离数据目录中验证", async (t) => {
  const testRoot = path.resolve(import.meta.dirname, "../.test-data");
  fs.mkdirSync(testRoot, { recursive: true });
  const dataDirectory = fs.mkdtempSync(path.join(testRoot, "paper-import-reliability-"));
  process.env.ZHIXU_DATA_DIR = dataDirectory;
  process.env.ZHIXU_ENV_FILE = path.join(dataDirectory, "absent.env");
  process.env.ZHIXU_DISABLE_CODEX_WORKER = "1";
  const parser = await import("../lib/article-parser.mjs");
  const papers = await import("../lib/paper-fulltext.mjs");
  const db = await import("../lib/database.mjs");
  try {
    await t.test("每轮超时重新创建 signal，首轮超时后第二轮实际成功", async () => {
      const signals = [];
      let attempts = 0;
      const response = await parser.fetchExternalResource(new URL("https://example.test/paper"), { timeoutMs: 20 }, "测试资源", {
        wait: async () => {},
        fetch: async (_url, options) => {
          signals.push(options.signal);
          attempts++;
          if (attempts === 1) await new Promise((_resolve, reject) => {
            const keepAlive = setTimeout(() => reject(new Error("测试超时未生效")), 1000);
            options.signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
          });
          assert.equal(options.signal.aborted, false);
          assert.equal(options.timeoutMs, undefined);
          return new Response("ok");
        },
      });
      assert.equal(await response.text(), "ok");
      assert.equal(attempts, 2);
      assert.notEqual(signals[0], signals[1]);
    });

    await t.test("调用方取消不会再次请求，也不会被转换成连接超时", async () => {
      const controller = new AbortController();
      const cancelled = new Error("用户取消导入");
      let attempts = 0;
      await assert.rejects(parser.fetchExternalResource(new URL("https://example.test/"), { signal: controller.signal, timeoutMs: 100 }, "测试", {
        wait: async () => {},
        fetch: async () => { attempts++; controller.abort(cancelled); throw cancelled; },
      }), (error) => error === cancelled);
      assert.equal(attempts, 1);
    });

    await t.test("PDF 初始私网及公网跳转私网均被阻断，正常跳转可下载", async () => {
      let requests = 0;
      const dependencies = { lookup: async () => [{ address: "8.8.8.8" }], fetchResource: async () => { requests++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/internal.pdf" } }); } };
      await assert.rejects(papers.downloadPaperPdf("https://127.0.0.1/private.pdf", dependencies), /本机|局域网/);
      await assert.rejects(papers.downloadPaperPdf("https://[::ffff:127.0.0.1]/private.pdf", dependencies), /本机|局域网/);
      assert.equal(requests, 0);
      await assert.rejects(papers.downloadPaperPdf("https://example.test/public.pdf", dependencies), /本机|局域网/);
      assert.equal(requests, 1);
      const visited = [];
      const bytes = await papers.downloadPaperPdf("https://example.test/start.pdf", {
        lookup: dependencies.lookup,
        fetchResource: async (url, options) => {
          visited.push(url.href);
          assert.equal(options.redirect, "manual");
          assert.equal(options.timeoutMs, 45_000);
          return visited.length === 1
            ? new Response(null, { status: 302, headers: { location: "/final.pdf" } })
            : new Response("%PDF synthetic bytes");
        },
      });
      assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
      assert.deepEqual(visited, ["https://example.test/start.pdf", "https://example.test/final.pdf"]);
    });

    await t.test("无 Content-Length 的超大正文按实际读取字节终止", async () => {
      let cancelled = false;
      const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } }));
      await assert.rejects(parser.readLimitedResponseBytes(response, 150, "测试资源"), /容量/);
      assert.equal(cancelled, true);
    });

    const section = "The experimental methods explain the reproducible setup and the measured results in detail. ".repeat(12);
    const html = `<h2>Introduction</h2><p>${section}</p><h2>Methods</h2><p>${section} x<sub>95</sub></p><figure><img src="https://example.test/figure.png" alt="Figure 1"><figcaption>Figure 1. Result.</figcaption></figure><table><tr><td colspan="2">Measurements</td></tr></table>`;
    await t.test("长摘要和摘要中的 Methods/Results 小标题不能冒充全文", () => {
      const abstract = `<h2>Abstract</h2><p>${section.repeat(3)}</p>`;
      assert.throws(() => papers.preparePaperWebSource({ contentHtml: abstract }, "https://publisher.test/paper"), (error) => error.code === "PAPER_ABSTRACT_ONLY");
      assert.throws(() => papers.preparePaperWebSource({ contentHtml: `<h2>Abstract</h2><h3>Methods</h3><p>${section}</p><h3>Results</h3><p>${section}</p>` }, "https://publisher.test/paper"), /摘要/);
      assert.throws(() => papers.preparePaperWebSource({ contentHtml: html }, "http://arxiv.org/abs/2512.08296"), /摘要/);
    });

    await t.test("真实全文回退保留图表公式，摘要回退保留明确提取错误", async () => {
      const full = db.upsertImportedPaper({ externalId: "test:publisher-full", title: "Full paper", sourceLanguage: "en", sourceUrl: "https://publisher.test/paper", pdfUrl: "https://publisher.test/paper.pdf" });
      const result = await papers.preparePaperFullText(full.id, { downloadPdf: async () => { throw new Error("模拟 PDF 不可用"); }, parseSourcePage: async () => ({ contentHtml: html }) });
      assert.equal(result.sourceStructure.contentScope, "fulltext");
      assert.equal(result.sourceStructure.imageCount, 1);
      assert.equal(result.sourceStructure.tableCount, 1);
      assert.match(result.sourceHtml, /<sub>95<\/sub>/);
      assert.equal(result.extractionError, null);
      const summary = db.upsertImportedPaper({ externalId: "test:publisher-abstract", title: "Abstract paper", sourceLanguage: "en", sourceUrl: "https://publisher.test/summary", pdfUrl: "https://publisher.test/summary.pdf" });
      await assert.rejects(papers.preparePaperFullText(summary.id, { downloadPdf: async () => { throw new Error("模拟 PDF 不可用"); }, parseSourcePage: async () => ({ contentHtml: `<h2>Abstract</h2><p>${section.repeat(3)}</p>` }) }), /摘要/);
      const rejected = db.getPaperById(summary.id);
      assert.equal(rejected.sourceText, "");
      assert.match(rejected.extractionError, /摘要/);
      assert.equal(db.listPendingFullPaperTranslations().some((paper) => paper.id === summary.id), false);
    });
  } finally {
    db.closeDatabase();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
