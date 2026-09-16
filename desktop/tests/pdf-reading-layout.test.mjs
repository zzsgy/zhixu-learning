import assert from "node:assert/strict";
import test from "node:test";
import { createPdfFigureRegions } from "../lib/pdf-reading-layout.mjs";
import { buildSingleColumnPdfFlow } from "../public/pdf-reading-flow.js";

test("单栏书籍中居中架构图使用整幅裁剪并不吞掉上方正文", () => {
  const layout = {
    pageWidth: 595.28,
    pageHeight: 841.89,
    multiColumn: false,
    structuredText: {
      body: [
        { text: "本书的核心公式只有一句话：Agent = LLM + 上下文 + 工具。", x: 76.62, y: 498.11, fontSize: 9.96 },
        { text: "在传达核心直觉：上下文是模型能感知到的一切信息。", x: 56.69, y: 428.77, fontSize: 9.63 },
        { text: "LLM：大脑", x: 267.17, y: 385.88, fontSize: 12.06 },
        { text: "上下文：眼睛 Agent 工具：手脚", x: 113.8, y: 306.31, fontSize: 13.26 },
        { text: "图0-1 Agent = LLM + 上下文 + 工具", x: 216.71, y: 139.45, fontSize: 9.96 },
        { text: "对熟悉强化学习的读者，这三者也可以映射到 RL 的形式化语言。", x: 76.62, y: 103.08, fontSize: 9.96 },
      ],
      columns: { left: [], right: [] },
    },
  };
  const regions = createPdfFigureRegions(layout);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].column, "both");
  assert.ok(regions[0].width > 500);
  assert.ok(regions[0].height > 260);
  assert.ok(regions[0].y > 400 && regions[0].y < 450);
});

test("单栏阅读流保留图前、图、图后顺序并移除图内文字副本", () => {
  const pageData = {
    pageHeight: 842,
    body: [
      { text: "图上方正文", x: 56, y: 500, fontSize: 10 },
      { text: "图内标签", x: 200, y: 300, fontSize: 8 },
      { text: "图下方正文", x: 56, y: 90, fontSize: 10 },
    ],
  };
  const figure = { regionIndex: 0, x: 40, y: 430, width: 510, height: 300 };
  const flow = buildSingleColumnPdfFlow(pageData, [figure]);
  assert.deepEqual(flow.map((block) => block.type), ["text", "figure", "text"]);
  assert.deepEqual(flow[0].lines.map((line) => line.text), ["图上方正文"]);
  assert.deepEqual(flow[2].lines.map((line) => line.text), ["图下方正文"]);
});

test("真双栏页的单栏图仍保持局部宽度", () => {
  const layout = {
    pageWidth: 600,
    pageHeight: 800,
    multiColumn: true,
    structuredText: {
      body: [],
      columns: {
        left: [
          { text: "正文段落需要保持在左栏中阅读。", x: 40, y: 650, fontSize: 9 },
          { text: "图 2.1 左栏示意图", x: 80, y: 300, fontSize: 9 },
        ],
        right: [{ text: "右栏独立正文", x: 330, y: 650, fontSize: 9 }],
      },
    },
  };
  const regions = createPdfFigureRegions(layout);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].column, "left");
  assert.ok(regions[0].width < 300);
});
