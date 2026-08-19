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
      ZHIXU_DISABLE_CODEX_WORKER: "1",
      DEEPSEEK_API_KEY: "",
    },
    stdio: "ignore",
  });

  try {
    await waitForServer();
    /** workerResponse 验证页面能够读取后台 Codex 工作器状态。 */
    const workerResponse = await fetch(
      `${integrationBaseUrl}/api/paper-translation-worker/status`,
    );
    assert.equal(workerResponse.status, 200);
    /** workerPayload 在集成测试中应明确显示工作器已关闭。 */
    const workerPayload = await workerResponse.json();
    assert.equal(workerPayload.worker.status, "disabled");
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

    /** foldersResponse 是默认一级文件夹树响应。 */
    const foldersResponse = await fetch(`${integrationBaseUrl}/api/folders`);
    /** foldersPayload 包含分类迁移后创建的七个一级文件夹。 */
    const foldersPayload = await foldersResponse.json();
    /** databaseFolder 是当前测试文档初始所在的数据库目录。 */
    const databaseFolder = foldersPayload.folders.find(
      (folder) => folder.name === "数据库" && !folder.parentId,
    );
    assert.ok(databaseFolder);
    assert.equal(listPayload.documents[0].folderId, databaseFolder.id);

    /** childFolderResponse 是在数据库目录下创建二级目录的响应。 */
    const childFolderResponse = await fetch(`${integrationBaseUrl}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: databaseFolder.id, name: "MVCC 专题" }),
    });
    assert.equal(childFolderResponse.status, 201);
    /** childFolderPayload 是新二级目录及最新文件夹树。 */
    const childFolderPayload = await childFolderResponse.json();
    /** childFolderId 是后续移动和安全删除使用的目录 ID。 */
    const childFolderId = childFolderPayload.folder.id;

    /** moveResponse 是把测试文档移动到二级目录的响应。 */
    const moveResponse = await fetch(`${integrationBaseUrl}/api/folder-items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "document",
        targetId: documentId,
        folderId: childFolderId,
      }),
    });
    assert.equal(moveResponse.status, 200);
    /** movedListPayload 用于验证主要目录关系已经改变。 */
    const movedListPayload = await (
      await fetch(`${integrationBaseUrl}/api/documents`)
    ).json();
    assert.equal(movedListPayload.documents[0].folderId, childFolderId);

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
    /** programFolder 是人工修改分类后文档自动进入的一级目录。 */
    const programFolder = childFolderPayload.folders.find(
      (folder) => folder.name === "程序" && !folder.parentId,
    );
    assert.equal(categoryPayload.document.folderId, programFolder.id);

    /** deleteFolderResponse 验证内容移走后空文件夹可以安全删除。 */
    const deleteFolderResponse = await fetch(
      `${integrationBaseUrl}/api/folders/${encodeURIComponent(childFolderId)}`,
      { method: "DELETE" },
    );
    assert.equal(deleteFolderResponse.status, 200);

    /** downloadResponse 是原文件下载响应。 */
    const downloadResponse = await fetch(
      `${integrationBaseUrl}/api/documents/${encodeURIComponent(documentId)}/download`,
    );
    assert.equal(downloadResponse.status, 200);
    assert.equal(await downloadResponse.text(), sourceText);

    /** initialWorkspaceResponse 是首次打开文档时的空阅读工作台响应。 */
    const initialWorkspaceResponse = await fetch(
      `${integrationBaseUrl}/api/reading-workspace?targetType=document&targetId=${encodeURIComponent(documentId)}`,
    );
    assert.equal(initialWorkspaceResponse.status, 200);
    /** initialWorkspacePayload 是带有默认未读状态的工作台数据。 */
    const initialWorkspacePayload = await initialWorkspaceResponse.json();
    assert.equal(initialWorkspacePayload.workspace.state.status, "unread");
    assert.deepEqual(initialWorkspacePayload.workspace.annotations, []);

    /** stateResponse 是保存阅读进度、状态和个人笔记的响应。 */
    const stateResponse = await fetch(`${integrationBaseUrl}/api/reading-workspace`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "document",
        targetId: documentId,
        status: "reading",
        progressPercent: 37.5,
        noteText: "重点理解 MVCC 的快照可见性规则。",
      }),
    });
    assert.equal(stateResponse.status, 200);
    /** statePayload 是持久化后的最新阅读状态。 */
    const statePayload = await stateResponse.json();
    assert.equal(statePayload.state.status, "reading");
    assert.equal(statePayload.state.progressPercent, 37.5);

    /** annotationResponse 是保存一段原文高亮的响应。 */
    const annotationResponse = await fetch(
      `${integrationBaseUrl}/api/reading-annotations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "document",
          targetId: documentId,
          quoteText: "MVCC",
          anchorStart: 20,
          anchorEnd: 24,
          color: "yellow",
        }),
      },
    );
    assert.equal(annotationResponse.status, 201);
    /** annotationPayload 是新创建的高亮批注。 */
    const annotationPayload = await annotationResponse.json();
    /** annotationId 是后续修改和删除使用的批注 ID。 */
    const annotationId = annotationPayload.annotation.id;

    /** annotationUpdateResponse 是为高亮补充文字批注的响应。 */
    const annotationUpdateResponse = await fetch(
      `${integrationBaseUrl}/api/reading-annotations/${encodeURIComponent(annotationId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText: "与 PostgreSQL vacuum 行为关联阅读。" }),
      },
    );
    assert.equal(annotationUpdateResponse.status, 200);

    /** savedWorkspaceResponse 是重新读取全部阅读数据的响应。 */
    const savedWorkspaceResponse = await fetch(
      `${integrationBaseUrl}/api/reading-workspace?targetType=document&targetId=${encodeURIComponent(documentId)}`,
    );
    /** savedWorkspacePayload 用于验证状态、笔记和批注均已持久化。 */
    const savedWorkspacePayload = await savedWorkspaceResponse.json();
    assert.equal(savedWorkspacePayload.workspace.state.progressPercent, 37.5);
    assert.equal(savedWorkspacePayload.workspace.annotations.length, 1);
    assert.match(savedWorkspacePayload.workspace.annotations[0].noteText, /vacuum/);

    /** tagResponse 是为当前文档新增技术标签的响应。 */
    const tagResponse = await fetch(`${integrationBaseUrl}/api/content-tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "document", targetId: documentId, tagName: "MVCC" }),
    });
    assert.equal(tagResponse.status, 201);
    /** tagPayload 是内容最新标签列表。 */
    const tagPayload = await tagResponse.json();
    assert.deepEqual(tagPayload.tags, ["MVCC"]);

    /** topicResponse 是创建本地学习专题的响应。 */
    const topicResponse = await fetch(`${integrationBaseUrl}/api/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "PostgreSQL 深入", description: "事务与存储专题" }),
    });
    assert.equal(topicResponse.status, 201);
    /** topicPayload 是新专题对象。 */
    const topicPayload = await topicResponse.json();
    /** topicId 是后续关联和读取使用的专题 ID。 */
    const topicId = topicPayload.topic.id;

    /** topicItemResponse 是将测试文档加入专题的响应。 */
    const topicItemResponse = await fetch(`${integrationBaseUrl}/api/topic-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, targetType: "document", targetId: documentId }),
    });
    assert.equal(topicItemResponse.status, 201);
    /** topicItemPayload 是专题的最新内容列表。 */
    const topicItemPayload = await topicItemResponse.json();
    assert.equal(topicItemPayload.items[0].targetId, documentId);
    assert.deepEqual(topicItemPayload.items[0].tags, ["MVCC"]);

    /** unifiedSearchResponse 是跨正文与阅读笔记的统一检索响应。 */
    const unifiedSearchResponse = await fetch(
      `${integrationBaseUrl}/api/search?q=${encodeURIComponent("快照可见性")}`,
    );
    assert.equal(unifiedSearchResponse.status, 200);
    /** unifiedSearchPayload 用于验证个人笔记也可以被检索。 */
    const unifiedSearchPayload = await unifiedSearchResponse.json();
    assert.equal(unifiedSearchPayload.results[0].targetId, documentId);
    assert.equal(unifiedSearchPayload.results[0].matchSource, "阅读笔记");
    assert.deepEqual(unifiedSearchPayload.results[0].tags, ["MVCC"]);

    /** annotationDeleteResponse 是删除测试高亮的响应。 */
    const annotationDeleteResponse = await fetch(
      `${integrationBaseUrl}/api/reading-annotations/${encodeURIComponent(annotationId)}`,
      { method: "DELETE" },
    );
    assert.equal(annotationDeleteResponse.status, 200);

    /** cardCreateResponse 是从原文选区创建来源卡片的响应。 */
    const cardCreateResponse = await fetch(`${integrationBaseUrl}/api/knowledge-cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "document",
        targetId: documentId,
        cardType: "concept",
        question: "MVCC 的作用是什么？",
        answer: "为事务提供一致性快照与并发可见性控制。",
        sourceQuote: "数据库事务通过 MVCC 提供一致性快照",
        anchorStart: 18,
        anchorEnd: 39,
      }),
    });
    assert.equal(cardCreateResponse.status, 201);
    /** cardCreatePayload 是带来源标题的新知识卡片。 */
    const cardCreatePayload = await cardCreateResponse.json();
    /** cardId 是后续复习调度使用的卡片 ID。 */
    const cardId = cardCreatePayload.card.id;
    assert.match(cardCreatePayload.card.sourceTitle, /PostgreSQL/);

    /** dueCardsResponse 是今日到期卡片列表。 */
    const dueCardsResponse = await fetch(`${integrationBaseUrl}/api/knowledge-cards?due=1`);
    /** dueCardsPayload 用于确认新卡片立即进入今日复习。 */
    const dueCardsPayload = await dueCardsResponse.json();
    assert.equal(dueCardsPayload.cards[0].id, cardId);

    /** reviewResponse 是一次“记得”复习结果。 */
    const reviewResponse = await fetch(
      `${integrationBaseUrl}/api/knowledge-cards/${encodeURIComponent(cardId)}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: "good" }),
      },
    );
    assert.equal(reviewResponse.status, 200);
    /** reviewPayload 是下一次复习调度。 */
    const reviewPayload = await reviewResponse.json();
    assert.equal(reviewPayload.card.reviewCount, 1);
    assert.ok(reviewPayload.card.intervalDays >= 1);

    /** documentDeleteResponse 是用户确认后的永久删除响应。 */
    const documentDeleteResponse = await fetch(
      `${integrationBaseUrl}/api/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    );
    assert.equal(documentDeleteResponse.status, 200);
    /** deletedDetailResponse 验证主记录已经删除。 */
    const deletedDetailResponse = await fetch(
      `${integrationBaseUrl}/api/documents/${encodeURIComponent(documentId)}`,
    );
    assert.equal(deletedDetailResponse.status, 404);
    /** remainingCardsResponse 验证删除来源时关联卡片也被清理。 */
    const remainingCardsResponse = await fetch(`${integrationBaseUrl}/api/knowledge-cards`);
    /** remainingCardsPayload 是删除来源后的卡片列表。 */
    const remainingCardsPayload = await remainingCardsResponse.json();
    assert.equal(remainingCardsPayload.cards.length, 0);
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
