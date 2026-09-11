import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const projectDirectory = path.resolve(import.meta.dirname, "..");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 47839;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("中文 PDF 测试服务未能启动。");
}

test("中文论文 HTML 通过 Chrome 生成并复用 PDF 缓存", { skip: !fs.existsSync(chromePath), timeout: 60000 }, async () => {
  const testRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testRoot, { recursive: true });
  const dataDirectory = fs.mkdtempSync(path.join(testRoot, "zhixu-chinese-pdf-"));
  const fixtureCode = `
    const database = await import('./lib/database.mjs');
    const paper = database.upsertImportedPaper({ id: 'paper_pdf_fixture', externalId: 'pdf-fixture', title: 'PDF Fixture', titleZh: '中文 PDF 测试', abstractZh: '验证中文、公式和表格排版。', category: 'AI', sourceUrl: 'https://example.com/paper', sourceText: 'source '.repeat(200), sourceLanguage: 'en' });
    database.updatePaperFullTranslation(paper.id, '<h2>第一章</h2><p>这是中文正文，包含公式 $E=mc^2$。</p><script>alert(1)</script><table><thead><tr><th>项目</th><th>结果</th></tr></thead><tbody><tr><td>中文</td><td>正常</td></tr></tbody></table>' + '<p>用于验证分页的正文内容。</p>'.repeat(80), { fidelity: 'complete', translation: {} });
  `;
  const fixture = spawnSync(process.execPath, ["--input-type=module", "-e", fixtureCode], { cwd: projectDirectory, env: { ...process.env, ZHIXU_DATA_DIR: dataDirectory, ZHIXU_DISABLE_CODEX_WORKER: "1" }, encoding: "utf8" });
  assert.equal(fixture.status, 0, fixture.stderr);
  const server = spawn(process.execPath, ["server.mjs"], { cwd: projectDirectory, env: { ...process.env, ZHIXU_DATA_DIR: dataDirectory, ZHIXU_PORT: String(port), ZHIXU_NO_BROWSER: "1", ZHIXU_DISABLE_CODEX_WORKER: "1", ZHIXU_CHROME_PATH: chromePath }, stdio: "ignore" });
  try {
    await waitForServer();
    const exportResponse = await fetch(`${baseUrl}/api/papers/paper_pdf_fixture/chinese-export`);
    assert.equal(exportResponse.status, 200);
    const exportHtml = await exportResponse.text();
    assert.match(exportHtml, /中文 PDF 测试/);
    assert.doesNotMatch(exportHtml, /alert\(1\)/);
    const generated = await (await fetch(`${baseUrl}/api/papers/paper_pdf_fixture/chinese-pdf`, { method: "POST" })).json();
    assert.equal(generated.cached, false);
    const pdfResponse = await fetch(`${baseUrl}${generated.url}`);
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 5000);
    const cached = await (await fetch(`${baseUrl}/api/papers/paper_pdf_fixture/chinese-pdf`, { method: "POST" })).json();
    assert.equal(cached.cached, true);
  } finally {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
