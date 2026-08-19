/**
 * 知序本地知识库浏览器交互。
 *
 * 页面只请求当前电脑上的本地服务，不连接任何第三方前端接口。
 */

/** applicationState 保存当前筛选、文档列表和已打开文档。 */
const applicationState = {
  /** activeView 是当前显示的一级页面。 */
  activeView: "library",
  /** readingPageHistory 保存进入阅读页前实际访问的页面或另一篇正文。 */
  readingPageHistory: [],
  /** activeCategory 是文档库当前分类筛选。 */
  activeCategory: "",
  /** searchQuery 是全文检索关键词。 */
  searchQuery: "",
  /** favoriteOnly 表示文档库是否只显示收藏的重点内容。 */
  favoriteOnly: false,
  /** categories 是服务端允许的全部分类。 */
  categories: [],
  /** documents 是当前条件下的轻量文档列表。 */
  documents: [],
  /** articles 是本地保存的文章列表。 */
  articles: [],
  /** papers 是用户每周亲自选入论文库的论文列表。 */
  papers: [],
  /** activePaperSource 是论文库当前来源筛选值。 */
  activePaperSource: "",
  /** activePaperReminder 是当前弹窗正在展示的周提醒。 */
  activePaperReminder: null,
  /** paperReminderTimer 用于网站运行期间每小时检查一次周提醒。 */
  paperReminderTimer: null,
  /** selectedDocument 是阅读页正在展示的完整文档。 */
  selectedDocument: null,
  /** selectedArticle 是文章阅读页正在展示的完整文章。 */
  selectedArticle: null,
  /** articleLanguageMode 是文章阅读页的中文、原文或双语显示模式。 */
  articleLanguageMode: "original",
  /** selectedPaper 是论文阅读页正在展示的完整论文。 */
  selectedPaper: null,
  /** paperTranslationPollTimer 用于等待后台 Codex 时自动刷新论文状态。 */
  paperTranslationPollTimer: null,
  /** searchTimer 用于合并快速连续输入。 */
  searchTimer: null,
  /** readingWorkspace 是当前内容的阅读状态、笔记和高亮批注。 */
  readingWorkspace: null,
  /** activeReadingSurface 是当前可进行目录和高亮操作的正文根节点。 */
  activeReadingSurface: null,
  /** pendingReadingSelection 是等待用户选择颜色的正文选区。 */
  pendingReadingSelection: null,
  /** readingAiSelection 是当前阅读内问答重点引用的正文选区。 */
  readingAiSelection: null,
  /** readingAiConversationId 是当前资料正在继续的本地问答会话。 */
  readingAiConversationId: "",
  /** readingWorkbenchWidth 是用户最后设置的阅读工作台宽度。 */
  readingWorkbenchWidth: 420,
  /** readingProgressTimer 用于合并连续滚动产生的进度保存。 */
  readingProgressTimer: null,
  /** readingNoteTimer 用于合并连续输入产生的笔记保存。 */
  readingNoteTimer: null,
  /** searchResults 是跨文档、文章、论文和笔记的统一搜索结果。 */
  searchResults: [],
  /** activeTag 是文档库当前启用的标签筛选值。 */
  activeTag: "",
  /** tags 是知识库中全部标签及其使用次数。 */
  tags: [],
  /** topics 是用户创建的学习专题列表。 */
  topics: [],
  /** folders 是知识库的树形文件夹扁平列表。 */
  folders: [],
  /** activeFolderId 是文档库当前打开的文件夹；空值表示根目录。 */
  activeFolderId: "",
  /** docsifyInspection 是等待用户确认的教程站目录预览。 */
  docsifyInspection: null,
  /** pendingMoveItem 是移动窗口当前等待处理的文档或文章。 */
  pendingMoveItem: null,
  /** selectedMoveFolderId 是移动窗口中由鼠标选中的目标文件夹。 */
  selectedMoveFolderId: "",
  /** readingTocExpanded 表示正文左侧目录当前是否展开。 */
  readingTocExpanded: true,
  /** activeTopicId 是专题页当前展开的专题 ID。 */
  activeTopicId: "",
  /** contentOrganization 是当前阅读内容的标签和专题关系。 */
  contentOrganization: null,
  /** readingFontSize 是正文区域当前使用的像素字号。 */
  readingFontSize: 18,
  /** readingLineHeight 是正文区域当前使用的无单位行距。 */
  readingLineHeight: 1.9,
  /** knowledgeCards 是全部来源可追溯知识卡片。 */
  knowledgeCards: [],
  /** dueKnowledgeCards 是当前已经到期的今日复习卡片。 */
  dueKnowledgeCards: [],
  /** activeReviewIndex 是今日复习队列中的当前位置。 */
  activeReviewIndex: 0,
  /** aiSources 是可被用户主动选入有出处问答的本地资料摘要。 */
  aiSources: [],
  /** selectedAiSourceKeys 是当前已选择的“类型:ID”集合。 */
  selectedAiSourceKeys: new Set(),
  /** aiMode 是单篇追问 ask 或多资料比较 compare。 */
  aiMode: "ask",
  /** aiConfigured 表示本机服务端是否已读取 DeepSeek Key。 */
  aiConfigured: false,
  /** aiConversations 是资料问答页显示的本地历史摘要。 */
  aiConversations: [],
  /** aiHistoryTimer 用于合并连续输入产生的历史搜索请求。 */
  aiHistoryTimer: null,
  /** importJobs 是任务中心最近的浏览器收藏、OCR 和视频导入记录。 */
  importJobs: [],
  /** importJobPollTimer 在存在排队或运行任务时刷新状态。 */
  importJobPollTimer: null,
  /** documentOcrPollTimer 在阅读页等待 OCR 完成时刷新文档。 */
  documentOcrPollTimer: null,
};

/** dom 集中保存页面中会重复访问的元素。 */
const dom = {
  pageEyebrow: document.querySelector("#page-eyebrow"),
  pageTitle: document.querySelector("#page-title"),
  /** floatingReaderBack 是滚动正文时始终可见的返回上一页按钮。 */
  floatingReaderBack: document.querySelector("#floating-reader-back"),
  topUploadButton: document.querySelector("#top-upload-button"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeToggleLabel: document.querySelector("#theme-toggle-label"),
  viewMode: document.querySelector("#view-mode"),
  viewModeLabel: document.querySelector("#view-mode-label"),
  viewModeOptions: document.querySelectorAll(".view-mode-option"),
  documentTotal: document.querySelector("#document-total"),
  searchInput: document.querySelector("#search-input"),
  folderBreadcrumbs: document.querySelector("#folder-breadcrumbs"),
  folderGrid: document.querySelector("#folder-grid"),
  newFolderButton: document.querySelector("#new-folder-button"),
  favoriteFilterButton: document.querySelector("#favorite-filter-button"),
  documentGrid: document.querySelector("#document-grid"),
  emptyState: document.querySelector("#empty-state"),
  fileInput: document.querySelector("#file-input"),
  paperFileInput: document.querySelector("#paper-file-input"),
  choosePaperFileButton: document.querySelector("#choose-paper-file-button"),
  paperImportForm: document.querySelector("#paper-import-form"),
  paperUrlInput: document.querySelector("#paper-url-input"),
  importPaperUrlButton: document.querySelector("#import-paper-url-button"),
  chooseFilesButton: document.querySelector("#choose-files-button"),
  dropZone: document.querySelector("#drop-zone"),
  uploadQueue: document.querySelector("#upload-queue"),
  backupButton: document.querySelector("#backup-button"),
  browserPairingButton: document.querySelector("#browser-pairing-button"),
  browserPairingCode: document.querySelector("#browser-pairing-code"),
  browserClientList: document.querySelector("#browser-client-list"),
  refreshImportJobs: document.querySelector("#refresh-import-jobs"),
  importJobList: document.querySelector("#import-job-list"),
  articleImportForm: document.querySelector("#article-import-form"),
  articleUrlInput: document.querySelector("#article-url-input"),
  parseArticleButton: document.querySelector("#parse-article-button"),
  docsifyPreview: document.querySelector("#docsify-preview"),
  videoImportForm: document.querySelector("#video-import-form"),
  videoUrlInput: document.querySelector("#video-url-input"),
  importVideoButton: document.querySelector("#import-video-button"),
  reader: document.querySelector("#reader"),
  readerBackButton: document.querySelector("#reader-back-button"),
  readerModeSwitch: document.querySelector("#reader-mode-switch"),
  widePreviewButton: document.querySelector("#wide-preview-button"),
  readerTitle: document.querySelector("#reader-title"),
  readerMeta: document.querySelector("#reader-meta"),
  readerSummary: document.querySelector("#reader-summary"),
  readerContent: document.querySelector("#reader-content"),
  originalPreview: document.querySelector("#original-preview"),
  originalPreviewFrame: document.querySelector("#original-preview-frame"),
  readerCategory: document.querySelector("#reader-category"),
  readerFileName: document.querySelector("#reader-file-name"),
  readerFileSize: document.querySelector("#reader-file-size"),
  readerStatus: document.querySelector("#reader-status"),
  readerOcrStatus: document.querySelector("#reader-ocr-status"),
  documentOcrButton: document.querySelector("#document-ocr-button"),
  readerSource: document.querySelector("#reader-source"),
  downloadLink: document.querySelector("#download-link"),
  articleReader: document.querySelector("#article-reader"),
  articleReaderBackButton: document.querySelector("#article-reader-back-button"),
  articleSourceLink: document.querySelector("#article-source-link"),
  articleTranslationTools: document.querySelector("#article-translation-tools"),
  articleTranslationStatus: document.querySelector("#article-translation-status"),
  articleTranslationRequest: document.querySelector("#article-translation-request"),
  articleLanguageSwitch: document.querySelector("#article-language-switch"),
  articleReaderMeta: document.querySelector("#article-reader-meta"),
  articleReaderTitle: document.querySelector("#article-reader-title"),
  articleReaderOriginalTitle: document.querySelector("#article-reader-original-title"),
  articleReaderSummary: document.querySelector("#article-reader-summary"),
  articleReaderContent: document.querySelector("#article-reader-content"),
  paperTotal: document.querySelector("#paper-total"),
  paperGrid: document.querySelector("#paper-grid"),
  paperEmptyState: document.querySelector("#paper-empty-state"),
  paperSourceTabs: document.querySelector("#paper-source-tabs"),
  refreshMliPapersButton: document.querySelector("#refresh-mli-papers-button"),
  checkPaperReminderButton: document.querySelector("#check-paper-reminder-button"),
  emptyPaperReminderButton: document.querySelector("#empty-paper-reminder-button"),
  paperReminderDialog: document.querySelector("#paper-reminder-dialog"),
  paperCandidateGrid: document.querySelector("#paper-candidate-grid"),
  paperReminderCloseButton: document.querySelector("#paper-reminder-close-button"),
  paperSnoozeButton: document.querySelector("#paper-snooze-button"),
  paperDismissButton: document.querySelector("#paper-dismiss-button"),
  paperReader: document.querySelector("#paper-reader"),
  paperReaderBackButton: document.querySelector("#paper-reader-back-button"),
  paperSourceLink: document.querySelector("#paper-source-link"),
  paperPdfLink: document.querySelector("#paper-pdf-link"),
  paperVideoLink: document.querySelector("#paper-video-link"),
  paperReaderMeta: document.querySelector("#paper-reader-meta"),
  paperReaderTitle: document.querySelector("#paper-reader-title"),
  paperReaderOriginalTitle: document.querySelector("#paper-reader-original-title"),
  paperReaderAbstract: document.querySelector("#paper-reader-abstract"),
  paperReadingStatus: document.querySelector("#paper-reading-status"),
  paperReaderContent: document.querySelector("#paper-reader-content"),
  readingWorkbench: document.querySelector("#reading-workbench"),
  readingWorkbenchResizeHandle: document.querySelector("#reading-workbench-resize-handle"),
  readingWorkbenchToggle: document.querySelector("#reading-workbench-toggle"),
  readingWorkbenchClose: document.querySelector("#reading-workbench-close"),
  readingWorkbenchTabs: document.querySelector("#reading-workbench-tabs"),
  readingTocSidebar: document.querySelector("#reading-toc-sidebar"),
  readingTocToggle: document.querySelector("#reading-toc-toggle"),
  readingTocReopen: document.querySelector("#reading-toc-reopen"),
  readingToolsPanel: document.querySelector("#reading-tools-panel"),
  readingAiPanel: document.querySelector("#reading-ai-panel"),
  readingAiSourceTitle: document.querySelector("#reading-ai-source-title"),
  readingAiSelection: document.querySelector("#reading-ai-selection"),
  readingAiSelectionText: document.querySelector("#reading-ai-selection-text"),
  readingAiClearSelection: document.querySelector("#reading-ai-clear-selection"),
  readingAiMessages: document.querySelector("#reading-ai-messages"),
  readingAiForm: document.querySelector("#reading-ai-form"),
  readingAiInput: document.querySelector("#reading-ai-input"),
  readingAiSubmit: document.querySelector("#reading-ai-submit"),
  readingAiStatus: document.querySelector("#reading-ai-status"),
  readingStatusSelect: document.querySelector("#reading-status-select"),
  readingProgressLabel: document.querySelector("#reading-progress-label"),
  readingProgressBar: document.querySelector("#reading-progress-bar"),
  readingToc: document.querySelector("#reading-toc"),
  readingSelectionHint: document.querySelector("#reading-selection-hint"),
  highlightPalette: document.querySelector("#highlight-palette"),
  annotationList: document.querySelector("#annotation-list"),
  readingNoteInput: document.querySelector("#reading-note-input"),
  readingNoteStatus: document.querySelector("#reading-note-status"),
  readingFontDecrease: document.querySelector("#reading-font-decrease"),
  readingFontIncrease: document.querySelector("#reading-font-increase"),
  readingFontReset: document.querySelector("#reading-font-reset"),
  readingFontLabel: document.querySelector("#reading-font-label"),
  readingLineDecrease: document.querySelector("#reading-line-decrease"),
  readingLineIncrease: document.querySelector("#reading-line-increase"),
  readingLineReset: document.querySelector("#reading-line-reset"),
  readingLineLabel: document.querySelector("#reading-line-label"),
  readingTagForm: document.querySelector("#reading-tag-form"),
  readingTagInput: document.querySelector("#reading-tag-input"),
  readingTagList: document.querySelector("#reading-tag-list"),
  readingTopicSelect: document.querySelector("#reading-topic-select"),
  readingTopicAdd: document.querySelector("#reading-topic-add"),
  readingTopicList: document.querySelector("#reading-topic-list"),
  topicCreateForm: document.querySelector("#topic-create-form"),
  topicNameInput: document.querySelector("#topic-name-input"),
  topicDescriptionInput: document.querySelector("#topic-description-input"),
  topicGrid: document.querySelector("#topic-grid"),
  topicDetailTitle: document.querySelector("#topic-detail-title"),
  topicDetailDescription: document.querySelector("#topic-detail-description"),
  topicItemList: document.querySelector("#topic-item-list"),
  cardTotal: document.querySelector("#card-total"),
  cardDueTotal: document.querySelector("#card-due-total"),
  knowledgeCardGrid: document.querySelector("#knowledge-card-grid"),
  knowledgeCardEmpty: document.querySelector("#knowledge-card-empty"),
  reviewPosition: document.querySelector("#review-position"),
  reviewEmpty: document.querySelector("#review-empty"),
  reviewCard: document.querySelector("#review-card"),
  reviewCardType: document.querySelector("#review-card-type"),
  reviewQuestion: document.querySelector("#review-question"),
  reviewRevealButton: document.querySelector("#review-reveal-button"),
  reviewAnswer: document.querySelector("#review-answer"),
  reviewAnswerText: document.querySelector("#review-answer-text"),
  reviewSourceQuote: document.querySelector("#review-source-quote"),
  reviewOpenSource: document.querySelector("#review-open-source"),
  reviewRating: document.querySelector("#review-rating"),
  readingCardButton: document.querySelector("#reading-card-button"),
  knowledgeCardDialog: document.querySelector("#knowledge-card-dialog"),
  knowledgeCardForm: document.querySelector("#knowledge-card-form"),
  knowledgeCardCancel: document.querySelector("#knowledge-card-cancel"),
  knowledgeCardCancelFooter: document.querySelector("#knowledge-card-cancel-footer"),
  knowledgeCardType: document.querySelector("#knowledge-card-type"),
  knowledgeCardQuestion: document.querySelector("#knowledge-card-question"),
  knowledgeCardAnswer: document.querySelector("#knowledge-card-answer"),
  knowledgeCardSource: document.querySelector("#knowledge-card-source"),
  aiStatusLabel: document.querySelector("#ai-status-label"),
  aiSourceCount: document.querySelector("#ai-source-count"),
  aiSourceSearch: document.querySelector("#ai-source-search"),
  aiSourceList: document.querySelector("#ai-source-list"),
  aiQuestionForm: document.querySelector("#ai-question-form"),
  aiModeSwitch: document.querySelector("#ai-mode-switch"),
  aiQuestionInput: document.querySelector("#ai-question-input"),
  aiSubmitButton: document.querySelector("#ai-submit-button"),
  aiAnswerPanel: document.querySelector("#ai-answer-panel"),
  aiAnswerStats: document.querySelector("#ai-answer-stats"),
  aiEvidenceWarning: document.querySelector("#ai-evidence-warning"),
  aiAnswerText: document.querySelector("#ai-answer-text"),
  aiCitationList: document.querySelector("#ai-citation-list"),
  aiHistorySearch: document.querySelector("#ai-history-search"),
  aiHistoryList: document.querySelector("#ai-history-list"),
  aiHistoryDetail: document.querySelector("#ai-history-detail"),
  documentAiButton: document.querySelector("#document-ai-button"),
  articleAiButton: document.querySelector("#article-ai-button"),
  paperAiButton: document.querySelector("#paper-ai-button"),
  moveFolderDialog: document.querySelector("#move-folder-dialog"),
  moveFolderForm: document.querySelector("#move-folder-form"),
  moveFolderItemTitle: document.querySelector("#move-folder-item-title"),
  moveFolderOptions: document.querySelector("#move-folder-options"),
  moveFolderClose: document.querySelector("#move-folder-close"),
  moveFolderCancel: document.querySelector("#move-folder-cancel"),
  moveFolderConfirm: document.querySelector("#move-folder-confirm"),
  toast: document.querySelector("#toast"),
};

/**
 * 请求本地 JSON 接口并统一处理错误。
 *
 * @param {string} url 本地 API 地址。
 * @param {RequestInit} options Fetch 配置。
 * @returns {Promise<unknown>} 解析后的 JSON。
 */
async function requestJson(url, options = {}) {
  /** response 是本地服务返回的 HTTP 响应。 */
  const response = await fetch(url, { cache: "no-store", ...options });
  /** payload 是尝试解析的 JSON 正文。 */
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }
  return payload;
}

/**
 * 以适合中文阅读的格式显示文件容量。
 *
 * @param {number} bytes 文件字节数。
 * @returns {string} 格式化容量。
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 格式化 ISO 时间用于文档卡片。
 *
 * @param {string} isoValue ISO 8601 时间。
 * @returns {string} 本地日期。
 */
function formatDate(isoValue) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoValue));
}

/**
 * 显示短暂操作反馈。
 *
 * @param {string} message 提示文字。
 * @returns {void}
 */
function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  window.clearTimeout(showToast.timeoutId);
  /** timeoutId 保存当前提示的自动关闭计时器。 */
  showToast.timeoutId = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, 3200);
}
/** timeoutId 是提示组件当前的计时器 ID。 */
showToast.timeoutId = 0;

/**
 * 安全创建只含文本的 HTML 元素。
 *
 * @param {string} tagName 标签名称。
 * @param {string} className CSS 类名。
 * @param {string} textContent 文本内容。
 * @returns {HTMLElement} 新元素。
 */
function createTextElement(tagName, className, textContent) {
  /** element 是待返回的 DOM 元素。 */
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = textContent;
  return element;
}

/**
 * 判断一行文本是否适合渲染为章节标题。
 *
 * @param {string} line 当前行。
 * @param {boolean} separatedBefore 当前行前是否存在空行。
 * @param {boolean} separatedAfter 当前行后是否存在空行。
 * @returns {boolean} 是否为标题。
 */
function isReadableHeading(line, separatedBefore, separatedAfter) {
  if (
    /^(第[一二三四五六七八九十百\d]+[章节部分]|chapter\s+\d+|part\s*\d+|\d+(?:\.\d+){0,3}[\s、.])/i.test(
      line,
    )
  ) {
    return true;
  }
  /** endsLikeSentence 表示当前行以完整句子的常见标点结束。 */
  const endsLikeSentence = /[。！？；，、.!?;,：:]$/.test(line);
  return (
    line.length >= 2 &&
    line.length <= 30 &&
    !endsLikeSentence &&
    separatedBefore &&
    separatedAfter
  );
}

/**
 * 把 PDF 中被压成一行的密集文字重新切分为可阅读段落。
 *
 * @param {string} text 待拆分的长文本。
 * @returns {string[]} 长度受控的段落列表。
 */
function splitDenseText(text) {
  /** markedText 在常见章节编号前补充结构边界。 */
  const markedText = text
    .replace(/\s+(?=Part\s*\d+\b)/gi, "\n")
    .replace(
      /\s+(?=(?:第[一二三四五六七八九十百\d]+[章节部分]|[一二三四五六七八九十]+、|\d+[.、]\s*[\u4e00-\u9fffA-Z]))/g,
      "\n",
    );
  /** structuralSections 是按编号和章节标记拆开的候选区域。 */
  const structuralSections = markedText
    .split("\n")
    .map((section) => section.trim())
    .filter(Boolean);
  /** outputBlocks 保存最终长度受控的自然段。 */
  const outputBlocks = [];
  /** sentenceSegmenter 使用浏览器的中文句子边界识别能力。 */
  const sentenceSegmenter = new Intl.Segmenter("zh-CN", {
    granularity: "sentence",
  });

  /**
   * 将无法按句号拆开的超长片段按就近标点或空格切开。
   *
   * @param {string} source 超长片段。
   * @returns {string[]} 较短片段。
   */
  function splitOversizedSegment(source) {
    /** chunks 是从超长片段中依次切出的文本块。 */
    const chunks = [];
    /** remaining 是尚未切分的剩余文本。 */
    let remaining = source.trim();
    while (remaining.length > 190) {
      /** searchWindow 是本次寻找理想切点的前部窗口。 */
      const searchWindow = remaining.slice(0, 190);
      /** candidateOffsets 是优先使用的中文标点和词间空格位置。 */
      const candidateOffsets = [
        searchWindow.lastIndexOf("；"),
        searchWindow.lastIndexOf("。"),
        searchWindow.lastIndexOf("，"),
        searchWindow.lastIndexOf("："),
        searchWindow.lastIndexOf(" "),
      ];
      /** splitOffset 是距离目标长度最近且不会产生过短段落的切点。 */
      const splitOffset =
        Math.max(...candidateOffsets.filter((offset) => offset >= 90)) || 150;
      chunks.push(remaining.slice(0, splitOffset + 1).trim());
      remaining = remaining.slice(splitOffset + 1).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  for (const section of structuralSections) {
    /** sentences 是当前结构区域内的句子列表。 */
    const sentences = [...sentenceSegmenter.segment(section)].flatMap(
      (segment) => splitOversizedSegment(segment.segment),
    );
    /** pendingBlock 是正在组合的短句段落。 */
    let pendingBlock = "";
    for (const sentence of sentences) {
      /** combinedLength 是把当前句加入段落后的长度。 */
      const combinedLength = pendingBlock.length + sentence.length;
      if (pendingBlock && combinedLength > 190) {
        outputBlocks.push(pendingBlock.trim());
        pendingBlock = sentence;
      } else {
        pendingBlock += sentence;
      }
    }
    if (pendingBlock.trim()) outputBlocks.push(pendingBlock.trim());
  }
  return outputBlocks;
}

/**
 * 判断文本块是否主要由统计数字、百分比和英文技能名称组成。
 *
 * @param {string} text 待判断文本。
 * @returns {boolean} 是否为高密度数据块。
 */
function isDenseDataBlock(text) {
  if (text.length < 90) return false;
  /** numericCharacters 是数字和百分号数量。 */
  const numericCharacters = (text.match(/[\d%+]/g) ?? []).length;
  /** latinCharacters 是英文字符数量。 */
  const latinCharacters = (text.match(/[A-Za-z]/g) ?? []).length;
  return (numericCharacters + latinCharacters) / text.length > 0.42;
}

/**
 * 把 PDF/文本提取结果重新组织为安全的语义化阅读结构。
 *
 * @param {string} text 文档提取正文。
 * @returns {DocumentFragment} 只包含安全文本节点的阅读内容。
 */
function createReadableDocument(text) {
  /** fragment 是最终插入阅读页的文档片段。 */
  const fragment = document.createDocumentFragment();
  /** normalizedLines 是保留空行但清理行内多余空白的正文行。 */
  const normalizedLines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  /** paragraphLines 暂存属于同一自然段的连续行。 */
  let paragraphLines = [];

  /**
   * 把暂存行合并为一个自然段。
   *
   * @returns {void}
   */
  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    /** paragraphText 是修复 PDF 强制换行后的自然段正文。 */
    const paragraphText = paragraphLines
      .reduce((combinedText, currentLine) => {
        if (!combinedText) return currentLine;
        /** needsSpace 用于保留英文单词跨 PDF 行连接时的自然间隔。 */
        const needsSpace =
          /[A-Za-z0-9]$/.test(combinedText) && /^[A-Za-z0-9]/.test(currentLine);
        return `${combinedText}${needsSpace ? " " : ""}${currentLine}`;
      }, "")
      .trim();
    if (paragraphText) {
      /** readableBlocks 是从可能很长的 PDF 行中恢复出的短段落。 */
      const readableBlocks = splitDenseText(paragraphText);
      for (const block of readableBlocks) {
        if (isReadableHeading(block, true, true)) {
          /** markdownHeading 是当前标题可能携带的 Markdown 层级标记。 */
          const markdownHeading = block.match(/^(#{1,4})\s+(.+)$/);
          /** headingLevel 是在阅读页主标题之下使用的安全标题层级。 */
          const headingLevel = markdownHeading
            ? Math.min(4, markdownHeading[1].length + 1)
            : 2;
          /** headingText 是移除 Markdown 井号后的干净标题。 */
          const headingText = markdownHeading?.[2]?.trim() || block;
          fragment.append(createTextElement(`h${headingLevel}`, "", headingText));
        } else if (isDenseDataBlock(block)) {
          fragment.append(createTextElement("div", "readable-data-block", block));
        } else {
          fragment.append(createTextElement("p", "", block));
        }
      }
    }
    paragraphLines = [];
  }

  for (const [index, line] of normalizedLines.entries()) {
    /** previousLine 是判断章节间距使用的上一行。 */
    const previousLine = normalizedLines[index - 1] ?? "";
    /** nextLine 是判断章节间距使用的下一行。 */
    const nextLine = normalizedLines[index + 1] ?? "";
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^\d+\s*\/\s*\d+$/.test(line)) {
      flushParagraph();
      fragment.append(createTextElement("div", "page-divider", `第 ${line} 页`));
      continue;
    }
    if (/^[•●▪◦\-–—]\s+/.test(line)) {
      flushParagraph();
      /** listItem 是单独展示的项目符号内容。 */
      const listItem = createTextElement(
        "div",
        "readable-list-item",
        line.replace(/^[•●▪◦\-–—]\s+/, ""),
      );
      fragment.append(listItem);
      continue;
    }
    if (isReadableHeading(line, !previousLine, !nextLine)) {
      flushParagraph();
      /** markdownHeading 是当前标题可能携带的 Markdown 层级标记。 */
      const markdownHeading = line.match(/^(#{1,4})\s+(.+)$/);
      /** headingLevel 是在阅读页主标题之下使用的安全标题层级。 */
      const headingLevel = markdownHeading
        ? Math.min(4, markdownHeading[1].length + 1)
        : 2;
      /** headingText 是移除 Markdown 井号后的干净标题。 */
      const headingText = markdownHeading?.[2]?.trim() || line;
      fragment.append(createTextElement(`h${headingLevel}`, "", headingText));
      continue;
    }
    if (/^\d+(?:\.\d+)?%$/.test(line)) {
      flushParagraph();
      fragment.append(createTextElement("strong", "readable-stat", line));
      continue;
    }
    paragraphLines.push(line);
    if (
      /[。！？；.!?;]$/.test(line) ||
      paragraphLines.join("").length >= 180
    ) {
      flushParagraph();
    }
  }
  flushParagraph();
  if (!fragment.childNodes.length) {
    fragment.append(
      createTextElement(
        "p",
        "readable-empty",
        "这类文件暂未提取出可阅读正文，请使用原版预览或下载原文件。",
      ),
    );
  }
  return fragment;
}

/**
 * 将 Word 转换结果按安全标签白名单重建为阅读页面。
 *
 * @param {string} rawHtml 服务端从 DOCX 提取的结构化 HTML。
 * @returns {DocumentFragment} 仅保留安全标签与属性的 Word 正文。
 */
function createWordDocument(rawHtml) {
  /** parsedDocument 是隔离解析后的 Word HTML 文档。 */
  const parsedDocument = new DOMParser().parseFromString(rawHtml, "text/html");
  /** fragment 是准备插入页面的安全 Word 内容。 */
  const fragment = document.createDocumentFragment();
  /** allowedTags 是 Word 阅读页允许保留的语义标签。 */
  const allowedTags = new Set([
    "P",
    "H1",
    "H2",
    "H3",
    "H4",
    "UL",
    "OL",
    "LI",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TH",
    "TD",
    "STRONG",
    "EM",
    "U",
    "S",
    "BR",
    "IMG",
    "A",
  ]);

  /**
   * 递归复制单个安全节点；未知标签只保留其文本和安全子节点。
   *
   * @param {Node} sourceNode 隔离文档中的原节点。
   * @param {Node} targetParent 当前安全父节点。
   * @returns {void}
   */
  function appendSafeNode(sourceNode, targetParent) {
    if (sourceNode.nodeType === Node.TEXT_NODE) {
      targetParent.append(document.createTextNode(sourceNode.textContent || ""));
      return;
    }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE) return;
    /** sourceElement 是便于读取标签和属性的元素节点。 */
    const sourceElement = /** @type {Element} */ (sourceNode);
    /** tagName 是统一为大写的元素标签。 */
    const tagName = sourceElement.tagName.toUpperCase();
    if (!allowedTags.has(tagName)) {
      for (const childNode of sourceElement.childNodes) {
        appendSafeNode(childNode, targetParent);
      }
      return;
    }
    /** safeElement 是新建的无危险属性元素。 */
    const safeElement = document.createElement(tagName.toLowerCase());
    if (["TD", "TH"].includes(tagName)) {
      for (const attributeName of ["colspan", "rowspan"]) {
        /** attributeValue 是 Word 表格中合法的合并单元格数量。 */
        const attributeValue = sourceElement.getAttribute(attributeName);
        if (/^\d{1,2}$/.test(attributeValue || "")) {
          safeElement.setAttribute(attributeName, attributeValue);
        }
      }
    }
    if (tagName === "IMG") {
      /** imageSource 仅允许 Mammoth 生成的本地内嵌图片。 */
      const imageSource = sourceElement.getAttribute("src") || "";
      if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(imageSource)) return;
      safeElement.setAttribute("src", imageSource);
      safeElement.setAttribute("alt", sourceElement.getAttribute("alt") || "");
    }
    if (tagName === "A") {
      /** linkTarget 仅允许普通网页链接。 */
      const linkTarget = sourceElement.getAttribute("href") || "";
      if (/^https?:\/\//i.test(linkTarget)) {
        safeElement.setAttribute("href", linkTarget);
        safeElement.setAttribute("target", "_blank");
        safeElement.setAttribute("rel", "noopener noreferrer");
      }
    }
    for (const childNode of sourceElement.childNodes) {
      appendSafeNode(childNode, safeElement);
    }
    targetParent.append(safeElement);
  }

  for (const childNode of parsedDocument.body.childNodes) {
    appendSafeNode(childNode, fragment);
  }
  return fragment;
}

/**
 * 更新阅读工作台中的进度文字和进度条。
 *
 * @param {number} progressPercent 当前阅读百分比。
 * @returns {void}
 */
function renderReadingProgress(progressPercent) {
  /** normalizedProgress 是限制到 0 至 100 的整数百分比。 */
  const normalizedProgress = Math.round(
    Math.min(100, Math.max(0, Number(progressPercent) || 0)),
  );
  dom.readingProgressLabel.textContent = `${normalizedProgress}%`;
  dom.readingProgressBar.style.width = `${normalizedProgress}%`;
}

/**
 * 显示或收起固定在阅读页右侧的工作台。
 *
 * @param {boolean} expanded 是否展开工作台。
 * @returns {void}
 */
function setReadingWorkbenchExpanded(expanded) {
  dom.readingWorkbench.hidden = !expanded;
  dom.readingWorkbenchToggle.hidden = expanded;
  dom.readingWorkbenchToggle.setAttribute("aria-expanded", String(expanded));
  dom.readingWorkbenchClose.textContent = "⇥";
  document.body.classList.toggle("has-reading-workbench", expanded);
  try {
    window.localStorage.setItem("zhixu-reading-sidebar-expanded", String(expanded));
  } catch (error) {}
}

/**
 * 展开或收起正文左侧的独立目录，并保存个人阅读偏好。
 *
 * @param {boolean} expanded 是否完整显示文章目录。
 * @returns {void}
 */
function setReadingTocExpanded(expanded) {
  applicationState.readingTocExpanded = Boolean(expanded);
  dom.readingTocSidebar.hidden = !expanded;
  dom.readingTocReopen.hidden = expanded;
  dom.readingTocReopen.setAttribute("aria-expanded", String(expanded));
  dom.readingTocToggle.textContent = "⇤";
  dom.readingTocToggle.setAttribute("aria-expanded", String(expanded));
  dom.readingTocToggle.setAttribute("aria-label", "收起文章目录");
  dom.readingTocToggle.title = "收起文章目录";
  document.body.classList.toggle("has-reading-toc", expanded);
  try {
    window.localStorage.setItem("zhixu-reading-toc-expanded", String(expanded));
  } catch (error) {}
}

/** readingWorkbenchMinimumWidth 是桌面端侧栏允许的最小宽度。 */
const readingWorkbenchMinimumWidth = 320;
/** readingWorkbenchMaximumWidth 是桌面端侧栏允许的最大宽度。 */
const readingWorkbenchMaximumWidth = 760;
/** readingWorkbenchDefaultWidth 是首次使用阅读工作台时的默认宽度。 */
const readingWorkbenchDefaultWidth = 420;

/**
 * 应用阅读工作台宽度，并按需保存到当前浏览器。
 *
 * @param {number} requestedWidth 用户拖动或键盘操作得到的目标宽度。
 * @param {boolean} persist 是否写入本地偏好。
 * @returns {number} 实际采用的宽度。
 */
function applyReadingWorkbenchWidth(requestedWidth, persist = true) {
  /** viewportMaximum 是当前窗口仍能保留正文空间的最大宽度。 */
  const viewportMaximum = Math.max(
    readingWorkbenchMinimumWidth,
    Math.min(readingWorkbenchMaximumWidth, window.innerWidth - 88),
  );
  /** normalizedWidth 是经过最小值、最大值与整数化处理的宽度。 */
  const normalizedWidth = Math.round(Math.min(
    Math.max(Number(requestedWidth) || readingWorkbenchDefaultWidth, readingWorkbenchMinimumWidth),
    viewportMaximum,
  ));
  applicationState.readingWorkbenchWidth = normalizedWidth;
  document.documentElement.style.setProperty("--reading-workbench-width", `${normalizedWidth}px`);
  dom.readingWorkbenchResizeHandle.setAttribute("aria-valuemin", String(readingWorkbenchMinimumWidth));
  dom.readingWorkbenchResizeHandle.setAttribute("aria-valuemax", String(viewportMaximum));
  dom.readingWorkbenchResizeHandle.setAttribute("aria-valuenow", String(normalizedWidth));
  if (persist) {
    try {
      window.localStorage.setItem("zhixu-reading-workbench-width", String(normalizedWidth));
    } catch (error) {}
  }
  return normalizedWidth;
}

/**
 * 启用阅读工作台左边缘拖动与键盘调宽。
 *
 * @returns {void}
 */
function setupReadingWorkbenchResize() {
  /** savedWidth 是浏览器中保存的上次侧栏宽度。 */
  let savedWidth = readingWorkbenchDefaultWidth;
  try {
    savedWidth = Number(window.localStorage.getItem("zhixu-reading-workbench-width"))
      || readingWorkbenchDefaultWidth;
  } catch (error) {}
  applyReadingWorkbenchWidth(savedWidth, false);
  /** activePointerId 是当前拖动侧栏的指针编号。 */
  let activePointerId = null;
  /** dragStartX 是开始拖动时的横向坐标。 */
  let dragStartX = 0;
  /** dragStartWidth 是开始拖动时的侧栏宽度。 */
  let dragStartWidth = savedWidth;
  dom.readingWorkbenchResizeHandle.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 720) return;
    activePointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartWidth = applicationState.readingWorkbenchWidth;
    dom.readingWorkbenchResizeHandle.setPointerCapture(event.pointerId);
    dom.readingWorkbench.classList.add("is-resizing");
    event.preventDefault();
  });
  dom.readingWorkbenchResizeHandle.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) return;
    applyReadingWorkbenchWidth(dragStartWidth + dragStartX - event.clientX, false);
  });
  /** finishResize 完成拖动并持久化最后的宽度。 */
  const finishResize = (event) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    dom.readingWorkbench.classList.remove("is-resizing");
    applyReadingWorkbenchWidth(applicationState.readingWorkbenchWidth, true);
  };
  dom.readingWorkbenchResizeHandle.addEventListener("pointerup", finishResize);
  dom.readingWorkbenchResizeHandle.addEventListener("pointercancel", finishResize);
  dom.readingWorkbenchResizeHandle.addEventListener("keydown", (event) => {
    /** keyboardStep 是每次方向键操作调整的像素数。 */
    const keyboardStep = event.shiftKey ? 48 : 24;
    if (event.key === "ArrowLeft") {
      applyReadingWorkbenchWidth(applicationState.readingWorkbenchWidth + keyboardStep, true);
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      applyReadingWorkbenchWidth(applicationState.readingWorkbenchWidth - keyboardStep, true);
      event.preventDefault();
    }
  });
  window.addEventListener("resize", () => {
    applyReadingWorkbenchWidth(applicationState.readingWorkbenchWidth, false);
  });
}

/**
 * 切换阅读工作台中的阅读工具与 AI 问答页签。
 *
 * @param {"tools" | "ai"} tabName 目标页签。
 * @returns {void}
 */
function setReadingWorkbenchTab(tabName) {
  /** normalizedTab 是经过白名单确认的工作台页签。 */
  const normalizedTab = tabName === "ai" ? "ai" : "tools";
  dom.readingToolsPanel.hidden = normalizedTab !== "tools";
  dom.readingAiPanel.hidden = normalizedTab !== "ai";
  for (const button of dom.readingWorkbenchTabs.querySelectorAll("button")) {
    button.classList.toggle("is-active", button.dataset.workbenchTab === normalizedTab);
  }
  if (normalizedTab === "ai") dom.readingAiInput.focus();
}

/**
 * 隐藏阅读工作台并清除当前阅读上下文。
 *
 * @returns {void}
 */
function closeReadingWorkspace() {
  if (applicationState.readingWorkspace) {
    void saveReadingState({ noteText: dom.readingNoteInput.value });
  }
  window.clearTimeout(applicationState.readingProgressTimer);
  window.clearTimeout(applicationState.readingNoteTimer);
  window.clearTimeout(applicationState.paperTranslationPollTimer);
  applicationState.paperTranslationPollTimer = null;
  applicationState.readingWorkspace = null;
  applicationState.activeReadingSurface = null;
  applicationState.pendingReadingSelection = null;
  applicationState.readingAiSelection = null;
  applicationState.readingAiConversationId = "";
  dom.readingWorkbench.hidden = true;
  dom.readingWorkbenchToggle.hidden = true;
  dom.readingTocSidebar.hidden = true;
  dom.readingTocReopen.hidden = true;
  dom.readingToc.replaceChildren();
  dom.annotationList.replaceChildren();
  dom.readingTagList.replaceChildren();
  dom.readingTopicList.replaceChildren();
  applicationState.contentOrganization = null;
  dom.readingNoteInput.value = "";
  dom.readingAiMessages.replaceChildren(
    createTextElement("p", "reading-ai-empty", "你可以询问整篇内容，也可以先在正文中选择术语、句子或段落再提问。"),
  );
  dom.readingAiSelection.hidden = true;
  setReadingWorkbenchTab("tools");
  document.body.classList.remove("has-reading-workbench");
  document.body.classList.remove("has-reading-toc");
}

/** readingFontMinimum 是允许的最小正文字号。 */
const readingFontMinimum = 14;
/** readingFontMaximum 是允许的最大正文字号。 */
const readingFontMaximum = 24;
/** readingFontDefault 是首次使用时的正文字号。 */
const readingFontDefault = 18;
/** readingLineMinimum 是用户可选择的最紧凑正文行距。 */
const readingLineMinimum = 1.5;
/** readingLineMaximum 是用户可选择的最宽松正文行距。 */
const readingLineMaximum = 2.3;
/** readingLineStep 是每次点击调整的行距步长。 */
const readingLineStep = 0.1;
/** readingLineDefault 是首次使用和重置时采用的正文行距。 */
const readingLineDefault = 1.9;

/**
 * 应用并记住用户选择的阅读正文字号。
 *
 * @param {number} requestedSize 用户期望的像素字号。
 * @returns {void}
 */
function applyReadingFontSize(requestedSize) {
  /** fontSize 是限制到舒适范围内的整数像素值。 */
  const fontSize = Math.min(readingFontMaximum, Math.max(readingFontMinimum, Math.round(requestedSize)));
  applicationState.readingFontSize = fontSize;
  document.documentElement.style.setProperty("--reading-font-size", `${fontSize}px`);
  dom.readingFontLabel.textContent = `${fontSize}px`;
  try {
    window.localStorage.setItem("zhixu-reading-font-size", String(fontSize));
  } catch (error) {}
}

/**
 * 从浏览器本地偏好初始化阅读字号。
 *
 * @returns {void}
 */
function setupReadingFontSize() {
  /** savedSize 是上次保存的字号，读取失败时使用默认值。 */
  let savedSize = readingFontDefault;
  try {
    savedSize = Number(window.localStorage.getItem("zhixu-reading-font-size")) || readingFontDefault;
  } catch (error) {}
  applyReadingFontSize(savedSize);
  dom.readingFontDecrease.addEventListener("click", () => applyReadingFontSize(applicationState.readingFontSize - 1));
  dom.readingFontIncrease.addEventListener("click", () => applyReadingFontSize(applicationState.readingFontSize + 1));
  dom.readingFontReset.addEventListener("click", () => applyReadingFontSize(readingFontDefault));
}

/**
 * 应用并记住用户选择的阅读正文行距。
 *
 * @param {number} requestedLineHeight 用户期望的无单位行高。
 * @returns {void}
 */
function applyReadingLineHeight(requestedLineHeight) {
  /** lineHeight 是限制到舒适范围并保留一位小数的行距。 */
  const lineHeight = Number(
    Math.min(
      readingLineMaximum,
      Math.max(readingLineMinimum, requestedLineHeight),
    ).toFixed(1),
  );
  applicationState.readingLineHeight = lineHeight;
  document.documentElement.style.setProperty(
    "--reading-line-height",
    String(lineHeight),
  );
  dom.readingLineLabel.textContent = lineHeight.toFixed(1);
  try {
    window.localStorage.setItem("zhixu-reading-line-height", String(lineHeight));
  } catch (error) {}
}

/**
 * 从浏览器本地偏好初始化阅读行距。
 *
 * @returns {void}
 */
function setupReadingLineHeight() {
  /** savedLineHeight 是上次保存的行距，读取失败时使用默认值。 */
  let savedLineHeight = readingLineDefault;
  try {
    savedLineHeight =
      Number(window.localStorage.getItem("zhixu-reading-line-height")) ||
      readingLineDefault;
  } catch (error) {}
  applyReadingLineHeight(savedLineHeight);
  dom.readingLineDecrease.addEventListener("click", () =>
    applyReadingLineHeight(applicationState.readingLineHeight - readingLineStep),
  );
  dom.readingLineIncrease.addEventListener("click", () =>
    applyReadingLineHeight(applicationState.readingLineHeight + readingLineStep),
  );
  dom.readingLineReset.addEventListener("click", () =>
    applyReadingLineHeight(readingLineDefault),
  );
}

/**
 * 渲染当前阅读内容的标签和专题关系。
 *
 * @returns {void}
 */
function renderContentOrganization() {
  /** organization 是当前阅读内容的组织信息。 */
  const organization = applicationState.contentOrganization ?? { tags: [], topics: [] };
  dom.readingTagList.replaceChildren();
  for (const tagName of organization.tags) {
    /** chip 是可以移除的内容标签。 */
    const chip = createTextElement("button", "reading-chip", `${tagName} ×`);
    chip.type = "button";
    chip.addEventListener("click", () => {
      void removeCurrentContentTag(tagName).catch((error) => showToast(error.message));
    });
    dom.readingTagList.append(chip);
  }
  dom.readingTopicList.replaceChildren();
  for (const topic of organization.topics) {
    /** chip 是可以移除的专题关联。 */
    const chip = createTextElement("button", "reading-chip is-topic", `${topic.name} ×`);
    chip.type = "button";
    chip.addEventListener("click", () => {
      void removeCurrentTopic(topic.id).catch((error) => showToast(error.message));
    });
    dom.readingTopicList.append(chip);
  }
  /** associatedIds 是当前内容已经加入的专题 ID。 */
  const associatedIds = new Set(organization.topics.map((topic) => topic.id));
  dom.readingTopicSelect.replaceChildren(new Option("选择专题", ""));
  for (const topic of applicationState.topics.filter((item) => !associatedIds.has(item.id))) {
    dom.readingTopicSelect.append(new Option(topic.name, topic.id));
  }
}

/**
 * 加载当前阅读内容的标签与专题。
 *
 * @returns {Promise<void>}
 */
async function loadContentOrganization() {
  /** workspace 是当前阅读上下文。 */
  const workspace = applicationState.readingWorkspace;
  if (!workspace) return;
  /** query 是组织关系接口参数。 */
  const query = new URLSearchParams({ targetType: workspace.targetType, targetId: workspace.targetId });
  /** payload 是内容组织接口响应。 */
  const payload = await requestJson(`/api/content-organization?${query}`);
  applicationState.contentOrganization = payload.organization;
  renderContentOrganization();
}

/**
 * 为当前阅读内容添加标签。
 *
 * @returns {Promise<void>}
 */
async function addCurrentContentTag() {
  /** workspace 是当前阅读上下文。 */
  const workspace = applicationState.readingWorkspace;
  /** tagName 是用户输入的标签名称。 */
  const tagName = dom.readingTagInput.value.trim();
  if (!workspace || !tagName) return;
  await requestJson("/api/content-tags", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetType: workspace.targetType, targetId: workspace.targetId, tagName }) });
  dom.readingTagInput.value = "";
  await Promise.all([loadContentOrganization(), loadLibrary()]);
}

/**
 * 移除当前内容的一个标签。
 *
 * @param {string} tagName 标签名称。
 * @returns {Promise<void>}
 */
async function removeCurrentContentTag(tagName) {
  /** workspace 是当前阅读上下文。 */
  const workspace = applicationState.readingWorkspace;
  if (!workspace) return;
  /** query 是删除标签关联所需参数。 */
  const query = new URLSearchParams({ targetType: workspace.targetType, targetId: workspace.targetId, tagName });
  await requestJson(`/api/content-tags?${query}`, { method: "DELETE" });
  await Promise.all([loadContentOrganization(), loadLibrary()]);
}

/**
 * 将当前阅读内容加入选定专题。
 *
 * @returns {Promise<void>}
 */
async function addCurrentTopic() {
  /** workspace 是当前阅读上下文。 */
  const workspace = applicationState.readingWorkspace;
  /** topicId 是用户选择的专题 ID。 */
  const topicId = dom.readingTopicSelect.value;
  if (!workspace || !topicId) return;
  await requestJson("/api/topic-items", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topicId, targetType: workspace.targetType, targetId: workspace.targetId }) });
  await Promise.all([loadContentOrganization(), loadTopics()]);
}

/**
 * 将当前阅读内容移出指定专题。
 *
 * @param {string} topicId 专题 ID。
 * @returns {Promise<void>}
 */
async function removeCurrentTopic(topicId) {
  /** workspace 是当前阅读上下文。 */
  const workspace = applicationState.readingWorkspace;
  if (!workspace) return;
  /** query 是删除专题关联所需参数。 */
  const query = new URLSearchParams({ topicId, targetType: workspace.targetType, targetId: workspace.targetId });
  await requestJson(`/api/topic-items?${query}`, { method: "DELETE" });
  await Promise.all([loadContentOrganization(), loadTopics()]);
}

/**
 * 根据正文标题建立可点击目录。
 *
 * @param {HTMLElement} readingSurface 当前正文根节点。
 * @returns {void}
 */
function buildReadingTableOfContents(readingSurface) {
  dom.readingToc.replaceChildren();
  /** headings 是正文中可进入目录的二至四级标题。 */
  const headings = Array.from(readingSurface.querySelectorAll("h1, h2, h3, h4"))
    .filter((heading) => heading.textContent.trim());
  if (headings.length === 0) {
    dom.readingToc.append(
      createTextElement("p", "reading-toc-empty", "当前正文没有可识别的章节标题。"),
    );
    return;
  }
  headings.forEach((heading, index) => {
    if (!heading.id) heading.id = `reading-section-${index + 1}`;
    /** tocButton 是跳转到单个章节标题的目录按钮。 */
    const tocButton = document.createElement("button");
    tocButton.type = "button";
    tocButton.className = `reading-toc-level-${heading.tagName.toLowerCase()}`;
    tocButton.textContent = heading.textContent.trim().slice(0, 90);
    tocButton.addEventListener("click", () => {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    dom.readingToc.append(tocButton);
  });
}

/**
 * 计算当前窗口在正文中的阅读百分比。
 *
 * @returns {number} 0 至 100 的阅读进度。
 */
function calculateReadingProgress() {
  /** readingSurface 是当前正在阅读的正文根节点。 */
  const readingSurface = applicationState.activeReadingSurface;
  if (!readingSurface || readingSurface.hidden || readingSurface.offsetParent === null) {
    return Number(applicationState.readingWorkspace?.state?.progressPercent ?? 0);
  }
  /** surfaceRectangle 是正文相对视口的位置和尺寸。 */
  const surfaceRectangle = readingSurface.getBoundingClientRect();
  /** surfaceTop 是正文顶部相对整个页面的纵向位置。 */
  const surfaceTop = window.scrollY + surfaceRectangle.top;
  /** readableDistance 是从正文顶部到正文末尾可滚动的距离。 */
  const readableDistance = Math.max(1, readingSurface.scrollHeight - window.innerHeight * 0.35);
  /** currentDistance 是阅读焦点进入正文后的纵向距离。 */
  const currentDistance = window.scrollY + window.innerHeight * 0.35 - surfaceTop;
  return Math.min(100, Math.max(0, (currentDistance / readableDistance) * 100));
}

/**
 * 把局部阅读状态写入本地数据库，并同步当前界面状态。
 *
 * @param {Record<string, unknown>} changes 本次需要保存的字段。
 * @returns {Promise<void>}
 */
async function saveReadingState(changes) {
  /** workspace 是调用发生时对应的阅读上下文快照。 */
  const workspace = applicationState.readingWorkspace;
  if (!workspace) return;
  try {
    /** payload 是服务端返回的最新阅读状态。 */
    const payload = await requestJson("/api/reading-workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: workspace.targetType,
        targetId: workspace.targetId,
        ...changes,
      }),
    });
    /** currentWorkspace 是网络响应返回时仍然打开的阅读上下文。 */
    const currentWorkspace = applicationState.readingWorkspace;
    if (
      currentWorkspace?.targetType === workspace.targetType &&
      currentWorkspace?.targetId === workspace.targetId
    ) {
      currentWorkspace.state = payload.state;
      dom.readingStatusSelect.value = payload.state.status;
      renderReadingProgress(payload.state.progressPercent);
    }
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 合并连续滚动事件，并在用户停顿后保存阅读进度。
 *
 * @returns {void}
 */
function scheduleReadingProgressSave() {
  if (!applicationState.readingWorkspace) return;
  /** progressPercent 是当前滚动位置对应的阅读进度。 */
  const progressPercent = calculateReadingProgress();
  renderReadingProgress(progressPercent);
  window.clearTimeout(applicationState.readingProgressTimer);
  applicationState.readingProgressTimer = window.setTimeout(() => {
    /** currentState 是保存前的阅读状态。 */
    const currentState = applicationState.readingWorkspace?.state;
    if (!currentState) return;
    /** nextStatus 是开始阅读后自动从“未读”进入“阅读中”的状态。 */
    const nextStatus =
      currentState.status === "unread" && progressPercent >= 2
        ? "reading"
        : currentState.status;
    void saveReadingState({ progressPercent, status: nextStatus });
  }, 550);
}

/**
 * 恢复上次保存的阅读位置。
 *
 * @param {number} progressPercent 已保存的阅读百分比。
 * @returns {void}
 */
function restoreReadingProgress(progressPercent) {
  /** readingSurface 是当前正文根节点。 */
  const readingSurface = applicationState.activeReadingSurface;
  /** normalizedProgress 是可用于定位的阅读百分比。 */
  const normalizedProgress = Math.min(100, Math.max(0, Number(progressPercent) || 0));
  if (!readingSurface || normalizedProgress < 1) return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      /** surfaceRectangle 是恢复时正文相对视口的位置和高度。 */
      const surfaceRectangle = readingSurface.getBoundingClientRect();
      /** surfaceTop 是正文顶部相对页面的位置。 */
      const surfaceTop = window.scrollY + surfaceRectangle.top;
      /** readableDistance 是正文可用于按百分比定位的长度。 */
      const readableDistance = Math.max(
        1,
        readingSurface.scrollHeight - window.innerHeight * 0.35,
      );
      /** targetTop 是还原后的页面滚动位置。 */
      const targetTop =
        surfaceTop + readableDistance * (normalizedProgress / 100) - window.innerHeight * 0.35;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
    });
  });
}

/**
 * 移除正文中已经渲染的高亮标签，同时保留其中原文。
 *
 * @param {HTMLElement} readingSurface 当前正文根节点。
 * @returns {void}
 */
function clearRenderedHighlights(readingSurface) {
  for (const highlight of readingSurface.querySelectorAll("mark.reading-highlight")) {
    highlight.replaceWith(...highlight.childNodes);
  }
  readingSurface.normalize();
}

/**
 * 把单个纯文本节点区间包裹为可点击高亮。
 *
 * @param {Text} textNode 原始文本节点。
 * @param {number} localStart 节点内起始位置。
 * @param {number} localEnd 节点内结束位置。
 * @param {Record<string, unknown>} annotation 批注数据。
 * @returns {void}
 */
function wrapTextSegment(textNode, localStart, localEnd, annotation) {
  if (localEnd <= localStart) return;
  /** afterNode 是高亮区间之后的文本节点。 */
  const afterNode = textNode.splitText(localEnd);
  /** selectedNode 是切分后恰好对应高亮区间的文本节点。 */
  const selectedNode = textNode.splitText(localStart);
  /** highlight 是呈现颜色和批注关联的语义标记。 */
  const highlight = document.createElement("mark");
  highlight.className = `reading-highlight is-${annotation.color}`;
  highlight.dataset.annotationId = annotation.id;
  highlight.title = annotation.noteText || "点击查看批注";
  highlight.append(selectedNode);
  afterNode.parentNode.insertBefore(highlight, afterNode);
}

/**
 * 根据纯文本字符位置在正文中重新绘制全部高亮。
 *
 * @returns {void}
 */
function applyReadingHighlights() {
  /** readingSurface 是当前正文根节点。 */
  const readingSurface = applicationState.activeReadingSurface;
  /** annotations 是当前内容全部高亮批注。 */
  const annotations = applicationState.readingWorkspace?.annotations ?? [];
  if (!readingSurface) return;
  clearRenderedHighlights(readingSurface);
  /** orderedAnnotations 按起点倒序处理，减少前部 DOM 切分对后部锚点的影响。 */
  const orderedAnnotations = [...annotations].sort(
    (left, right) => right.anchorStart - left.anchorStart,
  );
  for (const annotation of orderedAnnotations) {
    /** walker 遍历正文中全部纯文本节点。 */
    const walker = document.createTreeWalker(readingSurface, NodeFilter.SHOW_TEXT);
    /** textSegments 保存与当前高亮区间相交的节点片段。 */
    const textSegments = [];
    /** absoluteOffset 记录当前文本节点在正文纯文本中的起始位置。 */
    let absoluteOffset = 0;
    /** textNode 是遍历过程中当前处理的文本节点。 */
    let textNode = walker.nextNode();
    while (textNode) {
      /** nodeLength 是当前文本节点字符数。 */
      const nodeLength = textNode.data.length;
      /** nodeEnd 是当前节点在正文纯文本中的结束位置。 */
      const nodeEnd = absoluteOffset + nodeLength;
      /** intersectionStart 是高亮与当前节点相交后的局部起点。 */
      const intersectionStart = Math.max(annotation.anchorStart, absoluteOffset);
      /** intersectionEnd 是高亮与当前节点相交后的局部终点。 */
      const intersectionEnd = Math.min(annotation.anchorEnd, nodeEnd);
      if (intersectionEnd > intersectionStart) {
        textSegments.push({
          textNode,
          localStart: intersectionStart - absoluteOffset,
          localEnd: intersectionEnd - absoluteOffset,
        });
      }
      absoluteOffset = nodeEnd;
      textNode = walker.nextNode();
    }
    for (const segment of textSegments.reverse()) {
      wrapTextSegment(
        segment.textNode,
        segment.localStart,
        segment.localEnd,
        annotation,
      );
    }
  }
}

/**
 * 捕获正文选区，并转换为不依赖 DOM 标签层级的字符位置。
 *
 * @returns {void}
 */
/**
 * 更新阅读内 AI 问答使用的选区提示。
 *
 * @returns {void}
 */
function renderReadingAiSelection() {
  /** selection 是当前作为 AI 提问重点的正文选区。 */
  const selection = applicationState.readingAiSelection;
  dom.readingAiSelection.hidden = !selection;
  dom.readingAiSelectionText.textContent = selection?.quoteText || "";
}

function captureReadingSelection() {
  /** readingSurface 是当前允许选区高亮的正文根节点。 */
  const readingSurface = applicationState.activeReadingSurface;
  /** selection 是浏览器当前文本选区。 */
  const selection = window.getSelection();
  if (!readingSurface || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }
  /** range 是当前选区的首个连续范围。 */
  const range = selection.getRangeAt(0);
  if (!readingSurface.contains(range.commonAncestorContainer)) return;
  /** rawQuote 是包含可能首尾空白的原始选中文字。 */
  const rawQuote = range.toString();
  /** leadingWhitespace 是选区开头应排除的空白字符数。 */
  const leadingWhitespace = rawQuote.length - rawQuote.trimStart().length;
  /** quoteText 是最终保存的选中文字。 */
  const quoteText = rawQuote.trim();
  if (!quoteText || quoteText.length > 8000) {
    dom.readingSelectionHint.textContent = quoteText
      ? "单次高亮不能超过 8000 个字符。"
      : "在正文中选中文字，然后选择一种高亮颜色。";
    return;
  }
  /** prefixRange 用于计算选区起点之前的纯文本长度。 */
  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(readingSurface);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  /** anchorStart 是清除首部空白后的正文字符起点。 */
  const anchorStart = prefixRange.toString().length + leadingWhitespace;
  /** anchorEnd 是清除尾部空白后的正文字符终点。 */
  const anchorEnd = anchorStart + quoteText.length;
  applicationState.pendingReadingSelection = { quoteText, anchorStart, anchorEnd };
  applicationState.readingAiSelection = { quoteText, anchorStart, anchorEnd };
  renderReadingAiSelection();
  dom.readingSelectionHint.textContent = `已选择 ${quoteText.length} 个字符，请选择高亮颜色。`;
}

/**
 * 使用待处理选区创建一条高亮批注。
 *
 * @param {string} color 用户选择的高亮颜色。
 * @returns {Promise<void>}
 */
async function createReadingHighlight(color) {
  /** workspace 是当前阅读上下文。 */
  const workspace = applicationState.readingWorkspace;
  /** pendingSelection 是最近一次正文选区。 */
  const pendingSelection = applicationState.pendingReadingSelection;
  if (!workspace || !pendingSelection) {
    showToast("请先在正文中选择需要高亮的文字。");
    return;
  }
  /** overlapsExisting 表示新选区是否与已有高亮重叠。 */
  const overlapsExisting = workspace.annotations.some(
    (annotation) =>
      pendingSelection.anchorStart < annotation.anchorEnd &&
      pendingSelection.anchorEnd > annotation.anchorStart,
  );
  if (overlapsExisting) {
    showToast("该选区与已有高亮重叠，请重新选择。");
    return;
  }
  try {
    /** payload 是服务端保存并返回的新高亮批注。 */
    const payload = await requestJson("/api/reading-annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: workspace.targetType,
        targetId: workspace.targetId,
        ...pendingSelection,
        color,
      }),
    });
    workspace.annotations.push(payload.annotation);
    applicationState.pendingReadingSelection = null;
    window.getSelection()?.removeAllRanges();
    dom.readingSelectionHint.textContent = "高亮已保存，可在下方补充批注。";
    applyReadingHighlights();
    renderReadingAnnotations();
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 滚动到正文中某条高亮并给予短暂视觉提示。
 *
 * @param {string} annotationId 批注 ID。
 * @returns {void}
 */
function focusReadingAnnotation(annotationId) {
  /** highlights 是同一批注可能跨越多个文本节点形成的高亮片段。 */
  const highlights = Array.from(
    applicationState.activeReadingSurface?.querySelectorAll("mark.reading-highlight") ?? [],
  ).filter((highlight) => highlight.dataset.annotationId === annotationId);
  if (highlights.length === 0) return;
  highlights[0].scrollIntoView({ behavior: "smooth", block: "center" });
  for (const highlight of highlights) {
    highlight.classList.add("is-focused");
    window.setTimeout(() => highlight.classList.remove("is-focused"), 1400);
  }
}

/**
 * 修改一条高亮批注的文字说明。
 *
 * @param {string} annotationId 批注 ID。
 * @param {string} noteText 新批注正文。
 * @returns {Promise<void>}
 */
async function saveReadingAnnotationNote(annotationId, noteText) {
  try {
    /** payload 是服务端返回的最新批注。 */
    const payload = await requestJson(
      `/api/reading-annotations/${encodeURIComponent(annotationId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText }),
      },
    );
    /** annotationIndex 是当前批注在本地状态数组中的位置。 */
    const annotationIndex = applicationState.readingWorkspace?.annotations.findIndex(
      (annotation) => annotation.id === annotationId,
    );
    if (annotationIndex >= 0) {
      applicationState.readingWorkspace.annotations[annotationIndex] = payload.annotation;
    }
    dom.readingSelectionHint.textContent = "批注已保存到本地。";
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 删除一条高亮批注并重新绘制正文。
 *
 * @param {string} annotationId 批注 ID。
 * @returns {Promise<void>}
 */
async function deleteReadingHighlight(annotationId) {
  if (!window.confirm("确定删除这条高亮和批注吗？")) return;
  try {
    await requestJson(`/api/reading-annotations/${encodeURIComponent(annotationId)}`, {
      method: "DELETE",
    });
    /** workspace 是删除发生时仍然打开的阅读上下文。 */
    const workspace = applicationState.readingWorkspace;
    if (!workspace) return;
    workspace.annotations = workspace.annotations.filter(
      (annotation) => annotation.id !== annotationId,
    );
    applyReadingHighlights();
    renderReadingAnnotations();
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 渲染当前内容的全部高亮与批注卡片。
 *
 * @returns {void}
 */
function renderReadingAnnotations() {
  dom.annotationList.replaceChildren();
  /** annotations 是按正文位置排列的高亮批注。 */
  const annotations = applicationState.readingWorkspace?.annotations ?? [];
  if (annotations.length === 0) {
    dom.annotationList.append(
      createTextElement("p", "annotation-empty", "还没有高亮。选中正文即可开始。"),
    );
    return;
  }
  for (const annotation of annotations) {
    /** card 是侧栏中的单条批注卡片。 */
    const card = document.createElement("article");
    card.className = `annotation-card is-${annotation.color}`;
    /** quoteButton 是用于返回原文位置的摘录按钮。 */
    const quoteButton = document.createElement("button");
    quoteButton.type = "button";
    quoteButton.className = "annotation-quote";
    quoteButton.textContent = annotation.quoteText;
    quoteButton.addEventListener("click", () => focusReadingAnnotation(annotation.id));
    /** noteInput 是与当前高亮绑定的批注输入框。 */
    const noteInput = document.createElement("textarea");
    noteInput.rows = 3;
    noteInput.placeholder = "为这段原文添加批注……";
    noteInput.value = annotation.noteText;
    noteInput.addEventListener("change", () => {
      void saveReadingAnnotationNote(annotation.id, noteInput.value);
    });
    /** deleteButton 是删除当前高亮和批注的按钮。 */
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "annotation-delete";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => {
      void deleteReadingHighlight(annotation.id);
    });
    card.append(quoteButton, noteInput, deleteButton);
    dom.annotationList.append(card);
  }
}

/**
 * 为新打开的内容加载阅读进度、笔记、目录和高亮。
 *
 * @param {"document" | "article" | "paper"} targetType 阅读内容类型。
 * @param {string} targetId 阅读内容 ID。
 * @param {HTMLElement} readingSurface 当前正文根节点。
 * @returns {Promise<void>}
 */
/**
 * 获取当前阅读内容的显示标题。
 *
 * @returns {string} 当前文档、文章或论文标题。
 */
function getCurrentReadingTitle() {
  return applicationState.selectedDocument?.title
    || applicationState.selectedArticle?.title
    || applicationState.selectedPaper?.titleZh
    || applicationState.selectedPaper?.title
    || "当前资料";
}

/**
 * 在指定容器内渲染一条完整本地 AI 会话。
 *
 * @param {HTMLElement} container 消息列表容器。
 * @param {Record<string, unknown>} conversation 完整会话。
 * @returns {void}
 */
function renderAiConversationMessages(container, conversation) {
  container.replaceChildren();
  if (!conversation?.messages?.length) {
    container.append(createTextElement("p", "reading-ai-empty", "还没有问答记录。"));
    return;
  }
  for (const message of conversation.messages) {
    /** messageCard 是单条用户问题或 AI 回答。 */
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
      /** citationList 是该回答通过逐字核验的来源列表。 */
      const citationList = document.createElement("div");
      citationList.className = "ai-chat-citations";
      for (const citation of message.citations) {
        /** citationButton 是可返回站内原文的引文。 */
        const citationButton = document.createElement("button");
        citationButton.type = "button";
        citationButton.textContent = `${citation.chunkId} · ${citation.quote}`;
        citationButton.addEventListener("click", () =>
          void openAiCitationSource(citation.targetType, citation.targetId, citation.quote),
        );
        citationList.append(citationButton);
      }
      messageCard.append(citationList);
    }
    container.append(messageCard);
  }
  container.scrollTop = container.scrollHeight;
}

/**
 * 读取当前资料最近一次问答，以便关闭后继续追问。
 *
 * @param {string} targetType 当前内容类型。
 * @param {string} targetId 当前内容 ID。
 * @returns {Promise<void>}
 */
async function loadLatestReadingAiConversation(targetType, targetId) {
  /** query 是按当前资料过滤历史的查询参数。 */
  const query = new URLSearchParams({ targetType, targetId });
  /** payload 是当前资料的历史会话摘要。 */
  const payload = await requestJson(`/api/ai/conversations?${query}`);
  /** latestConversation 是最近更新的一条会话。 */
  const latestConversation = payload.conversations?.[0];
  if (!latestConversation) {
    applicationState.readingAiConversationId = "";
    renderAiConversationMessages(dom.readingAiMessages, null);
    return;
  }
  /** detailPayload 是包含全部消息的会话详情。 */
  const detailPayload = await requestJson(`/api/ai/conversations/${encodeURIComponent(latestConversation.id)}`);
  applicationState.readingAiConversationId = detailPayload.conversation.id;
  renderAiConversationMessages(dom.readingAiMessages, detailPayload.conversation);
}

/**
 * 在当前阅读页提交问题，并把问答保存到本机历史。
 *
 * @returns {Promise<void>}
 */
async function submitReadingAiQuestion() {
  /** workspace 是当前阅读内容上下文。 */
  const workspace = applicationState.readingWorkspace;
  /** question 是用户本次阅读内问题。 */
  const question = dom.readingAiInput.value.trim();
  if (!workspace || !question) return;
  dom.readingAiSubmit.disabled = true;
  dom.readingAiSubmit.textContent = "正在检索原文…";
  dom.readingAiStatus.textContent = "正在生成并核验引用，请稍候。";
  try {
    /** payload 是带完整本地会话的问答响应。 */
    const payload = await requestJson("/api/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "ask",
        question,
        conversationId: applicationState.readingAiConversationId || undefined,
        selectedQuote: applicationState.readingAiSelection?.quoteText || "",
        sources: [{ targetType: workspace.targetType, targetId: workspace.targetId }],
      }),
    });
    applicationState.readingAiConversationId = payload.conversationId;
    dom.readingAiInput.value = "";
    applicationState.readingAiSelection = null;
    renderReadingAiSelection();
    renderAiConversationMessages(dom.readingAiMessages, payload.conversation);
    dom.readingAiStatus.textContent = "已保存到本机问答记录。";
  } catch (error) {
    dom.readingAiStatus.textContent = error.message;
    showToast(error.message);
  } finally {
    dom.readingAiSubmit.disabled = false;
    dom.readingAiSubmit.textContent = "发送问题";
  }
}

async function initializeReadingWorkspace(targetType, targetId, readingSurface) {
  try {
    /** query 是读取工作台状态所需的安全查询参数。 */
    const query = new URLSearchParams({ targetType, targetId });
    /** payload 是本地数据库中的阅读工作台数据。 */
    const payload = await requestJson(`/api/reading-workspace?${query}`);
    applicationState.readingWorkspace = payload.workspace;
    applicationState.activeReadingSurface = readingSurface;
    applicationState.pendingReadingSelection = null;
    applicationState.readingAiSelection = null;
    applicationState.readingAiConversationId = "";
    readingSurface.classList.add("reading-surface");
    dom.readingStatusSelect.value = payload.workspace.state.status;
    dom.readingNoteInput.value = payload.workspace.state.noteText;
    dom.readingNoteStatus.textContent = "自动保存到本地";
    dom.readingSelectionHint.textContent =
      "在正文中选中文字，然后选择一种高亮颜色。";
    dom.readingAiSourceTitle.textContent = getCurrentReadingTitle();
    renderReadingAiSelection();
    setReadingWorkbenchTab("tools");
    renderReadingProgress(payload.workspace.state.progressPercent);
    buildReadingTableOfContents(readingSurface);
    dom.readingTocSidebar.hidden = false;
    /** savedTocExpanded 是用户上次选择的左侧目录状态。 */
    let savedTocExpanded = true;
    try {
      savedTocExpanded = window.localStorage.getItem("zhixu-reading-toc-expanded") !== "false";
    } catch (error) {}
    setReadingTocExpanded(savedTocExpanded);
    applyReadingHighlights();
    renderReadingAnnotations();
    await loadContentOrganization();
    /** savedExpanded 是用户上次选择的侧栏展开状态。 */
    let savedExpanded = true;
    try {
      savedExpanded = window.localStorage.getItem("zhixu-reading-sidebar-expanded") !== "false";
    } catch (error) {}
    setReadingWorkbenchExpanded(savedExpanded);
    void loadLatestReadingAiConversation(targetType, targetId).catch((error) => {
      dom.readingAiStatus.textContent = error.message;
    });
    restoreReadingProgress(payload.workspace.state.progressPercent);
  } catch (error) {
    closeReadingWorkspace();
    showToast(error.message);
  }
}

/**
 * 切换 PDF 原版预览与清爽阅读模式。
 *
 * @param {"original" | "readable"} mode 目标阅读模式。
 * @returns {void}
 */
function setReaderMode(mode) {
  /** showOriginal 表示当前文档是否采用原版预览。 */
  const showOriginal = mode === "original";
  dom.originalPreview.hidden = !showOriginal;
  dom.readerContent.hidden = showOriginal;
  if (!showOriginal) {
    dom.reader.classList.remove("is-wide-preview");
    dom.widePreviewButton.textContent = "⇱ 展开至页面宽度";
    dom.widePreviewButton.setAttribute("aria-pressed", "false");
  }
  for (const button of dom.readerModeSwitch.querySelectorAll("button")) {
    button.classList.toggle("is-active", button.dataset.readerMode === mode);
  }
}

/**
 * 切换 PDF 在标准双栏与页面宽度阅读布局之间的状态。
 *
 * @returns {void}
 */
function toggleWidePreview() {
  /** isWide 表示 PDF 是否已占用阅读页的全部可用宽度。 */
  const isWide = dom.reader.classList.toggle("is-wide-preview");
  dom.widePreviewButton.textContent = isWide
    ? "⇲ 恢复标准布局"
    : "⇱ 展开至页面宽度";
  dom.widePreviewButton.setAttribute("aria-pressed", String(isWide));
}

/**
 * 切换一级页面并更新导航。
 *
 * @param {string} viewName 目标页面名称。
 * @returns {void}
 */
/**
 * 生成 AI 来源在浏览器状态中的稳定键。
 * @param {string} targetType 内容类型。
 * @param {string} targetId 本地内容 ID。
 * @returns {string} 类型与 ID 组合键。
 */
function getAiSourceKey(targetType, targetId) {
  return `${targetType}:${targetId}`;
}

/**
 * 更新已选资料计数，并同步提交按钮可用状态。
 * @returns {void}
 */
function updateAiSelectionState() {
  /** selectedCount 是当前已选资料数量。 */
  const selectedCount = applicationState.selectedAiSourceKeys.size;
  dom.aiSourceCount.textContent = `${selectedCount} / 6`;
  dom.aiSubmitButton.disabled = !applicationState.aiConfigured || selectedCount === 0;
}

/**
 * 渲染可筛选、可多选的本地 AI 资料列表。
 * @returns {void}
 */
function renderAiSources() {
  /** query 是资料筛选输入的小写文本。 */
  const query = dom.aiSourceSearch.value.trim().toLowerCase();
  /** visibleSources 是标题、分类或类型命中的资料。 */
  const visibleSources = applicationState.aiSources.filter((source) =>
    `${source.title} ${source.category} ${source.targetType}`.toLowerCase().includes(query),
  );
  dom.aiSourceList.replaceChildren();
  if (visibleSources.length === 0) {
    dom.aiSourceList.append(createTextElement("p", "ai-source-empty", "没有匹配的资料。"));
  }
  /** typeLabels 是内部内容类型的中文显示名称。 */
  const typeLabels = { document: "文档", article: "文章", paper: "论文" };
  for (const source of visibleSources) {
    /** sourceKey 是当前资料的稳定选择键。 */
    const sourceKey = getAiSourceKey(source.targetType, source.targetId);
    /** label 是整行可点击的资料选项。 */
    const label = document.createElement("label");
    label.className = "ai-source-option";
    /** checkbox 是当前资料的选择控件。 */
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = applicationState.selectedAiSourceKeys.has(sourceKey);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && applicationState.selectedAiSourceKeys.size >= 6) {
        checkbox.checked = false;
        showToast("一次最多选择 6 份资料。");
        return;
      }
      if (checkbox.checked) applicationState.selectedAiSourceKeys.add(sourceKey);
      else applicationState.selectedAiSourceKeys.delete(sourceKey);
      updateAiSelectionState();
    });
    /** copy 是资料标题、类型与摘要说明。 */
    const copy = document.createElement("span");
    copy.append(
      createTextElement("strong", "", source.title),
      createTextElement("small", "", `${typeLabels[source.targetType] || "资料"} · ${source.category || "未分类"}`),
    );
    label.append(checkbox, copy);
    dom.aiSourceList.append(label);
  }
  updateAiSelectionState();
}

/**
 * 从本机服务读取 AI 配置状态和全部可选资料。
 * @returns {Promise<void>}
 */
async function loadAiSources() {
  /** payload 是不含密钥的配置状态与资料摘要。 */
  const payload = await requestJson("/api/ai/sources");
  applicationState.aiSources = payload.sources;
  applicationState.aiConfigured = Boolean(payload.configured);
  dom.aiStatusLabel.textContent = applicationState.aiConfigured
    ? `DeepSeek 已就绪 · ${payload.model}`
    : "尚未配置 DeepSeek API Key";
  renderAiSources();
}

/**
 * 在问答中心渲染可搜索的本地会话摘要。
 *
 * @returns {void}
 */
function renderAiConversationHistory() {
  dom.aiHistoryList.replaceChildren();
  if (applicationState.aiConversations.length === 0) {
    dom.aiHistoryList.append(createTextElement("p", "ai-history-empty", "还没有匹配的问答记录。阅读任意资料时可以直接开始提问。"));
    return;
  }
  for (const conversation of applicationState.aiConversations) {
    /** button 是一条可打开的历史会话摘要。 */
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-history-item";
    button.append(
      createTextElement("span", "", conversation.mode === "compare" ? "多资料比较" : "阅读追问"),
      createTextElement("strong", "", conversation.title),
      createTextElement("p", "", conversation.lastQuestion),
      createTextElement("small", "", `${conversation.messageCount} 条消息 · ${formatDate(conversation.updatedAt)}`),
    );
    button.addEventListener("click", () => void openAiConversationHistory(conversation.id));
    dom.aiHistoryList.append(button);
  }
}

/**
 * 从本地 SQLite 查询问答历史。
 *
 * @returns {Promise<void>}
 */
async function loadAiConversations() {
  /** parameters 是可选历史搜索词。 */
  const parameters = new URLSearchParams();
  if (dom.aiHistorySearch.value.trim()) parameters.set("q", dom.aiHistorySearch.value.trim());
  /** payload 是问答会话摘要列表。 */
  const payload = await requestJson(`/api/ai/conversations?${parameters}`);
  applicationState.aiConversations = payload.conversations;
  renderAiConversationHistory();
}

/**
 * 在历史中心打开一条完整会话。
 *
 * @param {string} conversationId 会话 ID。
 * @returns {Promise<void>}
 */
async function openAiConversationHistory(conversationId) {
  /** payload 是包含消息和来源的完整会话。 */
  const payload = await requestJson(`/api/ai/conversations/${encodeURIComponent(conversationId)}`);
  /** conversation 是要展示的本地问答记录。 */
  const conversation = payload.conversation;
  dom.aiHistoryDetail.replaceChildren(
    createTextElement("p", "eyebrow", conversation.mode === "compare" ? "MULTI-SOURCE" : "READING QUESTION"),
    createTextElement("h3", "", conversation.title),
  );
  /** sourceBar 是会话关联资料的站内返回入口。 */
  const sourceBar = document.createElement("div");
  sourceBar.className = "ai-history-sources";
  for (const source of conversation.sources) {
    /** sourceButton 打开会话对应的原始资料。 */
    const sourceButton = document.createElement("button");
    sourceButton.type = "button";
    sourceButton.textContent = `打开《${source.title || "原始资料"}》`;
    sourceButton.addEventListener("click", () => void openAiCitationSource(source.targetType, source.targetId));
    sourceBar.append(sourceButton);
  }
  dom.aiHistoryDetail.append(sourceBar);
  /** messageList 是历史中心的完整消息列表。 */
  const messageList = document.createElement("div");
  messageList.className = "ai-history-messages";
  dom.aiHistoryDetail.append(messageList);
  renderAiConversationMessages(messageList, conversation);
}

/**
 * 在当前正文中定位一段已核验引文。
 *
 * @param {string} quote 引用原文。
 * @returns {boolean} 是否成功找到并聚焦正文位置。
 */
function focusAiCitationInReadingSurface(quote) {
  /** readingSurface 是当前文档、文章或论文的正文容器。 */
  const readingSurface = applicationState.activeReadingSurface;
  /** normalizedQuote 是忽略换行和连续空格后的引用文本。 */
  const normalizedQuote = String(quote || "").replace(/\s+/g, " ").trim();
  if (!readingSurface || !normalizedQuote) return false;
  /** searchNeedle 是用于正文定位的引文开头，避免长引文跨越多个节点时无法匹配。 */
  const searchNeedle = normalizedQuote.slice(0, Math.min(normalizedQuote.length, 72));
  /** candidateElements 是具备稳定阅读位置的语义正文块。 */
  const candidateElements = Array.from(readingSurface.querySelectorAll(
    "p, li, blockquote, pre, td, th, h1, h2, h3, h4",
  ));
  /** matchedElement 是包含引文开头的第一个正文块。 */
  const matchedElement = candidateElements.find((element) =>
    String(element.textContent || "").replace(/\s+/g, " ").includes(searchNeedle),
  );
  if (!matchedElement) return false;
  /** previousFocus 是上一次被引用定位高亮的正文块。 */
  const previousFocus = readingSurface.querySelector(".is-ai-citation-focus");
  previousFocus?.classList.remove("is-ai-citation-focus");
  matchedElement.classList.add("is-ai-citation-focus");
  matchedElement.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => {
    if (matchedElement.isConnected) matchedElement.classList.remove("is-ai-citation-focus");
  }, 3200);
  return true;
}

/**
 * 打开指定引用对应的站内原始内容；同一资料直接定位而不重新加载。
 *
 * @param {string} targetType 内容类型。
 * @param {string} targetId 内容 ID。
 * @param {string} [quote] 需要定位并短暂高亮的引用原文。
 * @returns {Promise<void>}
 */
async function openAiCitationSource(targetType, targetId, quote = "") {
  /** isCurrentSource 表示引文是否属于当前正在阅读的资料。 */
  const isCurrentSource = applicationState.readingWorkspace?.targetType === targetType
    && applicationState.readingWorkspace?.targetId === targetId;
  if (isCurrentSource) {
    setReadingWorkbenchExpanded(true);
    setReadingWorkbenchTab("ai");
    if (quote && !focusAiCitationInReadingSurface(quote)) {
      showToast("已保持当前问答，但未在渲染正文中找到完全匹配的引文位置。");
    }
    return;
  }
  if (targetType === "document") await openDocument(targetId);
  else if (targetType === "article") await openArticle(targetId);
  else if (targetType === "paper") await openPaper(targetId);
  if (applicationState.readingWorkspace) {
    setReadingWorkbenchExpanded(true);
    setReadingWorkbenchTab("ai");
    if (quote && !focusAiCitationInReadingSurface(quote)) {
      showToast("已打开引用资料，但未找到完全匹配的正文位置。");
    }
  }
}

/**
 * 渲染经过服务端原文核验的 AI 回答与引文。
 * @param {Record<string, unknown>} payload 问答接口响应。
 * @returns {void}
 */
function renderAiAnswer(payload) {
  dom.aiAnswerPanel.hidden = false;
  dom.aiEvidenceWarning.hidden = !payload.insufficientEvidence;
  dom.aiAnswerStats.textContent = `${payload.usedSourceCount} 份资料 · ${payload.usedChunkCount} 个相关片段 · ${payload.citations.length} 条已核验引用`;
  dom.aiAnswerText.textContent = payload.answer;
  dom.aiCitationList.replaceChildren();
  for (const citation of payload.citations) {
    /** card 是一条已由服务端逐字反查的来源证据。 */
    const card = document.createElement("article");
    card.className = "ai-citation-card";
    /** openButton 返回该引文所属的站内原始内容。 */
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "text-button";
    openButton.textContent = `打开来源 · ${citation.chunkId}`;
    openButton.addEventListener("click", () =>
      void openAiCitationSource(citation.targetType, citation.targetId, citation.quote),
    );
    card.append(
      createTextElement("strong", "", citation.title),
      createTextElement("blockquote", "", citation.quote),
      openButton,
    );
    dom.aiCitationList.append(card);
  }
  dom.aiAnswerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * 提交当前问题和所选资料；正文由服务端从 SQLite 重新读取。
 * @returns {Promise<void>}
 */
async function submitAiQuestion() {
  /** selectedSources 是按资料列表顺序提交的类型和 ID。 */
  const selectedSources = applicationState.aiSources
    .filter((source) => applicationState.selectedAiSourceKeys.has(getAiSourceKey(source.targetType, source.targetId)))
    .map((source) => ({ targetType: source.targetType, targetId: source.targetId }));
  if (applicationState.aiMode === "compare" && selectedSources.length < 2) {
    showToast("多资料对比至少需要选择 2 份资料。");
    return;
  }
  dom.aiSubmitButton.disabled = true;
  dom.aiSubmitButton.textContent = "正在检索并核验…";
  try {
    /** payload 是带本地已验证引用的 AI 回答。 */
    const payload = await requestJson("/api/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: applicationState.aiMode, question: dom.aiQuestionInput.value.trim(), sources: selectedSources }),
    });
    renderAiAnswer(payload);
    await loadAiConversations();
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.aiSubmitButton.textContent = "开始比较";
    updateAiSelectionState();
  }
}

/**
 * 从阅读页跳到资料问答，并预选当前内容。
 * @param {string} targetType 当前内容类型。
 * @param {string} targetId 当前内容 ID。
 * @returns {Promise<void>}
 */
async function openAiWithSource(targetType, targetId) {
  if (!applicationState.readingWorkspace
    || applicationState.readingWorkspace.targetType !== targetType
    || applicationState.readingWorkspace.targetId !== targetId) return;
  setReadingWorkbenchExpanded(true);
  setReadingWorkbenchTab("ai");
}

/**
 * 获取当前可见页面的轻量导航快照。
 *
 * @returns {Record<string, string>} 一级页面或阅读页的位置。
 */
function captureCurrentPageLocation() {
  if (!dom.reader.hidden && applicationState.selectedDocument) {
    return { kind: "reader", targetType: "document", targetId: applicationState.selectedDocument.id };
  }
  if (!dom.articleReader.hidden && applicationState.selectedArticle) {
    return { kind: "reader", targetType: "article", targetId: applicationState.selectedArticle.id };
  }
  if (!dom.paperReader.hidden && applicationState.selectedPaper) {
    return { kind: "reader", targetType: "paper", targetId: applicationState.selectedPaper.id };
  }
  return {
    kind: "view",
    viewName: applicationState.activeView || "library",
    folderId: applicationState.activeView === "library" ? applicationState.activeFolderId : "",
  };
}

/**
 * 判断两个轻量页面快照是否指向同一个位置。
 *
 * @param {Record<string, string>} left 左侧页面快照。
 * @param {Record<string, string>} right 右侧页面快照。
 * @returns {boolean} 两个页面是否相同。
 */
function isSamePageLocation(left, right) {
  return left.kind === right.kind
    && left.targetType === right.targetType
    && left.targetId === right.targetId
    && left.viewName === right.viewName
    && left.folderId === right.folderId;
}

/**
 * 在打开新的阅读内容前保存当前页面，最多保留二十步。
 *
 * @returns {void}
 */
function rememberCurrentPageLocation() {
  /** currentLocation 是切换前用户实际看到的页面。 */
  const currentLocation = captureCurrentPageLocation();
  /** previousLocation 是当前返回栈最后一个页面。 */
  const previousLocation = applicationState.readingPageHistory.at(-1);
  if (!previousLocation || !isSamePageLocation(previousLocation, currentLocation)) {
    applicationState.readingPageHistory.push(currentLocation);
  }
  if (applicationState.readingPageHistory.length > 20) {
    applicationState.readingPageHistory.splice(0, applicationState.readingPageHistory.length - 20);
  }
}

/**
 * 根据当前是否处于阅读页更新悬浮返回按钮。
 *
 * @returns {void}
 */
function updateFloatingReaderBackButton() {
  /** readerVisible 表示文档、文章或论文阅读页有一个正在显示。 */
  const readerVisible = !dom.reader.hidden || !dom.articleReader.hidden || !dom.paperReader.hidden;
  dom.floatingReaderBack.hidden = !readerVisible;
}

/**
 * 清理离开原始文档阅读页时使用的预览状态。
 *
 * @returns {void}
 */
function resetDocumentReaderPreview() {
  dom.reader.classList.remove("is-word-reader");
  dom.readerContent.classList.remove("is-word-document");
  dom.reader.classList.remove("is-wide-preview");
  dom.widePreviewButton.textContent = "⇱ 展开至页面宽度";
  dom.widePreviewButton.setAttribute("aria-pressed", "false");
  dom.originalPreviewFrame.src = "about:blank";
}

/**
 * 返回进入当前阅读页前的页面；没有历史时回到对应资料库。
 *
 * @param {string} fallbackView 无历史时使用的一级页面。
 * @returns {Promise<void>}
 */
async function returnToPreviousPage(fallbackView = "library") {
  resetDocumentReaderPreview();
  /** previousLocation 是最近一次真实访问的页面位置。 */
  const previousLocation = applicationState.readingPageHistory.pop() || {
    kind: "view",
    viewName: fallbackView,
    folderId: "",
  };
  if (previousLocation.kind === "reader") {
    if (previousLocation.targetType === "document") {
      await openDocument(previousLocation.targetId, { rememberPrevious: false });
    } else if (previousLocation.targetType === "article") {
      await openArticle(previousLocation.targetId, { rememberPrevious: false });
    } else if (previousLocation.targetType === "paper") {
      await openPaper(previousLocation.targetId, { rememberPrevious: false });
    }
    return;
  }
  applicationState.activeFolderId = previousLocation.viewName === "library"
    ? previousLocation.folderId || ""
    : applicationState.activeFolderId;
  showView(previousLocation.viewName || fallbackView);
  if ((previousLocation.viewName || fallbackView) === "library") await loadLibrary();
  if ((previousLocation.viewName || fallbackView) === "papers") await loadPapers();
}

/** importJobStageLabels 是后台阶段到中文状态的映射。 */
const importJobStageLabels = Object.freeze({
  queued: "等待处理",
  starting: "正在启动",
  fetching: "正在抓取网页",
  rendering: "正在渲染 PDF 页面",
  recognizing: "正在识别文字",
  saving: "正在保存正文",
  indexing: "正在建立索引",
  reading_metadata: "正在读取视频信息",
  reading_captions: "正在读取公开字幕",
  awaiting_confirmation: "没有公开字幕，等待确认",
  completed: "已完成",
  failed: "失败",
});

/**
 * 渲染最近后台导入任务并提供打开结果或失败重试入口。
 *
 * @returns {void}
 */
function renderImportJobs() {
  dom.importJobList.replaceChildren();
  if (applicationState.importJobs.length === 0) {
    dom.importJobList.append(
      createTextElement("p", "import-job-empty", "还没有后台导入任务。"),
    );
    return;
  }
  for (const job of applicationState.importJobs) {
    /** item 是单项后台任务状态。 */
    const item = document.createElement("div");
    item.className = `import-job-item is-${job.status}`;
    /** copy 保存任务名称、阶段和错误信息。 */
    const copy = document.createElement("div");
    copy.append(
      createTextElement("strong", "", job.sourceLabel || job.jobType),
      createTextElement(
        "small",
        "",
        `${importJobStageLabels[job.stage] || job.stage} · ${Math.round(job.progressPercent || 0)}%`,
      ),
    );
    if (job.errorMessage) copy.append(createTextElement("p", "", job.errorMessage));
    item.append(copy);
    if (job.stage === "awaiting_confirmation") {
      /** actions 提供重新检查字幕和明确仅保存链接两个选择。 */
      const actions = document.createElement("div");
      actions.className = "import-job-actions";
      const retryButton = createTextElement("button", "text-button", "重新检查字幕");
      retryButton.type = "button";
      retryButton.addEventListener("click", async () => {
        retryButton.disabled = true;
        try {
          await requestJson(`/api/import-jobs/${encodeURIComponent(job.id)}/retry`, {
            method: "POST",
          });
          await loadImportJobs();
        } catch (error) {
          showToast(error.message);
        } finally {
          retryButton.disabled = false;
        }
      });
      const saveLinkButton = createTextElement("button", "text-button", "仅保存链接");
      saveLinkButton.type = "button";
      saveLinkButton.addEventListener("click", async () => {
        saveLinkButton.disabled = true;
        try {
          await requestJson(`/api/import-jobs/${encodeURIComponent(job.id)}/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save_link" }),
          });
          showToast("已确认仅保存链接，不会下载视频或音频。");
          await loadImportJobs();
        } catch (error) {
          showToast(error.message);
        } finally {
          saveLinkButton.disabled = false;
        }
      });
      actions.append(retryButton, saveLinkButton);
      item.append(actions);
    } else if (job.status === "failed") {
      /** retryButton 把失败任务重新放回统一队列。 */
      const retryButton = createTextElement("button", "text-button", "重试");
      retryButton.type = "button";
      retryButton.addEventListener("click", async () => {
        retryButton.disabled = true;
        try {
          await requestJson(`/api/import-jobs/${encodeURIComponent(job.id)}/retry`, {
            method: "POST",
          });
          await loadImportJobs();
        } catch (error) {
          showToast(error.message);
        } finally {
          retryButton.disabled = false;
        }
      });
      item.append(retryButton);
    } else if (job.status === "completed" && job.targetType === "article" && job.targetId) {
      /** openButton 直接打开浏览器收藏完成后的文章。 */
      const openButton = createTextElement("button", "text-button", "打开");
      openButton.type = "button";
      openButton.addEventListener("click", () => void openArticle(job.targetId));
      item.append(openButton);
    }
    dom.importJobList.append(item);
  }
}

/**
 * 读取任务中心并在有活动任务时自动轮询。
 *
 * @returns {Promise<void>}
 */
async function loadImportJobs() {
  window.clearTimeout(applicationState.importJobPollTimer);
  /** payload 是最近任务和执行器状态。 */
  const payload = await requestJson("/api/import-jobs?limit=20");
  applicationState.importJobs = payload.jobs || [];
  renderImportJobs();
  const hasActiveJobs = applicationState.importJobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  if (hasActiveJobs && applicationState.activeView === "storage") {
    applicationState.importJobPollTimer = window.setTimeout(
      () => void loadImportJobs().catch((error) => showToast(error.message)),
      2000,
    );
  }
}

/**
 * 渲染已经配对或撤销的浏览器扩展客户端。
 *
 * @param {Array<Record<string, unknown>>} clients 浏览器客户端。
 * @returns {void}
 */
function renderBrowserClients(clients) {
  dom.browserClientList.replaceChildren();
  if (clients.length === 0) {
    dom.browserClientList.append(
      createTextElement("small", "browser-client-empty", "尚未配对浏览器扩展。"),
    );
    return;
  }
  for (const client of clients) {
    /** item 是单个浏览器客户端及撤销操作。 */
    const item = document.createElement("div");
    item.className = `browser-client-item ${client.active ? "is-active" : "is-revoked"}`;
    /** label 显示名称和最近使用状态。 */
    const label = document.createElement("div");
    label.append(
      createTextElement("strong", "", client.name),
      createTextElement(
        "small",
        "",
        client.active
          ? client.lastUsedAt ? `最近使用：${formatDate(client.lastUsedAt)}` : "已配对，尚未使用"
          : "权限已撤销",
      ),
    );
    item.append(label);
    if (client.active) {
      /** revokeButton 使泄露或停用的扩展令牌立即失效。 */
      const revokeButton = createTextElement("button", "text-button", "撤销");
      revokeButton.type = "button";
      revokeButton.addEventListener("click", async () => {
        revokeButton.disabled = true;
        try {
          await requestJson(`/api/browser/clients/${encodeURIComponent(client.id)}`, {
            method: "DELETE",
          });
          await loadBrowserClients();
          showToast("已撤销这个浏览器扩展的权限。");
        } catch (error) {
          showToast(error.message);
        } finally {
          revokeButton.disabled = false;
        }
      });
      item.append(revokeButton);
    }
    dom.browserClientList.append(item);
  }
}

/**
 * 读取本机已配对浏览器客户端。
 *
 * @returns {Promise<void>}
 */
async function loadBrowserClients() {
  /** payload 包含全部有效和已撤销客户端。 */
  const payload = await requestJson("/api/browser/clients");
  renderBrowserClients(payload.clients || []);
}

/**
 * 创建并显示十分钟内有效的一次性浏览器扩展配对码。
 *
 * @returns {Promise<void>}
 */
async function generateBrowserPairingCode() {
  dom.browserPairingButton.disabled = true;
  try {
    /** payload 是本机服务生成的一次性配对码。 */
    const payload = await requestJson("/api/browser/pairing/start", { method: "POST" });
    dom.browserPairingCode.querySelector("strong").textContent = payload.code;
    dom.browserPairingCode.hidden = false;
    showToast("配对码已生成，请在十分钟内输入浏览器扩展。");
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.browserPairingButton.disabled = false;
  }
}

/**
 * 加载“本地数据”页面的浏览器客户端与后台任务状态。
 *
 * @returns {Promise<void>}
 */
async function loadStorageOperations() {
  await Promise.all([loadBrowserClients(), loadImportJobs()]);
}

function showView(viewName) {
  if (viewName !== "storage") {
    window.clearTimeout(applicationState.importJobPollTimer);
  }
  closeReadingWorkspace();
  applicationState.activeView = viewName;
  applicationState.selectedDocument = null;
  applicationState.selectedArticle = null;
  applicationState.selectedPaper = null;
  dom.reader.hidden = true;
  dom.articleReader.hidden = true;
  dom.paperReader.hidden = true;
  updateFloatingReaderBackButton();
  for (const view of document.querySelectorAll(".view")) {
    view.classList.toggle("is-active", view.id === `${viewName}-view`);
  }
  for (const button of document.querySelectorAll(".nav-item")) {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  }
  /** viewTitles 是每个一级页面的中英文标题。 */
  const viewTitles = {
    library: ["DOCUMENT LIBRARY", "我的文档库"],
    papers: ["PAPER LIBRARY", "我的论文库"],
    topics: ["LEARNING PATHS", "我的专题"],
    cards: ["SOURCE CARDS", "卡片与今日复习"],
    ai: ["GROUNDED AI", "资料问答与对比"],
    upload: ["CONTENT INBOX", "导入内容"],
    storage: ["LOCAL STORAGE", "本地数据"],
  };
  /** titlePair 是当前页面标题组合。 */
  const titlePair = viewTitles[viewName] ?? viewTitles.library;
  dom.pageEyebrow.textContent = titlePair[0];
  dom.pageTitle.textContent = titlePair[1];
  dom.topUploadButton.hidden = viewName === "upload";
  if (viewName === "papers") void loadPapers();
  if (viewName === "topics") void loadTopics();
  if (viewName === "cards") void loadKnowledgeCards();
  if (viewName === "ai") {
    applicationState.aiMode = "compare";
    void Promise.all([loadAiSources(), loadAiConversations()]).catch((error) => showToast(error.message));
  }
  if (viewName === "storage") {
    void loadStorageOperations().catch((error) => showToast(error.message));
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * 将服务端清洗过的文章原文转换为可反复渲染的安全正文片段。
 *
 * @param {Record<string, unknown>} article 完整文章对象。
 * @returns {DocumentFragment} 可插入阅读页的原文片段。
 */
function createArticleOriginalContent(article) {
  /** parsedContent 是从服务端白名单 HTML 创建的隔离文档。 */
  const parsedContent = new DOMParser().parseFromString(
    `<article>${article.contentHtml}</article>`,
    "text/html",
  );
  /** safeArticleRoot 是隔离文档中的正文根节点。 */
  const safeArticleRoot = parsedContent.querySelector("article");
  /** fragment 是最终返回给文章阅读页的原文片段。 */
  const fragment = document.createDocumentFragment();
  if (!safeArticleRoot) {
    fragment.append(createTextElement("p", "", article.contentText));
    return fragment;
  }
  /** emptyListItems 是旧文章记录中遗留的无文字、无媒体空项目。 */
  const emptyListItems = Array.from(safeArticleRoot.querySelectorAll("li")).filter(
    (listItem) =>
      !(listItem.textContent || "").trim() &&
      !listItem.querySelector("img, pre, code, table"),
  );
  for (const emptyListItem of emptyListItems) emptyListItem.remove();
  /** emptyLists 是删除空项目后已无有效内容的列表容器。 */
  const emptyLists = Array.from(safeArticleRoot.querySelectorAll("ul, ol")).filter(
    (list) => !list.querySelector("li"),
  );
  for (const emptyList of emptyLists) emptyList.remove();
  for (const image of safeArticleRoot.querySelectorAll("img")) {
    /** remoteSource 是服务端已清洗过的公开图片地址。 */
    const remoteSource = image.getAttribute("src") || "";
    if (/^https?:\/\//i.test(remoteSource)) {
      image.setAttribute(
        "src",
        `/api/article-images?url=${encodeURIComponent(remoteSource)}`,
      );
      image.removeAttribute("referrerpolicy");
    }
    /** loading 设为 eager，避免原网页懒加载规则留下占位图。 */
    image.setAttribute("loading", "eager");
    /** decoding 允许浏览器异步解码长文章中的图片。 */
    image.setAttribute("decoding", "async");
  }
  for (const childNode of safeArticleRoot.childNodes) {
    fragment.append(document.importNode(childNode, true));
  }
  return fragment;
}

/**
 * 判断文章是否确实需要中文翻译。
 *
 * 技术中文会包含大量模型名和英文缩写；只有明确英文，或拉丁字符明显占主导的
 * 混合文章才显示翻译入口。
 *
 * @param {Record<string, unknown>} article 当前完整文章。
 * @returns {boolean} 是否显示 Codex 翻译能力。
 */
function isArticleTranslationEligible(article) {
  if (article.sourceLanguage === "en") return true;
  if (article.sourceLanguage !== "mixed") return false;
  /** sourceText 是用于纠正技术中文误判的完整原文。 */
  const sourceText = String(article.contentText || article.summary || "");
  /** hanCount 是正文中的汉字数量。 */
  const hanCount = (sourceText.match(/[\u3400-\u9fff]/g) || []).length;
  /** latinLetterCount 是正文中的拉丁字母数量。 */
  const latinLetterCount = (sourceText.match(/[A-Za-z]/g) || []).length;
  return latinLetterCount >= 500 && latinLetterCount > hanCount * 1.35;
}

/**
 * 根据文章语言和翻译状态更新 Codex 翻译入口。
 *
 * @param {Record<string, unknown>} article 当前完整文章。
 * @returns {void}
 */
function renderArticleTranslationControls(article) {
  /** canTranslate 表示原文明显以英文为主。 */
  const canTranslate = isArticleTranslationEligible(article);
  /** translationReady 表示数据库已有 Codex 中文全文。 */
  const translationReady =
    article.translationStatus === "ready" && Boolean(article.translatedHtml);
  dom.articleTranslationTools.hidden = !canTranslate;
  dom.articleLanguageSwitch.hidden = !translationReady;
  dom.articleTranslationRequest.hidden =
    !canTranslate || article.translationStatus === "pending" || translationReady;
  dom.articleTranslationRequest.disabled = article.translationStatus === "pending";
  if (!canTranslate) {
    dom.articleTranslationStatus.textContent = "";
  } else if (translationReady) {
    dom.articleTranslationStatus.textContent = "Codex 中文译文已完成";
  } else if (article.translationStatus === "pending") {
    dom.articleTranslationStatus.textContent = "等待 Codex 翻译";
  } else {
    dom.articleTranslationStatus.textContent =
      article.sourceLanguage === "mixed" ? "检测到中英混合原文" : "检测到英文原文";
  }
  for (const button of dom.articleLanguageSwitch.querySelectorAll("button")) {
    button.classList.toggle(
      "is-active",
      button.dataset.articleLanguageMode === applicationState.articleLanguageMode,
    );
  }
}

/**
 * 按中文、英文或双语模式渲染当前文章，不修改数据库中的原文。
 *
 * @returns {void}
 */
function renderArticleReadingMode() {
  /** article 是文章阅读页当前选中的完整记录。 */
  const article = applicationState.selectedArticle;
  if (!article) return;
  /** translationReady 表示中文模式已经具有完整译文。 */
  const translationReady =
    isArticleTranslationEligible(article) &&
    article.translationStatus === "ready" &&
    Boolean(article.translatedHtml);
  /** requestedMode 是对未完成译文状态进行回退后的实际模式。 */
  const requestedMode = translationReady
    ? applicationState.articleLanguageMode
    : "original";
  applicationState.articleLanguageMode = requestedMode;
  dom.articleReaderOriginalTitle.hidden = requestedMode === "original";
  dom.articleReaderOriginalTitle.textContent =
    requestedMode === "original" ? "" : article.title;
  dom.articleReaderTitle.textContent =
    requestedMode === "original" ? article.title : article.translatedTitle || article.title;
  dom.articleReaderSummary.textContent =
    requestedMode === "original"
      ? article.summary
      : article.translatedSummary || article.summary;
  dom.articleReaderContent.classList.toggle(
    "is-bilingual",
    requestedMode === "bilingual",
  );
  if (requestedMode === "translation") {
    dom.articleReaderContent.replaceChildren(
      createSafePaperTranslation(article.translatedHtml),
    );
  } else if (requestedMode === "bilingual") {
    /** bilingualGrid 是左右并排的英文原文与中文译文容器。 */
    const bilingualGrid = document.createElement("div");
    bilingualGrid.className = "article-bilingual-grid";
    /** originalColumn 是双语模式的英文原文列。 */
    const originalColumn = document.createElement("section");
    originalColumn.className = "article-language-column is-original";
    originalColumn.lang = article.sourceLanguage === "en" ? "en" : "";
    originalColumn.append(createTextElement("h2", "article-language-heading", "英文原文"));
    originalColumn.append(createArticleOriginalContent(article));
    /** translationColumn 是双语模式的 Codex 中文译文列。 */
    const translationColumn = document.createElement("section");
    translationColumn.className = "article-language-column is-translation";
    translationColumn.lang = "zh-CN";
    translationColumn.append(createTextElement("h2", "article-language-heading", "中文译文"));
    translationColumn.append(createSafePaperTranslation(article.translatedHtml));
    bilingualGrid.append(originalColumn, translationColumn);
    dom.articleReaderContent.replaceChildren(bilingualGrid);
  } else {
    dom.articleReaderContent.replaceChildren(createArticleOriginalContent(article));
  }
  renderArticleTranslationControls(article);
}

/**
 * 将当前英文文章加入只由 Codex 处理的本地翻译队列。
 *
 * @returns {Promise<void>}
 */
async function requestCurrentArticleTranslation() {
  /** article 是用户当前阅读的英文或双语文章。 */
  const article = applicationState.selectedArticle;
  if (!article) return;
  dom.articleTranslationRequest.disabled = true;
  dom.articleTranslationRequest.textContent = "正在加入…";
  try {
    /** payload 是进入等待状态后的完整文章。 */
    const payload = await requestJson(
      `/api/articles/${encodeURIComponent(article.id)}/translation-request`,
      { method: "POST" },
    );
    applicationState.selectedArticle = payload.article;
    renderArticleTranslationControls(payload.article);
    showToast("已加入 Codex 翻译队列；英文原文会完整保留。");
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.articleTranslationRequest.disabled = false;
    dom.articleTranslationRequest.textContent = "加入 Codex 翻译";
  }
}

/**
 * 在站内阅读页打开一篇已保存文章。
 *
 * @param {string} articleId 文章 ID。
 * @param {{ rememberPrevious?: boolean }} options 导航历史选项。
 * @returns {Promise<void>}
 */
async function openArticle(articleId, options = {}) {
  try {
    closeReadingWorkspace();
    /** payload 是完整文章详情响应。 */
    const payload = await requestJson(
      `/api/articles/${encodeURIComponent(articleId)}`,
    );
    /** article 是即将显示的完整文章。 */
    const article = payload.article;
    if (options.rememberPrevious !== false) rememberCurrentPageLocation();
    applicationState.selectedArticle = article;
    applicationState.articleLanguageMode =
      isArticleTranslationEligible(article) &&
      article.translationStatus === "ready" &&
      article.translatedHtml
        ? "translation"
        : "original";
    for (const view of document.querySelectorAll(".view")) {
      view.classList.remove("is-active");
    }
    dom.reader.hidden = true;
    dom.paperReader.hidden = true;
    dom.articleReader.hidden = false;
    updateFloatingReaderBackButton();
    dom.pageEyebrow.textContent = "ARTICLE READER";
    dom.pageTitle.textContent = "文章阅读";
    dom.topUploadButton.hidden = true;
    dom.articleReaderMeta.textContent = [
      article.category,
      article.sourceLanguage === "en"
        ? "英文原文"
        : article.sourceLanguage === "mixed"
          ? "中英混合"
          : null,
      article.author,
      article.publishedAt,
    ]
      .filter(Boolean)
      .join(" · ");
    dom.articleSourceLink.href = article.url;
    renderArticleReadingMode();
    window.scrollTo({ top: 0, behavior: "smooth" });
    await initializeReadingWorkspace("article", article.id, dom.articleReaderContent);
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 渲染 Docsify 或 GitHub 教程目录预览和章节选择框。
 *
 * @param {Record<string, unknown>} inspection 服务端验证后的教程目录。
 * @returns {void}
 */
function renderDocsifyPreview(inspection) {
  applicationState.docsifyInspection = inspection;
  dom.docsifyPreview.replaceChildren();
  dom.docsifyPreview.hidden = false;
  /** heading 是站点名称与有效章节数量。 */
  const heading = createTextElement(
    "h3",
    "",
    `${inspection.siteTitle} · ${inspection.chapters.length} 个有效章节`,
  );
  /** pathText 是导入后将在文档库创建的文件夹路径。 */
  const pathText = createTextElement(
    "p",
    "docsify-folder-path",
    `保存到：${inspection.recommendedFolderPath.join(" / ")}`,
  );
  /** chapterList 是带选择框的章节预览。 */
  const chapterList = document.createElement("div");
  chapterList.className = "docsify-chapter-list";
  /** previousGroupTitle 用于只在章级标题变化时插入一次分组行。 */
  let previousGroupTitle = "";
  for (const chapter of inspection.chapters) {
    if (chapter.groupTitle && chapter.groupTitle !== previousGroupTitle) {
      /** groupHeading 是原站无链接章标题对应的预览分组。 */
      const groupHeading = createTextElement(
        "strong",
        "docsify-chapter-group",
        chapter.groupTitle,
      );
      chapterList.append(groupHeading);
      previousGroupTitle = chapter.groupTitle;
    }
    /** label 是单章选择行。 */
    const label = document.createElement("label");
    label.dataset.depth = String(Math.min(chapter.depth || 0, 4));
    /** checkbox 保存本章稳定路由供批量导入接口二次校验。 */
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.value = chapter.route;
    label.append(
      checkbox,
      createTextElement("span", "", `${String(chapter.order).padStart(2, "0")}  ${chapter.title}`),
      createTextElement("small", "", `${Number(chapter.characterCount || 0).toLocaleString("zh-CN")} 字符`),
    );
    chapterList.append(label);
  }
  /** skippedText 解释被自动排除的规划中或无效章节。 */
  const skippedText = inspection.skipped.length
    ? createTextElement("p", "docsify-skipped", `已自动跳过 ${inspection.skipped.length} 个无效或规划中章节。`)
    : null;
  /** importButton 是用户明确确认整站写入的操作入口。 */
  const importButton = createTextElement("button", "primary-button", "确认导入所选章节");
  importButton.type = "button";
  importButton.addEventListener("click", () => void importDocsifyInspection(importButton));
  dom.docsifyPreview.append(heading, pathText, chapterList);
  if (skippedText) dom.docsifyPreview.append(skippedText);
  dom.docsifyPreview.append(importButton);
}

/**
 * 将用户确认的教程章节批量写入本地知识库。
 *
 * @param {HTMLButtonElement} importButton 当前导入按钮。
 * @returns {Promise<void>}
 */
async function importDocsifyInspection(importButton) {
  /** inspection 是刚由服务端验证过的目录预览。 */
  const inspection = applicationState.docsifyInspection;
  if (!inspection) return;
  /** routes 是用户仍然勾选的章节路由。 */
  const routes = Array.from(
    dom.docsifyPreview.querySelectorAll('input[type="checkbox"]:checked'),
    (checkbox) => checkbox.value,
  );
  if (routes.length === 0) {
    showToast("请至少选择一个章节。");
    return;
  }
  importButton.disabled = true;
  importButton.textContent = `正在导入 ${routes.length} 个章节…`;
  try {
    /** payload 是整站写入结果和最终文件夹路径。 */
    const payload = await requestJson("/api/docsify/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: dom.articleUrlInput.value.trim(), routes }),
    });
    dom.articleUrlInput.value = "";
    dom.docsifyPreview.hidden = true;
    applicationState.docsifyInspection = null;
    await loadLibrary();
    /** targetFolder 是导入结果路径中的最末级专题文件夹。 */
    const targetFolder = payload.folderPath.at(-1);
    applicationState.activeFolderId = targetFolder?.id || "";
    renderLibrary();
    showView("library");
    showToast(
      `已导入 ${payload.importedCount} 章到“${payload.folderPath.map((folder) => folder.name).join(" / ")}”。`,
    );
  } catch (error) {
    showToast(error.message);
    importButton.disabled = false;
    importButton.textContent = "重新导入所选章节";
  }
}

/**
 * 解析并保存输入的公开文章链接，教程系列地址先进入目录预览。
 *
 * @returns {Promise<void>}
 */
async function parseArticleUrl() {
  /** inputUrl 是清理首尾空白后的文章链接。 */
  const inputUrl = dom.articleUrlInput.value.trim();
  if (!inputUrl) {
    showToast("请先输入文章链接。");
    return;
  }
  dom.parseArticleButton.disabled = true;
  /** looksLikeDocumentationSeries 识别 Docsify Hash 路由或 GitHub docs 目录。 */
  const looksLikeDocumentationSeries = /#\//.test(inputUrl)
    || /^https?:\/\/github\.com\/[^/]+\/[^/]+\/tree\/[^/]+\/.+/i.test(inputUrl);
  dom.parseArticleButton.textContent = looksLikeDocumentationSeries ? "正在识别目录…" : "正在解析正文…";
  try {
    if (looksLikeDocumentationSeries) {
      /** inspectionPayload 是服务端发现并验证后的教程目录。 */
      const inspectionPayload = await requestJson("/api/docsify/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputUrl }),
      });
      renderDocsifyPreview(inspectionPayload.inspection);
      showToast(`已识别 ${inspectionPayload.inspection.chapters.length} 个有效章节，请确认导入范围。`);
      return;
    }
    /** payload 是解析并保存后的完整文章。 */
    const payload = await requestJson("/api/articles/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: inputUrl }),
    });
    dom.articleUrlInput.value = "";
    await loadLibrary();
    showToast(`《${payload.article.title}》已保存到“${payload.article.category}”。`);
    await openArticle(payload.article.id);
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.parseArticleButton.disabled = false;
    dom.parseArticleButton.textContent = "解析并保存";
  }
}

/**
 * 将公开视频链接加入字幕优先后台导入任务。
 *
 * @returns {Promise<void>}
 */
async function importVideoUrl() {
  const inputUrl = dom.videoUrlInput.value.trim();
  if (!inputUrl) {
    showToast("请先输入视频链接。");
    return;
  }
  dom.importVideoButton.disabled = true;
  dom.importVideoButton.textContent = "正在加入任务…";
  try {
    const payload = await requestJson("/api/videos/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: inputUrl,
        preferredLanguages: ["zh-Hans", "zh-CN", "zh-Hant", "zh", "en"],
      }),
    });
    dom.videoUrlInput.value = "";
    showView("storage");
    await loadStorageOperations();
    showToast(payload.duplicate ? "相同视频已经在导入队列中。" : "视频已加入字幕导入任务。");
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.importVideoButton.disabled = false;
    dom.importVideoButton.textContent = "读取字幕并导入";
  }
}

/**
 * 渲染分类筛选按钮。
 *
 * @param {Record<string, number>} statistics 分类数量映射。
 * @returns {void}
 */
function renderCategoryTabs(statistics = {}) {
  dom.categoryTabs.replaceChildren();
  /** categoryOptions 包含“全部”和服务端允许分类。 */
  const categoryOptions = ["", ...applicationState.categories];
  for (const category of categoryOptions) {
    /** button 是单个分类筛选按钮。 */
    const button = document.createElement("button");
    /** label 是按钮展示名称。 */
    const label = category || "全部";
    /** count 是当前分类的文档数量。 */
    const count = category
      ? statistics[category] ?? 0
      : Number(dom.documentTotal.textContent) || 0;
    button.type = "button";
    button.textContent = `${label} ${count}`;
    // data-category 用于 CSS 绘制分类同色圆点；零计数的分类置灰但保留入口。
    if (category) {
      button.dataset.category = category;
    }
    button.classList.toggle("is-empty", count === 0);
    button.classList.toggle("is-active", category === applicationState.activeCategory);
    button.addEventListener("click", () => {
      applicationState.activeCategory = category;
      renderLibrary();
    });
    dom.categoryTabs.append(button);
  }
}

/**
 * 返回文档库中完成分类与收藏筛选后的项目。
 *
 * @returns {Record<string, unknown>[]} 当前可见项目。
 */
function getVisibleLibraryItems() {
  if (applicationState.searchQuery) {
    return applicationState.searchResults;
  }
  /** allItems 将上传文件和 URL 文章转换为统一知识条目。 */
  const allItems = [
    ...applicationState.documents.map((item) => ({
      ...item,
      targetType: "document",
    })),
    ...applicationState.articles.map((item) => ({
      ...item,
      targetType: "article",
    })),
  ];
  /** filteredItems 是当前文件夹或重点视图中的最终候选内容。 */
  const filteredItems = allItems
    .filter(
      (item) =>
        (applicationState.favoriteOnly
          ? item.isFavorite
          : Boolean(applicationState.activeFolderId) &&
            item.folderId === applicationState.activeFolderId),
    );
  /** hasExplicitFolderOrder 表示当前文件夹包含教程导入时保存的章节顺序。 */
  const hasExplicitFolderOrder = Boolean(applicationState.activeFolderId)
    && !applicationState.favoriteOnly
    && filteredItems.some((item) => Number(item.folderSortOrder) > 0);
  return filteredItems.sort((left, right) => {
    if (hasExplicitFolderOrder) {
      /** orderDifference 是两项在原站目录中的先后差。 */
      const orderDifference = Number(left.folderSortOrder) - Number(right.folderSortOrder);
      if (orderDifference !== 0) return orderDifference;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

/**
 * 打开统一知识条目对应的阅读页面。
 *
 * @param {Record<string, unknown>} item 统一知识条目。
 * @returns {void}
 */
function openKnowledgeItem(item) {
  if (item.targetType === "article") void openArticle(item.targetId || item.id);
  else if (item.targetType === "paper") void openPaper(item.targetId || item.id);
  else void openDocument(item.targetId || item.id);
}

/** cardTypeLabels 是卡片类型代码对应的中文名称。 */
const cardTypeLabels = Object.freeze({
  concept: "概念卡",
  principle: "原理卡",
  compare: "对比卡",
  engineering: "工程卡",
  qa: "问答卡",
  formula: "公式卡",
  fault: "故障卡",
});

/**
 * 打开知识卡片来源对应的阅读页。
 *
 * @param {Record<string, unknown>} card 知识卡片。
 * @returns {void}
 */
function openKnowledgeCardSource(card) {
  openKnowledgeItem({ targetType: card.targetType, targetId: card.targetId });
}

/**
 * 使用最近一次正文选区打开知识卡片编辑窗口。
 *
 * @returns {void}
 */
function openKnowledgeCardComposer() {
  /** workspace 是当前阅读内容的来源上下文。 */
  const workspace = applicationState.readingWorkspace;
  /** selection 是最近一次有效正文选区及字符锚点。 */
  const selection = applicationState.pendingReadingSelection;
  if (!workspace || !selection) {
    showToast("请先在正文中选择一段原文。");
    return;
  }
  /** questionSubject 是用于生成可编辑问题草稿的短选区。 */
  const questionSubject = selection.quoteText.replace(/\s+/g, " ").slice(0, 42);
  dom.knowledgeCardType.value = "concept";
  dom.knowledgeCardQuestion.value = `关于“${questionSubject}${selection.quoteText.length > 42 ? "…" : ""}”，核心知识点是什么？`;
  dom.knowledgeCardAnswer.value = selection.quoteText;
  dom.knowledgeCardSource.value = selection.quoteText;
  dom.knowledgeCardDialog.showModal();
  dom.knowledgeCardQuestion.focus();
  dom.knowledgeCardQuestion.select();
}

/**
 * 保存用户确认后的来源知识卡片。
 *
 * @returns {Promise<void>}
 */
async function saveKnowledgeCard() {
  /** workspace 是卡片来源所属的阅读上下文。 */
  const workspace = applicationState.readingWorkspace;
  /** selection 是卡片来源选区及字符锚点。 */
  const selection = applicationState.pendingReadingSelection;
  if (!workspace || !selection) throw new Error("卡片来源选区已经失效，请重新选择原文。");
  /** payload 是服务端确认保存后的卡片。 */
  const payload = await requestJson("/api/knowledge-cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetType: workspace.targetType,
      targetId: workspace.targetId,
      cardType: dom.knowledgeCardType.value,
      question: dom.knowledgeCardQuestion.value.trim(),
      answer: dom.knowledgeCardAnswer.value.trim(),
      sourceQuote: selection.quoteText,
      anchorStart: selection.anchorStart,
      anchorEnd: selection.anchorEnd,
    }),
  });
  dom.knowledgeCardDialog.close();
  applicationState.pendingReadingSelection = null;
  window.getSelection()?.removeAllRanges();
  await loadKnowledgeCards();
  showToast(`已创建${cardTypeLabels[payload.card.cardType] || "知识卡片"}并加入今日复习。`);
}

/**
 * 渲染全部卡片库和当前今日复习卡。
 *
 * @returns {void}
 */
function renderKnowledgeCards() {
  dom.cardTotal.textContent = String(applicationState.knowledgeCards.length);
  dom.cardDueTotal.textContent = String(applicationState.dueKnowledgeCards.length);
  dom.knowledgeCardGrid.replaceChildren();
  dom.knowledgeCardEmpty.hidden = applicationState.knowledgeCards.length > 0;
  dom.knowledgeCardGrid.hidden = applicationState.knowledgeCards.length === 0;
  for (const cardItem of applicationState.knowledgeCards) {
    /** card 是卡片库中的完整问答卡片。 */
    const card = document.createElement("article");
    card.className = "knowledge-card-item";
    /** footer 是来源返回和删除操作区。 */
    const footer = document.createElement("footer");
    /** sourceButton 是返回卡片原始文档、文章或论文的入口。 */
    const sourceButton = createTextElement("button", "text-button", "查看来源");
    sourceButton.type = "button";
    sourceButton.addEventListener("click", () => openKnowledgeCardSource(cardItem));
    /** deleteButton 是具有二次确认的卡片删除入口。 */
    const deleteButton = createTextElement("button", "danger-button", "删除卡片");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => void deleteKnowledgeCardItem(cardItem));
    footer.append(sourceButton, deleteButton);
    card.append(
      createTextElement("span", "knowledge-card-type", cardTypeLabels[cardItem.cardType] || "知识卡"),
      createTextElement("h3", "", cardItem.question),
      createTextElement("p", "knowledge-card-answer", cardItem.answer),
      createTextElement("blockquote", "knowledge-card-source", cardItem.sourceQuote),
      createTextElement("small", "", `来源：${cardItem.sourceTitle} · 已复习 ${cardItem.reviewCount} 次 · 下次 ${formatDate(cardItem.dueAt)}`),
      footer,
    );
    dom.knowledgeCardGrid.append(card);
  }
  renderTodayReview();
}

/**
 * 渲染今日复习队列中的当前卡片。
 *
 * @returns {void}
 */
function renderTodayReview() {
  /** dueCards 是截至现在已经到期的卡片队列。 */
  const dueCards = applicationState.dueKnowledgeCards;
  /** currentCard 是用户当前要回忆的卡片。 */
  const currentCard = dueCards[applicationState.activeReviewIndex] || null;
  dom.reviewPosition.textContent = `${currentCard ? applicationState.activeReviewIndex + 1 : 0} / ${dueCards.length}`;
  dom.reviewEmpty.hidden = Boolean(currentCard);
  dom.reviewCard.hidden = !currentCard;
  if (!currentCard) return;
  dom.reviewCardType.textContent = cardTypeLabels[currentCard.cardType] || "知识卡";
  dom.reviewQuestion.textContent = currentCard.question;
  dom.reviewAnswerText.textContent = currentCard.answer;
  dom.reviewSourceQuote.textContent = currentCard.sourceQuote;
  dom.reviewAnswer.hidden = true;
  dom.reviewRating.hidden = true;
  dom.reviewRevealButton.hidden = false;
}

/**
 * 从本地服务加载全部卡片和今日到期队列。
 *
 * @returns {Promise<void>}
 */
async function loadKnowledgeCards() {
  /** responses 是全部卡片和到期卡片的并行响应。 */
  const [allPayload, duePayload] = await Promise.all([
    requestJson("/api/knowledge-cards"),
    requestJson("/api/knowledge-cards?due=1"),
  ]);
  applicationState.knowledgeCards = allPayload.cards;
  applicationState.dueKnowledgeCards = duePayload.cards;
  applicationState.activeReviewIndex = 0;
  renderKnowledgeCards();
}

/**
 * 提交当前卡片复习结果并刷新下一张。
 *
 * @param {string} rating again、hard、good 或 easy。
 * @returns {Promise<void>}
 */
async function submitKnowledgeCardReview(rating) {
  /** currentCard 是当前复习队列中的卡片。 */
  const currentCard = applicationState.dueKnowledgeCards[applicationState.activeReviewIndex];
  if (!currentCard) return;
  await requestJson(`/api/knowledge-cards/${encodeURIComponent(currentCard.id)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  await loadKnowledgeCards();
}

/**
 * 二次确认后删除一张知识卡片。
 *
 * @param {Record<string, unknown>} card 卡片对象。
 * @returns {Promise<void>}
 */
async function deleteKnowledgeCardItem(card) {
  if (!window.confirm(`确定删除卡片“${card.question}”吗？此操作无法撤销。`)) return;
  await requestJson(`/api/knowledge-cards/${encodeURIComponent(card.id)}`, { method: "DELETE" });
  await loadKnowledgeCards();
  showToast("知识卡片已删除。");
}

/**
 * 向元素追加带安全关键词高亮的纯文本。
 *
 * @param {HTMLElement} container 承载文本的元素。
 * @param {string} text 原始文本。
 * @param {string} query 搜索关键词。
 * @returns {void}
 */
function appendHighlightedText(container, text, query) {
  /** sourceText 是确保为字符串的展示内容。 */
  const sourceText = String(text ?? "");
  /** normalizedQuery 是忽略首尾空白的关键词。 */
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    container.textContent = sourceText;
    return;
  }
  /** expression 是转义正则特殊符号后的安全匹配规则。 */
  const expression = new RegExp(`(${normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  for (const segment of sourceText.split(expression)) {
    if (!segment) continue;
    if (segment.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase()) {
      /** mark 是单个关键词命中的高亮节点。 */
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = segment;
      container.append(mark);
    } else {
      container.append(document.createTextNode(segment));
    }
  }
}

/**
 * 将某个知识条目的收藏状态写入本地数据库。
 *
 * @param {Record<string, unknown>} item 文件或网页文章。
 * @returns {Promise<void>}
 */
async function toggleFavorite(item) {
  /** nextActive 是用户点击后期望得到的收藏状态。 */
  const nextActive = !item.isFavorite;
  try {
    await requestJson("/api/favorites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: item.targetType,
        targetId: item.id,
        active: nextActive,
      }),
    });
    /** sourceCollection 是该条目所属的前端缓存列表。 */
    const sourceCollection =
      item.targetType === "document"
        ? applicationState.documents
        : applicationState.articles;
    /** cachedItem 是需要同步更新的前端缓存对象。 */
    const cachedItem = sourceCollection.find((candidate) => candidate.id === item.id);
    if (cachedItem) cachedItem.isFavorite = nextActive;
    renderLibrary();
    showToast(nextActive ? "已标记为重点文档。" : "已取消重点标记。");
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 经用户二次确认后永久删除文档、网页文章或论文。
 *
 * @param {Record<string, unknown>} item 待删除的统一知识条目。
 * @returns {Promise<void>}
 */
async function deleteKnowledgeItem(item) {
  /** targetType 是服务端允许删除的知识内容类型。 */
  const targetType = String(item.targetType || "");
  /** targetId 是目标内容的本地稳定 ID。 */
  const targetId = String(item.targetId || item.id || "");
  /** typeLabel 是确认弹窗中显示的中文类型。 */
  const typeLabel =
    targetType === "paper"
      ? "论文"
      : targetType === "article"
        ? "网页文章"
        : "文档";
  /** title 是确认弹窗中显示的内容标题。 */
  const title = String(item.titleZh || item.title || "未命名内容");
  if (!targetId || !["document", "article", "paper"].includes(targetType)) {
    showToast("无法识别要删除的内容。");
    return;
  }
  /** confirmed 表示用户已明确接受永久删除和不可恢复的后果。 */
  const confirmed = window.confirm(
    `确定永久删除这份${typeLabel}吗？\n\n《${title}》\n\n相关阅读进度、批注、标签和专题关系也会删除。此操作无法撤销。`,
  );
  if (!confirmed) return;
  /** endpoint 是不同内容类型对应的删除接口。 */
  const endpoint = `/api/${targetType === "paper" ? "papers" : `${targetType}s`}/${encodeURIComponent(targetId)}`;
  try {
    await requestJson(endpoint, { method: "DELETE" });
    if (applicationState.readingWorkspace?.targetId === targetId) {
      closeReadingWorkspace();
    }
    if (applicationState.selectedDocument?.id === targetId) {
      applicationState.selectedDocument = null;
    }
    if (applicationState.selectedArticle?.id === targetId) {
      applicationState.selectedArticle = null;
    }
    if (applicationState.selectedPaper?.id === targetId) {
      applicationState.selectedPaper = null;
    }
    await Promise.all([loadLibrary(), loadPapers(), loadTopics()]);
    showView(targetType === "paper" ? "papers" : "library");
    showToast(`《${title}》已永久删除。`);
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 返回当前文件夹从根目录开始的路径。
 *
 * @returns {Record<string, unknown>[]} 当前文件夹面包屑。
 */
function getActiveFolderPath() {
  /** activeFolder 是当前打开的文件夹。 */
  const activeFolder = applicationState.folders.find(
    (folder) => folder.id === applicationState.activeFolderId,
  );
  return activeFolder?.path || [];
}

/**
 * 打开一个文件夹并清除与目录视图冲突的虚拟筛选。
 *
 * @param {string} folderId 目标文件夹 ID；空值表示根目录。
 * @returns {void}
 */
function openFolder(folderId) {
  applicationState.activeFolderId = String(folderId || "");
  applicationState.favoriteOnly = false;
  renderLibrary();
}

/**
 * 渲染文件系统式面包屑导航。
 *
 * @returns {void}
 */
function renderFolderBreadcrumbs() {
  dom.folderBreadcrumbs.replaceChildren();
  /** rootButton 是返回文档库根目录的入口。 */
  const rootButton = createTextElement("button", "folder-breadcrumb", "文档库");
  rootButton.type = "button";
  rootButton.addEventListener("click", () => openFolder(""));
  dom.folderBreadcrumbs.append(rootButton);
  for (const folder of getActiveFolderPath()) {
    dom.folderBreadcrumbs.append(createTextElement("span", "", "›"));
    /** folderButton 是路径中的可点击祖先目录。 */
    const folderButton = createTextElement("button", "folder-breadcrumb", folder.name);
    folderButton.type = "button";
    folderButton.addEventListener("click", () => openFolder(folder.id));
    dom.folderBreadcrumbs.append(folderButton);
  }
  dom.folderBreadcrumbs.hidden = Boolean(applicationState.searchQuery || applicationState.favoriteOnly);
}

/**
 * 请求创建当前层级下的新文件夹。
 *
 * @returns {Promise<void>}
 */
async function createLibraryFolder() {
  /** folderName 是用户输入的新文件夹名称。 */
  const folderName = window.prompt("请输入新文件夹名称：");
  if (!folderName?.trim()) return;
  try {
    /** payload 是创建后的文件夹树。 */
    const payload = await requestJson("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId: applicationState.activeFolderId || null,
        name: folderName.trim(),
      }),
    });
    applicationState.folders = payload.folders;
    renderLibrary();
    showToast(`文件夹“${payload.folder.name}”已创建。`);
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 请求重命名单个文件夹。
 *
 * @param {Record<string, unknown>} folder 文件夹对象。
 * @returns {Promise<void>}
 */
async function renameLibraryFolder(folder) {
  /** nextName 是用户确认的新名称。 */
  const nextName = window.prompt("修改文件夹名称：", folder.name);
  if (!nextName?.trim() || nextName.trim() === folder.name) return;
  try {
    /** payload 是更新后的文件夹树。 */
    const payload = await requestJson(`/api/folders/${encodeURIComponent(folder.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName.trim() }),
    });
    applicationState.folders = payload.folders;
    renderLibrary();
    showToast("文件夹已重命名。");
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 二次确认后删除一个空文件夹。
 *
 * @param {Record<string, unknown>} folder 文件夹对象。
 * @returns {Promise<void>}
 */
async function deleteLibraryFolder(folder) {
  if (!window.confirm(`确定删除空文件夹“${folder.name}”吗？\n\n含有内容或子文件夹时系统会拒绝删除。`)) return;
  try {
    /** payload 是删除后的文件夹树。 */
    const payload = await requestJson(`/api/folders/${encodeURIComponent(folder.id)}`, {
      method: "DELETE",
    });
    applicationState.folders = payload.folders;
    renderLibrary();
    showToast("空文件夹已删除。");
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 渲染当前层级的直接子文件夹。
 *
 * @returns {void}
 */
function renderFolderGrid() {
  dom.folderGrid.replaceChildren();
  /** directoryMode 表示当前不是搜索或重点收藏虚拟视图。 */
  const directoryMode = !applicationState.searchQuery && !applicationState.favoriteOnly;
  dom.folderGrid.hidden = !directoryMode;
  if (!directoryMode) return;
  /** childFolders 是当前层级下的直接子目录。 */
  const childFolders = applicationState.folders.filter(
    (folder) => (folder.parentId || "") === applicationState.activeFolderId,
  );
  for (const folder of childFolders) {
    /** card 是单个文件夹卡片。 */
    const card = document.createElement("article");
    card.className = "folder-card";
    /** openButton 是进入文件夹的主要点击区域。 */
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "folder-card-open";
    openButton.addEventListener("click", () => openFolder(folder.id));
    openButton.append(
      createTextElement("span", "folder-icon", "▰"),
      createTextElement("h3", "", folder.name),
      createTextElement(
        "p",
        "",
        `${folder.itemCount} 项内容${folder.childCount ? ` · ${folder.childCount} 个子文件夹` : ""}`,
      ),
    );
    /** actions 是重命名和安全删除入口。 */
    const actions = document.createElement("div");
    actions.className = "folder-card-actions";
    /** renameButton 是文件夹重命名按钮。 */
    const renameButton = createTextElement("button", "", "重命名");
    renameButton.type = "button";
    renameButton.addEventListener("click", () => void renameLibraryFolder(folder));
    /** deleteButton 是仅删除空文件夹的按钮。 */
    const deleteButton = createTextElement("button", "is-danger", "删除");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => void deleteLibraryFolder(folder));
    actions.append(renameButton, deleteButton);
    card.append(openButton, actions);
    dom.folderGrid.append(card);
  }
}

/**
 * 打开居中的文件夹选择窗口，让用户直接点击目标位置。
 *
 * @param {Record<string, unknown>} item 文档或网页文章。
 * @returns {void}
 */
function moveKnowledgeItem(item) {
  /** folderOptions 是按完整路径排序的所有可选目录。 */
  const folderOptions = [...applicationState.folders].sort((left, right) =>
    left.path.map((part) => part.name).join("/").localeCompare(
      right.path.map((part) => part.name).join("/"),
      "zh-CN",
    ),
  );
  applicationState.pendingMoveItem = item;
  applicationState.selectedMoveFolderId = "";
  dom.moveFolderItemTitle.textContent = `《${item.title}》`;
  dom.moveFolderConfirm.disabled = true;
  dom.moveFolderOptions.replaceChildren();
  for (const folder of folderOptions) {
    /** optionButton 是无需输入编号即可选择的单个文件夹。 */
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "move-folder-option";
    optionButton.setAttribute("role", "option");
    optionButton.setAttribute("aria-selected", "false");
    optionButton.style.paddingLeft = `${12 + Math.min(folder.path.length - 1, 4) * 14}px`;
    /** optionText 包含文件夹名称和完整路径，避免同名目录混淆。 */
    const optionText = document.createElement("span");
    optionText.append(
      createTextElement("strong", "", folder.name),
      createTextElement("small", "", folder.path.map((part) => part.name).join(" / ")),
    );
    optionButton.append(optionText);
    optionButton.addEventListener("click", () => {
      applicationState.selectedMoveFolderId = folder.id;
      for (const candidateButton of dom.moveFolderOptions.querySelectorAll(".move-folder-option")) {
        /** selected 表示当前按钮是否就是用户最后点击的目标。 */
        const selected = candidateButton === optionButton;
        candidateButton.classList.toggle("is-selected", selected);
        candidateButton.setAttribute("aria-selected", String(selected));
      }
      dom.moveFolderConfirm.disabled = false;
    });
    dom.moveFolderOptions.append(optionButton);
  }
  dom.moveFolderDialog.showModal();
}

/**
 * 将移动窗口中确认的内容写入选中文件夹。
 *
 * @returns {Promise<void>}
 */
async function confirmMoveKnowledgeItem() {
  /** item 是打开移动窗口时保存的知识条目。 */
  const item = applicationState.pendingMoveItem;
  /** targetFolder 是用户鼠标点击选中的目标目录。 */
  const targetFolder = applicationState.folders.find(
    (folder) => folder.id === applicationState.selectedMoveFolderId,
  );
  if (!item || !targetFolder) return;
  dom.moveFolderConfirm.disabled = true;
  try {
    await requestJson("/api/folder-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: item.targetType,
        targetId: item.id,
        folderId: targetFolder.id,
      }),
    });
    dom.moveFolderDialog.close();
    applicationState.pendingMoveItem = null;
    applicationState.selectedMoveFolderId = "";
    await loadLibrary();
    showToast(`已移动到“${targetFolder.path.map((part) => part.name).join(" / ")}”。`);
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.moveFolderConfirm.disabled = false;
  }
}

/**
 * 渲染上传文件与 URL 文章组成的统一文档卡片列表。
 *
 * @returns {void}
 */
function renderDocumentGrid() {
  /** visibleItems 是经过分类和重点状态筛选的统一条目。 */
  const visibleItems = getVisibleLibraryItems();
  /** childFolderCount 是当前目录下直接子文件夹数量。 */
  const childFolderCount = applicationState.folders.filter(
    (folder) => (folder.parentId || "") === applicationState.activeFolderId,
  ).length;
  dom.documentGrid.replaceChildren();
  dom.emptyState.hidden = visibleItems.length > 0 || childFolderCount > 0;
  dom.documentGrid.hidden = visibleItems.length === 0;
  for (const documentItem of visibleItems) {
    /** card 是同时容纳打开操作与收藏操作的卡片容器。 */
    const card = document.createElement("article");
    card.className = "document-card";
    card.dataset.category = documentItem.category;
    /** openButton 是打开对应文件阅读页或文章阅读页的主要操作。 */
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "library-card-open";
    openButton.addEventListener("click", () => openKnowledgeItem(documentItem));
    /** favoriteButton 用星标区分重点文档与普通文档。 */
    const favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "favorite-button";
    favoriteButton.hidden = documentItem.targetType === "paper" || Boolean(applicationState.searchQuery);
    favoriteButton.classList.toggle("is-active", Boolean(documentItem.isFavorite));
    favoriteButton.textContent = documentItem.isFavorite ? "★" : "☆";
    favoriteButton.title = documentItem.isFavorite ? "取消重点" : "标记为重点";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
    favoriteButton.setAttribute("aria-pressed", String(Boolean(documentItem.isFavorite)));
    favoriteButton.addEventListener("click", () => void toggleFavorite(documentItem));
    /** deleteButton 是需要二次确认的永久删除入口。 */
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "content-delete-button";
    deleteButton.textContent = "删除";
    deleteButton.title = `删除《${documentItem.title}》`;
    deleteButton.setAttribute("aria-label", deleteButton.title);
    deleteButton.addEventListener("click", () =>
      void deleteKnowledgeItem(documentItem),
    );
    /** moveButton 是把内容移动到其它主要文件夹的入口。 */
    const moveButton = document.createElement("button");
    moveButton.type = "button";
    moveButton.className = "content-move-button";
    moveButton.textContent = "移动";
    moveButton.title = `移动《${documentItem.title}》`;
    moveButton.addEventListener("click", () => moveKnowledgeItem(documentItem));

    /** metadata 是卡片顶部分类和日期。 */
    const metadata = document.createElement("div");
    metadata.className = "document-card-meta";
    metadata.append(
      createTextElement("span", "", documentItem.category),
      createTextElement("span", "", formatDate(documentItem.updatedAt)),
    );
    /** footer 是卡片底部格式和容量。 */
    const footer = document.createElement("footer");
    footer.append(
      createTextElement(
        "span",
        "",
        documentItem.targetType === "article"
          ? documentItem.sourceType === "wechat"
            ? "微信公众号"
            : documentItem.sourceType === "video"
              ? "视频字幕"
            : "网页文章"
          : documentItem.targetType === "paper"
            ? "论文"
          : (documentItem.extension || "文件").replace(".", "").toUpperCase(),
      ),
      createTextElement(
        "span",
        "",
        documentItem.targetType === "article"
          ? `${Number(documentItem.wordCount || 0).toLocaleString("zh-CN")} 字`
          : documentItem.targetType === "paper"
            ? "中英文阅读"
            : formatFileSize(documentItem.sizeBytes),
      ),
    );
    /** title 是支持搜索关键词高亮的卡片标题。 */
    const title = document.createElement("h3");
    appendHighlightedText(title, documentItem.title, applicationState.searchQuery);
    /** summary 是正文摘要或搜索命中片段。 */
    const summary = document.createElement("p");
    appendHighlightedText(
      summary,
      documentItem.excerpt || documentItem.summary,
      applicationState.searchQuery,
    );
    openButton.append(
      metadata,
      title,
      summary,
      ...(documentItem.matchSource
        ? [createTextElement("small", "search-match-source", `命中：${documentItem.matchSource}`)]
        : []),
      footer,
    );
    /** actionGroup 把收藏和删除固定在独立操作列，避免与来源文字重叠。 */
    const actionGroup = document.createElement("div");
    actionGroup.className = "document-card-actions";
    actionGroup.append(favoriteButton, moveButton, deleteButton);
    card.append(openButton, actionGroup);
    dom.documentGrid.append(card);
  }
}

/**
 * 刷新统一文档库的数量、分类与卡片。
 *
 * @returns {void}
 */
function renderLibrary() {
  /** allItems 是用于统计的全部当前搜索结果。 */
  const allItems = applicationState.searchQuery
    ? applicationState.searchResults
    : [...applicationState.documents, ...applicationState.articles];
  dom.documentTotal.textContent = String(allItems.length);
  dom.favoriteFilterButton.classList.toggle(
    "is-active",
    applicationState.favoriteOnly,
  );
  dom.favoriteFilterButton.disabled = Boolean(applicationState.searchQuery);
  dom.favoriteFilterButton.textContent = applicationState.favoriteOnly
    ? "★ 正在查看重点"
    : "☆ 只看重点";
  dom.favoriteFilterButton.setAttribute(
    "aria-pressed",
    String(applicationState.favoriteOnly),
  );
  dom.newFolderButton.disabled = Boolean(
    applicationState.searchQuery || applicationState.favoriteOnly,
  );
  renderFolderBreadcrumbs();
  renderFolderGrid();
  renderDocumentGrid();
}

/**
 * 渲染知识库标签筛选按钮。
 *
 * @returns {void}
 */
function renderTagFilters() {
  dom.tagFilterRow.replaceChildren();
  if (applicationState.tags.length === 0) return;
  dom.tagFilterRow.append(createTextElement("span", "tag-filter-label", "标签"));
  /** allButton 是清除标签筛选的入口。 */
  const allButton = createTextElement("button", "tag-filter-button", "全部");
  allButton.type = "button";
  allButton.classList.toggle("is-active", !applicationState.activeTag);
  allButton.addEventListener("click", () => {
    applicationState.activeTag = "";
    renderLibrary();
  });
  dom.tagFilterRow.append(allButton);
  for (const tag of applicationState.tags) {
    /** button 是单个标签筛选按钮。 */
    const button = createTextElement("button", "tag-filter-button", `${tag.name} ${tag.itemCount}`);
    button.type = "button";
    button.classList.toggle("is-active", applicationState.activeTag === tag.name);
    button.addEventListener("click", () => {
      applicationState.activeTag = applicationState.activeTag === tag.name ? "" : tag.name;
      renderLibrary();
    });
    dom.tagFilterRow.append(button);
  }
}

/**
 * 从本地数据库同时加载上传文件与 URL 文章。
 *
 * @returns {Promise<void>}
 */
async function loadLibrary() {
  if (applicationState.searchQuery) {
    /** parameters 是统一搜索接口的关键词参数。 */
    const parameters = new URLSearchParams({ q: applicationState.searchQuery });
    /** searchPayload 是跨全部内容和个人笔记的搜索响应。 */
    const searchPayload = await requestJson(`/api/search?${parameters}`);
    applicationState.searchResults = searchPayload.results;
  } else {
    /** documentRequest 是上传文件列表请求。 */
    const documentRequest = requestJson("/api/documents");
    /** articleRequest 是 URL 文章列表请求。 */
    const articleRequest = requestJson("/api/articles");
    /** folderRequest 是树形文件夹及累计数量请求。 */
    const folderRequest = requestJson("/api/folders");
    /** responses 是文档、文章和文件夹并行返回的结果。 */
    const [documentPayload, articlePayload, folderPayload] = await Promise.all([
      documentRequest,
      articleRequest,
      folderRequest,
    ]);
    applicationState.documents = documentPayload.documents;
    applicationState.articles = articlePayload.articles;
    applicationState.folders = folderPayload.folders;
    applicationState.searchResults = [];
  }
  renderLibrary();
}

/**
 * 渲染专题列表。
 *
 * @returns {void}
 */
function renderTopics() {
  dom.topicGrid.replaceChildren();
  for (const topic of applicationState.topics) {
    /** button 是展开专题详情的卡片按钮。 */
    const button = document.createElement("button");
    button.type = "button";
    button.className = "topic-card";
    button.classList.toggle("is-active", topic.id === applicationState.activeTopicId);
    button.append(
      createTextElement("span", "topic-card-count", `${topic.itemCount} 项内容`),
      createTextElement("h3", "", topic.name),
      createTextElement("p", "", topic.description || "尚未填写专题说明。"),
    );
    button.addEventListener("click", () => void openTopic(topic.id));
    dom.topicGrid.append(button);
  }
  if (applicationState.topics.length === 0) {
    dom.topicGrid.append(createTextElement("p", "topic-empty", "还没有专题，从右上方创建第一条学习路线。"));
  }
}

/**
 * 打开一个专题并加载其中的知识条目。
 *
 * @param {string} topicId 专题 ID。
 * @returns {Promise<void>}
 */
async function openTopic(topicId) {
  /** topic 是当前专题元数据。 */
  const topic = applicationState.topics.find((item) => item.id === topicId);
  if (!topic) return;
  /** payload 是专题内容接口响应。 */
  const payload = await requestJson(`/api/topics/${encodeURIComponent(topicId)}/items`);
  applicationState.activeTopicId = topicId;
  dom.topicDetailTitle.textContent = topic.name;
  dom.topicDetailDescription.textContent = topic.description || "这个专题还没有说明。";
  dom.topicItemList.replaceChildren();
  for (const item of payload.items) {
    /** button 是打开专题内容的列表项。 */
    const button = document.createElement("button");
    button.type = "button";
    button.className = "topic-item";
    button.append(
      createTextElement("span", "", `${item.category} · ${item.targetType === "paper" ? "论文" : item.targetType === "article" ? "网页" : "文档"}`),
      createTextElement("strong", "", item.title),
      createTextElement("p", "", item.summary || "暂无摘要"),
    );
    button.addEventListener("click", () => openKnowledgeItem(item));
    dom.topicItemList.append(button);
  }
  if (payload.items.length === 0) {
    dom.topicItemList.append(createTextElement("p", "topic-empty", "专题还是空的。阅读内容时，可从右侧工作台加入本专题。"));
  }
  renderTopics();
}

/**
 * 从本地数据库加载专题列表。
 *
 * @returns {Promise<void>}
 */
async function loadTopics() {
  /** payload 是专题列表接口响应。 */
  const payload = await requestJson("/api/topics");
  applicationState.topics = payload.topics;
  renderTopics();
  if (applicationState.activeTopicId && applicationState.topics.some((topic) => topic.id === applicationState.activeTopicId)) {
    await openTopic(applicationState.activeTopicId);
  }
}

/**
 * 创建用户填写的学习专题。
 *
 * @returns {Promise<void>}
 */
async function createLearningTopic() {
  /** name 是用户输入的专题名称。 */
  const name = dom.topicNameInput.value.trim();
  if (!name) return;
  /** payload 是专题创建接口响应。 */
  const payload = await requestJson("/api/topics", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: dom.topicDescriptionInput.value.trim() }) });
  dom.topicCreateForm.reset();
  applicationState.activeTopicId = payload.topic.id;
  await loadTopics();
  showToast("专题已创建，可在阅读工作台中加入内容。");
}

/**
 * 将论文作者列表压缩成适合卡片展示的文本。
 *
 * @param {string[]} authors 完整作者列表。
 * @returns {string} 最多展示四位作者的文本。
 */
function formatPaperAuthors(authors = []) {
  /** visibleAuthors 是卡片直接展示的前四位作者。 */
  const visibleAuthors = authors.slice(0, 4);
  if (visibleAuthors.length === 0) return "作者信息暂缺";
  return `${visibleAuthors.join("、")}${authors.length > 4 ? " 等" : ""}`;
}

/**
 * 创建论文来源或 PDF 外部链接。
 *
 * @param {string} label 链接显示文字。
 * @param {string} url 公开论文地址。
 * @param {string} className 链接视觉样式。
 * @returns {HTMLAnchorElement} 安全打开新标签页的链接。
 */
function createPaperLink(label, url, className) {
  /** link 是论文卡片中的外部链接。 */
  const link = document.createElement("a");
  link.textContent = label;
  link.href = url;
  link.className = className;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

/**
 * 创建站内论文中文阅读按钮。
 *
 * @param {Record<string, unknown>} paper 论文列表对象。
 * @returns {HTMLButtonElement} 打开站内阅读页的按钮。
 */
function createPaperReaderButton(paper) {
  /** button 是论文卡片中的中文阅读操作。 */
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary-button";
  button.textContent = paper.sourceType === "mli" ? "中文解读" : "中文阅读";
  button.addEventListener("click", () => void openPaper(paper.id));
  return button;
}

/**
 * 重新启动一篇失败论文的公开 PDF 下载和全文提取。
 *
 * @param {Record<string, unknown>} paper 待重试论文。
 * @param {HTMLButtonElement} button 用户点击的重试按钮。
 * @returns {Promise<void>}
 */
async function retryPaperExtraction(paper, button) {
  button.disabled = true;
  button.textContent = "正在重试…";
  try {
    await requestJson(`/api/papers/${encodeURIComponent(paper.id)}/retry-extraction`, {
      method: "POST",
    });
    showToast("已重新开始下载和解析，完成后会自动进入 Codex 翻译队列。");
    await loadPapers();
    window.setTimeout(() => void loadPapers(), 4_000);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "重试解析";
  }
}

/**
 * 渲染已经由用户选入本地论文库的论文卡片。
 *
 * @returns {void}
 */
function renderPapers() {
  dom.paperTotal.textContent = String(applicationState.papers.length);
  dom.paperGrid.replaceChildren();
  dom.paperGrid.hidden = applicationState.papers.length === 0;
  dom.paperEmptyState.hidden = applicationState.papers.length > 0;
  for (const paper of applicationState.papers) {
    /** card 是论文库中的单篇论文卡片。 */
    const card = document.createElement("article");
    card.className = "paper-card";
    /** metadata 是论文分类和发表日期。 */
    const metadata = document.createElement("div");
    metadata.className = "paper-card-meta";
    metadata.append(
      createTextElement("span", "", paper.category),
      createTextElement(
        "span",
        "",
        paper.publishedAt ? formatDate(paper.publishedAt) : "日期暂缺",
      ),
    );
    /** footer 是中文阅读、论文来源和公开 PDF 操作区。 */
    const footer = document.createElement("footer");
    /** readerButton 是只在已有可读正文或中文译文时启用的站内阅读入口。 */
    const readerButton = createPaperReaderButton(paper);
    readerButton.disabled = Boolean(paper.pdfUrl && !paper.sourceText && !paper.fullTranslationHtml);
    footer.append(
      readerButton,
      createPaperLink(
        paper.sourceType === "weekly" ? "arXiv 原文" : "论文原文",
        paper.sourceUrl,
        "secondary-button",
      ),
    );
    if (paper.pdfUrl) {
      footer.append(
        createPaperLink("英文 PDF", paper.pdfUrl, "secondary-button"),
      );
    }
    if (paper.extractionError) {
      /** retryButton 是远程下载或 PDF 提取失败后的显式恢复操作。 */
      const retryButton = createTextElement("button", "secondary-button", "重试解析");
      retryButton.type = "button";
      retryButton.addEventListener("click", () => void retryPaperExtraction(paper, retryButton));
      footer.append(retryButton);
    }
    /** deleteButton 是需要二次确认的论文永久删除入口。 */
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () =>
      void deleteKnowledgeItem({ ...paper, targetType: "paper" }),
    );
    footer.append(deleteButton);
    /** title 是优先展示 Codex 中文翻译的论文标题。 */
    const title = createTextElement("h3", "", paper.titleZh || paper.title);
    /** contentElements 是按阅读顺序放入论文卡片的元素。 */
    const contentElements = [
      metadata,
      createTextElement(
        "span",
        "paper-source-label",
        paper.sourceLabel || "每周精选",
      ),
      title,
    ];
    if (paper.titleZh) {
      contentElements.push(
        createTextElement("p", "paper-original-title", paper.title),
      );
    }
    /** processingLabel 是论文从下载、解析到 Codex 翻译的当前可读状态。 */
    const processingLabel = paper.extractionError
      ? `PDF 解析失败：${paper.extractionError}`
      : paper.titleZh
        ? "Codex 中文翻译"
        : paper.pdfUrl && !paper.sourceText
          ? "正在后台下载并解析 PDF"
          : "等待 Codex 翻译";
    contentElements.push(
      createTextElement(
        "span",
        `paper-translation-state ${paper.titleZh ? "is-translated" : ""} ${paper.extractionError ? "is-failed" : ""}`,
        processingLabel,
      ),
      createTextElement(
        "p",
        "paper-authors",
        formatPaperAuthors(paper.authors),
      ),
      createTextElement(
        "p",
        "paper-abstract",
        paper.abstractZh || paper.abstract || "该论文暂未提供摘要。",
      ),
      ...(paper.curatorNote
        ? [createTextElement("p", "paper-curator-note", paper.curatorNote)]
        : []),
      footer,
    );
    card.replaceChildren(...contentElements);
    dom.paperGrid.append(card);
  }
}

/**
 * 从本地数据库加载已经选定的论文。
 *
 * @returns {Promise<void>}
 */
async function loadPapers() {
  try {
    /** queryString 是当前论文来源筛选参数。 */
    const queryString = applicationState.activePaperSource
      ? `?source=${encodeURIComponent(applicationState.activePaperSource)}`
      : "";
    /** payload 是本地论文列表接口响应。 */
    const payload = await requestJson(`/api/papers${queryString}`);
    applicationState.papers = payload.papers;
    renderPapers();
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 仅保留 Codex 全文译文中的阅读型 HTML 标签。
 *
 * @param {string} translatedHtml 数据库中的 Codex 中文译文。
 * @returns {DocumentFragment} 可安全插入页面的正文片段。
 */
function createSafePaperTranslation(translatedHtml) {
  /** allowedTags 是论文阅读页允许展示的语义标签。 */
  const allowedTags = new Set([
    "H2",
    "H3",
    "H4",
    "P",
    "UL",
    "OL",
    "LI",
    "BLOCKQUOTE",
    "PRE",
    "CODE",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TH",
    "TD",
    "STRONG",
    "EM",
    "SUB",
    "SUP",
  ]);
  /** parsedDocument 是隔离解析后的全文译文文档。 */
  const parsedDocument = new DOMParser().parseFromString(
    `<main>${translatedHtml}</main>`,
    "text/html",
  );
  /** sourceRoot 是隔离文档中的译文根节点。 */
  const sourceRoot = parsedDocument.querySelector("main");
  /** fragment 是最终返回的安全正文。 */
  const fragment = document.createDocumentFragment();

  /**
   * 递归复制文本与白名单标签，不复制任何属性。
   *
   * @param {Node} sourceNode 隔离文档节点。
   * @param {Node} targetNode 当前安全目标节点。
   * @returns {void}
   */
  function copySafeNode(sourceNode, targetNode) {
    if (sourceNode.nodeType === Node.TEXT_NODE) {
      targetNode.append(document.createTextNode(sourceNode.textContent || ""));
      return;
    }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE) return;
    /** sourceElement 是当前待检查的 HTML 元素。 */
    const sourceElement = /** @type {Element} */ (sourceNode);
    /** safeParent 是允许标签时新建的无属性元素，否则沿用上级节点。 */
    const safeParent = allowedTags.has(sourceElement.tagName)
      ? document.createElement(sourceElement.tagName.toLowerCase())
      : targetNode;
    if (safeParent !== targetNode) targetNode.append(safeParent);
    for (const childNode of sourceElement.childNodes) {
      copySafeNode(childNode, safeParent);
    }
  }

  if (sourceRoot) {
    for (const childNode of sourceRoot.childNodes) {
      copySafeNode(childNode, fragment);
    }
  }
  return fragment;
}

/**
 * 在论文页展示后台 Codex 队列、处理、完成或失败状态。
 *
 * @param {Record<string, unknown>} paper 当前论文详情。
 * @returns {Promise<void>}
 */
async function renderPaperTranslationStatus(paper) {
  dom.paperReadingStatus.replaceChildren();
  /** statusText 是当前阶段面向用户的核心说明。 */
  let statusText = "";
  if (paper.fullTranslationStatus === "ready") {
    statusText =
      "以下全文中文阅读版由 Codex 根据英文论文生成；公式符号保留原文，重要结论可通过右上角英文 PDF 交叉核对。";
  } else if (paper.fullTranslationStatus === "processing") {
    statusText = "Codex 正在后台翻译这篇论文。你可以离开本页，完成后再次打开即可阅读中文全文。";
  } else if (paper.fullTranslationStatus === "not_required") {
    statusText = "系统检测到论文原文为中文，无需创建重复的中文翻译。";
  } else if (paper.fullTranslationStatus === "failed") {
    statusText = paper.fullTranslationError
      ? `Codex 全文翻译失败：${paper.fullTranslationError}`
      : `论文正文提取失败：${paper.extractionError || "未知原因"}。`;
  } else {
    statusText = "论文已进入 Codex 全文翻译队列，后台工作器即将开始处理。";
    try {
      /** payload 是本机 Codex 后台工作器的实时状态。 */
      const payload = await requestJson("/api/paper-translation-worker/status");
      if (payload.worker?.status === "waiting") statusText = payload.worker.message;
      else if (payload.worker?.status === "processing") {
        statusText = payload.worker.currentPaperId === paper.id
          ? "Codex 正在后台翻译这篇论文。"
          : `Codex 正在翻译《${payload.worker.currentPaperTitle}》，本篇将在其后自动开始。`;
      }
    } catch {
      // 状态接口暂时不可用时保留论文自身的排队说明，不影响正文阅读。
    }
  }
  dom.paperReadingStatus.append(
    createTextElement("p", "paper-translation-state", statusText),
  );
  if (paper.fullTranslationStatus === "failed" && paper.fullTranslationError) {
    /** retryButton 允许用户修复登录或网络问题后主动重新排队。 */
    const retryButton = createTextElement(
      "button",
      "secondary-button paper-translation-retry",
      "重新加入翻译队列",
    );
    retryButton.type = "button";
    retryButton.addEventListener("click", async () => {
      retryButton.disabled = true;
      retryButton.textContent = "正在重新排队…";
      try {
        /** payload 是重新排队后的最新论文状态。 */
        const payload = await requestJson(
          `/api/papers/${encodeURIComponent(paper.id)}/translation/retry`,
          { method: "POST" },
        );
        applicationState.selectedPaper = payload.paper;
        await renderPaperTranslationStatus(payload.paper);
        schedulePaperTranslationPolling(payload.paper.id);
      } catch (error) {
        showToast(error.message);
        retryButton.disabled = false;
        retryButton.textContent = "重新加入翻译队列";
      }
    });
    dom.paperReadingStatus.append(retryButton);
  }
}

/**
 * 等待后台翻译时轮询单篇论文；完成后只刷新正文，不离开当前页面。
 *
 * @param {string} paperId 当前论文 ID。
 * @returns {void}
 */
function schedulePaperTranslationPolling(paperId) {
  window.clearTimeout(applicationState.paperTranslationPollTimer);
  applicationState.paperTranslationPollTimer = window.setTimeout(async () => {
    if (applicationState.selectedPaper?.id !== paperId || dom.paperReader.hidden) return;
    try {
      /** payload 是当前论文的最新数据库状态。 */
      const payload = await requestJson(`/api/papers/${encodeURIComponent(paperId)}`);
      /** previousStatus 用于判断是否需要首次渲染完成后的中文全文。 */
      const previousStatus = applicationState.selectedPaper.fullTranslationStatus;
      /** paper 是后台处理后的最新论文。 */
      const paper = payload.paper;
      applicationState.selectedPaper = paper;
      await renderPaperTranslationStatus(paper);
      if (paper.fullTranslationStatus === "ready" && previousStatus !== "ready") {
        dom.paperReaderTitle.textContent = paper.titleZh || paper.title;
        dom.paperReaderOriginalTitle.textContent = paper.titleZh ? paper.title : "";
        dom.paperReaderAbstract.textContent =
          paper.abstractZh || paper.abstract || paper.curatorNote || "暂无摘要。";
        dom.paperReaderContent.replaceChildren(
          createSafePaperTranslation(paper.fullTranslationHtml),
        );
        await initializeReadingWorkspace("paper", paper.id, dom.paperReaderContent);
        showToast("Codex 已完成论文中文全文翻译。");
      }
      if (["pending", "processing"].includes(paper.fullTranslationStatus)) {
        schedulePaperTranslationPolling(paperId);
      }
    } catch {
      schedulePaperTranslationPolling(paperId);
    }
  }, 4000);
}

/**
 * 在站内独立页面打开论文中文阅读版。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @param {{ rememberPrevious?: boolean }} options 导航历史选项。
 * @returns {Promise<void>}
 */
async function openPaper(paperId, options = {}) {
  try {
    closeReadingWorkspace();
    /** payload 是完整论文详情响应。 */
    const payload = await requestJson(`/api/papers/${encodeURIComponent(paperId)}`);
    /** paper 是即将显示的完整论文。 */
    const paper = payload.paper;
    if (options.rememberPrevious !== false) rememberCurrentPageLocation();
    applicationState.selectedPaper = paper;
    for (const view of document.querySelectorAll(".view")) {
      view.classList.remove("is-active");
    }
    dom.reader.hidden = true;
    dom.articleReader.hidden = true;
    dom.paperReader.hidden = false;
    updateFloatingReaderBackButton();
    dom.pageEyebrow.textContent = "PAPER READER";
    dom.pageTitle.textContent =
      paper.sourceType === "mli" ? "李沐精读" : "论文中文阅读";
    dom.topUploadButton.hidden = true;
    dom.paperReaderMeta.textContent = [
      paper.sourceLabel,
      paper.category,
      paper.publishedAt ? formatDate(paper.publishedAt) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    dom.paperReaderTitle.textContent = paper.titleZh || paper.title;
    dom.paperReaderOriginalTitle.textContent = paper.titleZh ? paper.title : "";
    dom.paperReaderAbstract.textContent =
      paper.abstractZh || paper.abstract || paper.curatorNote || "暂无摘要。";
    dom.paperSourceLink.href = paper.sourceUrl;
    dom.paperSourceLink.textContent =
      paper.sourceType === "weekly" ? "arXiv 原文" : "论文原文";
    dom.paperPdfLink.hidden = !paper.pdfUrl;
    dom.paperPdfLink.href = paper.pdfUrl || "#";
    dom.paperVideoLink.hidden = !paper.videoUrl;
    dom.paperVideoLink.href = paper.videoUrl || "#";
    dom.paperReaderContent.replaceChildren();
    if (paper.fullTranslationStatus === "ready" && paper.fullTranslationHtml) {
      dom.paperReaderContent.append(
        createSafePaperTranslation(paper.fullTranslationHtml),
      );
    } else if (paper.sourceType === "mli") {
      dom.paperReadingStatus.textContent =
        "该条目来自李沐论文精读目录。中文视频是主要解读入口，论文原文和 PDF 用于进一步核对。";
      dom.paperReaderContent.append(
        createTextElement(
          "p",
          "",
          paper.curatorNote || "建议先观看中文精读视频，再阅读论文原文。",
        ),
      );
      if (paper.videoAltUrl) {
        dom.paperReaderContent.append(
          createPaperLink("YouTube 备用视频", paper.videoAltUrl, "secondary-button"),
        );
      }
    } else if (paper.fullTranslationStatus === "failed") {
      // 失败原因和重新排队入口统一由状态区渲染。
    }
    await renderPaperTranslationStatus(paper);
    if (["pending", "processing"].includes(paper.fullTranslationStatus)) {
      schedulePaperTranslationPolling(paper.id);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    await initializeReadingWorkspace("paper", paper.id, dom.paperReaderContent);
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 将当前周的候选论文渲染到选择弹窗。
 *
 * @param {Record<string, unknown>} reminder 周提醒对象。
 * @returns {void}
 */
function renderPaperCandidates(reminder) {
  dom.paperCandidateGrid.replaceChildren();
  /** weekAlreadySelected 表示本周已经有一篇论文进入论文库。 */
  const weekAlreadySelected = reminder.status === "selected";
  for (const candidate of reminder.candidates) {
    /** card 是弹窗中的单篇候选论文。 */
    const card = document.createElement("article");
    card.className = "paper-candidate";
    /** metadata 是候选分类和发表日期。 */
    const metadata = document.createElement("div");
    metadata.className = "paper-card-meta";
    metadata.append(
      createTextElement("span", "", candidate.category),
      createTextElement(
        "span",
        "",
        candidate.publishedAt
          ? formatDate(candidate.publishedAt)
          : "日期暂缺",
      ),
    );
    /** actions 是查看来源和确认选择操作区。 */
    const actions = document.createElement("div");
    actions.className = "paper-candidate-actions";
    /** selectButton 是将当前候选加入论文库的确认按钮。 */
    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "primary-button";
    selectButton.disabled = weekAlreadySelected;
    selectButton.textContent =
      candidate.status === "selected"
        ? "已加入论文库"
        : weekAlreadySelected
          ? "本周已完成"
          : "选择这篇";
    selectButton.addEventListener("click", () => {
      void selectWeeklyPaper(candidate.id, selectButton);
    });
    actions.append(
      selectButton,
      createPaperLink("先看原文 ↗", candidate.sourceUrl, ""),
    );
    /** title 是优先展示 Codex 中文翻译的候选论文标题。 */
    const title = createTextElement(
      "h3",
      "",
      candidate.titleZh || candidate.title,
    );
    /** candidateElements 是候选卡片的有序内容节点。 */
    const candidateElements = [metadata, title];
    if (candidate.titleZh) {
      candidateElements.push(
        createTextElement("p", "paper-original-title", candidate.title),
      );
    }
    candidateElements.push(
      createTextElement(
        "span",
        `paper-translation-state ${candidate.titleZh ? "is-translated" : ""}`,
        candidate.titleZh ? "Codex 中文翻译" : "等待 Codex 翻译",
      ),
      createTextElement(
        "p",
        "paper-authors",
        formatPaperAuthors(candidate.authors),
      ),
      createTextElement(
        "p",
        "paper-abstract",
        candidate.abstractZh ||
          candidate.abstract ||
          "该论文暂未提供摘要。",
      ),
      actions,
    );
    card.append(...candidateElements);
    dom.paperCandidateGrid.append(card);
  }
}

/**
 * 查询今日经典论文，并在需要或用户主动查看时打开弹窗。
 *
 * @param {boolean} force 是否忽略自动提醒状态，主动查看本周候选。
 * @returns {Promise<void>}
 */
async function checkWeeklyPaperReminder(force = false) {
  try {
    /** suffix 是用户主动查看时使用的接口查询参数。 */
    const suffix = force ? "?force=1" : "";
    /** payload 是当前周论文提醒接口响应。 */
    const payload = await requestJson(`/api/paper-reminder${suffix}`);
    /** reminder 是本周提醒状态和候选论文。 */
    const reminder = payload.reminder;
    if (!reminder.due && !force) return;
    if (!reminder.candidates?.length) {
      if (force) showToast("今日经典论文暂未准备好，请稍后再试。");
      return;
    }
    applicationState.activePaperReminder = reminder;
    renderPaperCandidates(reminder);
    if (!dom.paperReminderDialog.open) dom.paperReminderDialog.showModal();
  } catch (error) {
    if (force) showToast(`暂时无法读取今日推荐：${error.message}`);
  }
}

/**
 * 将用户选中的候选论文写入本地论文库。
 *
 * @param {string} candidateId 候选论文 ID。
 * @param {HTMLButtonElement} button 被点击的确认按钮。
 * @returns {Promise<void>}
 */
async function selectWeeklyPaper(candidateId, button) {
  button.disabled = true;
  button.textContent = "正在保存…";
  try {
    /** payload 是正式保存后的论文对象。 */
    const payload = await requestJson("/api/paper-reminder/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });
    dom.paperReminderDialog.close();
    applicationState.activePaperReminder = null;
    await loadPapers();
    showView("papers");
    showToast(`《${payload.paper.title}》已加入论文库。`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "选择这篇";
    showToast(error.message);
  }
}

/**
 * 将每周论文提醒延后一天。
 *
 * @returns {Promise<void>}
 */
async function snoozeWeeklyPaperReminder() {
  try {
    await requestJson("/api/paper-reminder/snooze", { method: "POST" });
    dom.paperReminderDialog.close();
    applicationState.activePaperReminder = null;
    showToast("已延后到明天再提醒。");
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 跳过今天的论文选择提醒。
 *
 * @returns {Promise<void>}
 */
async function dismissWeeklyPaperReminder() {
  try {
    await requestJson("/api/paper-reminder/dismiss", { method: "POST" });
    dom.paperReminderDialog.close();
    applicationState.activePaperReminder = null;
    showToast("今天已跳过，明天会推荐下一篇经典论文。");
  } catch (error) {
    showToast(error.message);
  }
}

/** ocrSupportedExtensions 是阅读页允许手工重新识别的文件类型。 */
const ocrSupportedExtensions = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff",
]);

/**
 * 更新文档阅读页的 OCR 状态、置信度和操作按钮。
 *
 * @param {Record<string, unknown>} documentItem 当前文档。
 * @returns {void}
 */
function renderDocumentOcrState(documentItem) {
  /** status 是旧文档缺少字段时使用的兼容状态。 */
  const status = documentItem.ocrStatus || "not_required";
  const labels = {
    not_required: "不需要",
    queued: "等待后台识别",
    running: "正在识别",
    completed: `已完成 · ${documentItem.ocrPageCount || 0} 页 · 置信度 ${Math.round(documentItem.ocrAverageConfidence || 0)}%`,
    failed: `失败：${documentItem.ocrError || "未知原因"}`,
  };
  dom.readerOcrStatus.textContent = labels[status] || status;
  /** supported 表示可以主动开始或重新执行 OCR。 */
  const supported = ocrSupportedExtensions.has(String(documentItem.extension || "").toLowerCase());
  dom.documentOcrButton.hidden = !supported || status === "queued" || status === "running";
  dom.documentOcrButton.textContent = status === "completed" ? "重新执行 OCR" : "执行 OCR";
}

/**
 * 在当前文档等待 OCR 时刷新状态，完成后替换清爽阅读正文。
 *
 * @param {string} documentId 文档 ID。
 * @returns {Promise<void>}
 */
async function pollDocumentOcr(documentId) {
  window.clearTimeout(applicationState.documentOcrPollTimer);
  if (applicationState.selectedDocument?.id !== documentId) return;
  /** payload 是当前文档最新详情。 */
  const payload = await requestJson(`/api/documents/${encodeURIComponent(documentId)}`);
  /** documentItem 是带 OCR 状态和正文的新记录。 */
  const documentItem = payload.document;
  if (applicationState.selectedDocument?.id !== documentId) return;
  applicationState.selectedDocument = documentItem;
  renderDocumentOcrState(documentItem);
  dom.readerStatus.textContent = documentItem.extractionStatus;
  if (documentItem.ocrStatus === "completed") {
    dom.readerSummary.textContent = documentItem.summary;
    dom.readerContent.replaceChildren(createReadableDocument(documentItem.extractedText || ""));
    applicationState.activeReadingSurface = dom.readerContent;
    buildReadingTableOfContents(dom.readerContent);
    applyReadingHighlights();
    showToast("OCR 已完成，清爽阅读正文和全文索引已更新。");
    await loadLibrary();
    return;
  }
  if (documentItem.ocrStatus === "failed") return;
  applicationState.documentOcrPollTimer = window.setTimeout(
    () => void pollDocumentOcr(documentId).catch((error) => showToast(error.message)),
    2000,
  );
}

/**
 * 将当前图片或 PDF 加入 OCR 后台任务。
 *
 * @returns {Promise<void>}
 */
async function requestCurrentDocumentOcr() {
  /** documentItem 是阅读页当前文档。 */
  const documentItem = applicationState.selectedDocument;
  if (!documentItem) return;
  dom.documentOcrButton.disabled = true;
  try {
    /** payload 是新建或复用的 OCR 任务。 */
    const payload = await requestJson(
      `/api/documents/${encodeURIComponent(documentItem.id)}/ocr`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    applicationState.selectedDocument = payload.document;
    renderDocumentOcrState(payload.document);
    showToast("已加入 OCR 后台任务。");
    void pollDocumentOcr(documentItem.id).catch((error) => showToast(error.message));
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.documentOcrButton.disabled = false;
  }
}

/**
 * 打开一份文档的提取正文和元数据。
 *
 * @param {string} documentId 文档 ID。
 * @param {{ rememberPrevious?: boolean }} options 导航历史选项。
 * @returns {Promise<void>}
 */
async function openDocument(documentId, options = {}) {
  try {
    window.clearTimeout(applicationState.documentOcrPollTimer);
    closeReadingWorkspace();
    /** payload 是文档详情响应。 */
    const payload = await requestJson(`/api/documents/${encodeURIComponent(documentId)}`);
    /** documentItem 是完整文档对象。 */
    const documentItem = payload.document;
    if (options.rememberPrevious !== false) rememberCurrentPageLocation();
    applicationState.selectedDocument = documentItem;
    for (const view of document.querySelectorAll(".view")) view.classList.remove("is-active");
    dom.reader.hidden = false;
    dom.articleReader.hidden = true;
    dom.paperReader.hidden = true;
    updateFloatingReaderBackButton();
    dom.pageEyebrow.textContent = "DOCUMENT READER";
    dom.pageTitle.textContent = "文档阅读";
    dom.topUploadButton.hidden = true;
    dom.readerTitle.textContent = documentItem.title;
    dom.readerMeta.textContent = `${documentItem.category} · ${formatDate(documentItem.createdAt)}`;
    dom.readerSummary.textContent = documentItem.summary;
    /** isWordDocument 表示当前正文应采用 Word 结构化纸张视图。 */
    const isWordDocument =
      documentItem.extension === ".docx" && Boolean(documentItem.renderedHtml);
    dom.reader.classList.toggle("is-word-reader", isWordDocument);
    dom.readerContent.classList.toggle("is-word-document", isWordDocument);
    dom.readerContent.replaceChildren(
      isWordDocument
        ? createWordDocument(documentItem.renderedHtml)
        : createReadableDocument(documentItem.extractedText || ""),
    );
    dom.readerFileName.textContent = documentItem.originalName;
    dom.readerFileSize.textContent = formatFileSize(documentItem.sizeBytes);
    dom.readerStatus.textContent = documentItem.extractionStatus;
    renderDocumentOcrState(documentItem);
    dom.readerSource.textContent =
      documentItem.categorySource === "deepseek"
        ? "DeepSeek 辅助分类"
        : documentItem.categorySource === "manual"
          ? "人工调整"
          : "本地规则";
    dom.downloadLink.href = `/api/documents/${encodeURIComponent(documentId)}/download`;
    /** supportsOriginalPreview 表示浏览器能够直接呈现原始 PDF。 */
    const supportsOriginalPreview =
      documentItem.extension === ".pdf" ||
      documentItem.mimeType === "application/pdf";
    dom.readerModeSwitch.hidden = !supportsOriginalPreview;
    dom.originalPreviewFrame.src = supportsOriginalPreview
      ? `/api/documents/${encodeURIComponent(documentId)}/view#toolbar=1&navpanes=0&view=FitH`
      : "about:blank";
    setReaderMode(supportsOriginalPreview ? "original" : "readable");
    dom.readerCategory.value = documentItem.category;
    window.scrollTo({ top: 0, behavior: "smooth" });
    await initializeReadingWorkspace("document", documentItem.id, dom.readerContent);
    if (documentItem.ocrStatus === "queued" || documentItem.ocrStatus === "running") {
      void pollDocumentOcr(documentItem.id).catch((error) => showToast(error.message));
    }
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 向上传队列添加一条状态记录。
 *
 * @param {File} file 待上传文件。
 * @returns {HTMLElement} 队列项元素。
 */
function createQueueItem(file) {
  /** item 是队列中的单个文件状态行。 */
  const item = document.createElement("article");
  item.className = "queue-item";
  /** information 包含文件名和容量。 */
  const information = document.createElement("div");
  information.append(
    createTextElement("strong", "", file.name),
    createTextElement("small", "", formatFileSize(file.size)),
  );
  item.append(information, createTextElement("span", "", "等待上传"));
  dom.uploadQueue.prepend(item);
  return item;
}

/**
 * 上传一个文件并等待解析分类完成。
 *
 * @param {File} file 浏览器文件对象。
 * @returns {Promise<void>}
 */
async function uploadFile(file) {
  /** queueItem 是本文件对应的界面状态行。 */
  const queueItem = createQueueItem(file);
  /** statusElement 是状态行右侧文字。 */
  const statusElement = queueItem.querySelector(":scope > span");
  statusElement.textContent = "正在提取正文并分类…";
  try {
    /** payload 是上传完成后的文档对象。 */
    const payload = await requestJson("/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    queueItem.classList.add("is-complete");
    statusElement.textContent = payload.importJob
      ? `已保存 · OCR 后台处理中 · ${payload.document.category}`
      : `已保存 · ${payload.document.category}`;
    showToast(`《${payload.document.title}》已归入“${payload.document.category}”。`);
  } catch (error) {
    queueItem.classList.add("is-error");
    statusElement.textContent = error.message;
  }
}

/**
 * 顺序上传用户选择的全部文件，避免同时解析大文件造成内存峰值。
 *
 * @param {FileList | File[]} files 待上传文件集合。
 * @returns {Promise<void>}
 */
async function uploadFiles(files) {
  /** fileArray 是便于遍历的文件数组。 */
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return;
  showView("upload");
  for (const file of fileArray) await uploadFile(file);
  dom.fileInput.value = "";
  await loadLibrary();
}

/**
 * 把一个本地 PDF 导入独立论文库。
 *
 * @param {File} file 用户选择的 PDF。
 * @returns {Promise<void>}
 */
async function uploadPaperFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name)) {
    showToast("论文文件目前只支持 PDF。");
    return;
  }
  dom.choosePaperFileButton.disabled = true;
  dom.choosePaperFileButton.textContent = "正在解析 PDF…";
  try {
    /** payload 是完成全文提取与自动分类后的论文。 */
    const payload = await requestJson("/api/papers/import/file", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/pdf",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    await loadPapers();
    showToast(`《${payload.paper.titleZh || payload.paper.title}》已导入论文库。`);
    showView("papers");
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.paperFileInput.value = "";
    dom.choosePaperFileButton.disabled = false;
    dom.choosePaperFileButton.textContent = "选择本地 PDF";
  }
}

/**
 * 从 arXiv、直接 PDF 或公开论文网页导入论文。
 *
 * @returns {Promise<void>}
 */
async function importPaperUrl() {
  /** inputUrl 是清理首尾空白后的论文链接。 */
  const inputUrl = dom.paperUrlInput.value.trim();
  if (!inputUrl) {
    showToast("请先输入论文链接。");
    return;
  }
  dom.importPaperUrlButton.disabled = true;
  dom.importPaperUrlButton.textContent = "正在识别并提取…";
  try {
    /** payload 是链接识别和论文保存结果。 */
    const payload = await requestJson("/api/papers/import/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: inputUrl }),
    });
    dom.paperUrlInput.value = "";
    await loadPapers();
    showToast(
      payload.processing
        ? `《${payload.paper.titleZh || payload.paper.title}》已保存，正在后台下载并解析。`
        : `《${payload.paper.titleZh || payload.paper.title}》已导入论文库。`,
    );
    showView("papers");
    if (payload.processing) {
      window.setTimeout(() => void loadPapers(), 4_000);
      window.setTimeout(() => void loadPapers(), 12_000);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.importPaperUrlButton.disabled = false;
    dom.importPaperUrlButton.textContent = "识别并导入论文";
  }
}

/**
 * 初始化分类、列表与全部界面事件。
 *
 * @returns {Promise<void>}
 */
/**
 * 初始化深色/浅色主题切换按钮。
 * 主题只影响视觉，选择结果保存在 localStorage，键名 zhixu-theme。
 *
 * @returns {void}
 */
function setupThemeToggle() {
  if (!dom.themeToggle || !dom.themeToggleLabel) return;
  /** currentTheme 是页面当前生效的主题，初始化脚本已在 head 中写入。 */
  const syncLabel = () => {
    const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    dom.themeToggleLabel.textContent = currentTheme === "dark" ? "浅色模式" : "深色模式";
    dom.themeToggle.setAttribute("aria-pressed", String(currentTheme === "dark"));
  };
  dom.themeToggle.addEventListener("click", () => {
    /** nextTheme 是切换后的目标主题。 */
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem("zhixu-theme", nextTheme);
    } catch (error) {}
    syncLabel();
  });
  syncLabel();
}

/**
 * 初始化文档库视图切换控件（网格 / 列表）。
 * 选择结果保存在 localStorage，键名 zhixu-view-mode。
 *
 * @returns {void}
 */
function setupViewMode() {
  if (!dom.viewMode || !dom.viewModeLabel || !dom.documentGrid) return;
  /** VIEW_MODE_LABELS 是选项到中文标签的映射，与样式下拉显示一致。 */
  const VIEW_MODE_LABELS = { grid: "网格", list: "列表" };
  /** applyViewMode 根据模式切换文档网格样式与按钮标签。 */
  const applyViewMode = (mode) => {
    const nextMode = mode === "list" ? "list" : "grid";
    dom.documentGrid.classList.toggle("is-list", nextMode === "list");
    dom.viewModeLabel.textContent = VIEW_MODE_LABELS[nextMode];
    for (const option of dom.viewModeOptions) {
      const isActive = option.dataset.viewMode === nextMode;
      option.setAttribute("aria-checked", String(isActive));
    }
  };
  /** 当前视图模式：优先读取用户选择，缺失则使用网格。 */
  let currentMode = "grid";
  try {
    const savedMode = window.localStorage.getItem("zhixu-view-mode");
    if (savedMode === "list" || savedMode === "grid") {
      currentMode = savedMode;
    }
  } catch (error) {}
  applyViewMode(currentMode);
  for (const option of dom.viewModeOptions) {
    option.addEventListener("click", (event) => {
      event.preventDefault();
      const mode = option.dataset.viewMode === "list" ? "list" : "grid";
      try {
        window.localStorage.setItem("zhixu-view-mode", mode);
      } catch (error) {}
      applyViewMode(mode);
      /** 选择后收起下拉菜单。 */
      dom.viewMode.open = false;
    });
  }
  /** 点击下拉以外的区域时收起菜单。 */
  document.addEventListener("click", (event) => {
    if (!dom.viewMode.open) return;
    if (!dom.viewMode.contains(event.target)) {
      dom.viewMode.open = false;
    }
  });
}

async function initializeApplication() {
  setupThemeToggle();
  setupViewMode();
  setupReadingFontSize();
  setupReadingLineHeight();
  setupReadingWorkbenchResize();
  /** categoryPayload 是允许分类接口响应。 */
  const categoryPayload = await requestJson("/api/categories");
  applicationState.categories = categoryPayload.categories;
  dom.readerCategory.replaceChildren(
    ...applicationState.categories.map((category) => {
      /** option 是阅读页分类下拉选项。 */
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      return option;
    }),
  );

  for (const button of document.querySelectorAll(".nav-item")) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }
  dom.aiSourceSearch.addEventListener("input", renderAiSources);
  dom.aiHistorySearch.addEventListener("input", () => {
    window.clearTimeout(applicationState.aiHistoryTimer);
    applicationState.aiHistoryTimer = window.setTimeout(() => {
      void loadAiConversations().catch((error) => showToast(error.message));
    }, 300);
  });
  for (const button of dom.aiModeSwitch.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      applicationState.aiMode = button.dataset.aiMode === "compare" ? "compare" : "ask";
      for (const modeButton of dom.aiModeSwitch.querySelectorAll("button")) {
        modeButton.classList.toggle("is-active", modeButton === button);
      }
    });
  }
  dom.aiQuestionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAiQuestion();
  });
  dom.documentAiButton.addEventListener("click", () => {
    if (applicationState.selectedDocument) void openAiWithSource("document", applicationState.selectedDocument.id);
  });
  dom.documentOcrButton.addEventListener("click", () => {
    void requestCurrentDocumentOcr();
  });
  dom.articleAiButton.addEventListener("click", () => {
    if (applicationState.selectedArticle) void openAiWithSource("article", applicationState.selectedArticle.id);
  });
  dom.paperAiButton.addEventListener("click", () => {
    if (applicationState.selectedPaper) void openAiWithSource("paper", applicationState.selectedPaper.id);
  });
  for (const button of dom.paperSourceTabs.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      applicationState.activePaperSource = button.dataset.paperSource || "";
      for (const tabButton of dom.paperSourceTabs.querySelectorAll("button")) {
        tabButton.classList.toggle("is-active", tabButton === button);
      }
      void loadPapers();
    });
  }
  dom.checkPaperReminderButton.addEventListener("click", () => {
    void checkWeeklyPaperReminder(true);
  });
  dom.emptyPaperReminderButton.addEventListener("click", () => {
    void checkWeeklyPaperReminder(true);
  });
  dom.paperReminderCloseButton.addEventListener("click", () => {
    void snoozeWeeklyPaperReminder();
  });
  dom.paperSnoozeButton.addEventListener("click", () => {
    void snoozeWeeklyPaperReminder();
  });
  dom.paperDismissButton.addEventListener("click", () => {
    void dismissWeeklyPaperReminder();
  });
  dom.paperReminderDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    void snoozeWeeklyPaperReminder();
  });
  for (const button of document.querySelectorAll("[data-open-upload]")) {
    button.addEventListener("click", () => showView("upload"));
  }
  dom.topUploadButton.addEventListener("click", () => showView("upload"));
  dom.chooseFilesButton.addEventListener("click", (event) => {
    event.stopPropagation();
    dom.fileInput.click();
  });
  dom.dropZone.addEventListener("click", () => dom.fileInput.click());
  dom.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dom.fileInput.click();
    }
  });
  dom.fileInput.addEventListener("change", () => void uploadFiles(dom.fileInput.files));
  dom.choosePaperFileButton.addEventListener("click", () => dom.paperFileInput.click());
  dom.paperFileInput.addEventListener("change", () => {
    void uploadPaperFile(dom.paperFileInput.files?.[0]);
  });
  dom.paperImportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void importPaperUrl();
  });
  dom.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dom.dropZone.classList.add("is-dragging");
  });
  dom.dropZone.addEventListener("dragleave", () => {
    dom.dropZone.classList.remove("is-dragging");
  });
  dom.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dom.dropZone.classList.remove("is-dragging");
    void uploadFiles(event.dataTransfer.files);
  });
  dom.searchInput.addEventListener("input", () => {
    window.clearTimeout(applicationState.searchTimer);
    applicationState.searchTimer = window.setTimeout(() => {
      applicationState.searchQuery = dom.searchInput.value.trim();
      void loadLibrary();
    }, 260);
  });
  dom.favoriteFilterButton.addEventListener("click", () => {
    applicationState.favoriteOnly = !applicationState.favoriteOnly;
    renderLibrary();
  });
  dom.newFolderButton.addEventListener("click", () => {
    void createLibraryFolder();
  });
  dom.topicCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void createLearningTopic().catch((error) => showToast(error.message));
  });
  dom.readerBackButton.addEventListener("click", () => void returnToPreviousPage("library"));
  for (const button of dom.readerModeSwitch.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      setReaderMode(button.dataset.readerMode);
    });
  }
  dom.widePreviewButton.addEventListener("click", toggleWidePreview);
  dom.readerCategory.addEventListener("change", async () => {
    if (!applicationState.selectedDocument) return;
    try {
      /** payload 是人工分类更新响应。 */
      const payload = await requestJson(
        `/api/documents/${encodeURIComponent(applicationState.selectedDocument.id)}/category`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: dom.readerCategory.value }),
        },
      );
      applicationState.selectedDocument = payload.document;
      dom.readerMeta.textContent = `${payload.document.category} · ${formatDate(payload.document.createdAt)}`;
      dom.readerSource.textContent = "人工调整";
      showToast(`已调整为“${payload.document.category}”。`);
      await loadLibrary();
    } catch (error) {
      showToast(error.message);
    }
  });
  dom.backupButton.addEventListener("click", async () => {
    try {
      /** payload 是手动确认备份响应。 */
      const payload = await requestJson("/api/backups", { method: "POST" });
      showToast(`${payload.message} ${payload.backupName}`);
    } catch (error) {
      showToast(error.message);
    }
  });
  dom.browserPairingButton.addEventListener("click", () => {
    void generateBrowserPairingCode();
  });
  dom.refreshImportJobs.addEventListener("click", () => {
    void loadStorageOperations().catch((error) => showToast(error.message));
  });
  dom.articleImportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void parseArticleUrl();
  });
  dom.videoImportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void importVideoUrl();
  });
  dom.articleReaderBackButton.addEventListener("click", () => void returnToPreviousPage("library"));
  dom.articleTranslationRequest.addEventListener("click", () => {
    void requestCurrentArticleTranslation();
  });
  for (const button of dom.articleLanguageSwitch.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      /** mode 是用户选择的中文、英文或双语阅读模式。 */
      const mode = button.dataset.articleLanguageMode;
      if (!mode) return;
      applicationState.articleLanguageMode = mode;
      renderArticleReadingMode();
      applicationState.activeReadingSurface = dom.articleReaderContent;
      buildReadingTableOfContents(dom.articleReaderContent);
      if (mode !== "translation") applyReadingHighlights();
    });
  }
  dom.paperReaderBackButton.addEventListener("click", () => void returnToPreviousPage("papers"));
  dom.floatingReaderBack.addEventListener("click", () => {
    /** fallbackView 根据当前是否为论文阅读页选择无历史时的安全去向。 */
    const fallbackView = !dom.paperReader.hidden ? "papers" : "library";
    void returnToPreviousPage(fallbackView);
  });
  dom.readingWorkbenchClose.addEventListener("click", () => {
    setReadingWorkbenchExpanded(false);
  });
  dom.readingWorkbenchToggle.addEventListener("click", () => {
    setReadingWorkbenchExpanded(true);
  });
  dom.readingTocToggle.addEventListener("click", () => {
    setReadingTocExpanded(false);
  });
  dom.readingTocReopen.addEventListener("click", () => {
    setReadingTocExpanded(true);
  });
  dom.moveFolderClose.addEventListener("click", () => dom.moveFolderDialog.close());
  dom.moveFolderCancel.addEventListener("click", () => dom.moveFolderDialog.close());
  dom.moveFolderDialog.addEventListener("cancel", () => {
    applicationState.pendingMoveItem = null;
    applicationState.selectedMoveFolderId = "";
  });
  dom.moveFolderDialog.addEventListener("close", () => {
    applicationState.pendingMoveItem = null;
    applicationState.selectedMoveFolderId = "";
  });
  dom.moveFolderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void confirmMoveKnowledgeItem();
  });
  for (const button of dom.readingWorkbenchTabs.querySelectorAll("button")) {
    button.addEventListener("click", () => setReadingWorkbenchTab(button.dataset.workbenchTab));
  }
  dom.readingAiClearSelection.addEventListener("click", () => {
    applicationState.readingAiSelection = null;
    renderReadingAiSelection();
  });
  dom.readingAiForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitReadingAiQuestion();
  });
  dom.readingStatusSelect.addEventListener("change", () => {
    /** selectedStatus 是用户刚选择的阅读状态。 */
    const selectedStatus = dom.readingStatusSelect.value;
    /** completedProgress 是标记已读时同步完成的进度值。 */
    const completedProgress =
      selectedStatus === "completed"
        ? 100
        : applicationState.readingWorkspace?.state?.progressPercent ?? 0;
    void saveReadingState({
      status: selectedStatus,
      progressPercent: completedProgress,
    });
  });
  dom.readingNoteInput.addEventListener("input", () => {
    dom.readingNoteStatus.textContent = "正在输入…";
    window.clearTimeout(applicationState.readingNoteTimer);
    applicationState.readingNoteTimer = window.setTimeout(async () => {
      dom.readingNoteStatus.textContent = "正在保存…";
      await saveReadingState({ noteText: dom.readingNoteInput.value });
      if (applicationState.readingWorkspace) {
        dom.readingNoteStatus.textContent = "已保存到本地";
      }
    }, 700);
  });
  dom.readingTagForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addCurrentContentTag().catch((error) => showToast(error.message));
  });
  dom.readingTopicAdd.addEventListener("click", () => {
    void addCurrentTopic().catch((error) => showToast(error.message));
  });
  dom.readingCardButton.addEventListener("click", openKnowledgeCardComposer);
  dom.knowledgeCardCancel.addEventListener("click", () =>
    dom.knowledgeCardDialog.close(),
  );
  dom.knowledgeCardCancelFooter.addEventListener("click", () =>
    dom.knowledgeCardDialog.close(),
  );
  dom.knowledgeCardForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveKnowledgeCard().catch((error) => showToast(error.message));
  });
  dom.reviewRevealButton.addEventListener("click", () => {
    dom.reviewRevealButton.hidden = true;
    dom.reviewAnswer.hidden = false;
    dom.reviewRating.hidden = false;
  });
  dom.reviewOpenSource.addEventListener("click", () => {
    /** currentCard 是需要返回原文的当前复习卡片。 */
    const currentCard =
      applicationState.dueKnowledgeCards[applicationState.activeReviewIndex];
    if (currentCard) openKnowledgeCardSource(currentCard);
  });
  for (const ratingButton of dom.reviewRating.querySelectorAll("button")) {
    ratingButton.addEventListener("click", () => {
      void submitKnowledgeCardReview(ratingButton.dataset.reviewRating).catch(
        (error) => showToast(error.message),
      );
    });
  }
  for (const colorButton of dom.highlightPalette.querySelectorAll("button")) {
    colorButton.addEventListener("click", () => {
      void createReadingHighlight(colorButton.dataset.highlightColor);
    });
  }
  document.addEventListener("mouseup", captureReadingSelection);
  document.addEventListener("keyup", captureReadingSelection);
  document.addEventListener("click", (event) => {
    /** highlight 是点击位置向上找到的正文高亮标签。 */
    const highlight = event.target.closest?.("mark.reading-highlight");
    if (highlight?.dataset.annotationId) {
      focusReadingAnnotation(highlight.dataset.annotationId);
    }
  });
  window.addEventListener("scroll", scheduleReadingProgressSave, { passive: true });
  await loadLibrary();
  await loadPapers();
  await loadTopics();
  await loadKnowledgeCards();
  void checkWeeklyPaperReminder();
  /** reminderIntervalMilliseconds 是网页打开期间的论文提醒检查间隔。 */
  const reminderIntervalMilliseconds = 60 * 60 * 1000;
  applicationState.paperReminderTimer = window.setInterval(
    () => void checkWeeklyPaperReminder(),
    reminderIntervalMilliseconds,
  );
}

initializeApplication().catch((error) => {
  showToast(`本地知识库启动失败：${error.message}`);
});
