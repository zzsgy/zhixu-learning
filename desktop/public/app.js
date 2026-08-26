/**
 * 知序本地知识库浏览器交互。
 *
 * 页面只请求当前电脑上的本地服务，不连接任何第三方前端接口。
 */
import renderMathInElement from "/vendor/katex/contrib/auto-render.mjs";

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
  /** articleTranslationPollTimer 定时读取当前文章真实翻译进度。 */
  articleTranslationPollTimer: null,
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
  /** pendingMoveItems 是移动窗口等待处理的一项或多项内容。 */
  pendingMoveItems: [],
  /** pendingMoveFolder 是等待变更父目录的文件夹。 */
  pendingMoveFolder: null,
  /** moveFolderExpandedIds 保存移动窗口中由用户展开的目录。 */
  moveFolderExpandedIds: new Set(),
  /** moveFolderSearchQuery 是移动窗口当前目录搜索词。 */
  moveFolderSearchQuery: "",
  /** libraryBatchMode 表示文档库是否正在勾选多项内容。 */
  libraryBatchMode: false,
  /** selectedLibraryItemKeys 保存批量整理中勾选的“类型:ID”。 */
  selectedLibraryItemKeys: new Set(),
  /** uploadFolderMode 是上传时自动识别或指定目录。 */
  uploadFolderMode: "auto",
  /** selectedUploadFolderId 是上传前由用户选中的知识库目录。 */
  selectedUploadFolderId: "",
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
  /** importJobFilter 控制任务中心的重点、状态和类型筛选。 */
  importJobFilter: "priority",
  /** importJobPollTimer 在存在排队或运行任务时刷新状态。 */
  importJobPollTimer: null,
  /** documentOcrPollTimer 在阅读页等待 OCR 完成时刷新文档。 */
  documentOcrPollTimer: null,
  /** documentRenderSequence 用于取消已经离开的超长文档分批渲染。 */
  documentRenderSequence: 0,
  /** documentChapters 是当前本地文档按真实标题或安全长度拆出的章节。 */
  documentChapters: [],
  /** activeDocumentChapterIndex 是当前只渲染的一章下标。 */
  activeDocumentChapterIndex: 0,
  /** uploadInProgress 防止两个大批次同时解析造成内存峰值。 */
  uploadInProgress: false,
  /** uploadBatchHideTimer 在整批成功后收起紧凑进度提示。 */
  uploadBatchHideTimer: null,
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
  viewModeOptions: document.querySelectorAll("#view-mode .view-mode-option"),
  documentTotal: document.querySelector("#document-total"),
  searchInput: document.querySelector("#search-input"),
  folderBreadcrumbs: document.querySelector("#folder-breadcrumbs"),
  folderGrid: document.querySelector("#folder-grid"),
  newFolderButton: document.querySelector("#new-folder-button"),
  batchSelectButton: document.querySelector("#batch-select-button"),
  libraryBatchToolbar: document.querySelector("#library-batch-toolbar"),
  batchSelectionCount: document.querySelector("#batch-selection-count"),
  batchSelectAllButton: document.querySelector("#batch-select-all-button"),
  batchMoveButton: document.querySelector("#batch-move-button"),
  batchDeleteButton: document.querySelector("#batch-delete-button"),
  batchCancelButton: document.querySelector("#batch-cancel-button"),
  favoriteFilterButton: document.querySelector("#favorite-filter-button"),
  documentGrid: document.querySelector("#document-grid"),
  emptyState: document.querySelector("#empty-state"),
  fileInput: document.querySelector("#file-input"),
  folderInput: document.querySelector("#folder-input"),
  paperFileInput: document.querySelector("#paper-file-input"),
  choosePaperFileButton: document.querySelector("#choose-paper-file-button"),
  paperImportForm: document.querySelector("#paper-import-form"),
  paperUrlInput: document.querySelector("#paper-url-input"),
  importPaperUrlButton: document.querySelector("#import-paper-url-button"),
  chooseFilesButton: document.querySelector("#choose-files-button"),
  chooseFolderButton: document.querySelector("#choose-folder-button"),
  uploadDestinationControls: document.querySelector("#upload-destination-controls"),
  uploadDestinationModes: document.querySelectorAll('input[name="upload-destination-mode"]'),
  uploadFolderSelect: document.querySelector("#upload-folder-select"),
  dropZone: document.querySelector("#drop-zone"),
  uploadBatchProgress: document.querySelector("#upload-batch-progress"),
  uploadBatchLabel: document.querySelector("#upload-batch-label"),
  uploadBatchCount: document.querySelector("#upload-batch-count"),
  uploadBatchBar: document.querySelector("#upload-batch-bar"),
  uploadDuplicateSummary: document.querySelector("#upload-duplicate-summary"),
  uploadDuplicateLabel: document.querySelector("#upload-duplicate-label"),
  uploadDuplicateList: document.querySelector("#upload-duplicate-list"),
  uploadQueue: document.querySelector("#upload-queue"),
  backupButton: document.querySelector("#backup-button"),
  browserPairingButton: document.querySelector("#browser-pairing-button"),
  browserPairingCode: document.querySelector("#browser-pairing-code"),
  browserClientList: document.querySelector("#browser-client-list"),
  refreshImportJobs: document.querySelector("#refresh-import-jobs"),
  importJobFilter: document.querySelector("#import-job-filter"),
  showImportJobHistory: document.querySelector("#show-import-job-history"),
  importJobSummary: document.querySelector("#import-job-summary"),
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
  originalDocumentLink: document.querySelector("#original-document-link"),
  readerTitle: document.querySelector("#reader-title"),
  readerMeta: document.querySelector("#reader-meta"),
  readerSummary: document.querySelector("#reader-summary"),
  readerContent: document.querySelector("#reader-content"),
  documentChapterNavigation: document.querySelector("#document-chapter-navigation"),
  documentChapterPrevious: document.querySelector("#document-chapter-previous"),
  documentChapterCounter: document.querySelector("#document-chapter-counter"),
  documentChapterTitle: document.querySelector("#document-chapter-title"),
  documentChapterNext: document.querySelector("#document-chapter-next"),
  documentChapterFooter: document.querySelector("#document-chapter-footer"),
  documentChapterFooterPrevious: document.querySelector("#document-chapter-footer-previous"),
  documentChapterFooterCounter: document.querySelector("#document-chapter-footer-counter"),
  documentChapterFooterNext: document.querySelector("#document-chapter-footer-next"),
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
  articleTranslationProgress: document.querySelector("#article-translation-progress"),
  articleTranslationProgressBar: document.querySelector("#article-translation-progress-bar"),
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
  paperViewMode: document.querySelector("#paper-view-mode"),
  paperViewModeLabel: document.querySelector("#paper-view-mode-label"),
  paperViewModeOptions: document.querySelectorAll("#paper-view-mode .view-mode-option"),
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
  readingTocTitle: document.querySelector("#reading-toc-title"),
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
  moveFolderEyebrow: document.querySelector("#move-folder-eyebrow"),
  moveFolderTitle: document.querySelector("#move-folder-title"),
  moveFolderItemTitle: document.querySelector("#move-folder-item-title"),
  moveFolderOptions: document.querySelector("#move-folder-options"),
  moveFolderSearch: document.querySelector("#move-folder-search"),
  moveFolderCollapseAll: document.querySelector("#move-folder-collapse-all"),
  moveFolderNew: document.querySelector("#move-folder-new"),
  moveFolderCreatePanel: document.querySelector("#move-folder-create-panel"),
  moveFolderCreateParent: document.querySelector("#move-folder-create-parent"),
  moveFolderCreateName: document.querySelector("#move-folder-create-name"),
  moveFolderCreateConfirm: document.querySelector("#move-folder-create-confirm"),
  moveFolderCreateCancel: document.querySelector("#move-folder-create-cancel"),
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
    /** requestError 保留服务端错误代码和重复项摘要，供批量导入集中处理。 */
    const requestError = new Error(payload.message || `请求失败：${response.status}`);
    requestError.code = payload.code || "";
    requestError.status = response.status;
    requestError.payload = payload;
    throw requestError;
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
  if (/\.{4,}\s*(?:\d+|[IVXLCDM]+)$/i.test(line)) return false;
  if (/^\d+\s*(?:字节|位|个|项|条|行|列|秒|毫秒|%|℃|°C)/i.test(line)) return false;
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
 * 识别 PDF 提取结果中的点线目录项，并拆分标题与页码。
 *
 * @param {string} line 当前正文行。
 * @returns {{ title: string, page: string, level: number } | null} 目录项结构。
 */
function parseReadableTocLine(line) {
  /** match 是“章节标题……页码”形式的目录行。 */
  const match = line.match(/^(.+?)\s*\.{4,}\s*(\d+|[IVXLCDM]+)$/i);
  if (!match) return null;
  /** title 是移除点线后保留的目录标题。 */
  const title = match[1].trim();
  if (!title || title.length > 120) return null;
  /** sectionNumber 用于判断章、节和小节的视觉缩进。 */
  const sectionNumber = title.match(/^(\d+(?:\.\d+){0,3})\b/)?.[1] || "";
  return {
    title,
    page: match[2],
    level: sectionNumber ? Math.min(3, sectionNumber.split(".").length) : 1,
  };
}

/**
 * 把 PDF 中被压成一行的密集文字重新切分为可阅读段落。
 *
 * @param {string} text 待拆分的长文本。
 * @returns {string[]} 长度受控的段落列表。
 */
/** readableSentenceSegmenter 在整次阅读期间复用，避免表格型章节为每个短段重复创建分词器。 */
const readableSentenceSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "sentence" })
  : null;

function splitDenseText(text) {
  /** normalizedText 是去除首尾空白后的待排版文本。 */
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return [];
  // 普通段落在上游已限制到约 180 字；直接返回可显著降低参数表章节的排版成本。
  if (normalizedText.length <= 260) return [normalizedText];
  /** markedText 在常见章节编号前补充结构边界。 */
  const markedText = normalizedText
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
      /** validOffsets 排除不存在的切点，避免 Math.max 空数组得到 -Infinity。 */
      const validOffsets = candidateOffsets.filter((offset) => offset >= 90);
      /** splitOffset 是距离目标长度最近且不会产生过短段落的切点。 */
      const splitOffset = validOffsets.length > 0 ? Math.max(...validOffsets) : 150;
      chunks.push(remaining.slice(0, splitOffset + 1).trim());
      remaining = remaining.slice(splitOffset + 1).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  for (const section of structuralSections) {
    /** sentences 是当前结构区域内的句子列表。 */
    const sentences = readableSentenceSegmenter
      ? [...readableSentenceSegmenter.segment(section)].flatMap(
        (segment) => splitOversizedSegment(segment.segment),
      )
      : section
        .split(/(?<=[。！？；.!?;])/)
        .flatMap((segment) => splitOversizedSegment(segment));
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

/** 清理 PDF 坐标文字中不必要的中文空格。 */
function normalizeStructuredPdfText(value) {
  return String(value || "")
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff，。！？；：）])/g, "$1")
    .replace(/\s+([，。！？；：）])/g, "$1")
    .replace(/（\s+/g, "（")
    .trim();
}

/** 创建复杂页中的原始内嵌插图，而不是整页截图。 */
function createStructuredPdfFigure(pageNumber, figureInfo, captionText, figureIndex) {
  const figure = document.createElement("figure");
  figure.className = "readable-structured-figure";
  const isRegion = Number.isInteger(Number(figureInfo.regionIndex));
  if (isRegion) figure.classList.add("is-region");
  if (figureInfo.column === "both") figure.classList.add("is-spanning");
  const image = document.createElement("img");
  image.loading = "lazy";
  image.decoding = "async";
  image.width = Math.max(1, Math.round(Number(figureInfo.width) * (isRegion ? 2.5 : 1)) || 1);
  image.height = Math.max(1, Math.round(Number(figureInfo.height) * (isRegion ? 2.5 : 1)) || 1);
  const regionVersion = isRegion
    ? [figureInfo.x, figureInfo.y, figureInfo.width, figureInfo.height]
      .map((value) => Number(value).toFixed(2))
      .join("-")
    : "";
  image.src = isRegion
    ? `/api/documents/${encodeURIComponent(applicationState.selectedDocument.id)}/page-figure-region?page=${pageNumber}&region=${figureInfo.regionIndex}&v=${encodeURIComponent(regionVersion)}`
    : `/api/documents/${encodeURIComponent(applicationState.selectedDocument.id)}/page-figure?page=${pageNumber}&asset=${figureInfo.assetIndex}`;
  image.alt = captionText || `${applicationState.selectedDocument.title} 第 ${pageNumber} 页插图 ${figureIndex + 1}`;
  figure.append(image);
  /** 局部裁剪已包含 PDF 原始图注，只有独立内嵌图片才补 HTML 图注。 */
  if (captionText && !isRegion) figure.append(createTextElement("figcaption", "", captionText));
  return figure;
}

/** 把一栏坐标文字恢复为图注、编号清单和自然段。 */
function parseStructuredPdfColumn(lines, options = {}) {
  const sortedLines = [...(Array.isArray(lines) ? lines : [])]
    .filter((line) => String(line?.text || "").trim())
    .sort((left, right) => Number(right.y) - Number(left.y))
    .map((line) => ({ ...line, text: normalizeStructuredPdfText(line.text) }))
    /** 工艺图编号已保留在局部原图中，不把散落的 2 3 4、5、6 等再次排成正文。 */
    .filter((line) => !(
      options.removeDiagramLabels
      && /^(?:\d{1,2}(?:\s+|$)){1,12}$/.test(line.text)
    ));
  const captions = [];
  const calloutGroups = [];
  const bodyLines = [];
  let previousCalloutLine = null;
  for (const line of sortedLines) {
    const captionMatch = line.text.match(/^图\s*(\d+(?:\.\d+)?)\s*(.*)$/);
    if (captionMatch) {
      captions.push(`图 ${captionMatch[1]}${captionMatch[2] ? ` ${captionMatch[2]}` : ""}`);
      previousCalloutLine = null;
      continue;
    }
    const calloutMatch = line.text.match(/^(\d{1,2})[.、)]\s*(\S.*)$/);
    if (calloutMatch) {
      const currentGroup = calloutGroups.at(-1);
      const currentIndex = Number(calloutMatch[1]);
      if (!currentGroup || currentIndex <= Number(currentGroup.at(-1)?.index || 0)) {
        calloutGroups.push([]);
      }
      calloutGroups.at(-1).push({ index: calloutMatch[1], text: calloutMatch[2] });
      previousCalloutLine = line;
      continue;
    }
    const calloutGap = previousCalloutLine ? Number(previousCalloutLine.y) - Number(line.y) : Infinity;
    if (
      previousCalloutLine
      && calloutGroups.length > 0
      && calloutGap <= Math.max(9, Number(previousCalloutLine.fontSize) * 1.7)
    ) {
      calloutGroups.at(-1).at(-1).text += line.text;
      previousCalloutLine = line;
      continue;
    }
    previousCalloutLine = null;
    bodyLines.push(line);
  }

  const paragraphs = [];
  for (const line of bodyLines) {
    const previousLine = paragraphs.at(-1)?.lines.at(-1);
    const gap = previousLine ? Number(previousLine.y) - Number(line.y) : Infinity;
    const startsDefinition = /^[^：]{1,28}：/.test(line.text);
    if (
      !previousLine
      || gap > Math.max(15, Number(previousLine.fontSize) * 1.65)
      || (startsDefinition && paragraphs.at(-1).lines.length > 1)
    ) {
      paragraphs.push({ lines: [line] });
    } else {
      paragraphs.at(-1).lines.push(line);
    }
  }
  return {
    captions,
    calloutGroups,
    paragraphs: paragraphs.map((paragraph) => paragraph.lines.reduce((combinedText, line) => {
      const needsSpace = /[A-Za-z0-9]$/.test(combinedText) && /^[A-Za-z0-9]/.test(line.text);
      return `${combinedText}${combinedText && needsSpace ? " " : ""}${line.text}`;
    }, "")),
  };
}

/** 将复杂 PDF 页显示为可复制双栏 HTML，并把原始插图放回相应栏。 */
function createStructuredPdfPage(pageNumber, pageData) {
  const page = document.createElement("section");
  page.className = "readable-structured-page";
  page.dataset.pdfPage = String(pageNumber);
  const headerText = (pageData.header || []).map((line) => normalizeStructuredPdfText(line.text)).join(" · ");
  if (headerText) page.append(createTextElement("div", "readable-structured-header", headerText));
  const columns = document.createElement("div");
  columns.className = "readable-structured-columns";
  const hasFigureRegions = (pageData.figureRegions || []).length > 0;
  for (const columnName of ["left", "right"]) {
    const column = document.createElement("div");
    column.className = `readable-structured-column is-${columnName}`;
    const figureRegions = (pageData.figureRegions || [])
      .filter((region) => region.column === columnName);
    const parsed = parseStructuredPdfColumn(pageData.columns?.[columnName] || [], {
      removeDiagramLabels: (pageData.figureRegions || []).length > 0 || (pageData.figures || []).length > 0,
    });
    const figures = hasFigureRegions
      ? figureRegions
      : (pageData.figures || []).filter((figure) => figure.column === columnName);
    const figureElements = figures.map((figureInfo, index) => createStructuredPdfFigure(
      pageNumber,
      figureInfo,
      parsed.captions[index] || "",
      index,
    ));
    const appendCalloutList = (callouts) => {
      const calloutList = document.createElement("ol");
      calloutList.className = "readable-structured-callouts";
      for (const callout of callouts) {
        const item = document.createElement("li");
        item.value = Number(callout.index);
        item.textContent = callout.text;
        calloutList.append(item);
      }
      return calloutList;
    };
    figureElements.forEach((figureElement, figureIndex) => {
      const calloutGroup = parsed.calloutGroups[figureIndex] || [];
      if (!hasFigureRegions && calloutGroup.length >= 3) {
        const figureWithCallouts = document.createElement("div");
        figureWithCallouts.className = "readable-structured-figure-callouts";
        figureWithCallouts.append(figureElement, appendCalloutList(calloutGroup));
        column.append(figureWithCallouts);
      } else {
        column.append(figureElement);
      }
    });
    if (!hasFigureRegions) {
      for (const calloutGroup of parsed.calloutGroups.slice(figureElements.length)) {
        column.append(appendCalloutList(calloutGroup));
      }
    }
    for (const paragraphText of parsed.paragraphs) {
      const paragraph = document.createElement("p");
      const definitionMatch = paragraphText.match(/^([^：]{1,28}：)(.*)$/);
      if (definitionMatch) {
        paragraph.append(createTextElement("strong", "", definitionMatch[1]), definitionMatch[2]);
      } else {
        paragraph.textContent = paragraphText;
      }
      column.append(paragraph);
    }
    columns.append(column);
  }
  page.append(columns);
  const spanningRegions = (pageData.figureRegions || []).filter((region) => region.column === "both");
  for (const [regionIndex, region] of spanningRegions.entries()) {
    page.append(createStructuredPdfFigure(
      pageNumber,
      region,
      region.caption || "",
      regionIndex,
    ));
  }
  const footerText = (pageData.footer || []).map((line) => normalizeStructuredPdfText(line.text)).join(" ");
  page.append(createTextElement("div", "readable-structured-footer", footerText || `原文第 ${pageNumber} 页`));
  return page;
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
  /** skipPdfPageText 表示当前复杂页已由坐标文字重建，后续扁平副本不再重复显示。 */
  let skipPdfPageText = false;

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
    /** pdfPageMatch 只在原文位置插入本页真正的内嵌插图，不重复展示整张 PDF 页面。 */
    const pdfPageMatch = line.match(/^\[\[ZHIXU_PDF_PAGE:(\d{1,4})\]\]$/);
    if (pdfPageMatch && applicationState.selectedDocument?.id) {
      flushParagraph();
      const pageNumber = Number(pdfPageMatch[1]);
      const structuredPage = applicationState.selectedDocument.pdfStructuredPages?.[pageNumber];
      skipPdfPageText = Boolean(structuredPage);
      if (structuredPage) {
        fragment.append(createStructuredPdfPage(pageNumber, structuredPage));
        continue;
      }
      const pageFigures = applicationState.selectedDocument.pdfFigures?.[pageNumber] || [];
      pageFigures.forEach((figureInfo, figureIndex) => {
        const figure = document.createElement("figure");
        figure.className = "readable-document-figure";
        const image = document.createElement("img");
        image.loading = "lazy";
        image.decoding = "async";
        image.width = Math.max(1, Number(figureInfo.width) || 1);
        image.height = Math.max(1, Number(figureInfo.height) || 1);
        image.src = `/api/documents/${encodeURIComponent(applicationState.selectedDocument.id)}/page-figure?page=${pageNumber}&asset=${figureInfo.assetIndex}`;
        image.alt = `${applicationState.selectedDocument.title} 第 ${pageNumber} 页插图 ${figureIndex + 1}`;
        figure.append(
          image,
          createTextElement("figcaption", "", `原文第 ${pageNumber} 页插图`),
        );
        fragment.append(figure);
      });
      continue;
    }
    if (skipPdfPageText) continue;
    /** pdfTableMatch 用原表局部裁剪替换会丢失合并单元格的扁平文字。 */
    const pdfTableMatch = line.match(/^\[\[ZHIXU_PDF_TABLE:(\d{1,4}):(\d{1,3})\]\]$/);
    if (pdfTableMatch && applicationState.selectedDocument?.id) {
      flushParagraph();
      const pageNumber = Number(pdfTableMatch[1]);
      const tableIndex = Number(pdfTableMatch[2]);
      const tableInfo = (applicationState.selectedDocument.pdfTables?.[pageNumber] || [])
        .find((candidate) => Number(candidate.tableIndex) === tableIndex);
      if (tableInfo) {
        const figure = document.createElement("figure");
        figure.className = "readable-document-table";
        const image = document.createElement("img");
        image.loading = "lazy";
        image.decoding = "async";
        image.width = Math.max(1, Math.round(Number(tableInfo.width) * 2.5) || 1);
        image.height = Math.max(1, Math.round(Number(tableInfo.height) * 2.5) || 1);
        image.src = `/api/documents/${encodeURIComponent(applicationState.selectedDocument.id)}/page-table?page=${pageNumber}&table=${tableIndex}`;
        image.alt = String(tableInfo.caption || `原文第 ${pageNumber} 页表格`);
        figure.append(image);
        if (tableInfo.caption) {
          figure.append(createTextElement("figcaption", "", tableInfo.caption));
        }
        fragment.append(figure);
      }
      continue;
    }
    /** tocItem 是 PDF 目录页中需要紧凑展示的标题与页码。 */
    const tocItem = parseReadableTocLine(line);
    if (tocItem) {
      flushParagraph();
      /** tocRow 使用两列布局替代会撑破页面的连续点号。 */
      const tocRow = document.createElement("div");
      tocRow.className = `readable-toc-item is-level-${tocItem.level}`;
      tocRow.append(
        createTextElement("span", "readable-toc-title", tocItem.title),
        createTextElement("span", "readable-toc-page", tocItem.page),
      );
      fragment.append(tocRow);
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
    /** 连续数字部件标注属于图例清单，不应被误排成章节大标题。 */
    const numberedCalloutMatch = line.match(/^(\d{1,2})[.、)]\s*(\S.*)$/);
    const previousIsNumberedCallout = /^\d{1,2}[.、)]\s*\S/.test(previousLine);
    const nextIsNumberedCallout = /^\d{1,2}[.、)]\s*\S/.test(nextLine);
    if (numberedCalloutMatch && (previousIsNumberedCallout || nextIsNumberedCallout)) {
      flushParagraph();
      const listItem = document.createElement("div");
      listItem.className = "readable-numbered-callout";
      listItem.append(
        createTextElement("span", "readable-numbered-callout-index", numberedCalloutMatch[1]),
        createTextElement("span", "", numberedCalloutMatch[2]),
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
      fragment.append(
        createTextElement(
          `h${headingLevel}`,
          headingText === "目录" ? "readable-toc-heading" : "",
          headingText,
        ),
      );
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

/** progressiveReadableChunkSize 是无章节结构时单页正文的最大字数。 */
const progressiveReadableChunkSize = 4000;

/**
 * 计算排除 PDF 内部页码标记后的实际正文长度。
 *
 * @param {string} text 章节正文。
 * @returns {number} 用户可见正文长度。
 */
function getReadableTextLength(text) {
  return String(text || "")
    .replace(/\[\[ZHIXU_PDF_PAGE:\d{1,4}\]\]\n?/g, "")
    .replace(/\[\[ZHIXU_PDF_TABLE:\d{1,4}:\d{1,3}\]\]\n?/g, "")
    .length;
}

/**
 * 把超长提取正文按完整行拆成可分批渲染的片段。
 *
 * @param {string} text 文档提取正文。
 * @returns {string[]} 保留行边界且长度受控的正文片段。
 */
function splitReadableTextIntoChunks(text) {
  /** chunks 保存准备逐批转换为 HTML 的文本。 */
  const chunks = [];
  /** currentLines 是当前批次已经收集的完整行。 */
  let currentLines = [];
  /** currentLength 是当前批次包含换行符后的近似长度。 */
  let currentLength = 0;

  /** flushCurrentChunk 把当前非空批次写入结果。 */
  function flushCurrentChunk() {
    if (currentLines.length === 0) return;
    chunks.push(currentLines.join("\n"));
    currentLines = [];
    currentLength = 0;
  }

  for (const sourceLine of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
    /** remainingLine 是超长单行尚未加入批次的部分。 */
    let remainingLine = sourceLine;
    while (remainingLine.length > progressiveReadableChunkSize) {
      flushCurrentChunk();
      chunks.push(remainingLine.slice(0, progressiveReadableChunkSize));
      remainingLine = remainingLine.slice(progressiveReadableChunkSize);
    }
    const addedLength = /^\[\[ZHIXU_PDF_(?:PAGE:\d{1,4}|TABLE:\d{1,4}:\d{1,3})\]\]$/.test(remainingLine.trim())
      ? 0
      : remainingLine.length + 1;
    if (currentLines.length > 0 && currentLength + addedLength > progressiveReadableChunkSize) {
      flushCurrentChunk();
    }
    currentLines.push(remainingLine);
    currentLength += addedLength;
  }
  flushCurrentChunk();
  if (chunks.length === 0) return [""];
  /** activePageMarker 让同一物理页被拆成多段时，每段仍能找到对应原页图像。 */
  let activePageMarker = "";
  return chunks.map((chunk) => {
    const pageMarkers = chunk.match(/\[\[ZHIXU_PDF_PAGE:\d{1,4}\]\]/g) || [];
    const enrichedChunk = activePageMarker && pageMarkers.length === 0
      ? `${activePageMarker}\n${chunk}`
      : chunk;
    if (pageMarkers.length > 0) activePageMarker = pageMarkers.at(-1);
    return enrichedChunk;
  });
}

/**
 * 等待浏览器完成一次绘制，让长文档渲染期间点击和滚动仍能响应。
 *
 * @returns {Promise<void>} 下一次页面绘制后的等待结果。
 */
function yieldDocumentRendering() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 16));
  });
}

/**
 * 识别提取文本中的章节标题。
 *
 * @param {string} sourceLine 原始正文行。
 * @returns {{ title: string, level: number, numberPath: string } | null} 标题信息。
 */
function parseDocumentChapterHeading(sourceLine) {
  /** line 是移除页内多余空白后的候选标题。 */
  const line = String(sourceLine || "").replace(/[ \t]+/g, " ").trim();
  if (!line || line.length > 100 || /\.{4,}|…{3,}/.test(line)) return null;
  /** markdownHeading 是 Markdown 文档中的一二级标题。 */
  const markdownHeading = line.match(/^(#{1,2})\s+(.+)$/);
  if (markdownHeading) {
    return { title: markdownHeading[2].trim(), level: markdownHeading[1].length, numberPath: "" };
  }
  /** chineseHeading 是“第一章/第二篇”等中文顶层标题。 */
  const chineseHeading = line.match(/^(第\s*[一二三四五六七八九十百零〇0-9]+\s*[章节篇部])(?:[：:、.\-]?\s*(.*))?$/);
  if (chineseHeading) {
    return { title: line, level: 1, numberPath: chineseHeading[1] };
  }
  /** englishHeading 是英文 Chapter 标题。 */
  const englishHeading = line.match(/^(?:chapter|part)\s+([0-9ivxlcdm]+)\b(?:[：:\-.]?\s*(.*))?$/i);
  if (englishHeading) {
    return { title: line, level: 1, numberPath: englishHeading[1] };
  }
  /** numberedHeading 是 1、1.1、1.1.1 形式的技术手册标题。 */
  const numberedHeading = line.match(/^(\d{1,3}(?:\.\d{1,3}){0,3})\s+(.{1,80})$/);
  if (!numberedHeading) return null;
  /** headingBody 用于排除“4 字节”“2 个”等正文枚举。 */
  const headingBody = numberedHeading[2].trim();
  if (/^(?:字节|个|次|种|条|页|年|月|日|KB|MB|GB)/i.test(headingBody)) return null;
  if (/^[<>=≤≥]/.test(headingBody)) return null;
  if (/^[\d.,+\-×÷%°℃\s]+$/.test(headingBody)) return null;
  if (/^(?:bar|psi|kpa|mpa|pa|mm|cm|m|kg|g|s|ms|hz|rpm)(?:\s|$)/i.test(headingBody)) return null;
  return {
    title: `${numberedHeading[1]} ${headingBody}`,
    level: numberedHeading[1].split(".").length,
    numberPath: numberedHeading[1],
  };
}

/**
 * 把一个仍然过长的章节按安全字数继续拆成连续阅读页。
 *
 * @param {{ title: string, content: string, kind: "text" }} chapter 原章节。
 * @returns {Array<{ title: string, content: string, kind: "text" }>} 安全长度章节页。
 */
function splitOversizedTextChapter(chapter) {
  if (getReadableTextLength(chapter.content) <= progressiveReadableChunkSize) return [chapter];
  return splitReadableTextIntoChunks(chapter.content).map((content, index, chunks) => ({
    title: chunks.length === 1 ? chapter.title : `${chapter.title}（${index + 1}/${chunks.length}）`,
    content,
    kind: "text",
  }));
}

/**
 * 按真实章标题拆分 PDF 或纯文本；超长章优先按二级标题继续拆分。
 *
 * @param {string} text 完整提取正文。
 * @returns {Array<{ title: string, content: string, kind: "text" }>} 可单页渲染的章节。
 */
function createPdfOutlineDocumentChapters(text, pdfOutline) {
  /** outlineEntries 是经过基本类型校验且保留原始顺序的 PDF 原生书签。 */
  const outlineEntries = (Array.isArray(pdfOutline) ? pdfOutline : [])
    .map((entry, index) => ({
      index,
      title: String(entry?.title || "").replace(/\s+/g, " ").trim(),
      level: Number(entry?.level),
      pageNumber: Number(entry?.pageNumber),
    }))
    .filter((entry) => entry.title
      && Number.isInteger(entry.level) && entry.level >= 0
      && Number.isInteger(entry.pageNumber) && entry.pageNumber > 0);
  const rootEntries = outlineEntries.filter((entry) => entry.level === 0);
  if (rootEntries.length < 2) return null;
  /** longestSequences 选择页码递增的最长顶层书签链，排除位置错误的孤立书签。 */
  const longestSequences = [];
  rootEntries.forEach((entry, index) => {
    let bestPrevious = [];
    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const previousSequence = longestSequences[previousIndex];
      if (rootEntries[previousIndex].pageNumber >= entry.pageNumber) continue;
      if (previousSequence.length > bestPrevious.length) bestPrevious = previousSequence;
    }
    longestSequences.push([...bestPrevious, entry]);
  });
  const orderedRoots = longestSequences.reduce(
    (best, sequence) => (sequence.length > best.length ? sequence : best),
    [],
  );
  if (orderedRoots.length < 2) return null;

  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const pageLineIndexes = new Map();
  lines.forEach((line, index) => {
    const pageMatch = line.trim().match(/^\[\[ZHIXU_PDF_PAGE:(\d{1,4})\]\]$/);
    if (pageMatch) pageLineIndexes.set(Number(pageMatch[1]), index);
  });
  if (!pageLineIndexes.has(orderedRoots[0].pageNumber)) return null;

  /** normalizeOutlineTitleMatch 允许 PDF 提取时出现半角/全角及空白差异。 */
  const normalizeOutlineTitleMatch = (value) => String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[：:]/g, ":")
    .trim();
  /** findOutlineLineIndex 在书签页内找到标题正文，使同一页的多个节也能各自成章。 */
  function findOutlineLineIndex(entry, minimumIndex) {
    const pageStartIndex = pageLineIndexes.get(entry.pageNumber);
    const pageEndIndex = pageLineIndexes.get(entry.pageNumber + 1) ?? lines.length;
    const targetTitle = normalizeOutlineTitleMatch(entry.title);
    for (let index = Math.max(pageStartIndex + 1, minimumIndex + 1); index < pageEndIndex; index += 1) {
      const candidateTitle = normalizeOutlineTitleMatch(lines[index]);
      if (!candidateTitle) continue;
      if (candidateTitle === targetTitle || candidateTitle.includes(targetTitle)) return index;
    }
    return pageStartIndex;
  }
  /** boundaries 包含顶层章和直接子节，并按其在正文中的真实行位置排列。 */
  const boundaries = [];
  for (const [rootIndex, root] of orderedRoots.entries()) {
    const nextRoot = orderedRoots[rootIndex + 1];
    const segmentEntries = outlineEntries.filter((entry) => (
      entry.index >= root.index
      && (!nextRoot || entry.index < nextRoot.index)
      && entry.level <= 1
      && entry.pageNumber >= root.pageNumber
      && (!nextRoot || entry.pageNumber < nextRoot.pageNumber)
    ));
    for (const entry of segmentEntries) {
      if (!pageLineIndexes.has(entry.pageNumber)) continue;
      const previousBoundaryIndex = boundaries.at(-1)?.lineIndex ?? -1;
      const lineIndex = findOutlineLineIndex(entry, previousBoundaryIndex);
      if (lineIndex <= previousBoundaryIndex) continue;
      boundaries.push({ ...entry, lineIndex });
    }
  }
  if (boundaries.length < 2) return null;

  const chapters = [];
  const firstBoundaryLine = boundaries[0].lineIndex;
  const frontMatterLines = lines.slice(0, firstBoundaryLine);
  const tableOfContentsIndex = frontMatterLines.findIndex((line) => line.trim() === "目录");
  const frontMatterContent = (tableOfContentsIndex >= 0
    ? frontMatterLines.slice(0, tableOfContentsIndex)
    : frontMatterLines).join("\n").trim();
  if (frontMatterContent) {
    chapters.push(...splitOversizedTextChapter({
      title: "封面与前言",
      content: frontMatterContent,
      kind: "text",
    }));
  }
  boundaries.forEach((boundary, index) => {
    const startIndex = boundary.lineIndex;
    const nextBoundary = boundaries[index + 1];
    const endIndex = nextBoundary ? nextBoundary.lineIndex : lines.length;
    const contentLines = lines.slice(startIndex, endIndex);
    const pageMarker = `[[ZHIXU_PDF_PAGE:${boundary.pageNumber}]]`;
    if (contentLines[0]?.trim() !== pageMarker) contentLines.unshift(pageMarker);
    const content = contentLines.join("\n").trim();
    if (!content) return;
    chapters.push(...splitOversizedTextChapter({
      title: boundary.title,
      content,
      kind: "text",
    }));
  });
  return chapters.length >= 2 ? chapters : null;
}

/**
 * 按真实章标题拆分 PDF 或纯文本；PDF 有原生书签时优先按书签物理页码拆分。
 *
 * @param {string} text 完整提取正文。
 * @param {Array<Record<string, unknown>>} pdfOutline PDF 原生书签。
 * @returns {Array<{ title: string, content: string, kind: "text" }>} 可单页渲染的章节。
 */
function createTextDocumentChapters(text, pdfOutline = []) {
  const outlineChapters = createPdfOutlineDocumentChapters(text, pdfOutline);
  if (outlineChapters) return outlineChapters;
  /** lines 是保留原始换行的正文行。 */
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  /** pageMarkerAtLine 保存每一行所在的 PDF 物理页，用于章节恰好从页中部开始的情况。 */
  const pageMarkerAtLine = [];
  let activePageMarker = "";
  lines.forEach((line, index) => {
    if (/^\[\[ZHIXU_PDF_PAGE:\d{1,4}\]\]$/.test(line.trim())) activePageMarker = line.trim();
    pageMarkerAtLine[index] = activePageMarker;
  });
  /** candidates 是所有可能的章、节标题。 */
  const candidates = lines
    .map((line, index) => ({ index, heading: parseDocumentChapterHeading(line) }))
    .filter((candidate) => candidate.heading);
  /** numericTopCandidates 是数字顶层标题，按 1、2、3 的连续顺序排除正文枚举。 */
  const numericTopCandidates = candidates.filter((candidate) =>
    candidate.heading.level === 1 && /^\d+$/.test(candidate.heading.numberPath),
  );
  const sequentialNumericHeadings = [];
  let expectedChapterNumber = 1;
  for (const candidate of numericTopCandidates) {
    if (Number(candidate.heading.numberPath) !== expectedChapterNumber) continue;
    sequentialNumericHeadings.push(candidate);
    expectedChapterNumber += 1;
  }
  /** namedTopHeadings 是中文、英文或 Markdown 顶层标题。 */
  const namedTopHeadings = candidates.filter((candidate) =>
    candidate.heading.level === 1 && !/^\d+$/.test(candidate.heading.numberPath),
  );
  /** topHeadings 优先采用至少两章的连续数字结构，否则使用命名标题。 */
  const topHeadings = (sequentialNumericHeadings.length >= 2
    ? sequentialNumericHeadings
    : namedTopHeadings).sort((left, right) => left.index - right.index);
  /** rawChapters 是先按章、再按必要的小节得到的章节。 */
  const rawChapters = [];

  /** appendRange 把指定行范围作为一章，并在必要时利用二级标题拆分。 */
  function appendRange(startIndex, endIndex, title, numberPath = "") {
    const rangeLines = lines.slice(startIndex, endIndex);
    const startPageMarker = pageMarkerAtLine[startIndex] || "";
    if (startPageMarker && rangeLines[0]?.trim() !== startPageMarker) {
      rangeLines.unshift(startPageMarker);
    }
    const content = rangeLines.join("\n").trim();
    if (!content) return;
    if (getReadableTextLength(content) <= progressiveReadableChunkSize) {
      rawChapters.push({ title, content, kind: "text" });
      return;
    }
    /** subHeadings 是同一数字章下的直接二级标题。 */
    const subHeadings = candidates.filter((candidate) => {
      if (candidate.index <= startIndex || candidate.index >= endIndex) return false;
      if (candidate.heading.level !== 2) return false;
      return !numberPath || candidate.heading.numberPath.startsWith(`${numberPath}.`);
    });
    if (subHeadings.length === 0) {
      rawChapters.push(...splitOversizedTextChapter({ title, content, kind: "text" }));
      return;
    }
    const boundaries = [{ index: startIndex, heading: { title, numberPath } }, ...subHeadings];
    boundaries.forEach((boundary, boundaryIndex) => {
      const nextIndex = boundaries[boundaryIndex + 1]?.index ?? endIndex;
      const sectionLines = lines.slice(boundary.index, nextIndex);
      const sectionPageMarker = pageMarkerAtLine[boundary.index] || "";
      if (sectionPageMarker && sectionLines[0]?.trim() !== sectionPageMarker) {
        sectionLines.unshift(sectionPageMarker);
      }
      const sectionContent = sectionLines.join("\n").trim();
      if (!sectionContent) return;
      rawChapters.push(...splitOversizedTextChapter({
        title: boundary.heading.title,
        content: sectionContent,
        kind: "text",
      }));
    });
  }

  if (topHeadings.length >= 2) {
    if (topHeadings[0].index > 0) {
      /** frontMatterLines 去掉已经由左侧章节栏替代的 PDF 纸面目录。 */
      const frontMatterLines = lines.slice(0, topHeadings[0].index);
      const tableOfContentsIndex = frontMatterLines.findIndex((line) => line.trim() === "目录");
      const readableFrontMatter = tableOfContentsIndex >= 0
        ? frontMatterLines.slice(0, tableOfContentsIndex)
        : frontMatterLines;
      const frontMatterContent = readableFrontMatter.join("\n").trim();
      if (frontMatterContent) {
        rawChapters.push(...splitOversizedTextChapter({
          title: "封面与前言",
          content: frontMatterContent,
          kind: "text",
        }));
      }
    }
    topHeadings.forEach((candidate, index) => {
      appendRange(
        candidate.index,
        topHeadings[index + 1]?.index ?? lines.length,
        candidate.heading.title,
        candidate.heading.numberPath,
      );
    });
  } else {
    rawChapters.push(...splitOversizedTextChapter({
      title: "正文",
      content: lines.join("\n").trim(),
      kind: "text",
    }));
  }
  return rawChapters.length > 0
    ? rawChapters
    : [{ title: "正文", content: "", kind: "text" }];
}

/**
 * 将 Word 正文节点序列化成仅供安全重建器读取的 HTML。
 *
 * @param {Node[]} nodes 同一章节的 Word 节点。
 * @returns {string} 章节 HTML。
 */
function serializeWordChapterNodes(nodes) {
  const wrapper = document.createElement("div");
  for (const node of nodes) wrapper.append(node.cloneNode(true));
  return wrapper.innerHTML;
}

/**
 * 把 Word 章节按顶层段落或表格行限制到安全渲染长度。
 *
 * @param {Node[]} nodes 同一 Word 章节的节点。
 * @param {string} title 章节标题。
 * @returns {Array<{ title: string, content: string, kind: "word" }>} Word 章节页。
 */
function splitWordChapterNodes(nodes, title) {
  const pageNodeGroups = [];
  let currentNodes = [];
  let currentLength = 0;
  const flushCurrentNodes = () => {
    if (currentNodes.length === 0) return;
    pageNodeGroups.push(currentNodes);
    currentNodes = [];
    currentLength = 0;
  };
  for (const node of nodes) {
    const nodeLength = (node.textContent || "").length;
    /** 超长表格按行拆页，避免单一 TABLE 节点绕过章节上限。 */
    if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === "TABLE"
      && nodeLength > progressiveReadableChunkSize) {
      flushCurrentNodes();
      const rows = Array.from(node.querySelectorAll("tr"));
      let rowGroup = [];
      let rowGroupLength = 0;
      const flushRows = () => {
        if (rowGroup.length === 0) return;
        const table = document.createElement("table");
        for (const row of rowGroup) table.append(row.cloneNode(true));
        pageNodeGroups.push([table]);
        rowGroup = [];
        rowGroupLength = 0;
      };
      for (const row of rows) {
        const rowLength = (row.textContent || "").length;
        if (rowGroup.length > 0 && rowGroupLength + rowLength > progressiveReadableChunkSize) {
          flushRows();
        }
        rowGroup.push(row);
        rowGroupLength += rowLength;
      }
      flushRows();
      continue;
    }
    /** 极长单段落按纯文本切页，避免一个节点独占浏览器主线程。 */
    if (nodeLength > progressiveReadableChunkSize) {
      flushCurrentNodes();
      const textContent = node.textContent || "";
      for (let offset = 0; offset < textContent.length; offset += progressiveReadableChunkSize) {
        const safeTagName = node.nodeType === Node.ELEMENT_NODE
          && ["P", "LI", "BLOCKQUOTE"].includes(node.nodeName)
          ? node.nodeName.toLowerCase()
          : "p";
        const textNode = document.createElement(safeTagName);
        textNode.textContent = textContent.slice(offset, offset + progressiveReadableChunkSize);
        pageNodeGroups.push([textNode]);
      }
      continue;
    }
    if (currentNodes.length > 0 && currentLength + nodeLength > progressiveReadableChunkSize) {
      flushCurrentNodes();
    }
    currentNodes.push(node);
    currentLength += nodeLength;
  }
  flushCurrentNodes();
  const groups = pageNodeGroups.length > 0 ? pageNodeGroups : [[]];
  return groups.map((group, index) => ({
    title: groups.length === 1 ? title : `${title}（${index + 1}/${groups.length}）`,
    content: serializeWordChapterNodes(group),
    kind: "word",
  }));
}

/**
 * 按 Word 的 H1/H2 结构拆分章节；没有标题时按正文长度分页。
 *
 * @param {string} rawHtml Mammoth 生成的完整 Word HTML。
 * @returns {Array<{ title: string, content: string, kind: "word" }>} Word 章节。
 */
function createWordDocumentChapters(rawHtml) {
  const parsedDocument = new DOMParser().parseFromString(rawHtml, "text/html");
  const nodes = Array.from(parsedDocument.body.childNodes);
  const headingNodes = nodes.filter((node) =>
    node.nodeType === Node.ELEMENT_NODE && ["H1", "H2"].includes(node.nodeName),
  );
  const preferredTag = headingNodes.filter((node) => node.nodeName === "H1").length >= 2
    ? "H1"
    : "H2";
  const boundaries = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.nodeType === Node.ELEMENT_NODE && node.nodeName === preferredTag);
  const chapters = [];
  if (boundaries.length >= 2) {
    if (boundaries[0].index > 0) {
      chapters.push(...splitWordChapterNodes(
        nodes.slice(0, boundaries[0].index),
        "封面与前言",
      ));
    }
    boundaries.forEach((boundary, index) => {
      const chapterNodes = nodes.slice(boundary.index, boundaries[index + 1]?.index ?? nodes.length);
      chapters.push(...splitWordChapterNodes(
        chapterNodes,
        boundary.node.textContent.trim() || `第 ${index + 1} 章`,
      ));
    });
    return chapters;
  }
  return splitWordChapterNodes(nodes, "正文");
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
      if (!/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(imageSource)) return;
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
 * 更新文档章节顶部和底部的翻页控件。
 *
 * @returns {void}
 */
function updateDocumentChapterNavigation() {
  const chapters = applicationState.documentChapters;
  const chapterIndex = applicationState.activeDocumentChapterIndex;
  const hasMultipleChapters = chapters.length > 1;
  dom.documentChapterNavigation.hidden = !hasMultipleChapters;
  dom.documentChapterFooter.hidden = !hasMultipleChapters;
  if (!hasMultipleChapters) return;
  const chapter = chapters[chapterIndex];
  const counterText = `第 ${chapterIndex + 1} / ${chapters.length} 章`;
  dom.documentChapterCounter.textContent = counterText;
  dom.documentChapterFooterCounter.textContent = `${counterText} · ${chapter.title}`;
  dom.documentChapterTitle.textContent = chapter.title;
  dom.documentChapterPrevious.disabled = chapterIndex === 0;
  dom.documentChapterFooterPrevious.disabled = chapterIndex === 0;
  dom.documentChapterNext.disabled = chapterIndex >= chapters.length - 1;
  dom.documentChapterFooterNext.disabled = chapterIndex >= chapters.length - 1;
}

/**
 * 在左侧目录中显示整份文档的章节，而不是当前页全部小标题。
 *
 * @returns {void}
 */
function buildDocumentChapterTableOfContents() {
  dom.readingToc.replaceChildren();
  dom.readingTocTitle.textContent = "文档章节";
  applicationState.documentChapters.slice(0, 500).forEach((chapter, index) => {
    const tocButton = document.createElement("button");
    tocButton.type = "button";
    tocButton.className = "reading-toc-level-h2 document-chapter-toc-button";
    tocButton.classList.toggle("is-active", index === applicationState.activeDocumentChapterIndex);
    tocButton.setAttribute("aria-current", index === applicationState.activeDocumentChapterIndex ? "page" : "false");
    tocButton.textContent = chapter.title.slice(0, 100);
    tocButton.addEventListener("click", () => {
      void renderDocumentChapter(index, { scrollToTop: true, saveProgress: true });
    });
    dom.readingToc.append(tocButton);
  });
}

/**
 * 只渲染当前选中的一个文档章节。
 *
 * @param {number} requestedIndex 目标章节下标。
 * @param {{ scrollToTop?: boolean, saveProgress?: boolean }} options 翻页行为。
 * @returns {Promise<boolean>} 是否成功显示目标章节。
 */
async function renderDocumentChapter(requestedIndex, options = {}) {
  const chapters = applicationState.documentChapters;
  if (chapters.length === 0) return false;
  const chapterIndex = Math.min(chapters.length - 1, Math.max(0, Math.trunc(requestedIndex)));
  const chapter = chapters[chapterIndex];
  const renderSequence = applicationState.documentRenderSequence + 1;
  applicationState.documentRenderSequence = renderSequence;
  applicationState.activeDocumentChapterIndex = chapterIndex;
  dom.readerContent.replaceChildren(
    createTextElement("div", "readable-render-status", `正在打开：${chapter.title}`),
  );
  updateDocumentChapterNavigation();
  await yieldDocumentRendering();
  if (renderSequence !== applicationState.documentRenderSequence) return false;
  /** fragment 是当前章节转换后的安全 HTML；异常时改用纯文本，避免永久停在加载状态。 */
  let fragment;
  try {
    fragment = chapter.kind === "word"
      ? createWordDocument(chapter.content)
      : createReadableDocument(chapter.content);
  } catch (error) {
    console.error("文档章节排版失败，已改用纯文本显示。", error);
    /** fallbackText 是不经过复杂排版的章节正文。 */
    const fallbackText = chapter.kind === "word"
      ? new DOMParser().parseFromString(chapter.content, "text/html").body.textContent
      : chapter.content;
    fragment = document.createDocumentFragment();
    fragment.append(
      createTextElement("div", "readable-render-warning", "本章排版失败，已切换为纯文本阅读。"),
      createTextElement("pre", "readable-plain-fallback", fallbackText || "本章没有可显示的正文。"),
    );
  }
  dom.readerContent.replaceChildren(fragment);
  await yieldDocumentRendering();
  if (renderSequence !== applicationState.documentRenderSequence) return false;
  applicationState.activeReadingSurface = dom.readerContent;
  if (options.scrollToTop) {
    const readerTop = window.scrollY
      + (dom.documentChapterNavigation.hidden
        ? dom.readerContent.getBoundingClientRect().top
        : dom.documentChapterNavigation.getBoundingClientRect().top)
      - 24;
    window.scrollTo({ top: Math.max(0, readerTop), behavior: "auto" });
  }
  if (applicationState.readingWorkspace) {
    buildDocumentChapterTableOfContents();
    applyReadingHighlights();
    renderReadingAnnotations();
    const progressPercent = calculateReadingProgress();
    renderReadingProgress(progressPercent);
    if (options.saveProgress) {
      const currentStatus = applicationState.readingWorkspace.state.status;
      void saveReadingState({
        progressPercent,
        status: currentStatus === "unread" && progressPercent >= 2 ? "reading" : currentStatus,
      });
    }
  }
  return true;
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
  applicationState.documentChapters = [];
  applicationState.activeDocumentChapterIndex = 0;
  dom.documentChapterNavigation.hidden = true;
  dom.documentChapterFooter.hidden = true;
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
  dom.readingTocTitle.textContent = dom.paperReader.hidden ? "文章目录" : "论文目录";
  /** allHeadings 是正文中全部可进入目录的二至四级标题。 */
  const allHeadings = Array.from(readingSurface.querySelectorAll("h1, h2, h3, h4"))
    .filter((heading) => heading.textContent.trim());
  /** headings 限制首次目录节点数量，避免超长手册再次阻塞主线程。 */
  const headings = allHeadings.slice(0, 240);
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
  if (allHeadings.length > headings.length) {
    dom.readingToc.append(
      createTextElement(
        "p",
        "reading-toc-limit-note",
        `目录较长，已先展示前 ${headings.length} 节；正文仍完整保留。`,
      ),
    );
  }
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
  /** localProgress 是当前可见正文页内部的滚动百分比。 */
  const localProgress = Math.min(100, Math.max(0, (currentDistance / readableDistance) * 100));
  /** chapters 仅在本地文档章节阅读模式中存在。 */
  const chapters = applicationState.documentChapters;
  if (!dom.reader.hidden && chapters.length > 1) {
    return ((applicationState.activeDocumentChapterIndex + localProgress / 100) / chapters.length) * 100;
  }
  return localProgress;
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
  /** localProgress 把整本文档进度还原为当前章节内部进度。 */
  const chapters = applicationState.documentChapters;
  const localProgress = !dom.reader.hidden && chapters.length > 1
    ? Math.min(100, Math.max(0,
      (normalizedProgress / 100 * chapters.length - applicationState.activeDocumentChapterIndex) * 100,
    ))
    : normalizedProgress;
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
        surfaceTop + readableDistance * (localProgress / 100) - window.innerHeight * 0.35;
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
    /** savedChapterIndex 把整本文档的历史进度定位到对应章节。 */
    if (targetType === "document" && applicationState.documentChapters.length > 1) {
      const chapterCount = applicationState.documentChapters.length;
      const normalizedProgress = Math.min(
        100,
        Math.max(0, Number(payload.workspace.state.progressPercent) || 0),
      );
      const savedChapterIndex = Math.min(
        chapterCount - 1,
        Math.floor((normalizedProgress / 100) * chapterCount),
      );
      if (savedChapterIndex !== applicationState.activeDocumentChapterIndex) {
        await renderDocumentChapter(savedChapterIndex, { scrollToTop: false, saveProgress: false });
      }
      buildDocumentChapterTableOfContents();
    } else {
      buildReadingTableOfContents(readingSurface);
    }
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
 * 清理离开原始文档阅读页时使用的渲染状态。
 *
 * @returns {void}
 */
function resetDocumentReaderPreview() {
  applicationState.documentRenderSequence += 1;
  dom.reader.classList.remove("is-word-reader");
  dom.readerContent.classList.remove("is-word-document");
  dom.originalDocumentLink.href = "#";
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
  awaiting_confirmation: "没有独立字幕轨，等待确认",
  downloading_video: "正在临时获取公开视频",
  extracting_audio: "正在提取本地音频",
  extracting_frames: "正在采集候选画面",
  transcribing_audio: "正在进行本地语音转写",
  rendering_study_pdf: "正在生成图文学习 PDF",
  completed: "已完成",
  failed: "失败",
});

/**
 * 从任务中心跳到归档文件夹并突出对应文章或文档。
 *
 * @param {Record<string, unknown>} job 已完成的后台任务。
 * @returns {Promise<void>}
 */
async function locateImportJobTarget(job) {
  await loadLibrary();
  const targetItems = job.targetType === "article"
    ? applicationState.articles
    : applicationState.documents;
  const target = targetItems.find((item) => item.id === job.targetId);
  if (!target) {
    showToast("这项内容已不在文档库中，可能已经被删除。");
    return;
  }
  applicationState.searchQuery = "";
  dom.searchInput.value = "";
  applicationState.favoriteOnly = false;
  applicationState.activeTag = "";
  applicationState.activeFolderId = target.folderId || job.location?.folderId || "";
  showView("library");
  renderLibrary();
  window.requestAnimationFrame(() => {
    const itemKey = `${job.targetType}:${job.targetId}`;
    const card = [...dom.documentGrid.children].find((item) => item.dataset.itemKey === itemKey);
    if (!card) return;
    card.classList.add("is-located");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => card.classList.remove("is-located"), 3200);
  });
}

/**
 * 渲染最近后台导入任务并提供打开结果或失败重试入口。
 *
 * @returns {void}
 */
function renderImportJobs() {
  dom.importJobList.replaceChildren();
  if (applicationState.importJobs.length === 0) {
    dom.importJobSummary.textContent = "";
    dom.importJobList.append(
      createTextElement("p", "import-job-empty", "还没有后台导入任务。"),
    );
    return;
  }
  /** activeJobs 是仍在排队或运行、需要持续关注的任务。 */
  const activeJobs = applicationState.importJobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  );
  /** attentionJobs 是等待确认或失败后可重试的任务。 */
  const attentionJobs = applicationState.importJobs.filter(
    (job) => !activeJobs.includes(job)
      && (job.stage === "awaiting_confirmation" || job.status === "failed"),
  );
  /** completedJobs 是按更新时间倒序返回的已完成历史。 */
  const completedJobs = applicationState.importJobs.filter(
    (job) => job.status === "completed",
  );
  /** filters 把状态和任务类型筛选统一映射到列表。 */
  const filters = {
    priority: [...activeJobs, ...attentionJobs, ...completedJobs.slice(0, 5)],
    active: activeJobs,
    attention: attentionJobs,
    completed: completedJobs,
    video: applicationState.importJobs.filter((job) => job.jobType === "video_transcript"),
    ocr: applicationState.importJobs.filter((job) => job.jobType === "document_ocr"),
    all: applicationState.importJobs,
  };
  /** visibleJobs 是当前筛选条件下实际渲染的任务。 */
  const visibleJobs = filters[applicationState.importJobFilter] || filters.priority;
  dom.importJobFilter.value = applicationState.importJobFilter;
  dom.showImportJobHistory.textContent = applicationState.importJobFilter === "all"
    ? "收起历史"
    : `查看全部历史（${applicationState.importJobs.length}）`;
  dom.importJobSummary.textContent = applicationState.importJobs.length >= 200
    ? `当前显示 ${visibleJobs.length} 条；历史记录仅载入最近 200 条。`
    : `当前显示 ${visibleJobs.length} 条，共 ${applicationState.importJobs.length} 条历史记录。`;
  if (visibleJobs.length === 0) {
    dom.importJobList.append(
      createTextElement("p", "import-job-empty", "当前筛选条件下没有任务。"),
    );
    return;
  }
  for (const job of visibleJobs) {
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
    if (job.location?.folderLabel) {
      copy.append(
        createTextElement("small", "import-job-location", `所在目录：${job.location.folderLabel}`),
      );
    }
    if (job.errorMessage) copy.append(createTextElement("p", "", job.errorMessage));
    item.append(copy);
    if (job.stage === "awaiting_confirmation") {
      /** actions 提供重新检查、图文 PDF 和仅保存链接三个明确选择。 */
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
      const studyPdfButton = createTextElement(
        "button",
        "text-button",
        "本地转写并生成图文 PDF",
      );
      studyPdfButton.type = "button";
      studyPdfButton.addEventListener("click", async () => {
        const accepted = window.confirm(
          "将临时获取该公开视频，使用本机语音转写和关键帧生成 PDF。"
          + "处理完成后会删除临时视频和音频，仅保留正文、关键画面和 PDF。是否继续？",
        );
        if (!accepted) return;
        studyPdfButton.disabled = true;
        try {
          await requestJson(`/api/import-jobs/${encodeURIComponent(job.id)}/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "generate_study_pdf" }),
          });
          showToast("已开始本地转写和关键画面提取，较长视频可能需要一些时间。");
          await loadImportJobs();
        } catch (error) {
          showToast(error.message);
        } finally {
          studyPdfButton.disabled = false;
        }
      });
      actions.append(retryButton, studyPdfButton, saveLinkButton);
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
    } else if (
      job.status === "completed"
      && ["article", "document"].includes(job.targetType)
      && job.targetId
    ) {
      /** completedActions 直接打开已经进入知识库的文章或文档。 */
      const completedActions = document.createElement("div");
      completedActions.className = "import-job-actions";
      const openButton = createTextElement(
        "button",
        "text-button",
        job.targetType === "document" ? "打开文档" : "打开",
      );
      openButton.type = "button";
      openButton.addEventListener("click", () => {
        if (job.targetType === "document") void openDocument(job.targetId);
        else void openArticle(job.targetId);
      });
      if (job.location?.folderId) {
        const locateButton = createTextElement("button", "text-button", "查看位置");
        locateButton.type = "button";
        locateButton.addEventListener("click", () => {
          void locateImportJobTarget(job).catch((error) => showToast(error.message));
        });
        completedActions.append(locateButton);
      }
      completedActions.append(openButton);
      if (job.result?.pdfUrl) {
        const pdfButton = createTextElement("a", "text-button", "打开图文 PDF");
        pdfButton.href = job.result.pdfUrl;
        pdfButton.target = "_blank";
        pdfButton.rel = "noopener noreferrer";
        completedActions.append(pdfButton);
      }
      item.append(completedActions);
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
  const payload = await requestJson("/api/import-jobs?limit=200");
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
function setArticleImageSource(image, remoteSource) {
  /** proxySource 始终通过本机缓存代理读取远程图片。 */
  const proxySource = `/api/article-images?url=${encodeURIComponent(remoteSource)}`;
  image.setAttribute("src", proxySource);
  /** 首次网络或缓存失败时自动重试一次，不在阅读页永久留下破图。 */
  image.addEventListener("error", () => {
    image.setAttribute("src", `${proxySource}&retry=${Date.now()}`);
  }, { once: true });
}

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
      setArticleImageSource(image, remoteSource);
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
  /** translationActive 表示文章已经排队或正在分段翻译。 */
  const translationActive = ["pending", "processing"].includes(article.translationStatus);
  /** translationFailed 表示后台工作器已保存可重试错误。 */
  const translationFailed = article.translationStatus === "failed";
  dom.articleTranslationTools.hidden = !canTranslate;
  dom.articleLanguageSwitch.hidden = !translationReady;
  dom.articleTranslationRequest.hidden =
    !canTranslate || translationActive || translationReady;
  dom.articleTranslationRequest.disabled = translationActive;
  dom.articleTranslationRequest.textContent = translationFailed
    ? "重新翻译"
    : "加入 Codex 翻译";
  /** progressPercent 是页面进度条使用的受限整数。 */
  const progressPercent = Math.min(
    Math.max(Math.round(Number(article.translationProgressPercent) || 0), 0),
    100,
  );
  dom.articleTranslationProgress.hidden = !translationActive;
  dom.articleTranslationProgressBar.style.width = `${progressPercent}%`;
  dom.articleTranslationProgress.setAttribute("aria-valuenow", String(progressPercent));
  if (!canTranslate) {
    dom.articleTranslationStatus.textContent = "";
  } else if (translationReady) {
    dom.articleTranslationStatus.textContent = "Codex 中文译文已完成";
  } else if (article.translationStatus === "pending") {
    /** queuePosition 是后台状态接口返回的真实队列位置。 */
    const queuePosition = Number(article.queuePosition) || 0;
    /** workerWaitingMessage 在 Codex 未登录时解释为何仍在排队。 */
    const workerWaitingMessage = article.translationWorkerStatus === "waiting"
      ? ` · ${article.translationWorkerMessage || "等待本机 Codex 就绪"}`
      : "";
    dom.articleTranslationStatus.textContent = `排队中${queuePosition ? ` · 第 ${queuePosition} 位` : ""}${workerWaitingMessage}`;
  } else if (article.translationStatus === "processing") {
    /** totalSections 和 completedSections 构成真实分段完成度。 */
    const totalSections = Number(article.translationTotalSections) || 0;
    const completedSections = Number(article.translationCompletedSections) || 0;
    /** stageLabels 是非翻译阶段的用户可读说明。 */
    const stageLabels = {
      preparing: "正在准备原文",
      validating: "正在检查译文完整性",
      saving: "正在保存中文译文",
    };
    /** translatingLabel 表示当前实际处理的分段序号。 */
    const translatingLabel = totalSections > 0
      ? `正在翻译第 ${Math.min(completedSections + 1, totalSections)}/${totalSections} 节`
      : "正在切分文章";
    const stageLabel = article.translationStage === "translating"
      ? translatingLabel
      : stageLabels[article.translationStage] || "正在启动 Codex 翻译";
    dom.articleTranslationStatus.textContent = `${stageLabel} · ${progressPercent}%`;
  } else if (translationFailed) {
    /** conciseError 避免底层命令长日志挤占阅读页操作栏。 */
    const conciseError = String(article.translationError || "可以重新翻译").slice(0, 180);
    dom.articleTranslationStatus.textContent = `翻译失败：${conciseError}`;
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
  renderReadingMath(dom.articleReaderContent);
  renderArticleTranslationControls(article);
}

/**
 * 把正文中保留的 LaTeX 公式转换为本地 KaTeX 排版；代码块保持原样。
 *
 * @param {HTMLElement} readingSurface 已插入页面的文章或论文正文容器。
 * @returns {void}
 */
function renderReadingMath(readingSurface) {
  renderMathInElement(readingSurface, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "$", right: "$", display: false },
    ],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
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
    applicationState.selectedArticle = {
      ...payload.article,
      ...(payload.translation || {}),
    };
    renderArticleTranslationControls(applicationState.selectedArticle);
    showToast("已加入 Codex 自动翻译队列；页面会显示真实分段进度。");
    void pollArticleTranslation(article.id).catch((error) => showToast(error.message));
  } catch (error) {
    showToast(error.message);
  } finally {
    if (applicationState.selectedArticle) {
      renderArticleTranslationControls(applicationState.selectedArticle);
    }
  }
}

/**
 * 轮询当前文章的轻量翻译状态，完成时只额外读取一次完整译文。
 *
 * @param {string} articleId 当前文章 ID。
 * @returns {Promise<void>} 本轮轮询完成。
 */
async function pollArticleTranslation(articleId) {
  window.clearTimeout(applicationState.articleTranslationPollTimer);
  if (
    applicationState.selectedArticle?.id !== articleId
    || dom.articleReader.hidden
  ) return;
  /** payload 是工作器和当前文章的轻量状态。 */
  const payload = await requestJson(
    `/api/article-translation-worker/status?articleId=${encodeURIComponent(articleId)}`,
  );
  if (applicationState.selectedArticle?.id !== articleId) return;
  /** translation 是不含长正文的实时任务进度。 */
  const translation = payload.translation || {};
  applicationState.selectedArticle = {
    ...applicationState.selectedArticle,
    ...translation,
    translationWorkerStatus: payload.worker?.status || "",
    translationWorkerMessage: payload.worker?.message || "",
  };
  renderArticleTranslationControls(applicationState.selectedArticle);
  if (translation.translationStatus === "ready") {
    /** detailPayload 只在完成时加载一次包含中文全文的文章详情。 */
    const detailPayload = await requestJson(
      `/api/articles/${encodeURIComponent(articleId)}`,
    );
    if (applicationState.selectedArticle?.id !== articleId) return;
    applicationState.selectedArticle = detailPayload.article;
    applicationState.articleLanguageMode = "translation";
    renderArticleReadingMode();
    applicationState.activeReadingSurface = dom.articleReaderContent;
    buildReadingTableOfContents(dom.articleReaderContent);
    applyReadingHighlights();
    showToast("Codex 中文译文已完成。英文原文仍完整保留。");
    await loadLibrary();
    return;
  }
  if (translation.translationStatus === "failed") return;
  applicationState.articleTranslationPollTimer = window.setTimeout(
    () => void pollArticleTranslation(articleId).catch((error) => showToast(error.message)),
    2000,
  );
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
    window.clearTimeout(applicationState.articleTranslationPollTimer);
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
    if (["pending", "processing"].includes(article.translationStatus)) {
      void pollArticleTranslation(article.id).catch((error) => showToast(error.message));
    }
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
  const accepted = window.confirm(
    "知序将优先读取公开字幕，并临时获取视频画面来提取 PPT 和关键帧。"
    + "没有字幕时会在本机转写音频；完成后自动删除临时视频、音频和截图，"
    + "最终 PDF 会保存到文档库。是否继续？",
  );
  if (!accepted) return;
  dom.importVideoButton.disabled = true;
  dom.importVideoButton.textContent = "正在加入任务…";
  try {
    const payload = await requestJson("/api/videos/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: inputUrl,
        preferredLanguages: ["zh-Hans", "zh-CN", "zh-Hant", "zh", "en"],
        generateStudyPdf: true,
      }),
    });
    dom.videoUrlInput.value = "";
    showView("storage");
    await loadStorageOperations();
    showToast(payload.duplicate ? "相同视频已经在导入队列中。" : "正在整理图文 PDF，完成后会自动进入文档库。");
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.importVideoButton.disabled = false;
    dom.importVideoButton.textContent = "整理为图文 PDF 并保存";
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

/** 将文档与网页文章补齐统一的内容类型。 */
function getUnifiedLibraryItems() {
  return [
    ...applicationState.documents.map((item) => ({
      ...item,
      targetType: "document",
    })),
    ...applicationState.articles.map((item) => ({
      ...item,
      targetType: "article",
    })),
  ];
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
  /** allItems 是已经补齐 targetType 的统一知识条目。 */
  const allItems = getUnifiedLibraryItems();
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
 * 修改文档或网页文章在知识库中的展示名称。
 *
 * @param {Record<string, unknown>} item 文档库条目。
 * @returns {Promise<void>}
 */
async function renameKnowledgeItem(item) {
  if (!["document", "article"].includes(item.targetType)) return;
  const nextTitle = window.prompt("修改显示名称：", item.title);
  const normalizedTitle = String(nextTitle || "").replace(/\s+/g, " ").trim();
  if (!normalizedTitle || normalizedTitle === item.title) return;
  try {
    const targetId = item.targetId || item.id;
    const resourceName = item.targetType === "article" ? "articles" : "documents";
    await requestJson(`/api/${resourceName}/${encodeURIComponent(targetId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: normalizedTitle }),
    });
    await loadLibrary();
    showToast("名称已修改。");
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
    /** actions 是移动、重命名和安全删除入口。 */
    const actions = document.createElement("div");
    actions.className = "folder-card-actions";
    /** moveButton 会把当前文件夹整棵子树移动到其它目录。 */
    const moveButton = createTextElement("button", "", "移动");
    moveButton.type = "button";
    moveButton.addEventListener("click", () => moveLibraryFolder(folder));
    /** renameButton 是文件夹重命名按钮。 */
    const renameButton = createTextElement("button", "", "重命名");
    renameButton.type = "button";
    renameButton.addEventListener("click", () => void renameLibraryFolder(folder));
    /** deleteButton 是仅删除空文件夹的按钮。 */
    const deleteButton = createTextElement("button", "is-danger", "删除");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => void deleteLibraryFolder(folder));
    actions.append(moveButton, renameButton, deleteButton);
    card.append(openButton, actions);
    dom.folderGrid.append(card);
  }
}

/** 返回按完整路径排序的全部知识库目录。 */
function getSortedFolderOptions() {
  return [...applicationState.folders].sort((left, right) =>
    left.path.map((part) => part.name).join("/").localeCompare(
      right.path.map((part) => part.name).join("/"),
      "zh-CN",
      { numeric: true },
    ),
  );
}

/** 刷新上传区域的知识库目标目录下拉框。 */
function renderUploadFolderOptions() {
  const previousValue = applicationState.selectedUploadFolderId;
  dom.uploadFolderSelect.replaceChildren(new Option("请选择目录", ""));
  for (const folder of getSortedFolderOptions()) {
    const label = folder.path.map((part) => part.name).join(" / ");
    dom.uploadFolderSelect.append(new Option(label, folder.id));
  }
  const selectionStillExists = applicationState.folders.some((folder) => folder.id === previousValue);
  applicationState.selectedUploadFolderId = selectionStillExists ? previousValue : "";
  dom.uploadFolderSelect.value = applicationState.selectedUploadFolderId;
  dom.uploadFolderSelect.disabled = applicationState.uploadFolderMode !== "selected";
}

/** 检查上传目标设置，指定目录模式下必须先选择有效目录。 */
function validateUploadDestination() {
  if (applicationState.uploadFolderMode !== "selected") return true;
  const valid = applicationState.folders.some(
    (folder) => folder.id === applicationState.selectedUploadFolderId,
  );
  if (!valid) showToast("请先选择要保存到的知识库目录。");
  return valid;
}

/** 返回指定上传目录的完整可读路径，用于上传状态与完成提示。 */
function getUploadFolderPathLabel(folderId) {
  const folder = applicationState.folders.find((item) => item.id === folderId);
  return folder ? folder.path.map((part) => part.name).join(" / ") : "";
}

/** 返回统一内容条目的批量选择键。 */
function getLibraryItemKey(item) {
  return `${item.targetType}:${item.id}`;
}

/** 更新批量整理工具栏的数量与按钮状态。 */
function renderLibraryBatchToolbar() {
  const selectedCount = applicationState.selectedLibraryItemKeys.size;
  dom.libraryBatchToolbar.hidden = !applicationState.libraryBatchMode;
  dom.batchSelectButton.classList.toggle("is-active", applicationState.libraryBatchMode);
  dom.batchSelectButton.setAttribute("aria-pressed", String(applicationState.libraryBatchMode));
  dom.batchSelectButton.textContent = applicationState.libraryBatchMode ? "正在批量整理" : "批量整理";
  dom.batchSelectionCount.textContent = `已选择 ${selectedCount} 项`;
  dom.batchMoveButton.disabled = selectedCount === 0;
  dom.batchDeleteButton.disabled = selectedCount === 0;
}

/** 进入或退出文档库批量整理模式。 */
function setLibraryBatchMode(active) {
  applicationState.libraryBatchMode = Boolean(active);
  if (!applicationState.libraryBatchMode) applicationState.selectedLibraryItemKeys.clear();
  renderLibrary();
}

/** 选择或取消选择当前目录中显示的全部内容。 */
function toggleSelectAllVisibleItems() {
  const visibleItems = getVisibleLibraryItems();
  const allSelected = visibleItems.length > 0 && visibleItems.every(
    (item) => applicationState.selectedLibraryItemKeys.has(getLibraryItemKey(item)),
  );
  for (const item of visibleItems) {
    const key = getLibraryItemKey(item);
    if (allSelected) applicationState.selectedLibraryItemKeys.delete(key);
    else applicationState.selectedLibraryItemKeys.add(key);
  }
  renderDocumentGrid();
  renderLibraryBatchToolbar();
}

/** 返回当前批量勾选且仍存在于本地列表的内容。 */
function getSelectedLibraryItems() {
  const itemMap = new Map();
  for (const item of [
    ...getUnifiedLibraryItems(),
    ...applicationState.papers.map((item) => ({ ...item, targetType: "paper" })),
    ...applicationState.searchResults,
  ]) {
    itemMap.set(getLibraryItemKey(item), item);
  }
  return [...applicationState.selectedLibraryItemKeys]
    .map((key) => itemMap.get(key))
    .filter(Boolean);
}

/** 经二次确认后，在一个服务端事务中永久删除当前勾选的全部内容。 */
async function deleteSelectedLibraryItems() {
  /** items 是当前仍然存在于文档库缓存中的所选内容。 */
  const items = getSelectedLibraryItems();
  if (items.length === 0) {
    showToast("请先选择需要删除的内容。");
    return;
  }
  /** titlePreview 帮助用户在最终确认前核对前几项内容。 */
  const titlePreview = items
    .slice(0, 5)
    .map((item) => `• ${String(item.titleZh || item.title || "未命名内容")}`)
    .join("\n");
  const remainingLabel = items.length > 5 ? `\n• 以及另外 ${items.length - 5} 项` : "";
  /** confirmed 明确提示批量永久删除不可恢复。 */
  const confirmed = window.confirm(
    `确定永久删除所选 ${items.length} 项内容吗？\n\n${titlePreview}${remainingLabel}\n\n原始附件、阅读进度、批注、标签和专题关系也会删除。此操作无法撤销。`,
  );
  if (!confirmed) return;

  dom.batchDeleteButton.disabled = true;
  try {
    const result = await requestJson("/api/folder-items/batch", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((item) => ({ targetType: item.targetType, targetId: item.id })),
      }),
    });
    const selectedKeys = new Set(items.map(getLibraryItemKey));
    if (
      applicationState.readingWorkspace &&
      selectedKeys.has(`${applicationState.readingWorkspace.targetType}:${applicationState.readingWorkspace.targetId}`)
    ) {
      closeReadingWorkspace();
    }
    applicationState.selectedLibraryItemKeys.clear();
    applicationState.libraryBatchMode = false;
    await Promise.all([loadLibrary(), loadPapers(), loadTopics()]);
    showView("library");
    showToast(`已永久删除 ${Number(result.deletedCount || items.length)} 项内容。`);
  } catch (error) {
    showToast(error.message);
    renderLibraryBatchToolbar();
  }
}

/** 返回移动窗口允许展示的目录；移动整棵目录时排除自身及后代。 */
function getMoveFolderTreeFolders() {
  const sourceFolder = applicationState.pendingMoveFolder;
  if (!sourceFolder) return getSortedFolderOptions();
  return getSortedFolderOptions().filter((candidate) =>
    !candidate.path.some((pathItem) => pathItem.id === sourceFolder.id),
  );
}

/** 返回移动窗口中不能被选中、但仍需保留层级结构的目录 ID。 */
function getDisabledMoveFolderIds() {
  const sourceFolder = applicationState.pendingMoveFolder;
  return new Set(sourceFolder?.parentId ? [sourceFolder.parentId] : []);
}

/** 返回目录在移动树中的完整中文路径。 */
function getMoveFolderPathLabel(folder) {
  return folder.path.map((part) => part.name).join(" / ");
}

/** 根据当前来源位置，默认只展开来源目录所在路径。 */
function expandMoveFolderSourcePath() {
  const sourceFolder = applicationState.pendingMoveFolder;
  let sourceFolderId = sourceFolder?.parentId || "";
  if (!sourceFolder) {
    const itemFolderIds = new Set(
      applicationState.pendingMoveItems.map((item) => String(item.folderId || "")),
    );
    sourceFolderId = itemFolderIds.size === 1
      ? [...itemFolderIds][0]
      : applicationState.activeFolderId;
  }
  const folder = applicationState.folders.find((candidate) => candidate.id === sourceFolderId);
  for (const pathItem of folder?.path || []) {
    applicationState.moveFolderExpandedIds.add(pathItem.id);
  }
}

/** 更新弹窗内新建文件夹将使用的父目录说明。 */
function updateMoveFolderCreateParentLabel() {
  const selectedId = applicationState.selectedMoveFolderId;
  const selectedFolder = applicationState.folders.find((folder) => folder.id === selectedId);
  dom.moveFolderCreateParent.textContent = selectedFolder
    ? `将在“${getMoveFolderPathLabel(selectedFolder)}”下新建子文件夹`
    : "将在文档库根目录下创建一级文件夹";
}

/** 选中移动目标目录并刷新树中高亮。 */
function selectMoveFolderTarget(folderId) {
  applicationState.selectedMoveFolderId = folderId;
  dom.moveFolderConfirm.disabled = !folderId;
  updateMoveFolderCreateParentLabel();
  renderMoveFolderTree();
}

/** 创建移动目录树中的单行节点。 */
function createMoveFolderTreeRow(folder, depth, childFolders, disabledIds) {
  const row = document.createElement("div");
  row.className = "move-folder-tree-row";
  row.style.setProperty("--tree-depth", String(depth));
  const hasChildren = childFolders.length > 0;
  const expanded = applicationState.moveFolderExpandedIds.has(folder.id)
    || Boolean(applicationState.moveFolderSearchQuery);
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = `move-folder-toggle${hasChildren ? "" : " is-placeholder"}`;
  toggleButton.textContent = expanded ? "▾" : "▸";
  toggleButton.setAttribute("aria-label", expanded ? `折叠${folder.name}` : `展开${folder.name}`);
  toggleButton.setAttribute("aria-expanded", String(expanded));
  toggleButton.disabled = !hasChildren;
  toggleButton.addEventListener("click", () => {
    if (expanded) applicationState.moveFolderExpandedIds.delete(folder.id);
    else applicationState.moveFolderExpandedIds.add(folder.id);
    renderMoveFolderTree();
  });

  const disabled = disabledIds.has(folder.id);
  const optionButton = document.createElement("button");
  optionButton.type = "button";
  optionButton.className = "move-folder-option";
  optionButton.setAttribute("role", "treeitem");
  optionButton.setAttribute("aria-level", String(depth + 1));
  optionButton.setAttribute("aria-selected", String(applicationState.selectedMoveFolderId === folder.id));
  optionButton.classList.toggle("is-selected", applicationState.selectedMoveFolderId === folder.id);
  optionButton.classList.toggle("is-disabled", disabled);
  optionButton.disabled = disabled;
  if (disabled) optionButton.title = "文件夹已经位于这个目录下";
  const folderIcon = createTextElement("span", "move-folder-icon", "▰");
  const optionText = document.createElement("span");
  optionText.append(
    createTextElement("strong", "", folder.name),
    createTextElement(
      "small",
      "",
      `${folder.itemCount || 0} 项内容${folder.childCount ? ` · ${folder.childCount} 个子文件夹` : ""}`,
    ),
  );
  optionButton.append(folderIcon, optionText);
  optionButton.addEventListener("click", () => selectMoveFolderTarget(folder.id));
  row.append(toggleButton, optionButton);
  return { row, expanded };
}

/** 按需渲染可折叠目录树，搜索时只显示命中项及其祖先。 */
function renderMoveFolderTree() {
  const folders = getMoveFolderTreeFolders();
  const folderIds = new Set(folders.map((folder) => folder.id));
  const childrenByParentId = new Map();
  for (const folder of folders) {
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : "";
    if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
    childrenByParentId.get(parentId).push(folder);
  }
  for (const children of childrenByParentId.values()) {
    children.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
  }

  const query = applicationState.moveFolderSearchQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleIds = new Set();
  if (query) {
    for (const folder of folders) {
      if (getMoveFolderPathLabel(folder).toLocaleLowerCase("zh-CN").includes(query)) {
        for (const pathItem of folder.path) visibleIds.add(pathItem.id);
      }
    }
  }
  const disabledIds = getDisabledMoveFolderIds();
  dom.moveFolderOptions.replaceChildren();

  if (applicationState.pendingMoveFolder?.parentId && !query) {
    const rootRow = document.createElement("div");
    rootRow.className = "move-folder-tree-row is-root";
    rootRow.style.setProperty("--tree-depth", "0");
    const spacer = document.createElement("span");
    spacer.className = "move-folder-toggle is-placeholder";
    const rootButton = document.createElement("button");
    rootButton.type = "button";
    rootButton.className = "move-folder-option";
    rootButton.setAttribute("role", "treeitem");
    rootButton.setAttribute("aria-level", "1");
    rootButton.setAttribute("aria-selected", String(applicationState.selectedMoveFolderId === "__root__"));
    rootButton.classList.toggle("is-selected", applicationState.selectedMoveFolderId === "__root__");
    rootButton.append(
      createTextElement("span", "move-folder-icon", "⌂"),
      createTextElement("span", "", "文档库根目录"),
    );
    rootButton.addEventListener("click", () => selectMoveFolderTarget("__root__"));
    rootRow.append(spacer, rootButton);
    dom.moveFolderOptions.append(rootRow);
  }

  let renderedCount = 0;
  const appendChildren = (parentId, depth) => {
    for (const folder of childrenByParentId.get(parentId) || []) {
      if (query && !visibleIds.has(folder.id)) continue;
      const childFolders = (childrenByParentId.get(folder.id) || []).filter(
        (child) => !query || visibleIds.has(child.id),
      );
      const { row, expanded } = createMoveFolderTreeRow(folder, depth, childFolders, disabledIds);
      dom.moveFolderOptions.append(row);
      renderedCount += 1;
      if (expanded) appendChildren(folder.id, depth + 1);
    }
  };
  appendChildren("", 0);
  if (renderedCount === 0 && !(applicationState.pendingMoveFolder?.parentId && !query)) {
    dom.moveFolderOptions.append(createTextElement(
      "p",
      "move-folder-empty",
      query ? "没有找到匹配的文件夹。" : "还没有可用的目标文件夹，可在上方新建。",
    ));
  }
}

/** 显示移动弹窗内的紧凑新建目录表单。 */
function openMoveFolderCreatePanel() {
  updateMoveFolderCreateParentLabel();
  dom.moveFolderCreateName.value = "";
  dom.moveFolderCreatePanel.hidden = false;
  window.requestAnimationFrame(() => dom.moveFolderCreateName.focus());
}

/** 在当前选中目录下创建子文件夹，并自动将其选为移动目标。 */
async function createMoveFolderFromDialog() {
  const name = dom.moveFolderCreateName.value.trim();
  if (!name) {
    showToast("请输入新文件夹名称。");
    dom.moveFolderCreateName.focus();
    return;
  }
  const selectedParent = applicationState.folders.find(
    (folder) => folder.id === applicationState.selectedMoveFolderId,
  );
  dom.moveFolderCreateConfirm.disabled = true;
  try {
    const payload = await requestJson("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: selectedParent?.id || null, name }),
    });
    applicationState.folders = payload.folders;
    if (selectedParent) applicationState.moveFolderExpandedIds.add(selectedParent.id);
    applicationState.moveFolderSearchQuery = "";
    dom.moveFolderSearch.value = "";
    dom.moveFolderCreatePanel.hidden = true;
    selectMoveFolderTarget(payload.folder.id);
    showToast(`文件夹“${payload.folder.name}”已创建并选中。`);
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.moveFolderCreateConfirm.disabled = false;
  }
}

/** 清理移动弹窗的临时状态。 */
function resetMoveFolderDialogState() {
  applicationState.pendingMoveItem = null;
  applicationState.pendingMoveItems = [];
  applicationState.pendingMoveFolder = null;
  applicationState.selectedMoveFolderId = "";
  applicationState.moveFolderExpandedIds.clear();
  applicationState.moveFolderSearchQuery = "";
  dom.moveFolderSearch.value = "";
  dom.moveFolderCreatePanel.hidden = true;
  dom.moveFolderCreateName.value = "";
}

/**
 * 打开居中的文件夹选择窗口，让用户直接点击目标位置。
 *
 * @param {Record<string, unknown>} item 文档或网页文章。
 * @returns {void}
 */
function openMoveFolderDialog(items) {
  const moveItems = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (moveItems.length === 0) return;
  applicationState.pendingMoveItem = moveItems.length === 1 ? moveItems[0] : null;
  applicationState.pendingMoveItems = moveItems;
  applicationState.pendingMoveFolder = null;
  applicationState.selectedMoveFolderId = "";
  dom.moveFolderEyebrow.textContent = "MOVE CONTENT";
  dom.moveFolderTitle.textContent = "移动到文件夹";
  dom.moveFolderItemTitle.textContent = moveItems.length === 1
    ? `《${moveItems[0].title}》`
    : `已选择 ${moveItems.length} 项内容，将统一移动到同一目录。`;
  dom.moveFolderConfirm.disabled = true;
  applicationState.moveFolderExpandedIds.clear();
  applicationState.moveFolderSearchQuery = "";
  dom.moveFolderSearch.value = "";
  dom.moveFolderCreatePanel.hidden = true;
  expandMoveFolderSourcePath();
  updateMoveFolderCreateParentLabel();
  renderMoveFolderTree();
  dom.moveFolderDialog.showModal();
}

/** 打开单项内容的移动窗口。 */
function moveKnowledgeItem(item) {
  openMoveFolderDialog([item]);
}

/** 打开文件夹父目录选择窗口，并排除自身及全部后代。 */
function moveLibraryFolder(folder) {
  applicationState.pendingMoveItem = null;
  applicationState.pendingMoveItems = [];
  applicationState.pendingMoveFolder = folder;
  applicationState.selectedMoveFolderId = "";
  dom.moveFolderEyebrow.textContent = "MOVE FOLDER";
  dom.moveFolderTitle.textContent = "移动文件夹";
  dom.moveFolderItemTitle.textContent = `“${folder.name}”及其中全部内容会一起移动。`;
  dom.moveFolderConfirm.disabled = true;
  applicationState.moveFolderExpandedIds.clear();
  applicationState.moveFolderSearchQuery = "";
  dom.moveFolderSearch.value = "";
  dom.moveFolderCreatePanel.hidden = true;
  expandMoveFolderSourcePath();
  updateMoveFolderCreateParentLabel();
  renderMoveFolderTree();
  dom.moveFolderDialog.showModal();
}

/** 确认移动一个文件夹到新的父目录。 */
async function confirmMoveLibraryFolder() {
  const folder = applicationState.pendingMoveFolder;
  const selectedId = applicationState.selectedMoveFolderId;
  if (!folder || !selectedId) return;
  const targetFolder = selectedId === "__root__"
    ? null
    : applicationState.folders.find((item) => item.id === selectedId);
  if (selectedId !== "__root__" && !targetFolder) return;
  dom.moveFolderConfirm.disabled = true;
  try {
    const payload = await requestJson(`/api/folders/${encodeURIComponent(folder.id)}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: targetFolder?.id || null }),
    });
    applicationState.folders = payload.folders;
    dom.moveFolderDialog.close();
    renderLibrary();
    showToast(`文件夹“${folder.name}”已移动到${targetFolder
      ? `“${targetFolder.path.map((part) => part.name).join(" / ")}”下`
      : "文档库根目录"}。`);
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.moveFolderConfirm.disabled = false;
  }
}

/**
 * 将移动窗口中确认的内容写入选中文件夹。
 *
 * @returns {Promise<void>}
 */
async function confirmMoveKnowledgeItem() {
  if (applicationState.pendingMoveFolder) {
    await confirmMoveLibraryFolder();
    return;
  }
  /** items 是打开移动窗口时保存的一项或多项知识条目。 */
  const items = applicationState.pendingMoveItems;
  /** targetFolder 是用户鼠标点击选中的目标目录。 */
  const targetFolder = applicationState.folders.find(
    (folder) => folder.id === applicationState.selectedMoveFolderId,
  );
  if (!Array.isArray(items) || items.length === 0 || !targetFolder) return;
  dom.moveFolderConfirm.disabled = true;
  try {
    const isBatch = items.length > 1;
    await requestJson(isBatch ? "/api/folder-items/batch" : "/api/folder-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isBatch
        ? {
          items: items.map((item) => ({ targetType: item.targetType, targetId: item.id })),
          folderId: targetFolder.id,
        }
        : {
          targetType: items[0].targetType,
          targetId: items[0].id,
          folderId: targetFolder.id,
        }),
    });
    dom.moveFolderDialog.close();
    applicationState.pendingMoveItem = null;
    applicationState.pendingMoveItems = [];
    applicationState.selectedMoveFolderId = "";
    applicationState.libraryBatchMode = false;
    applicationState.selectedLibraryItemKeys.clear();
    await loadLibrary();
    showToast(`${items.length} 项内容已移动到“${targetFolder.path.map((part) => part.name).join(" / ")}”。`);
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
/**
 * 判断一段简介是否已经包含足够的中文信息。
 *
 * @param {unknown} value 候选简介。
 * @returns {boolean} 是否适合作为中文列表简介。
 */
function hasChineseSummary(value) {
  return (String(value || "").match(/[\u3400-\u9fff]/g) || []).length >= 4;
}

/**
 * 为文档库条目选择中文优先的列表简介。
 *
 * @param {Record<string, unknown>} item 文档或网页文章。
 * @returns {string} 不展示整段英文的中文简介或状态。
 */
function getChineseLibrarySummary(item) {
  const candidates = item.targetType === "article"
    ? [item.excerpt, item.translatedSummary, item.summary]
    : [item.excerpt, item.summary];
  const chineseSummary = candidates.find(hasChineseSummary);
  if (chineseSummary) return String(chineseSummary).trim();
  if (item.targetType === "article") {
    if (["pending", "processing"].includes(item.translationStatus)) {
      return "中文简介正在生成，完成后会自动更新。";
    }
    if (item.translationStatus === "failed") {
      return "中文简介生成失败，可进入文章阅读页重新翻译。";
    }
    return "这是一篇英文文章，中文简介尚未生成。";
  }
  return "这是一份英文文档，打开后可查看正文内容。";
}

/**
 * 为论文库选择中文摘要；未完成时只显示中文状态，不回退到英文摘要。
 *
 * @param {Record<string, unknown>} paper 论文列表对象。
 * @returns {string} 中文摘要或中文状态。
 */
function getChinesePaperSummary(paper) {
  const chineseSummary = [
    paper.abstractZh,
    paper.translationPreviewZh,
    paper.curatorNote,
    paper.abstract,
  ].find(hasChineseSummary);
  if (chineseSummary) return String(chineseSummary).trim();
  if (paper.fullTranslationStatus === "ready") {
    return "中文全文已经完成，打开后可查看详细内容。";
  }
  if (paper.fullTranslationStatus === "failed") {
    return "中文摘要暂未生成，可进入论文阅读页重新翻译。";
  }
  if (["pending", "processing"].includes(paper.fullTranslationStatus)) {
    return "中文摘要正在生成，完成后会自动更新。";
  }
  return "这是一篇英文论文，中文摘要尚未生成。";
}

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
    const itemKey = getLibraryItemKey(documentItem);
    card.dataset.itemKey = itemKey;
    const itemSelected = applicationState.selectedLibraryItemKeys.has(itemKey);
    card.classList.toggle("is-selection-mode", applicationState.libraryBatchMode);
    card.classList.toggle("is-selected", itemSelected);
    /** selectionLabel 是批量整理模式下显示的勾选入口。 */
    const selectionLabel = document.createElement("label");
    selectionLabel.className = "library-selection-control";
    selectionLabel.hidden = !applicationState.libraryBatchMode;
    const selectionCheckbox = document.createElement("input");
    selectionCheckbox.type = "checkbox";
    selectionCheckbox.checked = itemSelected;
    selectionCheckbox.setAttribute("aria-label", `选择《${documentItem.title}》`);
    selectionCheckbox.addEventListener("change", () => {
      if (selectionCheckbox.checked) applicationState.selectedLibraryItemKeys.add(itemKey);
      else applicationState.selectedLibraryItemKeys.delete(itemKey);
      card.classList.toggle("is-selected", selectionCheckbox.checked);
      renderLibraryBatchToolbar();
    });
    selectionLabel.append(selectionCheckbox, createTextElement("span", "", "选择"));
    /** openButton 是打开对应文件阅读页或文章阅读页的主要操作。 */
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "library-card-open";
    openButton.addEventListener("click", () => {
      if (!applicationState.libraryBatchMode) {
        openKnowledgeItem(documentItem);
        return;
      }
      const nextSelected = !applicationState.selectedLibraryItemKeys.has(itemKey);
      if (nextSelected) applicationState.selectedLibraryItemKeys.add(itemKey);
      else applicationState.selectedLibraryItemKeys.delete(itemKey);
      renderDocumentGrid();
      renderLibraryBatchToolbar();
    });
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
    /** renameButton 修改知识库展示名称，不改变原始附件文件名或来源地址。 */
    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "content-rename-button";
    renameButton.textContent = "改名";
    renameButton.title = `修改《${documentItem.title}》的显示名称`;
    renameButton.hidden = documentItem.targetType === "paper";
    renameButton.addEventListener("click", () => void renameKnowledgeItem(documentItem));

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
    appendHighlightedText(summary, getChineseLibrarySummary(documentItem), applicationState.searchQuery);
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
    actionGroup.hidden = applicationState.libraryBatchMode;
    actionGroup.append(favoriteButton, renameButton, moveButton, deleteButton);
    card.append(selectionLabel, openButton, actionGroup);
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
  renderLibraryBatchToolbar();
  renderFolderBreadcrumbs();
  renderFolderGrid();
  renderDocumentGrid();
  renderUploadFolderOptions();
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
    /** hasExtractedPaperText 使用列表接口保留的词数判断英文全文是否已提取。 */
    const hasExtractedPaperText = Number(paper.sourceTextWordCount) > 0;
    /** hasFullPaperTranslation 表示 Codex 中文全文已经写回数据库。 */
    const hasFullPaperTranslation = paper.fullTranslationStatus === "ready";
    /** hasReadablePaperContent 汇总卡片能够安全依赖的轻量状态字段。 */
    const hasReadablePaperContent = paper.sourceType === "mli"
      || hasExtractedPaperText
      || hasFullPaperTranslation;
    /** readerButton 是只在已有可读正文或中文译文时启用的站内阅读入口。 */
    const readerButton = createPaperReaderButton(paper);
    readerButton.disabled = Boolean(paper.pdfUrl && !hasReadablePaperContent);
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
    /** paperSummary 是中文优先且不会回退到整段英文的论文简介。 */
    const paperSummary = getChinesePaperSummary(paper);
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
      : hasFullPaperTranslation
        ? "Codex 中文全文已完成"
        : paper.fullTranslationStatus === "failed"
          ? `Codex 中文全文失败：${paper.fullTranslationError || "可进入阅读页重试"}`
          : paper.pdfUrl && !hasExtractedPaperText
            ? "正在后台下载并解析 PDF"
            : paper.fullTranslationStatus === "processing"
              ? "正在生成中文全文"
              : paper.fullTranslationStatus === "not_required"
                ? "原文可直接阅读"
                : "等待 Codex 翻译";
    /** paperStateIsFailed 统一控制提取或全文翻译失败样式。 */
    const paperStateIsFailed = Boolean(
      paper.extractionError || paper.fullTranslationStatus === "failed",
    );
    contentElements.push(
      createTextElement(
        "span",
        `paper-translation-state ${hasFullPaperTranslation ? "is-translated" : ""} ${paperStateIsFailed ? "is-failed" : ""}`,
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
        paperSummary,
      ),
      ...(paper.curatorNote && paper.curatorNote.trim() !== paperSummary
        ? [createTextElement("p", "paper-curator-note", paper.curatorNote)]
        : []),
      footer,
    );
    /** content 把标题、状态、作者和摘要组成可在列表模式压缩的主体区域。 */
    const content = document.createElement("div");
    content.className = "paper-card-content";
    content.replaceChildren(...contentElements.slice(1, -1));
    card.replaceChildren(metadata, content, footer);
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
 * 仅保留 Codex 全文译文中的阅读型 HTML 标签和受控代理图片。
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
    "BR",
    "IMG",
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
   * 递归复制文本与白名单标签；图片只复制 alt 并改写为本地代理地址。
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
    if (sourceElement.tagName === "IMG") {
      /** remoteSource 只接受数据库已验证的公开 HTTP(S) 图片。 */
      const remoteSource = sourceElement.getAttribute("src") || "";
      if (!/^https?:\/\//i.test(remoteSource)) return;
      /** safeImage 始终通过本地图片代理加载，避免第三方防盗链与隐私请求。 */
      const safeImage = document.createElement("img");
      setArticleImageSource(safeImage, remoteSource);
      safeImage.alt = sourceElement.getAttribute("alt") || "";
      safeImage.loading = "eager";
      safeImage.decoding = "async";
      targetNode.append(safeImage);
      return;
    }
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
        renderReadingMath(dom.paperReaderContent);
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
      renderReadingMath(dom.paperReaderContent);
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
    applicationState.documentChapters = createTextDocumentChapters(
      documentItem.extractedText || "",
      documentItem.pdfOutline || [],
    );
    applicationState.activeDocumentChapterIndex = 0;
    const rendered = await renderDocumentChapter(0, { scrollToTop: false, saveProgress: false });
    if (!rendered) return;
    buildDocumentChapterTableOfContents();
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
    /** isWordDocument 表示当前正文可采用保留结构的 Word HTML 视图。 */
    const isWordDocument =
      documentItem.extension === ".docx" && Boolean(documentItem.renderedHtml);
    dom.reader.classList.toggle("is-word-reader", isWordDocument);
    dom.readerContent.classList.toggle("is-word-document", isWordDocument);
    dom.readerContent.replaceChildren(
      createTextElement("div", "readable-render-status", "正在打开文档…"),
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
    /** supportsOriginalView 表示浏览器能够在新标签页直接呈现原始 PDF。 */
    const supportsOriginalView =
      documentItem.extension === ".pdf" ||
      documentItem.mimeType === "application/pdf";
    /** previewRevision 防止重建 PDF 后浏览器继续显示旧缓存。 */
    const previewRevision = encodeURIComponent(documentItem.updatedAt || "current");
    dom.readerModeSwitch.hidden = !supportsOriginalView;
    dom.originalDocumentLink.href = supportsOriginalView
      ? `/api/documents/${encodeURIComponent(documentId)}/view?v=${previewRevision}`
      : "";
    dom.readerCategory.value = documentItem.category;
    window.scrollTo({ top: 0, behavior: "auto" });
    applicationState.documentChapters = isWordDocument
      ? createWordDocumentChapters(documentItem.renderedHtml)
      : createTextDocumentChapters(documentItem.extractedText || "", documentItem.pdfOutline || []);
    applicationState.activeDocumentChapterIndex = 0;
    const rendered = await renderDocumentChapter(0, { scrollToTop: false, saveProgress: false });
    if (!rendered) return;
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
 * 上传成功后平滑移除临时状态行，避免成功通知长期占据导入页面。
 *
 * @param {HTMLElement} queueItem 已完成的上传状态行。
 * @returns {void}
 */
function dismissSuccessfulQueueItem(queueItem) {
  queueItem.classList.add("is-removing");
  window.setTimeout(() => queueItem.remove(), 180);
}

/**
 * 上传一个文件并等待解析分类完成。
 *
 * @param {File} file 浏览器文件对象。
 * @param {{ preserveRelativePath?: boolean, relativePath?: string, quietSuccess?: boolean, targetFolderId?: string, targetFolderLabel?: string }} options 批量导入选项。
 * @returns {Promise<{ status: "uploaded" | "duplicate" | "failed", duplicate?: Record<string, unknown> }>} 上传结果。
 */
async function uploadFile(file, options = {}) {
  /** queueItem 是本文件对应的界面状态行。 */
  const queueItem = createQueueItem(file);
  /** statusElement 是状态行右侧文字。 */
  const statusElement = queueItem.querySelector(":scope > span");
  statusElement.textContent = "正在提取正文并分类…";
  try {
    /** payload 是上传完成后的文档对象。 */
    /** relativePath 是文件夹选择器提供的根目录内相对路径。 */
    const relativePath = options.preserveRelativePath
      ? options.relativePath || file.webkitRelativePath || ""
      : "";
    /** requestHeaders 只在文件夹导入时携带相对路径，普通上传行为保持不变。 */
    const requestHeaders = {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    };
    if (relativePath) requestHeaders["X-Relative-Path"] = encodeURIComponent(relativePath);
    if (options.targetFolderId) requestHeaders["X-Target-Folder-Id"] = options.targetFolderId;
    const payload = await requestJson("/api/documents", {
      method: "POST",
      headers: requestHeaders,
      body: file,
    });
    queueItem.classList.add("is-complete");
    /** targetFolderLabel 明确展示实际目录，避免把自动识别分类误认为保存位置。 */
    const targetFolderLabel = String(options.targetFolderLabel || "").trim();
    statusElement.textContent = targetFolderLabel
      ? `已保存到 ${targetFolderLabel}${payload.importJob ? " · OCR 后台处理中" : ""}`
      : payload.importJob
        ? `已保存 · OCR 后台处理中 · 自动分类：${payload.document.category}`
        : `已保存 · 自动分类：${payload.document.category}`;
    if (!options.quietSuccess) {
      showToast(
        targetFolderLabel
          ? `《${payload.document.title}》已保存到“${targetFolderLabel}”${payload.importJob ? "，OCR 将在后台继续处理。" : "。"}`
          : payload.importJob
            ? `《${payload.document.title}》已保存，OCR 将在后台继续处理。`
            : `《${payload.document.title}》已按内容归入“${payload.document.category}”。`,
      );
    }
    dismissSuccessfulQueueItem(queueItem);
    return { status: "uploaded" };
  } catch (error) {
    if (error.code === "DUPLICATE_DOCUMENT") {
      statusElement.textContent = "重复，已跳过";
      dismissSuccessfulQueueItem(queueItem);
      if (!options.quietSuccess) showToast(error.message);
      return {
        status: "duplicate",
        duplicate: {
          fileName: file.name,
          title: error.payload?.duplicate?.title || "已有文档",
          matchReason: error.payload?.duplicate?.matchReason || "title",
        },
      };
    }
    queueItem.classList.add("is-error");
    statusElement.textContent = error.message;
    return { status: "failed" };
  }
}

/**
 * 更新多文件或文件夹导入的紧凑总进度。
 *
 * @param {string} label 当前阶段说明。
 * @param {number} completed 已处理文件数。
 * @param {number} total 总文件数。
 * @param {number} failures 失败文件数。
 * @param {number} duplicates 重复文件数。
 * @returns {void}
 */
function updateUploadBatchProgress(label, completed, total, failures = 0, duplicates = 0) {
  const safeTotal = Math.max(Number(total) || 0, 1);
  const safeCompleted = Math.min(Math.max(Number(completed) || 0, 0), safeTotal);
  dom.uploadBatchProgress.hidden = false;
  dom.uploadBatchProgress.classList.toggle("is-error", failures > 0);
  dom.uploadBatchProgress.classList.toggle("is-warning", failures === 0 && duplicates > 0);
  dom.uploadBatchLabel.textContent = label;
  const resultParts = [`${safeCompleted} / ${safeTotal}`];
  if (duplicates > 0) resultParts.push(`${duplicates} 个重复`);
  if (failures > 0) resultParts.push(`${failures} 个失败`);
  dom.uploadBatchCount.textContent = resultParts.join(" · ");
  dom.uploadBatchBar.style.width = `${Math.round((safeCompleted / safeTotal) * 100)}%`;
}

/**
 * 在批量进度区集中列出被查重跳过的文件，不为每个文件弹出通知。
 *
 * @param {Record<string, unknown>[]} duplicates 重复文件摘要。
 * @returns {void}
 */
function renderUploadDuplicateSummary(duplicates) {
  dom.uploadDuplicateList.replaceChildren();
  dom.uploadDuplicateSummary.hidden = duplicates.length === 0;
  dom.uploadDuplicateSummary.open = duplicates.length > 0;
  dom.uploadDuplicateLabel.textContent = `重复文件未导入（${duplicates.length} 个）`;
  for (const duplicate of duplicates) {
    const reason = duplicate.matchReason === "content" ? "文件内容相同" : "原标题相同";
    dom.uploadDuplicateList.append(
      createTextElement("li", "", `${duplicate.fileName}（与《${duplicate.title}》${reason}）`),
    );
  }
}

/**
 * 过滤文件夹中常见的系统索引和 Office 临时文件。
 *
 * @param {File} file 文件夹选择器返回的文件。
 * @returns {boolean} 是否应跳过。
 */
function shouldSkipFolderFile(file, relativePath = "") {
  const fileName = String(file.name || "");
  const pathSegments = String(relativePath || file.webkitRelativePath || "").split("/").filter(Boolean);
  return /^(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(fileName)
    || /^~\$/.test(fileName)
    || pathSegments.some((segment, index) => index > 0 && segment.startsWith("."));
}

/**
 * 递归读取原生目录选择器返回的目录句柄，并保留从所选根目录开始的相对路径。
 *
 * @param {FileSystemDirectoryHandle} directoryHandle 当前目录句柄。
 * @param {string} relativeDirectory 当前目录相对路径。
 * @returns {Promise<{ file: File, relativePath: string }[]>} 可交给批量上传的文件记录。
 */
async function collectDirectoryUploadEntries(directoryHandle, relativeDirectory = directoryHandle.name) {
  /** handles 先按名称排序，让批量进度和最终目录顺序保持稳定。 */
  const handles = [];
  for await (const childHandle of directoryHandle.values()) handles.push(childHandle);
  handles.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
  /** uploadEntries 汇总当前目录和全部后代文件。 */
  const uploadEntries = [];
  for (const childHandle of handles) {
    const relativePath = `${relativeDirectory}/${childHandle.name}`;
    if (childHandle.kind === "directory") {
      uploadEntries.push(...await collectDirectoryUploadEntries(childHandle, relativePath));
      continue;
    }
    uploadEntries.push({ file: await childHandle.getFile(), relativePath });
  }
  return uploadEntries;
}

/**
 * 打开 Chrome/Edge 原生目录选择器；不支持该接口时回退到 webkitdirectory。
 *
 * @returns {Promise<void>}
 */
async function chooseImportFolder() {
  if (!validateUploadDestination()) return;
  if (typeof window.showDirectoryPicker !== "function") {
    dom.folderInput.click();
    return;
  }
  try {
    /** directoryHandle 是用户在原生目录窗口中确认的目标文件夹。 */
    const directoryHandle = await window.showDirectoryPicker({ mode: "read", id: "zhixu-folder-import" });
    const uploadEntries = await collectDirectoryUploadEntries(directoryHandle);
    if (uploadEntries.length === 0) {
      showToast("所选文件夹中没有可导入的文件。");
      return;
    }
    await uploadFiles(uploadEntries, { preserveRelativePaths: true });
  } catch (error) {
    if (error?.name === "AbortError") return;
    showToast(error instanceof Error ? error.message : "无法读取所选文件夹。");
  }
}

/**
 * 顺序上传用户选择的全部文件，避免同时解析大文件造成内存峰值。
 *
 * @param {FileList | File[] | { file: File, relativePath: string }[]} files 待上传文件集合。
 * @param {{ preserveRelativePaths?: boolean }} options 批量导入选项。
 * @returns {Promise<void>}
 */
async function uploadFiles(files, options = {}) {
  if (applicationState.uploadInProgress) {
    showToast("已有一批文档正在导入，请等待当前批次完成。");
    return;
  }
  if (!validateUploadDestination()) return;
  /** targetFolderId 固定本批开始时的目标，避免上传途中切换位置。 */
  const targetFolderId = applicationState.uploadFolderMode === "selected"
    ? applicationState.selectedUploadFolderId
    : "";
  /** targetFolderLabel 与目录 ID 同时冻结，上传中刷新目录列表也不会改变完成提示。 */
  const targetFolderLabel = getUploadFolderPathLabel(targetFolderId);
  /** sourceEntries 统一普通 File、webkitdirectory File 和原生目录句柄文件。 */
  const sourceEntries = Array.from(files).map((entry) => {
    if (entry?.file) {
      return { file: entry.file, relativePath: String(entry.relativePath || "") };
    }
    return { file: entry, relativePath: String(entry.webkitRelativePath || "") };
  });
  /** fileEntries 在文件夹模式下排除系统和临时文件。 */
  const fileEntries = options.preserveRelativePaths
    ? sourceEntries.filter((entry) => !shouldSkipFolderFile(entry.file, entry.relativePath))
    : sourceEntries;
  if (fileEntries.length === 0) return;
  /** skippedCount 是文件夹内自动忽略的临时文件数量。 */
  const skippedCount = sourceEntries.length - fileEntries.length;
  /** rootFolderName 是文件夹选择器返回路径中的第一级目录。 */
  const rootFolderName = options.preserveRelativePaths
    ? String(fileEntries[0].relativePath || "").split("/").filter(Boolean)[0] || "所选文件夹"
    : "所选文档";
  /** showBatchProgress 表示应使用汇总进度避免逐文件通知刷屏。 */
  const showBatchProgress = options.preserveRelativePaths || fileEntries.length > 1;
  window.clearTimeout(applicationState.uploadBatchHideTimer);
  applicationState.uploadInProgress = true;
  dom.chooseFilesButton.disabled = true;
  dom.chooseFolderButton.disabled = true;
  for (const control of dom.uploadDestinationModes) control.disabled = true;
  dom.uploadFolderSelect.disabled = true;
  dom.dropZone.setAttribute("aria-busy", "true");
  renderUploadDuplicateSummary([]);
  showView("upload");
  if (showBatchProgress) {
    updateUploadBatchProgress(`正在导入“${rootFolderName}”`, 0, fileEntries.length);
  }
  let failures = 0;
  /** duplicates 收集整批中被服务端查重跳过的文件。 */
  const duplicates = [];
  try {
    for (const [fileIndex, entry] of fileEntries.entries()) {
      const result = await uploadFile(entry.file, {
        preserveRelativePath: Boolean(options.preserveRelativePaths),
        relativePath: entry.relativePath,
        quietSuccess: showBatchProgress,
        targetFolderId,
        targetFolderLabel,
      });
      if (result.status === "failed") failures += 1;
      if (result.status === "duplicate" && result.duplicate) duplicates.push(result.duplicate);
      if (showBatchProgress) {
        updateUploadBatchProgress(
          failures > 0 ? `“${rootFolderName}”已完成，但有文件需要处理` : `正在导入“${rootFolderName}”`,
          fileIndex + 1,
          fileEntries.length,
          failures,
          duplicates.length,
        );
      }
    }
    await loadLibrary();
    renderUploadDuplicateSummary(duplicates);
    /** importedCount 是排除重复和失败后的实际新增文件数。 */
    const importedCount = fileEntries.length - duplicates.length - failures;
    if (showBatchProgress && failures === 0 && duplicates.length === 0) {
      updateUploadBatchProgress(`“${rootFolderName}”导入完成`, fileEntries.length, fileEntries.length);
      showToast(`已导入 ${importedCount} 个文件${skippedCount ? `，跳过 ${skippedCount} 个临时文件` : ""}。`);
      applicationState.uploadBatchHideTimer = window.setTimeout(() => {
        dom.uploadBatchProgress.hidden = true;
      }, 3200);
    } else if (showBatchProgress) {
      const finalLabel = failures > 0
        ? `“${rootFolderName}”导入完成，但有文件需要处理`
        : `“${rootFolderName}”导入完成，重复文件已跳过`;
      updateUploadBatchProgress(
        finalLabel,
        fileEntries.length,
        fileEntries.length,
        failures,
        duplicates.length,
      );
      showToast(
        `实际导入 ${importedCount} 个，重复未导入 ${duplicates.length} 个${failures ? `，失败 ${failures} 个` : ""}。`,
      );
    }
  } finally {
    dom.fileInput.value = "";
    dom.folderInput.value = "";
    dom.chooseFilesButton.disabled = false;
    dom.chooseFolderButton.disabled = false;
    for (const control of dom.uploadDestinationModes) control.disabled = false;
    dom.uploadFolderSelect.disabled = applicationState.uploadFolderMode !== "selected";
    dom.dropZone.removeAttribute("aria-busy");
    applicationState.uploadInProgress = false;
  }
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

/**
 * 初始化论文库网格 / 列表切换，并单独记住论文库的显示偏好。
 *
 * @returns {void}
 */
function setupPaperViewMode() {
  if (!dom.paperViewMode || !dom.paperViewModeLabel || !dom.paperGrid) return;
  /** PAPER_VIEW_MODE_LABELS 是论文库模式对应的中文标签。 */
  const PAPER_VIEW_MODE_LABELS = { grid: "网格", list: "列表" };
  /** applyPaperViewMode 同步列表容器、下拉标签和无障碍选中状态。 */
  const applyPaperViewMode = (mode) => {
    const nextMode = mode === "list" ? "list" : "grid";
    dom.paperGrid.classList.toggle("is-list", nextMode === "list");
    dom.paperViewModeLabel.textContent = PAPER_VIEW_MODE_LABELS[nextMode];
    for (const option of dom.paperViewModeOptions) {
      option.setAttribute(
        "aria-checked",
        String(option.dataset.paperViewMode === nextMode),
      );
    }
  };
  /** currentMode 优先读取论文库自己的持久化设置。 */
  let currentMode = "grid";
  try {
    const savedMode = window.localStorage.getItem("zhixu-paper-view-mode");
    if (savedMode === "list" || savedMode === "grid") currentMode = savedMode;
  } catch (error) {}
  applyPaperViewMode(currentMode);
  for (const option of dom.paperViewModeOptions) {
    option.addEventListener("click", (event) => {
      event.preventDefault();
      const mode = option.dataset.paperViewMode === "list" ? "list" : "grid";
      try {
        window.localStorage.setItem("zhixu-paper-view-mode", mode);
      } catch (error) {}
      applyPaperViewMode(mode);
      dom.paperViewMode.open = false;
    });
  }
  document.addEventListener("click", (event) => {
    if (!dom.paperViewMode.open) return;
    if (!dom.paperViewMode.contains(event.target)) dom.paperViewMode.open = false;
  });
}

async function initializeApplication() {
  setupThemeToggle();
  setupViewMode();
  setupPaperViewMode();
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
  for (const modeControl of dom.uploadDestinationModes) {
    modeControl.addEventListener("change", () => {
      applicationState.uploadFolderMode = modeControl.value === "selected" ? "selected" : "auto";
      dom.uploadFolderSelect.disabled = applicationState.uploadFolderMode !== "selected";
      if (applicationState.uploadFolderMode === "selected") dom.uploadFolderSelect.focus();
    });
  }
  dom.uploadFolderSelect.addEventListener("change", () => {
    applicationState.selectedUploadFolderId = dom.uploadFolderSelect.value;
  });
  dom.chooseFilesButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (validateUploadDestination()) dom.fileInput.click();
  });
  dom.chooseFolderButton.addEventListener("click", (event) => {
    event.stopPropagation();
    void chooseImportFolder();
  });
  dom.dropZone.addEventListener("click", () => {
    if (validateUploadDestination()) dom.fileInput.click();
  });
  dom.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (validateUploadDestination()) dom.fileInput.click();
    }
  });
  dom.fileInput.addEventListener("change", () => void uploadFiles(dom.fileInput.files));
  dom.folderInput.addEventListener("change", () => {
    void uploadFiles(dom.folderInput.files, { preserveRelativePaths: true });
  });
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
  dom.batchSelectButton.addEventListener("click", () => {
    setLibraryBatchMode(!applicationState.libraryBatchMode);
  });
  dom.batchSelectAllButton.addEventListener("click", toggleSelectAllVisibleItems);
  dom.batchMoveButton.addEventListener("click", () => {
    openMoveFolderDialog(getSelectedLibraryItems());
  });
  dom.batchDeleteButton.addEventListener("click", () => {
    void deleteSelectedLibraryItems();
  });
  dom.batchCancelButton.addEventListener("click", () => setLibraryBatchMode(false));
  dom.topicCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void createLearningTopic().catch((error) => showToast(error.message));
  });
  dom.readerBackButton.addEventListener("click", () => void returnToPreviousPage("library"));
  for (const button of [dom.documentChapterPrevious, dom.documentChapterFooterPrevious]) {
    button.addEventListener("click", () => {
      void renderDocumentChapter(applicationState.activeDocumentChapterIndex - 1, {
        scrollToTop: true,
        saveProgress: true,
      });
    });
  }
  for (const button of [dom.documentChapterNext, dom.documentChapterFooterNext]) {
    button.addEventListener("click", () => {
      void renderDocumentChapter(applicationState.activeDocumentChapterIndex + 1, {
        scrollToTop: true,
        saveProgress: true,
      });
    });
  }
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
  dom.importJobFilter.addEventListener("change", () => {
    applicationState.importJobFilter = dom.importJobFilter.value;
    renderImportJobs();
  });
  dom.showImportJobHistory.addEventListener("click", () => {
    applicationState.importJobFilter = applicationState.importJobFilter === "all"
      ? "priority"
      : "all";
    renderImportJobs();
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
  dom.moveFolderSearch.addEventListener("input", () => {
    applicationState.moveFolderSearchQuery = dom.moveFolderSearch.value;
    renderMoveFolderTree();
  });
  dom.moveFolderCollapseAll.addEventListener("click", () => {
    applicationState.moveFolderExpandedIds.clear();
    renderMoveFolderTree();
  });
  dom.moveFolderNew.addEventListener("click", openMoveFolderCreatePanel);
  dom.moveFolderCreateCancel.addEventListener("click", () => {
    dom.moveFolderCreatePanel.hidden = true;
  });
  dom.moveFolderCreateConfirm.addEventListener("click", () => void createMoveFolderFromDialog());
  dom.moveFolderCreateName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void createMoveFolderFromDialog();
    } else if (event.key === "Escape") {
      event.preventDefault();
      dom.moveFolderCreatePanel.hidden = true;
    }
  });
  dom.moveFolderDialog.addEventListener("cancel", resetMoveFolderDialogState);
  dom.moveFolderDialog.addEventListener("close", resetMoveFolderDialogState);
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
