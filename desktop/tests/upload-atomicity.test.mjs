import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import test, { mock } from "node:test";

// 只在隔离子进程替换故障边界，HTTP、SQLite 事务、附件与下载走真实实现。
if (process.env.ZHIXU_UPLOAD_ATOMICITY_FIXTURE === "1") {
  const failure = process.env.ZHIXU_UPLOAD_FAILURE;
  const database = await import("../lib/database.mjs");
  const classifier = await import("../lib/classifier.mjs");
  const paper = await import("../lib/paper-service.mjs");
  const ocr = await import("../lib/ocr-service.mjs");
  let failedOcrEnqueue = false;
  mock.module("../lib/classifier.mjs", { namedExports: {
    ...classifier,
    classifyDocument: async ({ fileName }) => {
      if (failure === "folder" && fileName === "folder-race.txt") {
        const folder = database.listFolders().find((item) => item.name === "上传期间失效");
        assert.ok(folder, "故障必须发生在路由校验目录之后");
        database.deleteEmptyFolder(folder.id);
      }
      return { category: "AI", source: "rules", confidence: 1 };
    },
  } });
  mock.module("../lib/database.mjs", { namedExports: {
    ...database,
    createDailyBackup: () => {
      // 启动备份保持正常，只有真实文档提交之后才注入备份失败。
      if (failure === "backup" && database.listDocuments({ limit: 1 }).length > 0) {
        throw new Error("KB01 injected backup failure");
      }
      return database.createDailyBackup();
    },
    createImportJob: (input) => {
      if (failure === "ocr" && input.jobType === "document_ocr" && !failedOcrEnqueue) {
        failedOcrEnqueue = true;
        throw new Error("KB01 injected OCR enqueue failure");
      }
      return database.createImportJob(input);
    },
  } });
  mock.module("../lib/paper-service.mjs", { namedExports: {
    ...paper, ensureDailyClassicPaperCandidate: async () => null,
  } });
  mock.module("../lib/ocr-service.mjs", { namedExports: {
    ...ocr,
    // 重试仍跑真实任务编排与分页/索引写入，不依赖测试电脑安装 OCR 工具。
    recognizeDocument: async () => ({
      language: "chi_sim+eng", averageConfidence: 98,
      pages: [{ pageNumber: 1, text: "KB01 OCR retry succeeded", confidence: 98, layout: [] }],
    }),
  } });
  await import("../server.mjs");
} else {
  async function unusedPort() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    return port;
  }

  async function fixture(t, failure) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhixu-upload-atomicity-"));
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [
      "--disable-warning=ExperimentalWarning", "--experimental-test-module-mocks", import.meta.filename,
    ], {
      cwd: path.resolve(import.meta.dirname, ".."), windowsHide: true,
      env: {
        ...process.env, ZHIXU_UPLOAD_ATOMICITY_FIXTURE: "1", ZHIXU_UPLOAD_FAILURE: failure,
        ZHIXU_HOST: "127.0.0.1", ZHIXU_PORT: String(port),
        ZHIXU_DATA_DIR: directory, ZHIXU_ENV_FILE: path.join(directory, "absent.env"),
        ZHIXU_NO_BROWSER: "1", ZHIXU_DISABLE_CODEX_WORKER: "1",
        DEEPSEEK_API_KEY: "", GITHUB_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, "exit");
        child.kill();
        await stopped;
      }
      // 目标来自 mkdtemp 的完整路径，只清理本测试拥有的隔离目录。
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith("zhixu-upload-atomicity-"));
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, output);
      try {
        if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok) break;
      } catch {}
      if (attempt === 99) assert.fail(`隔离测试服务未启动：${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    async function json(route, body) {
      const response = await fetch(base + route, body === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, ...await response.json() };
    }
    async function upload(name, bytes, folderId = "") {
      const response = await fetch(`${base}/api/documents`, {
        method: "POST",
        headers: {
          "Content-Type": name.endsWith(".png") ? "image/png" : "text/plain",
          "X-File-Name": encodeURIComponent(name), "X-Target-Folder-Id": folderId,
        },
        body: bytes,
      });
      return { status: response.status, ...await response.json() };
    }
    function snapshot() {
      const readOnly = new DatabaseSync(path.join(directory, "zhixu.db"), { readOnly: true });
      try {
        return {
          documents: readOnly.prepare("SELECT COUNT(*) AS n FROM documents").get().n,
          search: readOnly.prepare("SELECT COUNT(*) AS n FROM document_search").get().n,
          assignments: readOnly.prepare("SELECT COUNT(*) AS n FROM content_folders WHERE target_type = 'document'").get().n,
          jobs: readOnly.prepare("SELECT COUNT(*) AS n FROM import_jobs WHERE job_type = 'document_ocr'").get().n,
          attachments: fs.readdirSync(path.join(directory, "attachments")).sort(),
        };
      } finally {
        readOnly.close();
      }
    }
    async function assertDownload(document, bytes) {
      const response = await fetch(`${base}/api/documents/${encodeURIComponent(document.id)}/download`);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    return { json, upload, snapshot, assertDownload };
  }

  test("上传期间目标目录失效时，记录、全文索引与附件一起回滚", { timeout: 30000 }, async (t) => {
    const app = await fixture(t, "folder");
    const created = await app.json("/api/folders", { name: "上传期间失效" });
    assert.equal(created.status, 201);
    const before = app.snapshot();
    const failed = await app.upload("folder-race.txt", Buffer.from("KB01 folder rollback"), created.folder.id);
    assert.ok(failed.status >= 400, JSON.stringify(failed));
    assert.match(failed.message, /目录|文件夹/);
    assert.deepEqual(app.snapshot(), before, "失败导入不能遗留记录、FTS、目录关系、任务或附件");

    // 事务回滚后连接仍能继续工作，正常导入仍保存目录关系与可下载附件。
    const bytes = Buffer.from("KB01 successful upload after rollback");
    const saved = await app.upload("after-rollback.txt", bytes);
    assert.equal(saved.status, 201, JSON.stringify(saved));
    assert.ok(saved.document.folderId);
    const after = app.snapshot();
    assert.equal(after.documents, before.documents + 1);
    assert.equal(after.search, before.search + 1);
    assert.equal(after.assignments, before.assignments + 1);
    await app.assertDownload(saved.document, bytes);
  });

  test("文档已提交后备份失败仍返回成功和警告，并保留可下载原件", { timeout: 30000 }, async (t) => {
    const app = await fixture(t, "backup");
    const bytes = Buffer.from("KB01 saved document survives backup failure");
    const saved = await app.upload("backup-failure.txt", bytes);
    assert.equal(saved.status, 201, JSON.stringify(saved));
    assert.ok(Array.isArray(saved.warnings) && saved.warnings.every((item) => typeof item === "string"));
    assert.ok(saved.warnings.length > 0);
    assert.match(saved.warnings.join(" "), /备份|backup/i);
    const state = app.snapshot();
    assert.equal(state.documents, 1);
    assert.equal(state.search, 1);
    assert.equal(state.assignments, 1);
    assert.equal(state.attachments.length, 1);
    await app.assertDownload(saved.document, bytes);
  });

  test("OCR 入队失败保留原件并报告警告，用户可以再次入队完成识别", { timeout: 30000 }, async (t) => {
    const app = await fixture(t, "ocr");
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");
    const saved = await app.upload("ocr-enqueue-failure.png", bytes);
    assert.equal(saved.status, 201, JSON.stringify(saved));
    assert.ok(Array.isArray(saved.warnings) && saved.warnings.every((item) => typeof item === "string"));
    assert.ok(saved.warnings.length > 0);
    assert.match(saved.warnings.join(" "), /OCR|识别/i);
    assert.equal(saved.document.ocrStatus, "failed");
    assert.match(saved.document.ocrError, /KB01 injected OCR enqueue failure/);
    assert.equal(app.snapshot().documents, 1);
    assert.equal(app.snapshot().jobs, 0);
    await app.assertDownload(saved.document, bytes);

    const retried = await app.json(`/api/documents/${saved.document.id}/ocr`, {});
    assert.equal(retried.status, 202, JSON.stringify(retried));
    assert.equal(retried.job.payload.documentId, saved.document.id);
    for (let attempt = 0; attempt < 100; attempt++) {
      const detail = await app.json(`/api/documents/${saved.document.id}`);
      if (detail.document.ocrStatus === "completed") {
        assert.match(detail.document.extractedText, /KB01 OCR retry succeeded/);
        assert.equal(detail.document.ocrError, "");
        break;
      }
      if (attempt === 99) assert.fail(`OCR 重试未完成：${JSON.stringify(detail)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(app.snapshot().search, 1, "OCR 更新不能产生重复全文索引");
    await app.assertDownload(saved.document, bytes);
  });
}
