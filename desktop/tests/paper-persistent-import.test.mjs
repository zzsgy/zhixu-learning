import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function waitForJob(db, id, status) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = db.getImportJob(id);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`导入任务 ${id} 未进入 ${status}`);
}

test("论文导入持久化、规范身份和历史数据保留", async (t) => {
  const project = path.resolve(import.meta.dirname, "..");
  const testRoot = path.join(project, ".test-data");
  fs.mkdirSync(testRoot, { recursive: true });
  const dataDirectory = fs.mkdtempSync(path.join(testRoot, "paper-persistent-"));
  process.env.ZHIXU_DATA_DIR = dataDirectory;
  process.env.ZHIXU_ENV_FILE = path.join(dataDirectory, "absent.env");
  process.env.ZHIXU_DISABLE_CODEX_WORKER = "1";
  const db = await import("../lib/database.mjs");
  const { createImportJobRunner } = await import("../lib/import-job-runner.mjs");
  try {
    await t.test("联网前同步保存占位记录和 target 任务；arXiv URL 变体复用同一 paper/job", () => {
      const queued = db.enqueuePaperImport({ inputUrl: "http://arxiv.org/abs/9912.00001v1" });
      assert.equal(queued.paper.sourceText, "");
      assert.match(queued.paper.title, /9912\.00001.*等待识别/);
      assert.equal(queued.importJob.status, "queued");
      assert.equal(queued.importJob.targetType, "paper");
      assert.equal(queued.importJob.targetId, queued.paper.id);
      assert.equal(queued.importJob.payload.paperId, queued.paper.id);
      assert.equal(queued.importJob.payload.requestedVersion, "v1");
      assert.equal(queued.processing, true);
      for (const inputUrl of ["https://arxiv.org/abs/9912.00001", "https://arxiv.org/pdf/9912.00001v2.pdf?download=1", "https://arxiv.org/html/9912.00001v3#section"]) {
        const repeated = db.enqueuePaperImport({ inputUrl });
        assert.equal(repeated.paper.id, queued.paper.id);
        assert.equal(repeated.importJob.id, queued.importJob.id);
        assert.equal(repeated.importJob.payload.requestedVersion, "v1");
      }
      assert.equal(db.listImportJobs({ jobType: "paper_import", limit: 200 }).length, 1);
      const claimed = db.claimNextImportJob(["paper_import"]);
      assert.equal(claimed.id, queued.importJob.id);
      const runningDuplicate = db.enqueuePaperImport({ inputUrl: "https://arxiv.org/abs/9912.00001" });
      assert.equal(runningDuplicate.importJob.id, claimed.id);
      assert.equal(runningDuplicate.importJob.status, "running");
      db.failImportJob(claimed.id, new Error("模拟元数据失败"));
      db.markPaperExtractionFailed(queued.paper.id, "模拟元数据失败");
      const retried = db.enqueuePaperImport({ paperId: queued.paper.id });
      assert.equal(retried.importJob.id, claimed.id);
      assert.equal(retried.importJob.status, "queued");
      assert.equal(retried.importJob.attemptCount, 1);
      assert.equal(retried.paper.extractionError, null);
      assert.equal(retried.paper.fullTranslationStatus, "pending");
      const nextClaim = db.claimNextImportJob(["paper_import"]);
      assert.equal(nextClaim.attemptCount, 2);
      db.updatePaperSourceText(queued.paper.id, { sourceText: "Synthetic recovered full text.", wordCount: 4, sourceLanguage: "en" });
      db.completeImportJob(nextClaim.id, { targetType: "paper", targetId: queued.paper.id });
      const status = db.getPaperImportStatuses().find((item) => item.target_id === queued.paper.id);
      assert.equal(status.status, "completed");
      assert.equal(status.attempt_count, 2);
    });

    await t.test("已 claim 的论文任务由新 runner 启动恢复，paperId 不改变", async () => {
      const queued = db.enqueuePaperImport({ inputUrl: "https://example.test/restart.pdf" });
      assert.equal(db.claimNextImportJob(["paper_import"]).id, queued.importJob.id);
      const seen = [];
      const runner = createImportJobRunner({ handlers: { paper_import: async (job, context) => {
        seen.push(job.payload.paperId);
        context.updateProgress({ stage: "extracting", progressPercent: 60 });
        db.updatePaperSourceText(job.payload.paperId, { sourceText: "Recovered source.", wordCount: 2, sourceLanguage: "en" });
        return { targetType: "paper", targetId: job.payload.paperId, title: "Recovered" };
      } } });
      runner.start();
      const completed = await waitForJob(db, queued.importJob.id, "completed");
      assert.deepEqual(seen, [queued.paper.id]);
      assert.equal(completed.attemptCount, 2);
      assert.equal(completed.targetId, queued.paper.id);
      assert.equal(db.getPaperById(queued.paper.id).sourceText, "Recovered source.");
      assert.equal(runner.getStatus().status, "idle");
    });

    await t.test("只恢复没有任务的旧待提取记录，连续启动不重复入队", () => {
      const old = db.upsertImportedPaper({ externalId: "manual-url:https://example.test/orphan.pdf", title: "旧待提取论文", sourceUrl: "https://example.test/orphan.pdf", pdfUrl: "https://example.test/orphan.pdf" });
      assert.equal(db.recoverPendingPaperImports(), 1);
      assert.equal(db.recoverPendingPaperImports(), 0);
      const jobs = db.listImportJobs({ jobType: "paper_import", limit: 200 }).filter((job) => job.targetId === old.id);
      assert.equal(jobs.length, 1);
      db.updatePaperSourceText(old.id, { sourceText: "Recovered old source.", wordCount: 3, sourceLanguage: "en" });
      db.completeImportJob(jobs[0].id, { targetType: "paper", targetId: old.id });
    });

    await t.test("manual/curated/candidate 同身份复用并保留正文译文笔记和批注", () => {
      const sourceText = "Original body with a preserved quote. ".repeat(50);
      const sourceHtml = `<h2>Original</h2><p>${sourceText}</p>`;
      const translatedHtml = `<h2>已保存译文</h2><p>${"这是已有的完整译文与阅读内容。".repeat(60)}</p>`;
      const original = db.upsertImportedPaper({ externalId: "http://arxiv.org/abs/9912.00002v1", title: "Original title", abstract: "Original abstract", category: "AI", sourceUrl: "http://arxiv.org/abs/9912.00002v1", pdfUrl: "https://arxiv.org/pdf/9912.00002v1", sourceText, sourceHtml, sourceLanguage: "en", curatorNote: "保留个人整理说明" });
      db.updatePaperFullTranslation(original.id, translatedHtml, { fidelity: "complete", translation: {}, message: "fixture" });
      db.updateReadingState("paper", original.id, { status: "reading", progressPercent: 37, noteText: "保留个人阅读笔记" });
      const annotation = db.createReadingAnnotation("paper", original.id, { quoteText: "Original body", anchorStart: 0, anchorEnd: 13, noteText: "保留高亮批注", color: "yellow" });
      const imported = db.enqueuePaperImport({ inputUrl: "https://arxiv.org/html/9912.00002v2" });
      assert.equal(imported.paper.id, original.id);
      assert.equal(imported.duplicate, true);
      assert.equal(imported.importJob, null);
      assert.equal(imported.processing, false);
      const curated = db.upsertCuratedPaper({ externalId: "https://arxiv.org/abs/9912.00002", title: "Curated title", sourceUrl: "https://arxiv.org/abs/9912.00002", pdfUrl: "https://arxiv.org/pdf/9912.00002", videoUrl: "https://example.test/video" });
      assert.equal(curated.id, original.id);
      const candidate = { id: "candidate_identity_test", externalId: "https://arxiv.org/abs/9912.00002v3", title: "Candidate title", abstract: "Candidate abstract", authors: ["Synthetic Author"], category: "AI", publishedAt: "2026-09-12", sourceUrl: "https://arxiv.org/abs/9912.00002v3", pdfUrl: "https://arxiv.org/pdf/9912.00002v3" };
      db.savePaperCandidates("daily:2099-12-02", [candidate]);
      assert.equal(db.selectPaperCandidate(candidate.id).id, original.id);
      const final = db.getPaperById(original.id);
      assert.equal(final.sourceText, sourceText.trim());
      assert.equal(final.sourceHtml, sourceHtml);
      assert.equal(final.fullTranslationHtml, translatedHtml);
      assert.equal(final.fullTranslationStatus, "ready");
      assert.equal(final.title, "Original title");
      assert.equal(final.curatorNote, "保留个人整理说明");
      const workspace = db.getReadingWorkspace("paper", original.id);
      assert.equal(workspace.state.progressPercent, 37);
      assert.equal(workspace.state.noteText, "保留个人阅读笔记");
      assert.equal(workspace.annotations[0].id, annotation.id);
      assert.equal(workspace.annotations[0].noteText, "保留高亮批注");
      assert.equal(db.listPapers().filter((paper) => paper.identityKey === "arxiv:9912.00002").length, 1);
    });

    await t.test("handler 元数据失败明确落库，同任务重试成功并保留请求版本", async () => {
      const { createPaperImportHandler } = await import("../lib/paper-import-service.mjs");
      const queued = db.enqueuePaperImport({ inputUrl: "https://arxiv.org/pdf/9912.00004v2.pdf" });
      let failMetadata = true;
      let metadataCalls = 0;
      let translationTriggers = 0;
      const handler = createPaperImportHandler({
        fetchArxivPaperByUrl: async () => {
          metadataCalls++;
          if (failMetadata) throw new Error("模拟 arXiv 网络超时");
          return { id: "candidate_should_not_replace_paper", title: "Recovered metadata title", abstract: "Synthetic abstract", authors: ["Synthetic Author"], sourceUrl: "http://arxiv.org/abs/9912.00004v9", pdfUrl: "http://arxiv.org/pdf/9912.00004v9" };
        },
        parseAndClassifyArticle: async () => { throw new Error("arXiv 不应使用网页分支"); },
        preparePaperFullText: async (paperId) => {
          assert.equal(paperId, queued.paper.id);
          const paper = db.getPaperById(paperId);
          assert.equal(paper.sourceUrl, "https://arxiv.org/abs/9912.00004v2");
          assert.equal(paper.pdfUrl, "https://arxiv.org/pdf/9912.00004v2");
          return db.updatePaperSourceText(paperId, { sourceText: "Recovered synthetic full text.", sourceHtml: "<p>Recovered synthetic full text.</p>", wordCount: 4, sourceLanguage: "en" });
        },
        classifyDocument: async () => ({ category: "AI" }),
        triggerCodexPaperTranslationWorker: () => { translationTriggers++; },
      });
      assert.equal(metadataCalls, 0);
      const runner = createImportJobRunner({ handlers: { paper_import: handler } });
      runner.start();
      const failed = await waitForJob(db, queued.importJob.id, "failed");
      assert.match(failed.errorMessage, /模拟 arXiv 网络超时/);
      assert.match(db.getPaperById(queued.paper.id).extractionError, /模拟 arXiv 网络超时/);
      assert.equal(translationTriggers, 0);
      failMetadata = false;
      const retried = db.enqueuePaperImport({ paperId: queued.paper.id, inputUrl: "https://arxiv.org/abs/9912.00004v2" });
      assert.equal(retried.importJob.id, queued.importJob.id);
      runner.trigger();
      const completed = await waitForJob(db, queued.importJob.id, "completed");
      assert.equal(completed.targetId, queued.paper.id);
      assert.equal(completed.attemptCount, 2);
      assert.equal(db.getPaperById(queued.paper.id).title, "Recovered metadata title");
      assert.equal(db.getPaperById(queued.paper.id).extractionError, null);
      assert.equal(metadataCalls, 2);
      assert.equal(translationTriggers, 1);
    });

    await t.test("handler 普通论文网页成功保留图片表格和上下标，摘要失败不入翻译", async () => {
      const { createPaperImportHandler } = await import("../lib/paper-import-service.mjs");
      const section = "This is detailed evidence and a reproducible experimental method from a synthetic research paper. ".repeat(15);
      const html = `<h2>Introduction</h2><p>${section}</p><h2>Methods</h2><p>${section} x<sub>95</sub>.</p><figure><img src="https://example.test/figure.svg" alt="Figure 1"><figcaption>Figure 1.</figcaption></figure><table><tr><td colspan="2">Measured results</td></tr></table>`;
      let translationTriggers = 0;
      const handler = createPaperImportHandler({
        fetchArxivPaperByUrl: async () => { throw new Error("普通网页不应请求 arXiv"); },
        preparePaperFullText: async () => { throw new Error("普通网页不应请求 PDF"); },
        parseAndClassifyArticle: async (url) => ({ title: "Publisher full text", url, summary: "Publisher summary", author: "Synthetic Author", contentHtml: url.endsWith("/abstract") ? `<h2>Abstract</h2><p>${section.repeat(4)}</p>` : html }),
        classifyDocument: async () => ({ category: "AI" }),
        triggerCodexPaperTranslationWorker: () => { translationTriggers++; },
      });
      const queued = db.enqueuePaperImport({ inputUrl: "https://publisher.example.test/article" });
      const runner = createImportJobRunner({ handlers: { paper_import: handler } });
      runner.start();
      await waitForJob(db, queued.importJob.id, "completed");
      const paper = db.getPaperById(queued.paper.id);
      assert.equal(paper.sourceStructure.contentScope, "fulltext");
      assert.equal(paper.sourceStructure.imageCount, 1);
      assert.equal(paper.sourceStructure.tableCount, 1);
      assert.match(paper.sourceHtml, /<sub>95<\/sub>/);
      assert.match(paper.sourceHtml, /colspan="2"/);
      assert.equal(translationTriggers, 1);
      const abstract = db.enqueuePaperImport({ inputUrl: "https://publisher.example.test/abstract" });
      runner.trigger();
      const failed = await waitForJob(db, abstract.importJob.id, "failed");
      assert.match(failed.errorMessage, /摘要/);
      assert.equal(db.getPaperById(abstract.paper.id).sourceText, "");
      assert.equal(translationTriggers, 1);
    });

    await t.test("DOI 跳转到出版商后元数据仍保留稳定身份", () => {
      const queued = db.enqueuePaperImport({ inputUrl: "https://doi.org/10.1234/Persistent.Example.v2" });
      assert.equal(queued.paper.identityKey, "doi:10.1234/persistent.example.v2");
      const updated = db.updatePaperImportMetadata(queued.paper.id, { title: "Publisher metadata", sourceUrl: "https://publisher.example.test/doi-fulltext" });
      assert.equal(updated.identityKey, "doi:10.1234/persistent.example.v2");
      db.updatePaperSourceText(queued.paper.id, { sourceText: "Existing DOI paper content.", wordCount: 4, sourceLanguage: "en" });
      db.completeImportJob(queued.importJob.id, { targetType: "paper", targetId: queued.paper.id });
      const duplicate = db.enqueuePaperImport({ inputUrl: "https://doi.org/10.1234/persistent.example.v2" });
      assert.equal(duplicate.paper.id, queued.paper.id);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.importJob, null);
    });

    await t.test("旧 http/https 重复经新进程迁移只补身份，不删除任何正文笔记", () => {
      const legacyDirectory = path.join(dataDirectory, "legacy");
      const moduleUrl = pathToFileURL(path.join(project, "lib/database.mjs")).href;
      const runLegacy = (source) => execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source], { encoding: "utf8", env: { ...process.env, ZHIXU_DATA_DIR: legacyDirectory, ZHIXU_ENV_FILE: path.join(legacyDirectory, "absent.env") }, windowsHide: true });
      runLegacy(`const db = await import(${JSON.stringify(moduleUrl)}); db.closeDatabase();`);
      const legacy = new DatabaseSync(path.join(legacyDirectory, "zhixu.db"));
      try {
        const insert = legacy.prepare("INSERT INTO papers(id, external_id, title, category, source_url, pdf_url, source_text, source_text_word_count, identity_key, created_at, updated_at) VALUES(?, ?, ?, 'AI', ?, ?, ?, ?, '', ?, ?)");
        const note = legacy.prepare("INSERT INTO reading_states(target_type, target_id, reading_status, progress_percent, note_text, updated_at) VALUES('paper', ?, 'reading', 25, ?, ?)");
        for (const [index, scheme] of [[1, "http"], [2, "https"]]) {
          const url = `${scheme}://arxiv.org/abs/9912.00003`;
          insert.run(`legacy_${index}`, url, `Legacy ${index}`, url, "https://arxiv.org/pdf/9912.00003", `Legacy body ${index}`, 3, "2026-01-01", "2026-01-01");
          note.run(`legacy_${index}`, `Legacy note ${index}`, "2026-01-01");
        }
      } finally { legacy.close(); }
      const result = JSON.parse(runLegacy(`const db = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify({ groups: db.listPaperIdentityDuplicates(), rows: ['legacy_1','legacy_2'].map(id=>({id, body:db.getPaperById(id).sourceText, note:db.getReadingWorkspace('paper',id).state.noteText})) })); db.closeDatabase();`).trim());
      assert.deepEqual(result.groups, [{ identityKey: "arxiv:9912.00003", count: 2, paperIds: ["legacy_1", "legacy_2"] }]);
      assert.deepEqual(result.rows, [{ id: "legacy_1", body: "Legacy body 1", note: "Legacy note 1" }, { id: "legacy_2", body: "Legacy body 2", note: "Legacy note 2" }]);
    });
  } finally {
    db.closeDatabase();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
