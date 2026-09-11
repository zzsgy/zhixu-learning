/**
 * 本地 OCR TSV 解析与图片上传后台识别集成测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

/** ocrPort 是 OCR 集成测试独占端口。 */
const ocrPort = 47832;
/** ocrBaseUrl 是隔离服务地址。 */
const ocrBaseUrl = `http://127.0.0.1:${ocrPort}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${ocrBaseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // 服务尚未启动时继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("OCR 测试服务未能按时启动。");
}

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${ocrBaseUrl}/api/import-jobs/${encodeURIComponent(jobId)}`);
    const payload = await response.json();
    if (["completed", "failed"].includes(payload.job.status)) return payload.job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("OCR 任务未能按时完成。");
}

test("图片上传后由本地 OCR 任务写回分页正文和置信度", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内允许写入的临时根目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是数据库、附件和模拟命令的隔离目录。 */
  const temporaryDirectory = fs.mkdtempSync(path.join(testDataRoot, "zhixu-ocr-"));
  /** fakeTesseractPath 是不依赖系统安装的 TSV 模拟程序。 */
  const fakeTesseractPath = path.join(temporaryDirectory, "fake-tesseract.mjs");
  fs.writeFileSync(
    fakeTesseractPath,
    `if (process.argv.includes("--version")) {
  process.stdout.write("tesseract 5-test\\n");
  process.exit(0);
}
process.stdout.write([
  "level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext",
  "5\\t1\\t1\\t1\\t1\\t1\\t10\\t20\\t80\\t24\\t96.5\\t生物反应器",
  "5\\t1\\t1\\t1\\t1\\t2\\t100\\t20\\t60\\t24\\t88.5\\tcontrol",
  "5\\t1\\t1\\t1\\t2\\t1\\t10\\t60\\t100\\t24\\t91\\t温度反馈"
].join("\\n"));
`,
    "utf8",
  );
  /** serverProcess 是配置模拟 Tesseract 的知序服务。 */
  const serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      ZHIXU_DATA_DIR: temporaryDirectory,
      ZHIXU_PORT: String(ocrPort),
      ZHIXU_NO_BROWSER: "1",
      ZHIXU_DISABLE_CODEX_WORKER: "1",
      ZHIXU_TESSERACT_CLI_JS: fakeTesseractPath,
      DEEPSEEK_API_KEY: "",
    },
    stdio: "ignore",
  });
  try {
    await waitForServer();
    /** uploadResponse 是模拟扫描图片上传请求。 */
    const uploadResponse = await fetch(`${ocrBaseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-File-Name": encodeURIComponent("发酵控制扫描页.png"),
      },
      body: Buffer.from("not-a-real-image-because-cli-is-mocked"),
    });
    assert.equal(uploadResponse.status, 201);
    const uploadPayload = await uploadResponse.json();
    assert.equal(uploadPayload.document.ocrStatus, "queued");
    assert.equal(uploadPayload.importJob.jobType, "document_ocr");

    /** completedJob 证明上传接口没有等待识别，后台任务随后完成。 */
    const completedJob = await waitForJob(uploadPayload.importJob.id);
    assert.equal(completedJob.status, "completed", completedJob.errorMessage);
    assert.equal(completedJob.targetType, "document");

    /** detailPayload 是 OCR 写回后的文档正文和摘要状态。 */
    const detailResponse = await fetch(
      `${ocrBaseUrl}/api/documents/${encodeURIComponent(uploadPayload.document.id)}`,
    );
    const detailPayload = await detailResponse.json();
    assert.equal(detailPayload.document.ocrStatus, "completed");
    assert.equal(detailPayload.document.ocrPageCount, 1);
    assert.match(detailPayload.document.extractedText, /生物反应器 control/);
    assert.equal(Math.round(detailPayload.document.ocrAverageConfidence), 92);

    /** pagesPayload 保留逐页正文和坐标，供后续页面定位。 */
    const pagesResponse = await fetch(
      `${ocrBaseUrl}/api/documents/${encodeURIComponent(uploadPayload.document.id)}/pages`,
    );
    const pagesPayload = await pagesResponse.json();
    assert.equal(pagesPayload.pages.length, 1);
    assert.equal(pagesPayload.pages[0].layout.length, 3);
  } finally {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
