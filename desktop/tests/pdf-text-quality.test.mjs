import assert from "node:assert/strict";
import test from "node:test";
import { isPdfTextLayerCorrupted } from "../lib/extractor.mjs";

test("识别字形正常但 Unicode 映射损坏的 PDF 文字层", () => {
  const corruptedLine = "⚥㕂ⵖ鸣剣♧⚡㼱剣➃靍饰涸濨湽կ♧倰꬗㸐䊺僽Ⰼ椕痦♧ⵖ鸣㣐㕂\u0012\u0017";
  assert.equal(isPdfTextLayerCorrupted(corruptedLine.repeat(20)), true);
});

test("正常中文、技术符号和少量生僻字不会误判为乱码文字层", () => {
  const normalText = "中国制造业正在从自动化走向自适应制造。系统包含 AI、PLC、DCS、温度 25℃ 与压力 0.15 MPa。"
    .repeat(30);
  assert.equal(isPdfTextLayerCorrupted(normalText), false);
  assert.equal(isPdfTextLayerCorrupted(`${normalText} 图标：\uE001；生僻字：㐂。`), false);
});
