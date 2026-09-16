import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyReadableBlock,
  createDocumentChapterTocEntries,
  isDenseDataBlock,
  joinReadableTextLines,
  matchesReadableChapterHeading,
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

test("权威目录标题可从页首恢复且忽略性能分块后缀", () => {
  assert.equal(matchesReadableChapterHeading("引言", "引言"), true);
  assert.equal(matchesReadableChapterHeading(
    "1.1 现代 Agent = LLM + 上下文 + 工具",
    "1.1 现代 Agent = LLM + 上下文 + 工具（1/4）",
  ), true);
  assert.equal(matchesReadableChapterHeading("目录", "引言"), false);
});

test("超长章节的多个性能分块只产生一个目录入口", () => {
  assert.deepEqual(createDocumentChapterTocEntries([
    { title: "引言" },
    { title: "1.1 现代 Agent（1/4）" },
    { title: "1.1 现代 Agent（2/4）" },
    { title: "1.1 现代 Agent（3/4）" },
    { title: "1.1 现代 Agent（4/4）" },
    { title: "1.2 Harness 工程" },
  ]), [
    { title: "引言", startIndex: 0, endIndex: 0, chunkCount: 1 },
    { title: "1.1 现代 Agent", startIndex: 1, endIndex: 4, chunkCount: 4 },
    { title: "1.2 Harness 工程", startIndex: 5, endIndex: 5, chunkCount: 1 },
  ]);
});
