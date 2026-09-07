/** 论文图文结构清单与完成门禁测试。 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePaperHtmlStructure,
  validatePaperTranslationStructure,
} from "../lib/paper-structure.mjs";

test("论文结构清单区分引用上标和公式上下标", () => {
  const structure = analyzePaperHtmlStructure(`
    <h2>Results</h2>
    <p>Accuracy x<sub>95</sub><sup>2</sup><sup><a href="#r1">1</a></sup>.</p>
    <figure><img src="https://example.test/f1.png"><figcaption>Fig. 1. Result.</figcaption></figure>
    <table><tr><td>1</td></tr></table>
  `);
  assert.equal(structure.imageCount, 1);
  assert.equal(structure.tableCount, 1);
  assert.equal(structure.formulaCount, 2);
  assert.equal(structure.declaredFigureCount, 1);
});

test("缺图或缺公式时不能标记为完整译文", () => {
  const validation = validatePaperTranslationStructure(
    { imageCount: 1, declaredFigureCount: 1, tableCount: 0, formulaCount: 1, headingCount: 1 },
    "<h2>结果</h2><p>只有文字。</p>",
  );
  assert.equal(validation.fidelity, "degraded");
  assert.match(validation.message, /图片|图形/);
  assert.match(validation.message, /公式/);
});

test("引用上标增多不能掩盖原文下标结构丢失", () => {
  const validation = validatePaperTranslationStructure(
    {
      imageCount: 0,
      declaredFigureCount: 0,
      tableCount: 0,
      formulaCount: 1,
      semanticSubscriptCount: 1,
      semanticSuperscriptCount: 0,
      headingCount: 1,
    },
    "<h2>结果</h2><p>引用<sup>1</sup><sup>2</sup>很多，但下标已经丢失。</p>",
  );
  assert.equal(validation.fidelity, "degraded");
  assert.match(validation.message, /下标结构 0\/1/);
});

test("复合子图编号多于实际图片时不会误报正文图形缺失", () => {
  const translatedHtml = [
    "<h2>结果</h2>",
    '<figure><img src="f1.png"><figcaption>图 1。</figcaption></figure>',
    '<figure><img src="f2.png"><figcaption>图 2。</figcaption></figure>',
    '<figure><img src="f3.png"><figcaption>图 3。</figcaption></figure>',
  ].join("");
  const validation = validatePaperTranslationStructure(
    {
      imageCount: 3,
      declaredFigureCount: 9,
      tableCount: 0,
      formulaCount: 0,
      headingCount: 1,
      structureFidelity: "complete",
    },
    translatedHtml,
  );
  assert.equal(validation.fidelity, "complete");
  assert.doesNotMatch(validation.message, /正文图形/);
});

test("只有 PDF 文字层时不能因为结构计数均为零而误报完整", () => {
  const validation = validatePaperTranslationStructure(
    {
      imageCount: 0,
      declaredFigureCount: 0,
      tableCount: 0,
      formulaCount: 0,
      headingCount: 0,
      structureFidelity: "degraded",
      structureMessage: "PDF 文字层未提供可验证的图片与公式结构。",
    },
    "<h2>中文正文</h2><p>可以阅读的翻译。</p>",
  );
  assert.equal(validation.fidelity, "degraded");
  assert.match(validation.message, /PDF 文字层/);
});
