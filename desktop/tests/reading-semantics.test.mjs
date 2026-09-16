import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyReadableBlock,
  isDenseDataBlock,
  joinReadableTextLines,
  normalizeReadableLines,
} from "../public/reading-semantics.js";

test("普通英文论文段落不会被误判为数据框", () => {
  const paragraph = "(S1) RSI for Science. Scientific discovery involves open-ended exploration, costly experiments, and feedback that may not clearly identify the source of failure. We examine how accumulated evidence can improve scientific hypothesis modules and experimental agents.";
  assert.equal(isDenseDataBlock(paragraph), false);
});

test("包含多组指标和值的文本仍可显示为数据块", () => {
  const metrics = "模型评估：准确率 92.4%；召回率 88.1%；F1 90.2%；首字延迟 125 ms；平均延迟 240 ms；吞吐量 320 tokens/s；测试样本 1200 条；失败样本 18 条。";
  assert.equal(isDenseDataBlock(metrics), true);
});

test("只有少量章节编号的长正文不会成为数据块", () => {
  const prose = "第 1 阶段完成资料收集，然后进入第 2 阶段的方案讨论。本段虽然包含少量编号，但仍然是连续的自然语言说明，不应该因为篇幅较长就变成带背景色和左侧竖线的数据卡片，以免破坏正文连续阅读。";
  assert.equal(isDenseDataBlock(prose), false);
});

test("孤立项目符号与下一行合并且四类展示互斥", () => {
  const lines = normalizeReadableLines("•\n(S2) RSI for Embodied Intelligence.\n\n普通正文");
  assert.deepEqual(lines, ["• (S2) RSI for Embodied Intelligence.", "", "普通正文"]);
  assert.equal(classifyReadableBlock(lines[0], { heading: true }), "list");
  assert.equal(classifyReadableBlock("2 Background", { heading: true }), "heading");
  assert.equal(classifyReadableBlock("普通正文"), "paragraph");
});

test("英文换行在标点后补空格且保留连字符复合词", () => {
  assert.equal(
    joinReadableTextLines(["their own actions,", "while failures may arise"]),
    "their own actions, while failures may arise",
  );
  assert.equal(
    joinReadableTextLines(["experience-", "acquisition autonomy"]),
    "experience-acquisition autonomy",
  );
});
