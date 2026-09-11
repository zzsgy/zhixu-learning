/**
 * 本地文档分类规则测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyWithRules } from "../lib/classifier.mjs";

/**
 * 验证 AI 文档能够被识别为 AI 分类。
 */
test("识别大模型与 Agent 技术文档", () => {
  /** result 是包含 Transformer、RAG 和 Agent 关键词的分类结果。 */
  const result = classifyWithRules({
    fileName: "LLM-Agent架构.md",
    text: "本文讨论 Transformer attention、RAG、embedding 与 Agent 状态机。",
  });
  assert.equal(result.category, "AI");
  assert.ok(result.confidence > 0.5);
});

/**
 * 验证 PostgreSQL 文档能够被识别为数据库分类。
 */
test("识别 PostgreSQL 技术文档", () => {
  /** result 是包含数据库事务与索引关键词的分类结果。 */
  const result = classifyWithRules({
    fileName: "PostgreSQL-MVCC.pdf",
    text: "数据库通过 MVCC 管理事务可见性，并由查询优化器选择索引。",
  });
  assert.equal(result.category, "数据库");
});

/**
 * 验证 CIP 文档能够被识别为工艺工程分类。
 */
test("识别 CIP 与洁净生产文档", () => {
  /** result 是包含清洗、泵和换热器关键词的分类结果。 */
  const result = classifyWithRules({
    fileName: "CIP清洗站设计.docx",
    text: "CIP 清洁验证需要评估泵、换热器、阀门、管道流速和压降。",
  });
  assert.equal(result.category, "工艺工程");
});

/**
 * 验证发酵文档能够被识别为生物工程分类。
 */
test("识别发酵与生物反应器文档", () => {
  /** result 是包含发酵、培养基与细胞关键词的分类结果。 */
  const result = classifyWithRules({
    fileName: "发酵工艺基础.txt",
    text: "发酵过程中需要控制培养基、菌种、生物反应器和细胞代谢。",
  });
  assert.equal(result.category, "生物工程");
});
