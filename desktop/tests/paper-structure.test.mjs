/** 论文图文结构清单与完成门禁测试。 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePaperHtmlStructure,
  normalizePaperTranslationHtml,
  restorePaperFiguresByCaption,
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
  assert.equal(structure.uniqueImageCount, 1);
  assert.equal(structure.tableCount, 1);
  assert.equal(structure.formulaCount, 2);
  assert.equal(structure.declaredFigureCount, 1);
  assert.equal(structure.figureCaptionCount, 1);
  assert.equal(structure.imageFigureCount, 1);
  assert.equal(structure.tableFigureCount, 0);
  assert.equal(structure.emptyFigureCount, 0);
});

test("嵌套图形只统计各自直接拥有的资产并区分重复图片引用", () => {
  const structure = analyzePaperHtmlStructure(`
    <figure>
      <img src="https://example.test/shared.svg">
      <figure><img src="https://example.test/shared.svg"><figcaption>Figure 1a.</figcaption></figure>
      <figure><img src="https://example.test/other.svg"><figcaption>Figure 1b.</figcaption></figure>
      <figcaption>Figure 1.</figcaption>
    </figure>
  `);
  assert.equal(structure.imageCount, 3);
  assert.equal(structure.uniqueImageCount, 2);
  assert.equal(structure.imageFigureCount, 3);
  assert.equal(structure.emptyFigureCount, 0);
});

test("结构清单识别只有题注却丢失资产的空图", () => {
  const structure = analyzePaperHtmlStructure(`
    <figure><figcaption>Figure 1: Missing SVG.</figcaption></figure>
    <figure><table><tr><td>data</td></tr></table><figcaption>Table 1: Preserved.</figcaption></figure>
  `);
  assert.equal(structure.figureCaptionCount, 2);
  assert.equal(structure.tableFigureCount, 1);
  assert.equal(structure.emptyFigureCount, 1);
});

test("旧译文按图号补回来源图片并清理重复脚注", () => {
  const sourceHtml = '<figure><img src="https://arxiv.org/html/paper/figure-1.svg" alt="workflow"><figcaption>Figure 1: Workflow.</figcaption></figure>';
  const restored = restorePaperFiguresByCaption(
    sourceHtml,
    '<p>正文<sup>4</sup><sup>4</sup><sup>4</sup></p><p>图 1：工作流程。</p>',
  );
  const normalized = normalizePaperTranslationHtml(restored);
  assert.match(normalized, /<img[^>]+figure-1\.svg/);
  assert.equal((normalized.match(/<sup>4<\/sup>/g) || []).length, 1);
});

test("论文译文只保留有界的表格跨行跨列属性", () => {
  const normalized = normalizePaperTranslationHtml(
    '<table><tr><td colspan="2" rowspan="3">标题</td><td colspan="999">异常</td></tr></table>',
  );
  assert.match(normalized, /colspan="2"/);
  assert.match(normalized, /rowspan="3"/);
  assert.doesNotMatch(normalized, /999/);
});

test("旧译文可从下一行列数恢复丢失的跨列表头", () => {
  const normalized = normalizePaperTranslationHtml(
    '<table><tr><td>共同指令</td></tr><tr><td>Act</td><td>ReAct</td></tr></table>',
  );
  assert.match(normalized, /<td colspan="2">共同指令<\/td>/);
});

test("结构完整性按唯一图片资产校验而非重复出现次数", () => {
  const validation = validatePaperTranslationStructure(
    {
      imageCount: 3,
      uniqueImageCount: 2,
      tableCount: 0,
      formulaCount: 0,
      semanticSubscriptCount: 0,
      semanticSuperscriptCount: 0,
      headingCount: 0,
    },
    '<img src="https://example.test/shared.svg"><img src="https://example.test/other.svg">',
  );
  assert.equal(validation.fidelity, "complete");
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
