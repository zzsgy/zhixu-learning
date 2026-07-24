/**
 * 每周论文候选、提醒状态和正式论文库测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

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
  } finally {
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
