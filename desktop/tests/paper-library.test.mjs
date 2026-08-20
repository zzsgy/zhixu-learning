/**
 * 每周论文候选、提醒状态和正式论文库测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("论文列表使用轻量状态字段启用中文阅读", () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** applicationScript 是论文卡片状态判断所在的浏览器脚本。 */
  const applicationScript = fs.readFileSync(
    path.join(projectDirectory, "public", "app.js"),
    "utf8",
  );
  assert.match(applicationScript, /Number\(paper\.sourceTextWordCount\) > 0/);
  assert.match(applicationScript, /paper\.fullTranslationStatus === "ready"/);
  assert.doesNotMatch(
    applicationScript,
    /readerButton\.disabled = Boolean\(paper\.pdfUrl && !paper\.sourceText/,
  );
});

/**
 * 验证 ISO 周计算和“每周只选一篇”的完整本地数据流程。
 */
test("每周候选经用户确认后进入论文库", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内允许测试写入的数据目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是本测试独占的 SQLite 数据目录。 */
  const temporaryDirectory = fs.mkdtempSync(
    path.join(testDataRoot, "zhixu-paper-"),
  );
  process.env.ZHIXU_DATA_DIR = temporaryDirectory;
  /** databaseModule 是在设置隔离目录后加载的数据库模块。 */
  const databaseModule = await import("../lib/database.mjs");
  /** paperServiceModule 提供 ISO 周标识计算。 */
  const paperServiceModule = await import("../lib/paper-service.mjs");
  try {
    /** weekKey 是固定日期对应的 ISO 自然周。 */
    const weekKey = paperServiceModule.getIsoWeekKey(
      new Date("2026-07-24T08:00:00+08:00"),
    );
    assert.equal(weekKey, "2026-W30");
    /** candidates 是三个不同领域的模拟候选论文。 */
    const candidates = [
      {
        id: "candidate_ai",
        externalId: "https://arxiv.org/abs/2607.00001",
        title: "Agent Systems",
        abstract: "An agent systems paper.",
        authors: ["Author A"],
        category: "AI",
        publishedAt: "2026-07-20T00:00:00Z",
        sourceUrl: "https://arxiv.org/abs/2607.00001",
        pdfUrl: "https://arxiv.org/pdf/2607.00001",
      },
      {
        id: "candidate_bio",
        externalId: "https://arxiv.org/abs/2607.00002",
        title: "Bioprocess Control",
        abstract: "A bioprocess control paper.",
        authors: ["Author B"],
        category: "生物工程",
        publishedAt: "2026-07-21T00:00:00Z",
        sourceUrl: "https://arxiv.org/abs/2607.00002",
        pdfUrl: null,
      },
      {
        id: "candidate_db",
        externalId: "https://arxiv.org/abs/2607.00003",
        title: "Database Indexing",
        abstract: "A database indexing paper.",
        authors: ["Author C"],
        category: "数据库",
        publishedAt: "2026-07-22T00:00:00Z",
        sourceUrl: "https://arxiv.org/abs/2607.00003",
        pdfUrl: null,
      },
    ];
    databaseModule.savePaperCandidates(weekKey, candidates);
    assert.equal(databaseModule.listPaperCandidates(weekKey).length, 3);
    assert.equal(databaseModule.listPendingPaperTranslations().length, 3);
    databaseModule.updatePaperCandidateTranslation("candidate_bio", {
      titleZh: "生物过程控制",
      abstractZh: "一篇由 Codex 翻译的生物过程控制论文摘要。",
    });
    assert.equal(databaseModule.listPendingPaperTranslations().length, 2);
    /** selectedPaper 是用户第一次确认后进入论文库的论文。 */
    const selectedPaper =
      databaseModule.selectPaperCandidate("candidate_bio");
    assert.equal(selectedPaper.title, "Bioprocess Control");
    assert.equal(selectedPaper.titleZh, "生物过程控制");
    assert.equal(selectedPaper.translationSource, "codex");
    assert.equal(selectedPaper.sourceType, "weekly");
    databaseModule.updatePaperSourceText(selectedPaper.id, {
      sourceText: "A complete English paper body for local translation.",
      wordCount: 8,
    });
    assert.equal(databaseModule.listPendingFullPaperTranslations().length, 1);
    /** claimedPaper 模拟后台工作器原子领取最早的待翻译论文。 */
    const claimedPaper = databaseModule.claimNextPendingFullPaperTranslation();
    assert.equal(claimedPaper.id, selectedPaper.id);
    assert.equal(claimedPaper.fullTranslationStatus, "processing");
    assert.equal(databaseModule.claimNextPendingFullPaperTranslation(), null);
    /** failedPaper 验证失败原因可保存且用户能够重新排队。 */
    const failedPaper = databaseModule.markPaperFullTranslationFailed(
      selectedPaper.id,
      "模拟 Codex 失败",
    );
    assert.equal(failedPaper.fullTranslationStatus, "failed");
    assert.equal(failedPaper.fullTranslationError, "模拟 Codex 失败");
    const retriedPaper = databaseModule.retryPaperFullTranslation(selectedPaper.id);
    assert.equal(retriedPaper.fullTranslationStatus, "pending");
    assert.equal(
      databaseModule.claimNextPendingFullPaperTranslation().fullTranslationStatus,
      "processing",
    );
    /** translatedHtml 是超过最低完整性要求的模拟 Codex 全文。 */
    const translatedHtml = `<h2>方法</h2><p>${"生物过程全文翻译。".repeat(80)}</p>`;
    const translatedPaper = databaseModule.updatePaperFullTranslation(
      selectedPaper.id,
      translatedHtml,
    );
    assert.equal(translatedPaper.fullTranslationStatus, "ready");
    assert.equal(translatedPaper.fullTranslationSource, "codex");
    assert.equal(databaseModule.listPendingFullPaperTranslations().length, 0);
    assert.equal(databaseModule.listPapers().length, 1);
    /** repeatedSelection 是同一周再次选择时返回的原论文。 */
    const repeatedSelection =
      databaseModule.selectPaperCandidate("candidate_ai");
    assert.equal(repeatedSelection.id, selectedPaper.id);
    assert.equal(databaseModule.listPapers().length, 1);
    assert.equal(
      databaseModule.getPaperWeekStatus(weekKey).status,
      "selected",
    );

    /** curatedPaper 是模拟写入的李沐精读目录条目。 */
    const curatedPaper = databaseModule.upsertCuratedPaper({
      externalId: "https://arxiv.org/pdf/2107.03374.pdf",
      title: "OpenAI Codex 论文精读",
      titleZh: "OpenAI Codex 论文精读",
      abstractZh: "李沐中文精读。",
      category: "AI",
      sourceUrl: "https://arxiv.org/abs/2107.03374",
      pdfUrl: "https://arxiv.org/pdf/2107.03374.pdf",
      curatorNote: "先看中文视频，再核对英文论文。",
      videoUrl: "https://www.bilibili.com/video/example",
      duration: "47:58",
    });
    assert.equal(curatedPaper.sourceType, "mli");
    assert.equal(curatedPaper.sourceLabel, "李沐精读");
    assert.equal(databaseModule.listPapers("mli").length, 1);
    assert.equal(databaseModule.listPapers("weekly").length, 1);
    /** deletedPaper 是永久删除后的论文摘要。 */
    const deletedPaper = databaseModule.deleteKnowledgeTarget("paper", selectedPaper.id);
    assert.equal(deletedPaper.targetId, selectedPaper.id);
    assert.equal(databaseModule.listPapers("weekly").length, 0);
    assert.equal(databaseModule.getPaperWeekStatus(weekKey).status, "pending");
    /** restoredCandidate 是删除论文后重新回到待选择状态的原候选。 */
    const restoredCandidate = databaseModule
      .listPaperCandidates(weekKey)
      .find((candidate) => candidate.id === "candidate_bio");
    assert.equal(restoredCandidate.status, "pending");

    /** dailyCandidates 是经典路线第一天唯一生成的一篇论文。 */
    const dailyCandidates = await paperServiceModule.ensureDailyClassicPaperCandidate(
      new Date("2026-08-18T08:00:00+08:00"),
    );
    assert.equal(dailyCandidates.length, 1);
    assert.equal(dailyCandidates[0].title, "A Neural Probabilistic Language Model");
    assert.equal(dailyCandidates[0].translationSource, "codex");
    /** dailyPaper 是用户确认后以“每日经典”来源进入论文库的记录。 */
    const dailyPaper = databaseModule.selectPaperCandidate(dailyCandidates[0].id);
    assert.equal(dailyPaper.sourceType, "classic");
    assert.equal(dailyPaper.sourceLabel, "每日经典");

    /** importedPaper 是用户手动导入中文论文网页的模拟记录。 */
    const importedPaper = databaseModule.upsertImportedPaper({
      externalId: "manual-url:https://example.com/paper",
      title: "生物反应器放大研究",
      abstract: "讨论氧传递和混合时间。",
      category: "生物工程",
      sourceUrl: "https://example.com/paper",
      sourceText: "生物反应器放大需要同时考虑氧传递、混合时间和剪切。".repeat(80),
      sourceLanguage: "zh",
    });
    assert.equal(importedPaper.sourceType, "manual");
    assert.equal(importedPaper.fullTranslationStatus, "not_required");
    assert.equal(databaseModule.listPendingFullPaperTranslations().length, 0);

    /** clearedResult 是带关联状态清理的论文库重置结果。 */
    const clearedResult = databaseModule.clearPaperLibrary();
    assert.equal(clearedResult.deletedCount, 3);
    assert.equal(databaseModule.listPapers().length, 0);
    assert.equal(databaseModule.listPaperCandidates(weekKey).length, 0);
  } finally {
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
