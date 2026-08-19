/**
 * 每周论文偏好排序测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  scorePaperPreference,
  selectPreferredPaperCandidate,
} from "../lib/paper-service.mjs";

/** llmAgentTopic 模拟生产环境中的 LLM 与 Agent 优先规则。 */
const llmAgentTopic = {
  preferenceTerms: [
    {
      pattern: /\b(?:large language models?|llms?|agentic|multi-agent)\b/i,
      weight: 12,
    },
    {
      pattern: /\b(?:tool use|planning|agent memory|reasoning)\b/i,
      weight: 9,
    },
  ],
};

test("LLM 与 Agent 论文获得更高偏好分数", () => {
  /** visionCandidate 是发布时间较新但与用户优先方向无关的视觉论文。 */
  const visionCandidate = {
    title: "A New Geometry Model for 4D Reconstruction",
    abstract: "We reconstruct dynamic scenes from monocular video.",
  };
  /** agentCandidate 是同时包含 LLM、Agent 规划与工具调用的论文。 */
  const agentCandidate = {
    title: "Planning and Tool Use for Agentic Large Language Models",
    abstract: "An agent memory architecture improves multi-step reasoning.",
  };
  assert.ok(
    scorePaperPreference(agentCandidate, llmAgentTopic) >
      scorePaperPreference(visionCandidate, llmAgentTopic),
  );
});

test("优先级高于单纯发布时间，分数相同时仍选择较新论文", () => {
  /** newestVision 是最新但不匹配 LLM 或 Agent 偏好的论文。 */
  const newestVision = {
    externalId: "vision",
    title: "Recent Vision Reconstruction",
    abstract: "Dense geometry estimation.",
    sourceUrl: "https://example.com/vision",
    publishedAt: "2026-07-28T00:00:00Z",
  };
  /** olderAgent 是稍早但匹配 Agent 技术栈的论文。 */
  const olderAgent = {
    externalId: "agent",
    title: "Agentic LLM Planning",
    abstract: "Tool use and agent memory for reasoning.",
    sourceUrl: "https://example.com/agent",
    publishedAt: "2026-07-27T00:00:00Z",
  };
  /** selectedCandidate 是按用户偏好排序后的最终候选。 */
  const selectedCandidate = selectPreferredPaperCandidate(
    [newestVision, olderAgent],
    llmAgentTopic,
  );
  assert.equal(selectedCandidate?.externalId, "agent");
});
