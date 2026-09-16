import assert from "node:assert/strict";
import test from "node:test";
import { createAiQuestionRouteHandler } from "../lib/http/routes/ai-question-routes.mjs";

function createRecorder() {
  const responses = [];
  return {
    responses,
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  };
}

function createBaseDependencies(overrides = {}) {
  return {
    answerQuestion: async () => ({
      answer: "回答",
      citations: [],
      insufficientEvidence: false,
      usedChunkCount: 1,
      usedSourceCount: 1,
    }),
    config: { deepSeekApiKey: "test-key", deepSeekModel: "deepseek-chat" },
    createBackup: () => {},
    getArticle: () => null,
    getConversation: () => null,
    getDocument: () => null,
    getPaper: () => null,
    listArticles: () => [],
    listDocuments: () => [],
    listPapers: () => [],
    readRequestBuffer: async (request) => Buffer.from(JSON.stringify(request.payload), "utf8"),
    saveExchange: () => ({ id: "conversation-1", messages: [] }),
    sendJson: () => {},
    ...overrides,
  };
}

test("AI 来源目录保持三类资料映射、字段优先级、1000 项上限和模型状态", async () => {
  const recorder = createRecorder();
  const calls = [];
  const handler = createAiQuestionRouteHandler(createBaseDependencies({
    listDocuments: (filters) => {
      calls.push(["documents", filters]);
      return [{ id: "document-1", title: "文档", category: "工作", summary: "文档摘要" }];
    },
    listArticles: (filters) => {
      calls.push(["articles", filters]);
      return [{ id: "article-1", title: "文章", category: "学习", summary: "文章摘要" }];
    },
    listPapers: (...args) => {
      calls.push(["papers", args]);
      return [{
        id: "paper-1",
        title: "Paper",
        titleZh: "中文论文",
        category: "AI",
        abstract: "Abstract",
        abstractZh: "中文摘要",
        curatorNote: "推荐语",
      }];
    },
    sendJson: recorder.sendJson,
  }));

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/ai/sources"),
  ), true);
  assert.deepEqual(calls, [
    ["documents", { limit: 1000 }],
    ["articles", { limit: 1000 }],
    ["papers", []],
  ]);
  assert.deepEqual(recorder.responses.at(-1).payload, {
    configured: true,
    model: "deepseek-chat",
    sources: [
      { targetType: "document", targetId: "document-1", title: "文档", category: "工作", summary: "文档摘要" },
      { targetType: "article", targetId: "article-1", title: "文章", category: "学习", summary: "文章摘要" },
      { targetType: "paper", targetId: "paper-1", title: "中文论文", category: "AI", summary: "中文摘要" },
    ],
  });
});

test("AI 问答路由从本地重读三类正文、恢复上下文、映射引用并在保存后备份", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const answerInputs = [];
  const savedExchanges = [];
  const existingConversation = {
    id: "conversation-1",
    messages: [{ role: "user", content: "上一问" }, { role: "assistant", content: "上一答" }],
  };
  const result = {
    answer: "综合回答",
    citations: [
      { sourceKey: "S1", chunkId: "S1-C1", quote: "文档引文" },
      { sourceKey: "S3", chunkId: "S3-C1", quote: "论文引文" },
    ],
    insufficientEvidence: false,
    usedChunkCount: 3,
    usedSourceCount: 3,
  };
  const savedConversation = { id: "conversation-1", messages: [] };
  const handler = createAiQuestionRouteHandler(createBaseDependencies({
    answerQuestion: async (input) => {
      sequence.push("answer");
      answerInputs.push(input);
      return result;
    },
    createBackup: () => sequence.push("backup"),
    getArticle: (id) => id === "article-1" ? {
      title: "文章", contentText: "文章正文", summary: "文章摘要",
    } : null,
    getConversation: (id) => id === "conversation-1" ? existingConversation : null,
    getDocument: (id) => id === "document-1" ? {
      title: "文档", extractedText: "文档正文", summary: "文档摘要",
    } : null,
    getPaper: (id) => id === "paper-1" ? {
      title: "Paper", titleZh: "中文论文", fullTranslationHtml: "论文中文全文",
      sourceText: "Paper full text", abstractZh: "中文摘要", abstract: "Abstract",
    } : null,
    readRequestBuffer: async (request, byteLimit) => {
      assert.equal(byteLimit, 512 * 1024);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    saveExchange: (exchange) => {
      sequence.push("save");
      savedExchanges.push(exchange);
      return savedConversation;
    },
    sendJson: recorder.sendJson,
  }));
  const payload = {
    conversationId: "conversation-1",
    mode: "compare",
    question: "请比较三份资料",
    selectedQuote: "重点选区",
    sources: [
      { targetType: "document", targetId: " document-1 ", text: "伪造文档正文" },
      { targetType: "article", targetId: "article-1", text: "伪造文章正文" },
      { targetType: "paper", targetId: "paper-1", text: "伪造论文正文" },
    ],
  };

  assert.equal(await handler(
    { method: "POST", payload },
    {},
    new URL("http://local/api/ai/ask"),
  ), true);
  assert.deepEqual(sequence, ["answer", "save", "backup"]);
  assert.deepEqual(answerInputs[0], {
    apiKey: "test-key",
    model: "deepseek-chat",
    question: "请比较三份资料",
    mode: "compare",
    sources: [
      { sourceKey: "S1", targetType: "document", targetId: "document-1", title: "文档", text: "文档正文" },
      { sourceKey: "S2", targetType: "article", targetId: "article-1", title: "文章", text: "文章正文" },
      { sourceKey: "S3", targetType: "paper", targetId: "paper-1", title: "中文论文", text: "论文中文全文" },
    ],
    selectedQuote: "重点选区",
    conversationMessages: existingConversation.messages,
  });
  assert.deepEqual(savedExchanges[0].citations, [
    { sourceKey: "S1", chunkId: "S1-C1", quote: "文档引文", targetType: "document", targetId: "document-1" },
    { sourceKey: "S3", chunkId: "S3-C1", quote: "论文引文", targetType: "paper", targetId: "paper-1" },
  ]);
  assert.deepEqual(savedExchanges[0].sources, [
    { targetType: "document", targetId: "document-1", title: "文档" },
    { targetType: "article", targetId: "article-1", title: "文章" },
    { targetType: "paper", targetId: "paper-1", title: "中文论文" },
  ]);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.equal(recorder.responses.at(-1).payload.conversationId, "conversation-1");
  assert.deepEqual(recorder.responses.at(-1).payload.conversation, savedConversation);
});

test("AI 问答路由最多读取六份来源且任一来源失效时在模型调用前返回 422", async () => {
  const recorder = createRecorder();
  const calls = [];
  const handler = createAiQuestionRouteHandler(createBaseDependencies({
    answerQuestion: async () => {
      calls.push("answer");
      return { answer: "不应调用", citations: [], insufficientEvidence: true };
    },
    getDocument: (id) => {
      calls.push(["document", id]);
      return id === "document-4" ? null : { title: id, extractedText: "正文" };
    },
    readRequestBuffer: async (request, byteLimit) => {
      assert.equal(byteLimit, 512 * 1024);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    sendJson: recorder.sendJson,
  }));
  const sources = Array.from({ length: 8 }, (_, index) => ({
    targetType: "document",
    targetId: `document-${index + 1}`,
  }));

  assert.equal(await handler(
    { method: "POST", payload: { sources } },
    {},
    new URL("http://local/api/ai/ask"),
  ), true);
  assert.deepEqual(calls, [
    ["document", "document-1"],
    ["document", "document-2"],
    ["document", "document-3"],
    ["document", "document-4"],
    ["document", "document-5"],
    ["document", "document-6"],
  ]);
  assert.equal(recorder.responses.at(-1).statusCode, 422);
  assert.deepEqual(recorder.responses.at(-1).payload, {
    message: "部分所选资料已不存在，请刷新资料列表后重试。",
  });
});

test("AI 问答路由在连续会话不存在时于模型调用前返回 404", async () => {
  const recorder = createRecorder();
  let answerCalled = false;
  const handler = createAiQuestionRouteHandler(createBaseDependencies({
    answerQuestion: async () => {
      answerCalled = true;
      return { answer: "不应调用", citations: [], insufficientEvidence: true };
    },
    getConversation: () => null,
    getDocument: () => ({ title: "文档", extractedText: "正文" }),
    sendJson: recorder.sendJson,
  }));

  assert.equal(await handler(
    {
      method: "POST",
      payload: {
        conversationId: "missing",
        sources: [{ targetType: "document", targetId: "document-1" }],
      },
    },
    {},
    new URL("http://local/api/ai/ask"),
  ), true);
  assert.equal(answerCalled, false);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, {
    message: "找不到要继续的问答记录。",
  });
});

test("AI 问答路由只在回答与历史保存都成功后备份并放行非目标请求", async () => {
  const sequence = [];
  const answerFailure = createAiQuestionRouteHandler(createBaseDependencies({
    answerQuestion: async () => {
      sequence.push("answer");
      throw new Error("模型失败");
    },
    createBackup: () => sequence.push("backup"),
  }));
  await assert.rejects(
    answerFailure(
      { method: "POST", payload: { sources: [] } },
      {},
      new URL("http://local/api/ai/ask"),
    ),
    /模型失败/,
  );
  assert.deepEqual(sequence, ["answer"]);

  const saveFailure = createAiQuestionRouteHandler(createBaseDependencies({
    answerQuestion: async () => {
      sequence.push("answer-2");
      return { answer: "回答", citations: [], insufficientEvidence: true };
    },
    createBackup: () => sequence.push("backup"),
    saveExchange: () => {
      sequence.push("save");
      throw new Error("保存失败");
    },
  }));
  await assert.rejects(
    saveFailure(
      { method: "POST", payload: { sources: [] } },
      {},
      new URL("http://local/api/ai/ask"),
    ),
    /保存失败/,
  );
  assert.deepEqual(sequence, ["answer", "answer-2", "save"]);
  assert.equal(await saveFailure(
    { method: "GET" },
    {},
    new URL("http://local/api/other"),
  ), false);
});
