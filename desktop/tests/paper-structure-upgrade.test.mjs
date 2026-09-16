/** 已完成论文的旧结构清单升级测试。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("旧版重复上标误报可原地重检且不改正文和时间", async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "paper-structure-upgrade-"));
  process.env.ZHIXU_DATA_DIR = dataDirectory;
  const database = await import("../lib/database.mjs");
  try {
    const paper = database.upsertImportedPaper({
      externalId: "https://example.test/duplicate-script-paper",
      title: "Duplicate MathML fallback scripts",
      category: "AI",
      sourceUrl: "https://example.test/duplicate-script-paper",
    });
    const sourceHtml = [
      "<h2>Method</h2>",
      `<p>${"Complete source paragraph. ".repeat(40)}x<sup>1</sup><sup>1</sup></p>`,
      "<p>$E=mc^2$</p>",
    ].join("");
    database.updatePaperSourceText(paper.id, {
      sourceText: "Complete source paragraph. ".repeat(40),
      sourceHtml,
      sourceStructure: {
        imageCount: 0,
        tableCount: 0,
        headingCount: 1,
        formulaCount: 3,
        semanticSubscriptCount: 0,
        semanticSuperscriptCount: 2,
      },
      wordCount: 120,
    });
    const translatedHtml = [
      "<h2>方法</h2>",
      `<p>${"完整的中文译文段落。".repeat(80)}x<sup>1</sup></p>`,
      "<p>$E=mc^2$</p>",
    ].join("");
    database.updatePaperFullTranslation(paper.id, translatedHtml, {
      fidelity: "degraded",
      message: "结构未完整保留：公式结构 2/3，上标结构 1/2。",
      translation: {
        imageCount: 0,
        tableCount: 0,
        headingCount: 1,
        formulaCount: 2,
        semanticSubscriptCount: 0,
        semanticSuperscriptCount: 1,
      },
    });
    const manualPaper = database.upsertImportedPaper({
      externalId: "https://example.test/manually-verified-paper",
      title: "Manually verified paper",
      category: "AI",
      sourceUrl: "https://example.test/manually-verified-paper",
    });
    database.updatePaperSourceText(manualPaper.id, {
      sourceText: "Complete source paragraph. ".repeat(40),
      sourceHtml,
      sourceStructure: { formulaCount: 3, semanticSuperscriptCount: 2 },
      wordCount: 120,
    });
    database.updatePaperFullTranslation(manualPaper.id, translatedHtml, {
      fidelity: "complete",
      message: "已经逐页人工核验，不允许自动任务覆盖。",
      translation: { formulaCount: 2, semanticSuperscriptCount: 1 },
      validationSource: "manual",
    });
    const manualBefore = database.getPaperById(manualPaper.id);
    const before = database.getPaperById(paper.id);
    assert.equal(database.revalidateReadyPaperTranslationStructures().checkedCount, 0);
    const result = database.revalidateReadyPaperTranslationStructures([paper.id, manualPaper.id]);
    const after = database.getPaperById(paper.id);
    const manualAfter = database.getPaperById(manualPaper.id);

    assert.equal(result.checkedCount, 1);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.completeCount, 1);
    assert.equal(after.fullTranslationFidelity, "complete");
    assert.equal(after.sourceStructure.structureMetricVersion, 3);
    assert.equal(after.sourceStructure.formulaCount, 1);
    assert.equal(after.sourceStructure.semanticSuperscriptCount, 1);
    assert.equal(after.fullTranslationStructure.formulaCount, 1);
    assert.equal(after.fullTranslationStructure.semanticSuperscriptCount, 1);
    assert.equal(after.sourceHtml, sourceHtml);
    assert.equal(after.fullTranslationHtml, translatedHtml);
    assert.equal(after.fullTranslatedAt, before.fullTranslatedAt);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.fullTranslationValidationSource, "auto");
    assert.equal(manualAfter.fullTranslationValidationSource, "manual");
    assert.equal(manualAfter.fullTranslationFidelity, "complete");
    assert.equal(manualAfter.fullTranslationFidelityMessage, manualBefore.fullTranslationFidelityMessage);
    assert.deepEqual(manualAfter.sourceStructure, manualBefore.sourceStructure);
    assert.deepEqual(manualAfter.fullTranslationStructure, manualBefore.fullTranslationStructure);
    assert.equal(database.revalidateReadyPaperTranslationStructures([paper.id]).checkedCount, 0);
  } finally {
    database.closeDatabase();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
