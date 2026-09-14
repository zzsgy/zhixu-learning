import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import test, { mock } from "node:test";

if (process.env.ZHIXU_LOCAL_SAFETY_FIXTURE === "1") {
  const classifier = await import("../lib/classifier.mjs");
  const paper = await import("../lib/paper-service.mjs");
  const cleanup = await import("../lib/file-deletion-runner.mjs");
  mock.module("../lib/classifier.mjs", { namedExports: {
    ...classifier, classifyDocument: async () => ({ category: "AI", source: "rules", confidence: 1 }),
  } });
  mock.module("../lib/paper-service.mjs", { namedExports: { ...paper, ensureDailyClassicPaperCandidate: async () => null } });
  if (process.env.ZHIXU_BLOCK_FILE_DELETION === "1") {
    mock.module("../lib/file-deletion-runner.mjs", { namedExports: {
      ...cleanup,
      createFileDeletionRunner: (options) => cleanup.createFileDeletionRunner({ ...options,
        unlinkFile: () => { throw Object.assign(new Error("KB12 injected Windows file-in-use failure"), { code: "EBUSY" }); },
      }),
    } });
  }
  await import("../server.mjs");
} else {
  async function freePort() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    return port;
  }

  function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zhixu-local-safety-"));
    const children = [];
    async function stop(child) {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, "exit");
        child.kill();
        await stopped;
      }
    }
    t.after(async () => {
      for (const child of children) await stop(child);
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith("zhixu-local-safety-"));
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    async function start(blockDeletion = false) {
      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-test-module-mocks", import.meta.filename], {
        cwd: path.resolve(import.meta.dirname, ".."), windowsHide: true,
        env: { ...process.env, ZHIXU_LOCAL_SAFETY_FIXTURE: "1", ZHIXU_BLOCK_FILE_DELETION: blockDeletion ? "1" : "0",
          ZHIXU_HOST: "127.0.0.1", ZHIXU_PORT: String(port), ZHIXU_DATA_DIR: directory,
          ZHIXU_ENV_FILE: path.join(directory, "absent.env"), ZHIXU_DISABLE_CODEX_WORKER: "1",
          ZHIXU_NO_BROWSER: "1", DEEPSEEK_API_KEY: "", GITHUB_TOKEN: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      async function request(route, { method = "GET", headers = {}, body } = {}) {
        const bytes = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
        return new Promise((resolve, reject) => {
          const req = http.request(base + route, { method, headers: {
            ...(bytes && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}),
            ...(bytes ? { "Content-Length": String(bytes.length) } : {}), ...headers,
          } }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
              const content = Buffer.concat(chunks);
              let payload = {};
              try { payload = JSON.parse(content.toString("utf8")); } catch {}
              resolve({ ...payload, status: response.statusCode, headers: response.headers, content });
            });
          });
          req.once("error", reject);
          req.setTimeout(10000, () => req.destroy(new Error("isolated request timed out")));
          req.end(bytes);
        });
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        assert.equal(child.exitCode, null, output);
        try { if ((await request("/api/health")).status === 200) break; } catch {}
        if (attempt === 99) assert.fail(output);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      async function upload(name) {
        return request("/api/documents", { method: "POST",
          headers: { "Content-Type": "text/plain", "X-File-Name": name }, body: Buffer.from(`unique contents: ${name}`) });
      }
      return { base, port, request, upload, stop: () => stop(child) };
    }
    function inspect(callback, writable = false) {
      const database = new DatabaseSync(path.join(directory, "zhixu.db"), { readOnly: !writable });
      try { return callback(database); } finally { database.close(); }
    }
    return { directory, start, inspect };
  }

  test("普通 API 拒绝异常 Host、外站 Origin 和跨站修改，保留本地 CLI 与扩展鉴权", { timeout: 30000 }, async (t) => {
    const app = fixture(t);
    const server = await app.start();
    const { request } = server;
    assert.equal((await request("/api/health")).status, 200);
    assert.equal((await request("/api/health", { headers: { Host: "attacker.invalid" } })).status, 403);
    assert.equal((await request("/api/health", { headers: { Origin: "https://attacker.invalid" } })).status, 403);
    assert.equal((await request("/api/health", { headers: { Origin: "null" } })).status, 403);
    assert.equal((await request("/api/health", { headers: { Origin: server.base } })).status, 200);
    assert.equal((await request("/api/health", { headers: { Host: `localhost:${server.port}` } })).status, 200);
    const before = (await request("/api/folders")).folders.length;
    assert.equal((await request("/api/folders", { method: "POST", headers: { Origin: "https://attacker.invalid", "Content-Type": "text/plain" }, body: { name: "must-not-create" } })).status, 403);
    assert.equal((await request("/api/folders", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: { name: "must-not-create-either" } })).status, 403);
    assert.equal((await request("/api/folders")).folders.length, before);
    assert.equal((await request("/api/folders", { method: "POST", headers: { Origin: server.base }, body: { name: "local-allowed" } })).status, 201);
    assert.equal((await request("/api/backups", { method: "POST" })).status, 200, "本地空 body 备份请求应继续工作");

    const Origin = "chrome-extension://abcdefghijklmnop";
    assert.equal((await request("/api/browser/captures", { method: "OPTIONS", headers: { Origin } })).status, 204);
    assert.equal((await request("/api/browser/captures", { method: "POST", headers: { Origin }, body: { url: "https://example.com" } })).status, 401);
    assert.equal((await request("/api/documents", { headers: { Origin } })).status, 403);
    assert.equal((await request("/api/browser/pairing/start", { method: "POST", headers: { Origin } })).status, 403);
    const code = (await request("/api/browser/pairing/start", { method: "POST" })).code;
    const paired = await request("/api/browser/pair", { method: "POST", headers: { Origin }, body: { code, name: "test extension" } });
    assert.equal(paired.status, 201);
    assert.ok(paired.token.length >= 32);
  });

  test("批量删除先持久化清理任务；文件占用返回成功警告，重启后继续清理", { timeout: 30000 }, async (t) => {
    const app = fixture(t);
    const server = await app.start(true);
    const first = await server.upload("delete-first.txt");
    const second = await server.upload("delete-second.txt");
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const items = [first, second].map(({ document }) => ({ targetType: "document", targetId: document.id }));
    const refused = await server.request("/api/folder-items/batch", { method: "DELETE", body: { items: [...items, { targetType: "document", targetId: "missing" }] } });
    assert.ok(refused.status >= 400);
    assert.equal((await server.request("/api/storage/cleanup")).pendingFileCount, 0);
    assert.equal((await server.request("/api/documents")).documents.length, 2);

    const deleted = await server.request("/api/folder-items/batch", { method: "DELETE", body: { items } });
    assert.equal(deleted.status, 200, JSON.stringify(deleted));
    assert.equal(deleted.deletedCount, 2);
    assert.equal(deleted.warnings.length, 2);
    assert.equal(deleted.cleanup.pendingFileCount, 2);
    assert.equal((await server.request("/api/documents")).documents.length, 0);
    assert.equal(app.inspect((database) => database.prepare("SELECT COUNT(*) AS n FROM document_search").get().n), 0);
    assert.equal(fs.readdirSync(path.join(app.directory, "attachments")).length, 2);
    const retried = await server.request("/api/storage/cleanup/retry", { method: "POST" });
    assert.equal(retried.status, 200);
    assert.equal(retried.pendingFileCount, 2);
    assert.ok((await server.request("/api/storage/cleanup")).pending.every((item) => item.attemptCount >= 2));
    await server.stop();

    const restarted = await app.start(false);
    assert.equal((await restarted.request("/api/storage/cleanup")).pendingFileCount, 0);
    assert.equal(fs.readdirSync(path.join(app.directory, "attachments")).length, 0);
    const next = await restarted.upload("after-cleanup.txt");
    assert.equal((await restarted.request(`/api/documents/${next.document.id}`, { method: "DELETE" })).status, 200);
    assert.equal(fs.readdirSync(path.join(app.directory, "attachments")).length, 0);
  });

  test("删除论文覆盖原版及中文导出；同名共享资产与未选中的旧重复记录保留", { timeout: 30000 }, async (t) => {
    const app = fixture(t);
    const server = await app.start();
    const ids = ["paper.a", "paper_a"];
    app.inspect((database) => {
      for (const id of ids) database.prepare("INSERT INTO papers(id, external_id, title, category, source_url, created_at, updated_at) VALUES (?, ?, 'same old title', 'AI', 'https://example.com', ?, ?)")
        .run(id, `external-${id}`, new Date().toISOString(), new Date().toISOString());
    }, true);
    for (const id of ids) fs.writeFileSync(path.join(app.directory, "papers", `${id}.pdf`), `original ${id}`);
    for (const extension of ["pdf", "sha256"]) fs.writeFileSync(path.join(app.directory, "paper-chinese-pdfs", `paper_a.${extension}`), "shared derived asset");
    fs.writeFileSync(path.join(app.directory, "article-images", "keep-shared.png"), "shared image");
    const first = await server.request("/api/papers/paper.a", { method: "DELETE" });
    assert.equal(first.status, 200);
    assert.equal(first.cleanup.preservedFileCount, 2);
    assert.equal(fs.existsSync(path.join(app.directory, "papers", "paper.a.pdf")), false);
    assert.equal(fs.existsSync(path.join(app.directory, "paper-chinese-pdfs", "paper_a.pdf")), true);
    assert.equal((await server.request("/api/papers/paper_a")).status, 200);
    const second = await server.request("/api/papers/paper_a", { method: "DELETE" });
    assert.equal(second.status, 200);
    assert.equal(fs.readdirSync(path.join(app.directory, "papers")).length, 0);
    assert.equal(fs.readdirSync(path.join(app.directory, "paper-chinese-pdfs")).length, 0);
    assert.equal(fs.readFileSync(path.join(app.directory, "article-images", "keep-shared.png"), "utf8"), "shared image");

    const outside = path.join(app.directory, "outside.txt");
    fs.writeFileSync(outside, "must survive unsafe queue entry");
    app.inspect((database) => database.prepare("INSERT INTO pending_file_deletions(id,asset_kind,file_name,target_type,target_id,created_at,updated_at) VALUES ('unsafe','attachment','../outside.txt','document','deleted','now','now')").run(), true);
    const refused = await server.request("/api/storage/cleanup/retry", { method: "POST" });
    assert.equal(refused.status, 200);
    assert.equal(refused.pendingFileCount, 1);
    assert.match(refused.warnings.join(" "), /允许的资产目录/);
    assert.equal(fs.readFileSync(outside, "utf8"), "must survive unsafe queue entry");
  });
}
