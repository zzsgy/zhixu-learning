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
 * 学习统计是默认首页，资料库统计使用目录层级而非导入时间柱图。
 */
test("学习统计默认首页并展示资料库目录层级", () => {
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  const pageSource = fs.readFileSync(path.join(projectDirectory, "public", "index.html"), "utf8");
  const applicationSource = fs.readFileSync(path.join(projectDirectory, "public", "app.js"), "utf8");
  const activityNavigationIndex = pageSource.indexOf('data-view="activity"');
  const libraryNavigationIndex = pageSource.indexOf('data-view="library"');
  assert.ok(activityNavigationIndex >= 0 && activityNavigationIndex < libraryNavigationIndex);
  assert.match(pageSource, /class="nav-item is-active" data-view="activity"/);
  assert.match(pageSource, /class="view is-active" id="activity-view"/);
  assert.match(pageSource, /id="page-title">学习与资料统计/);
  assert.match(pageSource, /id="activity-library-chart"/);
  assert.match(pageSource, /data-view="ai" type="button" hidden/);
  assert.match(pageSource, /data-view="github"/);
  assert.match(pageSource, /id="github-view"/);
  assert.match(pageSource, /id="github-project-form"/);
  assert.match(pageSource, /id="activity-github-statistics"/);
  assert.doesNotMatch(pageSource, /资料入库节奏/);
  assert.match(applicationSource, /activeView: "activity"/);
  assert.match(applicationSource, /function renderLibraryCompositionChart\(composition\)/);
  assert.match(applicationSource, /function renderGitHubStatistics\(statistics\)/);
  assert.match(applicationSource, /function analyzeGitHubProject\(\)/);
  assert.doesNotMatch(applicationSource, /renderImportActivityChart/);
});

/**
 * 成功上传只保留短暂通知，失败状态仍由队列项承载。
 */
test("上传成功后自动收起状态行且空队列不占版面", () => {
  /** projectDirectory 是桌面版本项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** applicationSource 是上传反馈的浏览器端实现。 */
  const applicationSource = fs.readFileSync(path.join(projectDirectory, "public", "app.js"), "utf8");
  /** styleSource 是空队列折叠和退出动画样式。 */
  const styleSource = fs.readFileSync(path.join(projectDirectory, "public", "styles.css"), "utf8");
  /** pageSource 是文件与文件夹双入口及汇总进度结构。 */
  const pageSource = fs.readFileSync(path.join(projectDirectory, "public", "index.html"), "utf8");

  assert.match(applicationSource, /function dismissSuccessfulQueueItem\(queueItem\)/);
  assert.match(applicationSource, /window\.setTimeout\(\(\) => queueItem\.remove\(\), 180\)/);
  assert.match(applicationSource, /catch \(error\) \{[\s\S]*queueItem\.classList\.add\("is-error"\)/);
  assert.match(styleSource, /\.upload-queue:empty\s*\{\s*display:\s*none;/);
  assert.match(styleSource, /\.queue-item\.is-removing\s*\{[^}]*opacity:\s*0;/);
  assert.match(pageSource, /id="folder-input"[^>]*webkitdirectory/);
  assert.match(pageSource, /id="choose-folder-button"/);
  assert.match(pageSource, /id="upload-batch-progress"/);
  assert.match(pageSource, /id="upload-duplicate-summary"/);
  assert.match(applicationSource, /window\.showDirectoryPicker/);
  assert.match(applicationSource, /function collectDirectoryUploadEntries/);
  assert.match(applicationSource, /void chooseImportFolder\(\)/);
  assert.match(applicationSource, /file\.webkitRelativePath/);
  assert.match(applicationSource, /"X-Relative-Path"/);
  assert.match(applicationSource, /DUPLICATE_DOCUMENT/);
  assert.match(applicationSource, /function renderUploadDuplicateSummary\(duplicates\)/);
  assert.match(pageSource, /name="upload-destination-mode" value="auto" checked/);
  assert.match(pageSource, /id="upload-folder-select"/);
  assert.match(applicationSource, /"X-Target-Folder-Id"/);
  assert.match(applicationSource, /getUploadFolderPathLabel/);
  assert.match(applicationSource, /已保存到“\$\{targetFolderLabel\}”/);
  assert.match(applicationSource, /function locateImportJobTarget\(job\)/);
  assert.match(applicationSource, /所在目录：\$\{job\.location\.folderLabel\}/);
  assert.match(applicationSource, /"查看位置"/);
  assert.match(applicationSource, /card\.dataset\.itemKey = itemKey/);
  assert.match(styleSource, /\.document-card\.is-located/);
  assert.match(pageSource, /id="batch-select-button"/);
  assert.match(pageSource, /id="library-batch-toolbar"/);
  assert.match(pageSource, /id="batch-delete-button"/);
  assert.match(applicationSource, /\/api\/folder-items\/batch/);
  assert.match(applicationSource, /function deleteSelectedLibraryItems\(\)/);
  assert.match(applicationSource, /function getUnifiedLibraryItems\(\)/);
  assert.match(applicationSource, /\.\.\.getUnifiedLibraryItems\(\)/);
  assert.match(applicationSource, /function getChineseLibrarySummary\(item\)/);
  assert.match(applicationSource, /item\.translatedSummary/);
  assert.match(applicationSource, /function getChinesePaperSummary\(paper\)/);
  assert.match(applicationSource, /paper\.translationPreviewZh/);
  assert.match(applicationSource, /function moveLibraryFolder\(folder\)/);
  assert.match(applicationSource, /\/api\/folders\/\$\{encodeURIComponent\(folder\.id\)\}\/move/);
  assert.match(applicationSource, /function renameKnowledgeItem\(item\)/);
  assert.match(applicationSource, /className = "content-rename-button"/);
});

/**
 * 本地文档默认使用站内章节阅读，PDF 原文件在新标签页交给浏览器阅读器。
 */
test("本地文档默认按章节阅读且在新标签页打开 PDF 原版", () => {
  /** projectDirectory 是桌面版本项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** applicationSource 是文档阅读模式的浏览器端实现。 */
  const applicationSource = fs.readFileSync(path.join(projectDirectory, "public", "app.js"), "utf8");
  /** pageSource 是 HTML 阅读状态和原版 PDF 新标签页入口。 */
  const pageSource = fs.readFileSync(path.join(projectDirectory, "public", "index.html"), "utf8");
  /** styleSource 是 HTML 正文和 PDF 目录项的阅读页样式。 */
  const styleSource = fs.readFileSync(path.join(projectDirectory, "public", "styles.css"), "utf8");
  /** serverSource 是 PDF 原页图像按需响应和逐页文本关联实现。 */
  const serverSource = fs.readFileSync(path.join(projectDirectory, "server.mjs"), "utf8");
  /** extractorSource 是 PDF 物理页码标记生成实现。 */
  const extractorSource = fs.readFileSync(path.join(projectDirectory, "lib", "extractor.mjs"), "utf8");

  assert.match(pageSource, /<span class="is-active" aria-current="page">HTML 阅读<\/span>/);
  assert.match(pageSource, /id="original-document-link"[\s\S]*target="_blank"[\s\S]*rel="noopener"/);
  assert.match(pageSource, /↗ 新标签页查看原版/);
  assert.doesNotMatch(pageSource, /id="original-preview-frame"/);
  assert.match(applicationSource, /originalDocumentLink\.href = supportsOriginalView/);
  assert.match(applicationSource, /\/view\?v=\$\{previewRevision\}/);
  assert.doesNotMatch(applicationSource, /originalPreviewFrame/);
  assert.match(applicationSource, /function parseReadableTocLine\(line\)/);
  assert.match(applicationSource, /readable-toc-item is-level-/);
  assert.match(styleSource, /\.readable-toc-item\s*\{/);
  assert.match(applicationSource, /function splitReadableTextIntoChunks\(text\)/);
  assert.match(applicationSource, /function createTextDocumentChapters\(text, pdfOutline = \[\]\)/);
  assert.match(applicationSource, /function createPdfOutlineDocumentChapters\(text, pdfOutline\)/);
  assert.match(applicationSource, /documentItem\.pdfOutline \|\| \[\]/);
  assert.match(applicationSource, /function createWordDocumentChapters\(rawHtml\)/);
  assert.match(applicationSource, /async function renderDocumentChapter\(requestedIndex, options = \{\}\)/);
  assert.match(applicationSource, /if \(normalizedText\.length <= 260\) return \[normalizedText\]/);
  assert.match(applicationSource, /const readableSentenceSegmenter = typeof Intl\.Segmenter/);
  assert.match(applicationSource, /validOffsets\.length > 0 \? Math\.max\(\.\.\.validOffsets\) : 150/);
  assert.match(applicationSource, /文档章节排版失败，已改用纯文本显示/);
  assert.match(applicationSource, /ZHIXU_PDF_PAGE/);
  assert.match(applicationSource, /\/page-figure\?page=\$\{pageNumber\}&asset=\$\{figureInfo\.assetIndex\}/);
  assert.match(applicationSource, /className = "readable-document-figure"/);
  assert.match(applicationSource, /function createStructuredPdfPage\(pageNumber, pageData\)/);
  assert.match(applicationSource, /pdfStructuredPages/);
  assert.match(applicationSource, /className = "readable-structured-columns"/);
  assert.match(applicationSource, /\/page-figure-region\?page=\$\{pageNumber\}&region=\$\{figureInfo\.regionIndex\}/);
  assert.match(applicationSource, /removeDiagramLabels/);
  assert.match(applicationSource, /ZHIXU_PDF_TABLE/);
  assert.match(applicationSource, /className = "readable-document-table"/);
  assert.match(styleSource, /\.readable-document-figure\s*\{/);
  assert.match(styleSource, /\.readable-structured-page\s*\{/);
  assert.match(styleSource, /\.readable-structured-columns\s*\{/);
  assert.match(styleSource, /\.readable-document-table\s*\{/);
  assert.match(serverSource, /pageFigureMatch/);
  assert.match(serverSource, /createPdfStructuredPages/);
  assert.match(serverSource, /createPdfFigureRegions/);
  assert.match(serverSource, /pageFigureRegionMatch/);
  assert.match(serverSource, /pageTableMatch/);
  assert.match(serverSource, /renderPdfTableRegion/);
  assert.match(serverSource, /renderPdfEmbeddedFigure/);
  assert.match(serverSource, /listPdfEmbeddedFigures/);
  assert.match(extractorSource, /extractPdfReadingStructure/);
  assert.match(extractorSource, /extractPdfOutline/);
  assert.match(serverSource, /document\.pdfOutline = readingAssets\.outline/);
  assert.match(extractorSource, /detectPdfTableRegions/);
  assert.match(extractorSource, /detectPdfPageLayoutComplexity/);
  assert.match(extractorSource, /createPdfStructuredTextColumns/);
  assert.match(pageSource, /id="document-chapter-navigation"/);
  assert.match(pageSource, /id="document-chapter-footer"/);
  assert.match(applicationSource, /await yieldDocumentRendering\(\)/);
  assert.match(styleSource, /\.document-chapter-navigation,/);
  assert.match(styleSource, /\.document-chapter-toc-button\.is-active/);
});

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
    /** katexModuleResponse 验证浏览器能以模块 MIME 加载本地公式渲染器。 */
    const katexModuleResponse = await fetch(
      `${integrationBaseUrl}/vendor/katex/contrib/auto-render.mjs`,
    );
    assert.equal(katexModuleResponse.status, 200);
    assert.match(katexModuleResponse.headers.get("content-type") || "", /^text\/javascript/);
    /** katexFontResponse 验证公式字体无需联网即可由本机服务提供。 */
    const katexFontResponse = await fetch(
      `${integrationBaseUrl}/vendor/katex/fonts/KaTeX_Main-Regular.woff2`,
    );
    assert.equal(katexFontResponse.status, 200);
    assert.equal(katexFontResponse.headers.get("content-type"), "font/woff2");
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

    /** duplicateContentResponse 验证改名后的相同文件内容不会再次保存。 */
    const duplicateContentResponse = await fetch(`${integrationBaseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "text/markdown",
        "X-File-Name": encodeURIComponent("改名后的数据库笔记.md"),
      },
      body: sourceText,
    });
    assert.equal(duplicateContentResponse.status, 409);
    const duplicateContentPayload = await duplicateContentResponse.json();
    assert.equal(duplicateContentPayload.code, "DUPLICATE_DOCUMENT");
    assert.equal(duplicateContentPayload.duplicate.matchReason, "content");

    /** duplicateTitleResponse 验证原标题仅有空格和标点差异时也会被查重。 */
    const duplicateTitleResponse = await fetch(`${integrationBaseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "text/markdown",
        "X-File-Name": encodeURIComponent("PostgreSQL 事务基础！.md"),
      },
      body: "这是内容不同但原标题相同的候选文件。",
    });
    assert.equal(duplicateTitleResponse.status, 409);
    const duplicateTitlePayload = await duplicateTitleResponse.json();
    assert.equal(duplicateTitlePayload.duplicate.matchReason, "title");

    /** documentId 是上传后返回的文档 ID。 */
    const documentId = uploadPayload.document.id;
    assert.equal(uploadPayload.document.isFavorite, false);
    /** renameResponse 验证展示名称可修改且不改变原附件名称。 */
    const renameResponse = await fetch(`${integrationBaseUrl}/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "PostgreSQL 事务与 MVCC" }),
    });
    assert.equal(renameResponse.status, 200);
    const renamedDocument = (await renameResponse.json()).document;
    assert.equal(renamedDocument.title, "PostgreSQL 事务与 MVCC");
    assert.equal(renamedDocument.sourceTitle, "PostgreSQL事务基础");
    assert.equal(renamedDocument.originalName, "PostgreSQL事务基础.md");
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
    assert.equal(listPayload.documents[0].title, "PostgreSQL 事务与 MVCC");
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

    /** archiveFolderResponse 创建另一个一级目录，用于验证整棵文件夹移动。 */
    const archiveFolderResponse = await fetch(`${integrationBaseUrl}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: null, name: "临时归档" }),
    });
    assert.equal(archiveFolderResponse.status, 201);
    const archiveFolderPayload = await archiveFolderResponse.json();
    const archiveFolderId = archiveFolderPayload.folder.id;
    const moveFolderResponse = await fetch(
      `${integrationBaseUrl}/api/folders/${encodeURIComponent(childFolderId)}/move`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: archiveFolderId }),
      },
    );
    assert.equal(moveFolderResponse.status, 200);
    const moveFolderPayload = await moveFolderResponse.json();
    assert.equal(
      moveFolderPayload.folder.path.map((part) => part.name).join("/"),
      "临时归档/MVCC 专题",
    );
    /** grandchildResponse 和 invalidCycleResponse 验证不能移入自己的后代。 */
    const grandchildResponse = await fetch(`${integrationBaseUrl}/api/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: childFolderId, name: "后代目录" }),
    });
    const grandchildPayload = await grandchildResponse.json();
    const invalidCycleResponse = await fetch(
      `${integrationBaseUrl}/api/folders/${encodeURIComponent(childFolderId)}/move`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: grandchildPayload.folder.id }),
      },
    );
    assert.equal(invalidCycleResponse.status, 500);
    assert.match((await invalidCycleResponse.json()).message, /自己的子目录/);
    await fetch(
      `${integrationBaseUrl}/api/folders/${encodeURIComponent(grandchildPayload.folder.id)}`,
      { method: "DELETE" },
    );
    const restoreFolderResponse = await fetch(
      `${integrationBaseUrl}/api/folders/${encodeURIComponent(childFolderId)}/move`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: databaseFolder.id }),
      },
    );
    assert.equal(restoreFolderResponse.status, 200);
    await fetch(
      `${integrationBaseUrl}/api/folders/${encodeURIComponent(archiveFolderId)}`,
      { method: "DELETE" },
    );

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

    /** selectedFolderUploadResponse 验证单文件可直接保存到用户指定目录。 */
    const selectedFolderUploadResponse = await fetch(`${integrationBaseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-File-Name": encodeURIComponent("批量移动测试.txt"),
        "X-Target-Folder-Id": childFolderId,
      },
      body: "用于验证指定目录上传和原子批量移动。",
    });
    assert.equal(selectedFolderUploadResponse.status, 201);
    const selectedFolderUploadPayload = await selectedFolderUploadResponse.json();
    assert.equal(selectedFolderUploadPayload.document.folderId, childFolderId);

    /** batchMoveResponse 验证多项内容可一次原子移动到同一目录。 */
    const batchMoveResponse = await fetch(`${integrationBaseUrl}/api/folder-items/batch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId: databaseFolder.id,
        items: [
          { targetType: "document", targetId: documentId },
          { targetType: "document", targetId: selectedFolderUploadPayload.document.id },
        ],
      }),
    });
    assert.equal(batchMoveResponse.status, 200);
    const batchMovePayload = await batchMoveResponse.json();
    assert.equal(batchMovePayload.movedCount, 2);
    const batchMovedDocuments = (await (
      await fetch(`${integrationBaseUrl}/api/documents`)
    ).json()).documents;
    assert.equal(batchMovedDocuments.find((item) => item.id === documentId).folderId, databaseFolder.id);
    assert.equal(
      batchMovedDocuments.find((item) => item.id === selectedFolderUploadPayload.document.id).folderId,
      databaseFolder.id,
    );
    /** secondBatchDeleteUploadResponse 是批量删除事务中的第二份附件。 */
    const secondBatchDeleteUploadResponse = await fetch(`${integrationBaseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-File-Name": encodeURIComponent("批量删除测试.txt"),
        "X-Target-Folder-Id": databaseFolder.id,
      },
      body: "用于验证批量删除会清理全部所选内容和附件。",
    });
    assert.equal(secondBatchDeleteUploadResponse.status, 201);
    const secondBatchDeleteUploadPayload = await secondBatchDeleteUploadResponse.json();
    const firstBatchAttachmentPath = path.join(
      temporaryDirectory,
      "attachments",
      selectedFolderUploadPayload.document.storedName,
    );
    const secondBatchAttachmentPath = path.join(
      temporaryDirectory,
      "attachments",
      secondBatchDeleteUploadPayload.document.storedName,
    );
    assert.equal(fs.existsSync(firstBatchAttachmentPath), true);
    assert.equal(fs.existsSync(secondBatchAttachmentPath), true);

    /** rejectedBatchDelete 验证任意目标不存在时不会先删除其余有效内容。 */
    const rejectedBatchDelete = await fetch(`${integrationBaseUrl}/api/folder-items/batch`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { targetType: "document", targetId: selectedFolderUploadPayload.document.id },
          { targetType: "document", targetId: "missing-document" },
        ],
      }),
    });
    assert.equal(rejectedBatchDelete.status, 500);
    assert.equal(
      (await fetch(`${integrationBaseUrl}/api/documents/${encodeURIComponent(selectedFolderUploadPayload.document.id)}`)).status,
      200,
    );

    /** batchDeleteResponse 验证所选文档可在一个请求中永久删除。 */
    const batchDeleteResponse = await fetch(`${integrationBaseUrl}/api/folder-items/batch`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { targetType: "document", targetId: selectedFolderUploadPayload.document.id },
          { targetType: "document", targetId: secondBatchDeleteUploadPayload.document.id },
        ],
      }),
    });
    assert.equal(batchDeleteResponse.status, 200);
    const batchDeletePayload = await batchDeleteResponse.json();
    assert.equal(batchDeletePayload.deletedCount, 2);
    assert.equal(
      (await fetch(`${integrationBaseUrl}/api/documents/${encodeURIComponent(selectedFolderUploadPayload.document.id)}`)).status,
      404,
    );
    assert.equal(
      (await fetch(`${integrationBaseUrl}/api/documents/${encodeURIComponent(secondBatchDeleteUploadPayload.document.id)}`)).status,
      404,
    );
    assert.equal(fs.existsSync(firstBatchAttachmentPath), false);
    assert.equal(fs.existsSync(secondBatchAttachmentPath), false);

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

    /** readingSessionResponse 创建一次可幂等累计的活跃阅读会话。 */
    const readingSessionResponse = await fetch(`${integrationBaseUrl}/api/reading-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "document",
        targetId: documentId,
        progressPercent: 37.5,
      }),
    });
    assert.equal(readingSessionResponse.status, 201);
    const readingSessionPayload = await readingSessionResponse.json();
    const readingSessionId = readingSessionPayload.session.id;
    /** heartbeatResponse 保存累计时长与最新进度，重复提交不会重复累加。 */
    const heartbeatResponse = await fetch(
      `${integrationBaseUrl}/api/reading-sessions/${encodeURIComponent(readingSessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeSeconds: 95, progressPercent: 42, ended: true }),
      },
    );
    assert.equal(heartbeatResponse.status, 200);
    const repeatedHeartbeatResponse = await fetch(
      `${integrationBaseUrl}/api/reading-sessions/${encodeURIComponent(readingSessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeSeconds: 95, progressPercent: 42, ended: true }),
      },
    );
    assert.equal(repeatedHeartbeatResponse.status, 200);

    /** dashboardResponse 汇总阅读时长、进度与最近入库内容。 */
    const dashboardResponse = await fetch(`${integrationBaseUrl}/api/activity-dashboard?days=30`);
    assert.equal(dashboardResponse.status, 200);
    const dashboardPayload = await dashboardResponse.json();
    assert.equal(dashboardPayload.dashboard.summary.totalReadingSeconds, 95);
    assert.equal(dashboardPayload.dashboard.summary.readItemCount, 1);
    assert.ok(dashboardPayload.dashboard.summary.newItemCount >= 1);
    assert.equal(dashboardPayload.dashboard.libraryComposition.documentCount, 1);
    assert.equal(dashboardPayload.dashboard.libraryComposition.articleCount, 0);
    assert.equal(dashboardPayload.dashboard.libraryComposition.paperCount, 0);
    assert.equal(dashboardPayload.dashboard.githubStatistics.projectCount, 0);
    assert.ok(
      dashboardPayload.dashboard.libraryComposition.folders.some(
        (folder) => folder.name === "程序" && folder.level === 1 && folder.documentCount === 1,
      ),
    );
    assert.equal(dashboardPayload.dashboard.recentReading[0].targetId, documentId);
    assert.ok(
      dashboardPayload.dashboard.recentImports.some((item) => item.targetId === documentId),
    );
    assert.equal(dashboardPayload.dashboard.readingTrend.length, 30);

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

    /** folderUploadResponse 模拟浏览器选择整个本地文件夹后的相对路径上传。 */
    const folderUploadResponse = await fetch(`${integrationBaseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-File-Name": encodeURIComponent("设备说明.txt"),
        "X-Relative-Path": encodeURIComponent("批量资料/设备/设备说明.txt"),
        "X-Target-Folder-Id": databaseFolder.id,
      },
      body: "设备启动前应检查联锁状态。",
    });
    assert.equal(folderUploadResponse.status, 201);
    /** folderUploadPayload 用于确认文档最终归入相对路径末级文件夹。 */
    const folderUploadPayload = await folderUploadResponse.json();
    /** foldersResponse 返回数据库已创建的根目录和子目录。 */
    const importedFolderTreeResponse = await fetch(`${integrationBaseUrl}/api/folders`);
    const importedFolderTreePayload = await importedFolderTreeResponse.json();
    /** importedFolder 是与浏览器相对路径一致的知识库末级目录。 */
    const importedFolder = importedFolderTreePayload.folders.find(
      (folder) => folder.path.map((part) => part.name).join("/") === "数据库/批量资料/设备",
    );
    assert.ok(importedFolder);
    assert.equal(folderUploadPayload.document.folderId, importedFolder.id);

    /** invalidFolderUploadResponse 验证目录穿越片段会在保存前被拒绝。 */
    const invalidFolderUploadResponse = await fetch(`${integrationBaseUrl}/api/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-File-Name": encodeURIComponent("危险.txt"),
        "X-Relative-Path": encodeURIComponent("批量资料/../危险.txt"),
      },
      body: "不应保存",
    });
    assert.equal(invalidFolderUploadResponse.status, 400);

    /** folderDocumentDeleteResponse 清理本测试创建的文件夹导入文档。 */
    const folderDocumentDeleteResponse = await fetch(
      `${integrationBaseUrl}/api/documents/${encodeURIComponent(folderUploadPayload.document.id)}`,
      { method: "DELETE" },
    );
    assert.equal(folderDocumentDeleteResponse.status, 200);
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
