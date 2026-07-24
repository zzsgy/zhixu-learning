/**
 * 本地服务上传、检索、详情、分类和下载集成测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

/** integrationPort 是集成测试独占的本地端口。 */
const integrationPort = 47829;
/** integrationBaseUrl 是集成测试服务地址。 */
const integrationBaseUrl = `http://127.0.0.1:${integrationPort}`;

/**
 * 轮询健康接口，等待子进程完成初始化。
 *
 * @returns {Promise<void>}
 */
async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      /** response 是本次健康检查响应。 */
      const response = await fetch(`${integrationBaseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // 服务尚未监听时继续短暂等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("集成测试服务未能按时启动。");
}

/**
 * 验证完整的本地文档处理链路。
 */
test("上传、分类、搜索、修改分类与下载原件", async () => {
  /** projectDirectory 是桌面版本项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataDirectory 是允许测试写入的项目内临时目录。 */
  const testDataDirectory = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataDirectory, { recursive: true });
  /** temporaryDirectory 是本测试独占的数据目录。 */
  const temporaryDirectory = fs.mkdtempSync(
    path.join(testDataDirectory, "zhixu-integration-"),
  );
  /** serverProcess 是运行本地知识库服务的子进程。 */
  const serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      ZHIXU_DATA_DIR: temporaryDirectory,
      ZHIXU_PORT: String(integrationPort),
      ZHIXU_NO_BROWSER: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: "ignore",
  });

  try {
    await waitForServer();
    /** sourceText 是用于测试分类和下载完整性的 Markdown 原文。 */
    const sourceText =
      "# PostgreSQL MVCC\n\n数据库事务通过 MVCC 提供一致性快照，查询优化器会评估索引成本。";
    /** uploadResponse 是原始二进制上传响应。 */
    const uploadResponse = await fetch(`${integrationBaseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "text/markdown",
        "X-File-Name": encodeURIComponent("PostgreSQL事务基础.md"),
      },
      body: sourceText,
    });
    assert.equal(uploadResponse.status, 201);
    /** uploadPayload 是新建文档对象。 */
    const uploadPayload = await uploadResponse.json();
    assert.equal(uploadPayload.document.category, "数据库");
    assert.match(uploadPayload.document.extractedText, /MVCC/);

    /** documentId 是上传后返回的文档 ID。 */
    const documentId = uploadPayload.document.id;
    assert.equal(uploadPayload.document.isFavorite, false);
    /** favoriteResponse 是将上传文档标为重点的本地持久化响应。 */
    const favoriteResponse = await fetch(`${integrationBaseUrl}/api/favorites`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "document",
        targetId: documentId,
        active: true,
      }),
    });
    assert.equal(favoriteResponse.status, 200);
    /** favoritePayload 是最终收藏状态。 */
    const favoritePayload = await favoriteResponse.json();
    assert.equal(favoritePayload.favorite.active, true);
    /** listResponse 是关键词检索响应。 */
    const listResponse = await fetch(
      `${integrationBaseUrl}/api/documents?q=${encodeURIComponent("PostgreSQL")}`,
    );
    /** listPayload 是文档列表和统计。 */
    const listPayload = await listResponse.json();
    assert.equal(listPayload.statistics.total, 1);
    assert.equal(listPayload.documents[0].id, documentId);
    assert.equal(listPayload.documents[0].isFavorite, true);

    /** categoryResponse 是人工修改分类响应。 */
    const categoryResponse = await fetch(
      `${integrationBaseUrl}/api/documents/${encodeURIComponent(documentId)}/category`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "程序" }),
      },
    );
    /** categoryPayload 是更新后的文档。 */
    const categoryPayload = await categoryResponse.json();
    assert.equal(categoryPayload.document.category, "程序");
    assert.equal(categoryPayload.document.categorySource, "manual");

    /** downloadResponse 是原文件下载响应。 */
    const downloadResponse = await fetch(
      `${integrationBaseUrl}/api/documents/${encodeURIComponent(documentId)}/download`,
    );
    assert.equal(downloadResponse.status, 200);
    assert.equal(await downloadResponse.text(), sourceText);
  } finally {
    if (serverProcess.exitCode === null) {
      await new Promise((resolve) => {
        /** fallbackTimer 防止异常子进程在测试清理阶段永久等待。 */
        const fallbackTimer = setTimeout(resolve, 1500);
        serverProcess.once("exit", () => {
          clearTimeout(fallbackTimer);
          resolve();
        });
        serverProcess.kill();
      });
    }
    /** resolvedTemporaryDirectory 用于确保只删除本测试创建的临时目录。 */
    const resolvedTemporaryDirectory = path.resolve(temporaryDirectory);
    /** resolvedTestDataDirectory 是项目内测试临时目录绝对路径。 */
    const resolvedTestDataDirectory = path.resolve(testDataDirectory);
    if (
      resolvedTemporaryDirectory.startsWith(
        `${resolvedTestDataDirectory}${path.sep}`,
      ) &&
      path.basename(resolvedTemporaryDirectory).startsWith("zhixu-integration-")
    ) {
      fs.rmSync(resolvedTemporaryDirectory, { recursive: true, force: true });
    }
    if (fs.existsSync(testDataDirectory) && fs.readdirSync(testDataDirectory).length === 0) {
      fs.rmdirSync(testDataDirectory);
    }
  }
});
