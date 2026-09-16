/**
 * 挂载资料问答中心和阅读页内的连续问答。
 *
 * 来源选择、历史搜索、会话恢复、引用跳转和请求竞态均封装在本模块；
 * 打开具体资料及切换阅读工作台由主应用通过回调协调。
 */
export function mountAiCenter({
  document,
  window,
  request,
  notify = () => {},
  formatDate,
  getReadingContext,
  getReadingSurface,
  getSelectedTargetId,
  openContent,
  setReadingWorkbenchExpanded,
  setReadingWorkbenchTab,
}) {
  const elements = {
    statusLabel: document.querySelector("#ai-status-label"),
    sourceCount: document.querySelector("#ai-source-count"),
    sourceSearch: document.querySelector("#ai-source-search"),
    sourceList: document.querySelector("#ai-source-list"),
    questionForm: document.querySelector("#ai-question-form"),
    modeSwitch: document.querySelector("#ai-mode-switch"),
    questionInput: document.querySelector("#ai-question-input"),
    submitButton: document.querySelector("#ai-submit-button"),
    answerPanel: document.querySelector("#ai-answer-panel"),
    answerStats: document.querySelector("#ai-answer-stats"),
    evidenceWarning: document.querySelector("#ai-evidence-warning"),
    answerText: document.querySelector("#ai-answer-text"),
    citationList: document.querySelector("#ai-citation-list"),
    historySearch: document.querySelector("#ai-history-search"),
    historyList: document.querySelector("#ai-history-list"),
    historyDetail: document.querySelector("#ai-history-detail"),
    documentButton: document.querySelector("#document-ai-button"),
    articleButton: document.querySelector("#article-ai-button"),
    paperButton: document.querySelector("#paper-ai-button"),
    readingPanel: document.querySelector("#reading-ai-panel"),
    readingSourceTitle: document.querySelector("#reading-ai-source-title"),
    readingSelection: document.querySelector("#reading-ai-selection"),
    readingSelectionText: document.querySelector("#reading-ai-selection-text"),
    readingClearSelection: document.querySelector("#reading-ai-clear-selection"),
    readingMessages: document.querySelector("#reading-ai-messages"),
    readingForm: document.querySelector("#reading-ai-form"),
    readingInput: document.querySelector("#reading-ai-input"),
    readingSubmit: document.querySelector("#reading-ai-submit"),
    readingStatus: document.querySelector("#reading-ai-status"),
  };
  const state = {
    sources: [],
    selectedSourceKeys: new Set(),
    mode: "ask",
    configured: false,
    conversations: [],
    historyTimer: null,
    sourceRequestSequence: 0,
    historyRequestSequence: 0,
    historyDetailSequence: 0,
    readingContextSequence: 0,
    readingSelection: null,
    readingConversationId: "",
  };

  const createTextElement = (tagName, className, textContent) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = textContent;
    return element;
  };
  const getSourceKey = (targetType, targetId) => `${targetType}:${targetId}`;
  const isCurrentReadingContext = (sequence, targetType, targetId) => {
    const context = getReadingContext();
    return sequence === state.readingContextSequence
      && context?.targetType === targetType
      && context?.targetId === targetId;
  };

  /** 更新已选资料计数和提交按钮状态。 */
  function updateSelectionState() {
    const selectedCount = state.selectedSourceKeys.size;
    elements.sourceCount.textContent = `${selectedCount} / 6`;
    elements.submitButton.disabled = !state.configured || selectedCount === 0;
  }

  /** 渲染可筛选、最多六项的本地资料选择列表。 */
  function renderSources() {
    const query = elements.sourceSearch.value.trim().toLowerCase();
    const visibleSources = state.sources.filter((source) =>
      `${source.title} ${source.category} ${source.targetType}`.toLowerCase().includes(query),
    );
    elements.sourceList.replaceChildren();
    if (visibleSources.length === 0) {
      elements.sourceList.append(createTextElement("p", "ai-source-empty", "没有匹配的资料。"));
    }
    const typeLabels = { document: "文档", article: "文章", paper: "论文" };
    for (const source of visibleSources) {
      const sourceKey = getSourceKey(source.targetType, source.targetId);
      const label = document.createElement("label");
      label.className = "ai-source-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedSourceKeys.has(sourceKey);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && state.selectedSourceKeys.size >= 6) {
          checkbox.checked = false;
          notify("一次最多选择 6 份资料。");
          return;
        }
        if (checkbox.checked) state.selectedSourceKeys.add(sourceKey);
        else state.selectedSourceKeys.delete(sourceKey);
        updateSelectionState();
      });
      const copy = document.createElement("span");
      copy.append(
        createTextElement("strong", "", source.title),
        createTextElement("small", "", `${typeLabels[source.targetType] || "资料"} · ${source.category || "未分类"}`),
      );
      label.append(checkbox, copy);
      elements.sourceList.append(label);
    }
    updateSelectionState();
  }

  /** 读取不含密钥的模型状态和资料摘要；迟到响应不会覆盖新加载。 */
  async function loadSources() {
    const sequence = ++state.sourceRequestSequence;
    const payload = await request("/api/ai/sources");
    if (sequence !== state.sourceRequestSequence) return false;
    state.sources = Array.isArray(payload.sources) ? payload.sources : [];
    state.configured = Boolean(payload.configured);
    elements.statusLabel.textContent = state.configured
      ? `DeepSeek 已就绪 · ${payload.model}`
      : "尚未配置 DeepSeek API Key";
    renderSources();
    return true;
  }

  /** 设置单资料问答或多资料比较模式，并同步按钮状态。 */
  function setMode(mode) {
    state.mode = mode === "compare" ? "compare" : "ask";
    for (const button of elements.modeSwitch.querySelectorAll("button")) {
      button.classList.toggle("is-active", button.dataset.aiMode === state.mode);
    }
  }

  /** 在任意消息容器内渲染完整会话和可点击引用。 */
  function renderConversationMessages(container, conversation) {
    container.replaceChildren();
    if (!conversation?.messages?.length) {
      container.append(createTextElement("p", "reading-ai-empty", "还没有问答记录。"));
      return;
    }
    for (const message of conversation.messages) {
      const messageCard = document.createElement("article");
      messageCard.className = `ai-chat-message is-${message.role}`;
      messageCard.append(createTextElement("span", "", message.role === "assistant" ? "AI" : "你"));
      if (message.selectedQuote) {
        messageCard.append(createTextElement("blockquote", "ai-chat-selected-quote", message.selectedQuote));
      }
      messageCard.append(createTextElement("p", "", message.content));
      if (message.insufficientEvidence) {
        messageCard.append(createTextElement("small", "ai-chat-warning", "证据不足，请结合原文判断。"));
      }
      if (Array.isArray(message.citations) && message.citations.length > 0) {
        const citationList = document.createElement("div");
        citationList.className = "ai-chat-citations";
        for (const citation of message.citations) {
          const citationButton = document.createElement("button");
          citationButton.type = "button";
          citationButton.textContent = `${citation.chunkId} · ${citation.quote}`;
          citationButton.addEventListener("click", () => {
            void openCitationSource(citation.targetType, citation.targetId, citation.quote)
              .catch((error) => notify(error.message));
          });
          citationList.append(citationButton);
        }
        messageCard.append(citationList);
      }
      container.append(messageCard);
    }
    container.scrollTop = container.scrollHeight;
  }

  /** 渲染问答中心的历史摘要。 */
  function renderConversationHistory() {
    elements.historyList.replaceChildren();
    if (state.conversations.length === 0) {
      elements.historyList.append(createTextElement("p", "ai-history-empty", "还没有匹配的问答记录。阅读任意资料时可以直接开始提问。"));
      return;
    }
    for (const conversation of state.conversations) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-history-item";
      button.append(
        createTextElement("span", "", conversation.mode === "compare" ? "多资料比较" : "阅读追问"),
        createTextElement("strong", "", conversation.title),
        createTextElement("p", "", conversation.lastQuestion),
        createTextElement("small", "", `${conversation.messageCount} 条消息 · ${formatDate(conversation.updatedAt)}`),
      );
      button.addEventListener("click", () => {
        void openConversationHistory(conversation.id).catch((error) => notify(error.message));
      });
      elements.historyList.append(button);
    }
  }

  /** 查询问答历史；搜索框的旧响应不会覆盖较新的查询结果。 */
  async function loadConversations() {
    const sequence = ++state.historyRequestSequence;
    const parameters = new URLSearchParams();
    if (elements.historySearch.value.trim()) parameters.set("q", elements.historySearch.value.trim());
    const payload = await request(`/api/ai/conversations?${parameters}`);
    if (sequence !== state.historyRequestSequence) return false;
    state.conversations = Array.isArray(payload.conversations) ? payload.conversations : [];
    renderConversationHistory();
    return true;
  }

  /** 打开一条完整历史；快速切换时只保留最后一次选择。 */
  async function openConversationHistory(conversationId) {
    const sequence = ++state.historyDetailSequence;
    const payload = await request(`/api/ai/conversations/${encodeURIComponent(conversationId)}`);
    if (sequence !== state.historyDetailSequence) return false;
    const conversation = payload.conversation;
    elements.historyDetail.replaceChildren(
      createTextElement("p", "eyebrow", conversation.mode === "compare" ? "MULTI-SOURCE" : "READING QUESTION"),
      createTextElement("h3", "", conversation.title),
    );
    const sourceBar = document.createElement("div");
    sourceBar.className = "ai-history-sources";
    for (const source of conversation.sources || []) {
      const sourceButton = document.createElement("button");
      sourceButton.type = "button";
      sourceButton.textContent = `打开《${source.title || "原始资料"}》`;
      sourceButton.addEventListener("click", () => {
        void openCitationSource(source.targetType, source.targetId).catch((error) => notify(error.message));
      });
      sourceBar.append(sourceButton);
    }
    elements.historyDetail.append(sourceBar);
    const messageList = document.createElement("div");
    messageList.className = "ai-history-messages";
    elements.historyDetail.append(messageList);
    renderConversationMessages(messageList, conversation);
    return true;
  }

  /** 在当前正文中定位已核验引文。 */
  function focusCitationInReadingSurface(quote) {
    const readingSurface = getReadingSurface();
    const normalizedQuote = String(quote || "").replace(/\s+/g, " ").trim();
    if (!readingSurface || !normalizedQuote) return false;
    const searchNeedle = normalizedQuote.slice(0, Math.min(normalizedQuote.length, 72));
    const candidateElements = Array.from(readingSurface.querySelectorAll(
      "p, li, blockquote, pre, td, th, h1, h2, h3, h4",
    ));
    const matchedElement = candidateElements.find((element) =>
      String(element.textContent || "").replace(/\s+/g, " ").includes(searchNeedle),
    );
    if (!matchedElement) return false;
    readingSurface.querySelector(".is-ai-citation-focus")?.classList.remove("is-ai-citation-focus");
    matchedElement.classList.add("is-ai-citation-focus");
    matchedElement.scrollIntoView?.({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      if (matchedElement.isConnected) matchedElement.classList.remove("is-ai-citation-focus");
    }, 3200);
    return true;
  }

  /** 打开引用所属资料；当前资料直接定位，不重新载入。 */
  async function openCitationSource(targetType, targetId, quote = "") {
    let context = getReadingContext();
    const isCurrentSource = context?.targetType === targetType && context?.targetId === targetId;
    if (!isCurrentSource) {
      await openContent(targetType, targetId);
      context = getReadingContext();
    }
    if (!context) return;
    setReadingWorkbenchExpanded(true);
    setReadingWorkbenchTab("ai");
    if (quote && !focusCitationInReadingSurface(quote)) {
      notify(isCurrentSource
        ? "已保持当前问答，但未在渲染正文中找到完全匹配的引文位置。"
        : "已打开引用资料，但未找到完全匹配的正文位置。");
    }
  }

  /** 渲染服务端已经逐字核验的回答和引用。 */
  function renderAnswer(payload) {
    elements.answerPanel.hidden = false;
    elements.evidenceWarning.hidden = !payload.insufficientEvidence;
    elements.answerStats.textContent = `${payload.usedSourceCount} 份资料 · ${payload.usedChunkCount} 个相关片段 · ${payload.citations.length} 条已核验引用`;
    elements.answerText.textContent = payload.answer;
    elements.citationList.replaceChildren();
    for (const citation of payload.citations) {
      const card = document.createElement("article");
      card.className = "ai-citation-card";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "text-button";
      openButton.textContent = `打开来源 · ${citation.chunkId}`;
      openButton.addEventListener("click", () => {
        void openCitationSource(citation.targetType, citation.targetId, citation.quote)
          .catch((error) => notify(error.message));
      });
      card.append(
        createTextElement("strong", "", citation.title),
        createTextElement("blockquote", "", citation.quote),
        openButton,
      );
      elements.citationList.append(card);
    }
    elements.answerPanel.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  /** 提交问答中心中的单资料问题或多资料比较。 */
  async function submitQuestion() {
    const selectedSources = state.sources
      .filter((source) => state.selectedSourceKeys.has(getSourceKey(source.targetType, source.targetId)))
      .map((source) => ({ targetType: source.targetType, targetId: source.targetId }));
    if (state.mode === "compare" && selectedSources.length < 2) {
      notify("多资料对比至少需要选择 2 份资料。");
      return false;
    }
    elements.submitButton.disabled = true;
    elements.submitButton.textContent = "正在检索并核验…";
    try {
      const payload = await request("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: state.mode,
          question: elements.questionInput.value.trim(),
          sources: selectedSources,
        }),
      });
      renderAnswer(payload);
      await loadConversations();
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    } finally {
      elements.submitButton.textContent = "开始比较";
      updateSelectionState();
    }
  }

  /** 更新阅读页问答使用的正文选区。 */
  function setReadingSelection(selection) {
    state.readingSelection = selection || null;
    elements.readingSelection.hidden = !state.readingSelection;
    elements.readingSelectionText.textContent = state.readingSelection?.quoteText || "";
  }

  /** 读取当前资料最近的会话并防止旧资料响应覆盖新资料。 */
  async function loadLatestReadingConversation(targetType, targetId, sequence) {
    const query = new URLSearchParams({ targetType, targetId });
    const payload = await request(`/api/ai/conversations?${query}`);
    if (!isCurrentReadingContext(sequence, targetType, targetId)) return false;
    const latestConversation = payload.conversations?.[0];
    if (!latestConversation) {
      state.readingConversationId = "";
      renderConversationMessages(elements.readingMessages, null);
      return true;
    }
    const detailPayload = await request(`/api/ai/conversations/${encodeURIComponent(latestConversation.id)}`);
    if (!isCurrentReadingContext(sequence, targetType, targetId)) return false;
    state.readingConversationId = detailPayload.conversation.id;
    renderConversationMessages(elements.readingMessages, detailPayload.conversation);
    return true;
  }

  /** 初始化一篇资料的阅读问答上下文。 */
  async function initializeReading({ targetType, targetId, title }) {
    const sequence = ++state.readingContextSequence;
    state.readingConversationId = "";
    setReadingSelection(null);
    elements.readingSourceTitle.textContent = title || "当前资料";
    elements.readingSubmit.disabled = false;
    elements.readingSubmit.textContent = "发送问题";
    elements.readingStatus.textContent = "回答和引用会保存到本机问答记录。";
    try {
      return await loadLatestReadingConversation(targetType, targetId, sequence);
    } catch (error) {
      if (isCurrentReadingContext(sequence, targetType, targetId)) {
        elements.readingStatus.textContent = error.message;
      }
      return false;
    }
  }

  /** 在阅读页继续当前资料的本地会话。 */
  async function submitReadingQuestion() {
    const context = getReadingContext();
    const question = elements.readingInput.value.trim();
    if (!context || !question) return false;
    const sequence = state.readingContextSequence;
    const targetType = context.targetType;
    const targetId = context.targetId;
    elements.readingSubmit.disabled = true;
    elements.readingSubmit.textContent = "正在检索原文…";
    elements.readingStatus.textContent = "正在生成并核验引用，请稍候。";
    try {
      const payload = await request("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ask",
          question,
          conversationId: state.readingConversationId || undefined,
          selectedQuote: state.readingSelection?.quoteText || "",
          sources: [{ targetType, targetId }],
        }),
      });
      if (!isCurrentReadingContext(sequence, targetType, targetId)) return false;
      state.readingConversationId = payload.conversationId;
      elements.readingInput.value = "";
      setReadingSelection(null);
      renderConversationMessages(elements.readingMessages, payload.conversation);
      elements.readingStatus.textContent = "已保存到本机问答记录。";
      return true;
    } catch (error) {
      if (isCurrentReadingContext(sequence, targetType, targetId)) {
        elements.readingStatus.textContent = error.message;
        notify(error.message);
      }
      return false;
    } finally {
      if (isCurrentReadingContext(sequence, targetType, targetId)) {
        elements.readingSubmit.disabled = false;
        elements.readingSubmit.textContent = "发送问题";
      }
    }
  }

  /** 清除已关闭阅读页的问答状态和可见消息。 */
  function closeReading() {
    state.readingContextSequence += 1;
    state.readingConversationId = "";
    setReadingSelection(null);
    elements.readingMessages.replaceChildren(
      createTextElement("p", "reading-ai-empty", "你可以询问整篇内容，也可以先在正文中选择术语、句子或段落再提问。"),
    );
    elements.readingSubmit.disabled = false;
    elements.readingSubmit.textContent = "发送问题";
  }

  /** 打开当前资料的阅读问答页签。 */
  function openForReading(targetType, targetId) {
    const context = getReadingContext();
    if (context?.targetType !== targetType || context?.targetId !== targetId) return false;
    setReadingWorkbenchExpanded(true);
    setReadingWorkbenchTab("ai");
    return true;
  }

  /** 由主应用切换工作台页签时同步 AI 面板可见性。 */
  function setReadingPanelVisible(visible) {
    elements.readingPanel.hidden = !visible;
    if (visible) elements.readingInput.focus();
  }

  /** 进入问答中心时加载来源和历史。 */
  async function load() {
    setMode("compare");
    await Promise.all([loadSources(), loadConversations()]);
  }

  elements.sourceSearch.addEventListener("input", renderSources);
  elements.historySearch.addEventListener("input", () => {
    window.clearTimeout(state.historyTimer);
    state.historyTimer = window.setTimeout(() => {
      void loadConversations().catch((error) => notify(error.message));
    }, 300);
  });
  for (const button of elements.modeSwitch.querySelectorAll("button")) {
    button.addEventListener("click", () => setMode(button.dataset.aiMode));
  }
  elements.questionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitQuestion();
  });
  elements.readingClearSelection.addEventListener("click", () => setReadingSelection(null));
  elements.readingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReadingQuestion();
  });
  for (const [targetType, button] of [
    ["document", elements.documentButton],
    ["article", elements.articleButton],
    ["paper", elements.paperButton],
  ]) {
    button.addEventListener("click", () => {
      const targetId = getSelectedTargetId(targetType);
      if (targetId) openForReading(targetType, targetId);
    });
  }

  return Object.freeze({
    closeReading,
    initializeReading,
    load,
    loadConversations,
    openConversationHistory,
    openForReading,
    setMode,
    setReadingPanelVisible,
    setReadingSelection,
    submitQuestion,
    submitReadingQuestion,
  });
}
