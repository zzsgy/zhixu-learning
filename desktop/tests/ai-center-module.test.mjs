import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountAiCenter } from "../public/ai-center.js";

const pageHtml = fs.readFileSync(path.resolve(import.meta.dirname, "../public/index.html"), "utf8");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createHarness(request) {
  const { document, window } = parseHTML(pageHtml);
  const notifications = [];
  const opened = [];
  const workbench = [];
  let readingContext = null;
  let readingSurface = null;
  const selectedIds = { document: "document-1", article: "article-1", paper: "paper-1" };
  const ai = mountAiCenter({
    document,
    window,
    request,
    notify: (message) => notifications.push(message),
    formatDate: () => "2026/09/16",
    getReadingContext: () => readingContext,
    getReadingSurface: () => readingSurface,
    getSelectedTargetId: (targetType) => selectedIds[targetType] || "",
    openContent: async (targetType, targetId) => {
      opened.push([targetType, targetId]);
      readingContext = { targetType, targetId };
    },
    setReadingWorkbenchExpanded: (expanded) => workbench.push(["expanded", expanded]),
    setReadingWorkbenchTab: (tabName) => workbench.push(["tab", tabName]),
  });
  return {
    ai,
    document,
    notifications,
    opened,
    setReadingContext: (value) => { readingContext = value; },
    setReadingSurface: (value) => { readingSurface = value; },
    window,
    workbench,
  };
}

const createConversation = (id, title = id, citations = []) => ({
  id,
  mode: "ask",
  title,
  sources: [{ targetType: "article", targetId: "article-1", title: "来源文章" }],
  messages: [
    { role: "user", content: "为什么？", selectedQuote: "", citations: [] },
    { role: "assistant", content: `回答 ${title}`, selectedQuote: "", citations },
  ],
});

test("AI 中心独立加载来源、限制六项选择并提交多资料比较", async () => {
  const requests = [];
  const sources = Array.from({ length: 7 }, (_, index) => ({
    targetType: index % 2 ? "article" : "document",
    targetId: `source-${index + 1}`,
    title: `资料 ${index + 1}`,
    category: index === 6 ? "特殊分类" : "学习",
  }));
  const harness = createHarness(async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/api/ai/sources") return { configured: true, model: "deepseek-chat", sources };
    if (url.startsWith("/api/ai/conversations?")) return { conversations: [] };
    if (url === "/api/ai/ask") {
      return {
        answer: "综合比较结果",
        insufficientEvidence: false,
        usedSourceCount: 6,
        usedChunkCount: 12,
        citations: [],
      };
    }
    throw new Error(`未处理请求：${url}`);
  });

  await harness.ai.load();
  assert.match(harness.document.querySelector("#ai-status-label").textContent, /deepseek-chat/);
  assert.equal(harness.document.querySelectorAll("#ai-source-list input").length, 7);
  assert.equal(harness.document.querySelector('[data-ai-mode="compare"]').classList.contains("is-active"), true);
  const checkboxes = [...harness.document.querySelectorAll("#ai-source-list input")];
  for (const checkbox of checkboxes.slice(0, 6)) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new harness.window.Event("change"));
  }
  checkboxes[6].checked = true;
  checkboxes[6].dispatchEvent(new harness.window.Event("change"));
  assert.equal(checkboxes[6].checked, false);
  assert.equal(harness.document.querySelector("#ai-source-count").textContent, "6 / 6");
  assert.deepEqual(harness.notifications, ["一次最多选择 6 份资料。"]);

  harness.document.querySelector("#ai-source-search").value = "特殊分类";
  harness.document.querySelector("#ai-source-search").dispatchEvent(new harness.window.Event("input"));
  assert.equal(harness.document.querySelectorAll("#ai-source-list input").length, 1);
  harness.document.querySelector("#ai-question-input").value = "比较这些资料";
  assert.equal(await harness.ai.submitQuestion(), true);
  const submitted = JSON.parse(requests.find((entry) => entry.url === "/api/ai/ask").options.body);
  assert.equal(submitted.mode, "compare");
  assert.equal(submitted.sources.length, 6);
  assert.equal(harness.document.querySelector("#ai-answer-text").textContent, "综合比较结果");
  assert.equal(harness.document.querySelector("#ai-submit-button").textContent, "开始比较");
});

test("阅读页 AI 恢复最近会话、携带选区并连续追问同一会话", async () => {
  const submitted = [];
  let answerIndex = 0;
  const harness = createHarness(async (url, options = {}) => {
    if (url.startsWith("/api/ai/conversations?")) return { conversations: [{ id: "conversation-1" }] };
    if (url === "/api/ai/conversations/conversation-1") {
      return { conversation: createConversation("conversation-1", "已有会话") };
    }
    if (url === "/api/ai/ask") {
      const body = JSON.parse(options.body);
      submitted.push(body);
      answerIndex += 1;
      return {
        conversationId: "conversation-1",
        conversation: createConversation("conversation-1", `第 ${answerIndex} 次追问`),
      };
    }
    throw new Error(`未处理请求：${url}`);
  });
  harness.setReadingContext({ targetType: "article", targetId: "article-1" });

  assert.equal(await harness.ai.initializeReading({
    targetType: "article",
    targetId: "article-1",
    title: "状态机文章",
  }), true);
  assert.match(harness.document.querySelector("#reading-ai-messages").textContent, /已有会话/);
  harness.ai.setReadingSelection({ quoteText: "可恢复检查点", anchorStart: 3, anchorEnd: 10 });
  harness.document.querySelector("#reading-ai-input").value = "第一问";
  assert.equal(await harness.ai.submitReadingQuestion(), true);
  harness.document.querySelector("#reading-ai-input").value = "第二问";
  assert.equal(await harness.ai.submitReadingQuestion(), true);

  assert.equal(submitted[0].conversationId, "conversation-1");
  assert.equal(submitted[0].selectedQuote, "可恢复检查点");
  assert.deepEqual(submitted[0].sources, [{ targetType: "article", targetId: "article-1" }]);
  assert.equal(submitted[1].conversationId, "conversation-1");
  assert.equal(submitted[1].selectedQuote, "");
  assert.equal(harness.document.querySelector("#reading-ai-selection").hidden, true);
  assert.match(harness.document.querySelector("#reading-ai-messages").textContent, /第 2 次追问/);
  assert.equal(harness.document.querySelector("#reading-ai-status").textContent, "已保存到本机问答记录。");
});

test("切换阅读资料后迟到的旧会话请求不能覆盖当前资料", async () => {
  const articleList = createDeferred();
  const paperList = createDeferred();
  const harness = createHarness(async (url) => {
    if (url.includes("targetType=article")) return articleList.promise;
    if (url.includes("targetType=paper")) return paperList.promise;
    if (url === "/api/ai/conversations/paper-conversation") {
      return { conversation: createConversation("paper-conversation", "论文新会话") };
    }
    if (url === "/api/ai/conversations/article-conversation") {
      throw new Error("旧资料不应继续读取详情");
    }
    throw new Error(`未处理请求：${url}`);
  });

  harness.setReadingContext({ targetType: "article", targetId: "article-1" });
  const oldLoad = harness.ai.initializeReading({
    targetType: "article", targetId: "article-1", title: "旧文章",
  });
  harness.setReadingContext({ targetType: "paper", targetId: "paper-1" });
  const newLoad = harness.ai.initializeReading({
    targetType: "paper", targetId: "paper-1", title: "新论文",
  });
  paperList.resolve({ conversations: [{ id: "paper-conversation" }] });
  assert.equal(await newLoad, true);
  articleList.resolve({ conversations: [{ id: "article-conversation" }] });
  assert.equal(await oldLoad, false);

  assert.equal(harness.document.querySelector("#reading-ai-source-title").textContent, "新论文");
  assert.match(harness.document.querySelector("#reading-ai-messages").textContent, /论文新会话/);
  assert.doesNotMatch(harness.document.querySelector("#reading-ai-messages").textContent, /旧文章/);
});

test("历史搜索和会话详情只渲染最后一次请求", async () => {
  const oldSearch = createDeferred();
  const newSearch = createDeferred();
  const oldDetail = createDeferred();
  const newDetail = createDeferred();
  const harness = createHarness(async (url) => {
    if (url === "/api/ai/conversations?q=old") return oldSearch.promise;
    if (url === "/api/ai/conversations?q=new") return newSearch.promise;
    if (url === "/api/ai/conversations/old-detail") return oldDetail.promise;
    if (url === "/api/ai/conversations/new-detail") return newDetail.promise;
    throw new Error(`未处理请求：${url}`);
  });
  const search = harness.document.querySelector("#ai-history-search");
  search.value = "old";
  const oldSearchLoad = harness.ai.loadConversations();
  search.value = "new";
  const newSearchLoad = harness.ai.loadConversations();
  newSearch.resolve({ conversations: [{
    id: "new", mode: "ask", title: "新搜索结果", lastQuestion: "新问题", messageCount: 2, updatedAt: "2026-09-16",
  }] });
  assert.equal(await newSearchLoad, true);
  oldSearch.resolve({ conversations: [{
    id: "old", mode: "ask", title: "旧搜索结果", lastQuestion: "旧问题", messageCount: 2, updatedAt: "2026-09-15",
  }] });
  assert.equal(await oldSearchLoad, false);
  assert.match(harness.document.querySelector("#ai-history-list").textContent, /新搜索结果/);
  assert.doesNotMatch(harness.document.querySelector("#ai-history-list").textContent, /旧搜索结果/);

  const oldDetailLoad = harness.ai.openConversationHistory("old-detail");
  const newDetailLoad = harness.ai.openConversationHistory("new-detail");
  newDetail.resolve({ conversation: createConversation("new-detail", "新详情") });
  assert.equal(await newDetailLoad, true);
  oldDetail.resolve({ conversation: createConversation("old-detail", "旧详情") });
  assert.equal(await oldDetailLoad, false);
  assert.match(harness.document.querySelector("#ai-history-detail").textContent, /新详情/);
  assert.doesNotMatch(harness.document.querySelector("#ai-history-detail").textContent, /旧详情/);
});

test("引用可返回正文定位，阅读问答失败后恢复按钮和错误状态", async () => {
  let failQuestion = false;
  const citation = {
    chunkId: "S1-C1",
    quote: "状态机通过检查点恢复执行",
    targetType: "article",
    targetId: "article-1",
  };
  const harness = createHarness(async (url) => {
    if (url.startsWith("/api/ai/conversations?")) return { conversations: [{ id: "conversation-1" }] };
    if (url === "/api/ai/conversations/conversation-1") {
      return { conversation: createConversation("conversation-1", "引用会话", [citation]) };
    }
    if (url === "/api/ai/ask" && failQuestion) throw new Error("模型暂时不可用");
    throw new Error(`未处理请求：${url}`);
  });
  const surface = harness.document.createElement("main");
  const paragraph = harness.document.createElement("p");
  paragraph.textContent = "这里说明状态机通过检查点恢复执行，并继续后续步骤。";
  surface.append(paragraph);
  harness.document.body.append(surface);
  harness.setReadingSurface(surface);
  harness.setReadingContext({ targetType: "article", targetId: "article-1" });
  await harness.ai.initializeReading({ targetType: "article", targetId: "article-1", title: "引用文章" });
  harness.document.querySelector("#reading-ai-messages .ai-chat-citations button").click();
  await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
  assert.equal(paragraph.classList.contains("is-ai-citation-focus"), true);
  assert.deepEqual(harness.workbench, [["expanded", true], ["tab", "ai"]]);

  failQuestion = true;
  harness.document.querySelector("#reading-ai-input").value = "失败问题";
  assert.equal(await harness.ai.submitReadingQuestion(), false);
  assert.equal(harness.document.querySelector("#reading-ai-submit").disabled, false);
  assert.equal(harness.document.querySelector("#reading-ai-submit").textContent, "发送问题");
  assert.equal(harness.document.querySelector("#reading-ai-status").textContent, "模型暂时不可用");
  assert.deepEqual(harness.notifications, ["模型暂时不可用"]);
});
