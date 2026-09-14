import assert from "node:assert/strict";
import test from "node:test";
import {
  createPdfStructuredTextColumns,
  detectPdfPageLayoutComplexity,
} from "../lib/extractor.mjs";

function textItem(x, width = 90, text = "正文", y = 0, fontSize = 9) {
  return { str: text, transform: [1, 0, 0, fontSize, x, y], width, height: fontSize };
}

test("多栏编号图例页进入复杂版面保真模式", () => {
  const rows = Array.from({ length: 6 }, (_value, index) => ({
    text: `左栏 ${index} 右栏 ${index}`,
    items: [textItem(45, 170), textItem(360, 160)],
  }));
  const layout = detectPdfPageLayoutComplexity({
    pageWidth: 612,
    pageHeight: 792,
    rows,
    pageText: "1. 阀杆\n2. 填料法兰\n3. 执行机构防松螺母\n正文",
  });
  assert.equal(layout.multiColumn, true);
  assert.equal(layout.numberedCalloutCount, 3);
  assert.ok(layout.splitRowCount >= 3);
});

test("复杂页按坐标拆成可复制的左右栏，并过滤插图中的孤立引线编号", () => {
  const rows = [
    { y: 593, items: [textItem(36, 120, "控制阀手册 | 第一章", 593, 7)] },
    { y: 572, items: [textItem(140, 45, "1. 阀杆", 572, 6)] },
    { y: 568, items: [textItem(60, 4, "1", 568, 6)] },
    { y: 415, items: [textItem(204, 150, "波纹管密封型阀盖：说明", 415)] },
    { y: 390, items: [textItem(36, 70, "图 1.3 直行程控制阀", 390, 7)] },
    { y: 13, items: [textItem(36, 9, "18", 13, 8)] },
  ];
  const structured = createPdfStructuredTextColumns({
    pageWidth: 396,
    pageHeight: 612,
    rows,
  });
  assert.deepEqual(structured.header.map((line) => line.text), ["控制阀手册 | 第一章"]);
  assert.deepEqual(structured.columns.left.map((line) => line.text), [
    "1. 阀杆",
    "图 1.3 直行程控制阀",
  ]);
  assert.deepEqual(structured.columns.right.map((line) => line.text), ["波纹管密封型阀盖：说明"]);
  assert.deepEqual(structured.footer.map((line) => line.text), ["18"]);
});

test("普通单栏正文不会误判为复杂版面", () => {
  const rows = Array.from({ length: 12 }, (_value, index) => ({
    text: `普通正文第 ${index} 行`,
    items: [textItem(72, 450)],
  }));
  const layout = detectPdfPageLayoutComplexity({
    pageWidth: 612,
    pageHeight: 792,
    rows,
    pageText: "第一章 普通正文\n这是连续的单栏说明文字。",
  });
  assert.equal(layout.multiColumn, false);
  assert.equal(layout.numberedCalloutCount, 0);
  assert.equal(layout.splitRowCount, 0);
});
