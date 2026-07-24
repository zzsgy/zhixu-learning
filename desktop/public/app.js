/**
 * 知序本地知识库浏览器交互。
 *
 * 页面只请求当前电脑上的本地服务，不连接任何第三方前端接口。
 */

/** applicationState 保存当前筛选、文档列表和已打开文档。 */
const applicationState = {
  /** activeView 是当前显示的一级页面。 */
  activeView: "library",
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
  /** selectedPaper 是论文阅读页正在展示的完整论文。 */
  selectedPaper: null,
  /** searchTimer 用于合并快速连续输入。 */
  searchTimer: null,
};

/** dom 集中保存页面中会重复访问的元素。 */
const dom = {
  pageEyebrow: document.querySelector("#page-eyebrow"),
  pageTitle: document.querySelector("#page-title"),
  topUploadButton: document.querySelector("#top-upload-button"),
  documentTotal: document.querySelector("#document-total"),
  searchInput: document.querySelector("#search-input"),
  categoryTabs: document.querySelector("#category-tabs"),
  favoriteFilterButton: document.querySelector("#favorite-filter-button"),
  documentGrid: document.querySelector("#document-grid"),
  emptyState: document.querySelector("#empty-state"),
  fileInput: document.querySelector("#file-input"),
  chooseFilesButton: document.querySelector("#choose-files-button"),
  dropZone: document.querySelector("#drop-zone"),
  uploadQueue: document.querySelector("#upload-queue"),
  backupButton: document.querySelector("#backup-button"),
  articleImportForm: document.querySelector("#article-import-form"),
  articleUrlInput: document.querySelector("#article-url-input"),
  parseArticleButton: document.querySelector("#parse-article-button"),
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
  readerSource: document.querySelector("#reader-source"),
  downloadLink: document.querySelector("#download-link"),
  articleReader: document.querySelector("#article-reader"),
  articleReaderBackButton: document.querySelector("#article-reader-back-button"),
  articleSourceLink: document.querySelector("#article-source-link"),
  articleReaderMeta: document.querySelector("#article-reader-meta"),
  articleReaderTitle: document.querySelector("#article-reader-title"),
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
          fragment.append(createTextElement("h2", "", block));
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
      fragment.append(createTextElement("h2", "", line));
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
function showView(viewName) {
  applicationState.activeView = viewName;
  applicationState.selectedDocument = null;
  applicationState.selectedArticle = null;
  applicationState.selectedPaper = null;
  dom.reader.hidden = true;
  dom.articleReader.hidden = true;
  dom.paperReader.hidden = true;
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
    upload: ["CONTENT INBOX", "导入内容"],
    storage: ["LOCAL STORAGE", "本地数据"],
  };
  /** titlePair 是当前页面标题组合。 */
  const titlePair = viewTitles[viewName] ?? viewTitles.library;
  dom.pageEyebrow.textContent = titlePair[0];
  dom.pageTitle.textContent = titlePair[1];
  dom.topUploadButton.hidden = viewName === "upload";
  if (viewName === "papers") void loadPapers();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * 在站内阅读页打开一篇已保存文章。
 *
 * @param {string} articleId 文章 ID。
 * @returns {Promise<void>}
 */
async function openArticle(articleId) {
  try {
    /** payload 是完整文章详情响应。 */
    const payload = await requestJson(
      `/api/articles/${encodeURIComponent(articleId)}`,
    );
    /** article 是即将显示的完整文章。 */
    const article = payload.article;
    applicationState.selectedArticle = article;
    for (const view of document.querySelectorAll(".view")) {
      view.classList.remove("is-active");
    }
    dom.reader.hidden = true;
    dom.articleReader.hidden = false;
    dom.pageEyebrow.textContent = "ARTICLE READER";
    dom.pageTitle.textContent = "文章阅读";
    dom.topUploadButton.hidden = true;
    dom.articleReaderMeta.textContent = [
      article.category,
      article.author,
      article.publishedAt,
    ]
      .filter(Boolean)
      .join(" · ");
    dom.articleReaderTitle.textContent = article.title;
    dom.articleReaderSummary.textContent = article.summary;
    dom.articleSourceLink.href = article.url;
    /** parsedContent 是从服务端白名单 HTML 创建的隔离文档。 */
    const parsedContent = new DOMParser().parseFromString(
      `<article>${article.contentHtml}</article>`,
      "text/html",
    );
    /** safeArticleRoot 是隔离文档中的正文根节点。 */
    const safeArticleRoot = parsedContent.querySelector("article");
    if (safeArticleRoot) {
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
        /** 阅读页主动加载图片，避免原网页的懒加载规则导致滚动后仍显示占位图。 */
        image.setAttribute("loading", "eager");
        /** decoding 允许浏览器异步解码图片，减少长文章首次渲染时的阻塞。 */
        image.setAttribute("decoding", "async");
      }
    }
    dom.articleReaderContent.replaceChildren(
      ...(safeArticleRoot
        ? Array.from(safeArticleRoot.childNodes).map((node) =>
            document.importNode(node, true),
          )
        : [createTextElement("p", "", article.contentText)]),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 解析并保存输入的公开文章链接。
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
  dom.parseArticleButton.textContent = "正在解析正文…";
  try {
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
  return allItems
    .filter(
      (item) =>
        (!applicationState.activeCategory ||
          item.category === applicationState.activeCategory) &&
        (!applicationState.favoriteOnly || item.isFavorite),
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
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
 * 渲染上传文件与 URL 文章组成的统一文档卡片列表。
 *
 * @returns {void}
 */
function renderDocumentGrid() {
  /** visibleItems 是经过分类和重点状态筛选的统一条目。 */
  const visibleItems = getVisibleLibraryItems();
  dom.documentGrid.replaceChildren();
  dom.emptyState.hidden = visibleItems.length > 0;
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
    openButton.addEventListener("click", () => {
      if (documentItem.targetType === "article") {
        void openArticle(documentItem.id);
      } else {
        void openDocument(documentItem.id);
      }
    });
    /** favoriteButton 用星标区分重点文档与普通文档。 */
    const favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "favorite-button";
    favoriteButton.classList.toggle("is-active", documentItem.isFavorite);
    favoriteButton.textContent = documentItem.isFavorite ? "★" : "☆";
    favoriteButton.title = documentItem.isFavorite ? "取消重点" : "标记为重点";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
    favoriteButton.setAttribute("aria-pressed", String(Boolean(documentItem.isFavorite)));
    favoriteButton.addEventListener("click", () => void toggleFavorite(documentItem));

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
            : "网页文章"
          : (documentItem.extension || "文件").replace(".", "").toUpperCase(),
      ),
      createTextElement(
        "span",
        "",
        documentItem.targetType === "article"
          ? `${Number(documentItem.wordCount || 0).toLocaleString("zh-CN")} 字`
          : formatFileSize(documentItem.sizeBytes),
      ),
    );
    openButton.append(
      metadata,
      createTextElement("h3", "", documentItem.title),
      createTextElement("p", "", documentItem.summary),
      footer,
    );
    card.append(favoriteButton, openButton);
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
  const allItems = [
    ...applicationState.documents,
    ...applicationState.articles,
  ];
  /** categoryStatistics 是上传文件与网页文章合并后的分类数量。 */
  const categoryStatistics = {};
  for (const item of allItems) {
    categoryStatistics[item.category] =
      (categoryStatistics[item.category] || 0) + 1;
  }
  dom.documentTotal.textContent = String(allItems.length);
  dom.favoriteFilterButton.classList.toggle(
    "is-active",
    applicationState.favoriteOnly,
  );
  dom.favoriteFilterButton.textContent = applicationState.favoriteOnly
    ? "★ 正在查看重点"
    : "☆ 只看重点";
  dom.favoriteFilterButton.setAttribute(
    "aria-pressed",
    String(applicationState.favoriteOnly),
  );
  renderCategoryTabs(categoryStatistics);
  renderDocumentGrid();
}

/**
 * 从本地数据库同时加载上传文件与 URL 文章。
 *
 * @returns {Promise<void>}
 */
async function loadLibrary() {
  /** parameters 是统一传给两类内容接口的关键词查询参数。 */
  const parameters = new URLSearchParams();
  if (applicationState.searchQuery) parameters.set("q", applicationState.searchQuery);
  /** documentRequest 是上传文件列表请求。 */
  const documentRequest = requestJson(`/api/documents?${parameters}`);
  /** articleRequest 是 URL 文章列表请求。 */
  const articleRequest = requestJson(`/api/articles?${parameters}`);
  /** responses 是两个本地接口并行返回的结果。 */
  const [documentPayload, articlePayload] = await Promise.all([
    documentRequest,
    articleRequest,
  ]);
  applicationState.documents = documentPayload.documents;
  applicationState.articles = articlePayload.articles;
  renderLibrary();
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
    footer.append(
      createPaperReaderButton(paper),
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
    contentElements.push(
      createTextElement(
        "span",
        `paper-translation-state ${paper.titleZh ? "is-translated" : ""}`,
        paper.titleZh ? "Codex 中文翻译" : "等待 Codex 翻译",
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
 * 在站内独立页面打开论文中文阅读版。
 *
 * @param {string} paperId 论文稳定本地 ID。
 * @returns {Promise<void>}
 */
async function openPaper(paperId) {
  try {
    /** payload 是完整论文详情响应。 */
    const payload = await requestJson(`/api/papers/${encodeURIComponent(paperId)}`);
    /** paper 是即将显示的完整论文。 */
    const paper = payload.paper;
    applicationState.selectedPaper = paper;
    for (const view of document.querySelectorAll(".view")) {
      view.classList.remove("is-active");
    }
    dom.reader.hidden = true;
    dom.articleReader.hidden = true;
    dom.paperReader.hidden = false;
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
      dom.paperReadingStatus.textContent =
        "以下全文中文阅读版由 Codex 根据英文论文生成；公式符号保留原文，重要结论可通过右上角英文 PDF 交叉核对。";
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
      dom.paperReadingStatus.textContent =
        `英文全文提取失败：${paper.extractionError || "未知原因"}。你仍可通过英文 PDF 阅读原文。`;
    } else {
      dom.paperReadingStatus.textContent =
        "论文已进入 Codex 全文翻译队列。完成后这里会直接显示站内中文全文，不会跳转到第三方翻译页面。";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
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
 * 查询本周论文候选，并在需要或用户主动查看时打开弹窗。
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
      if (force) showToast("本周候选暂未获取到，请稍后再试。");
      return;
    }
    applicationState.activePaperReminder = reminder;
    renderPaperCandidates(reminder);
    if (!dom.paperReminderDialog.open) dom.paperReminderDialog.showModal();
  } catch (error) {
    if (force) showToast(`暂时无法更新论文候选：${error.message}`);
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
 * 跳过当前自然周的论文选择提醒。
 *
 * @returns {Promise<void>}
 */
async function dismissWeeklyPaperReminder() {
  try {
    await requestJson("/api/paper-reminder/dismiss", { method: "POST" });
    dom.paperReminderDialog.close();
    applicationState.activePaperReminder = null;
    showToast("本周已跳过，下周会准备新的候选论文。");
  } catch (error) {
    showToast(error.message);
  }
}

/**
 * 打开一份文档的提取正文和元数据。
 *
 * @param {string} documentId 文档 ID。
 * @returns {Promise<void>}
 */
async function openDocument(documentId) {
  try {
    /** payload 是文档详情响应。 */
    const payload = await requestJson(`/api/documents/${encodeURIComponent(documentId)}`);
    /** documentItem 是完整文档对象。 */
    const documentItem = payload.document;
    applicationState.selectedDocument = documentItem;
    for (const view of document.querySelectorAll(".view")) view.classList.remove("is-active");
    dom.reader.hidden = false;
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
    statusElement.textContent = `已保存 · ${payload.document.category}`;
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
 * 初始化分类、列表与全部界面事件。
 *
 * @returns {Promise<void>}
 */
async function initializeApplication() {
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
  for (const button of dom.paperSourceTabs.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      applicationState.activePaperSource = button.dataset.paperSource || "";
      for (const tabButton of dom.paperSourceTabs.querySelectorAll("button")) {
        tabButton.classList.toggle("is-active", tabButton === button);
      }
      void loadPapers();
    });
  }
  dom.refreshMliPapersButton.addEventListener("click", async () => {
    dom.refreshMliPapersButton.disabled = true;
    dom.refreshMliPapersButton.textContent = "正在同步…";
    try {
      /** payload 是李沐精读目录同步结果。 */
      const payload = await requestJson("/api/papers/mli/refresh", {
        method: "POST",
      });
      applicationState.activePaperSource = "mli";
      for (const tabButton of dom.paperSourceTabs.querySelectorAll("button")) {
        tabButton.classList.toggle(
          "is-active",
          tabButton.dataset.paperSource === "mli",
        );
      }
      await loadPapers();
      showToast(`已同步 ${payload.imported} 条李沐精读内容。`);
    } catch (error) {
      showToast(error.message);
    } finally {
      dom.refreshMliPapersButton.disabled = false;
      dom.refreshMliPapersButton.textContent = "同步李沐精读";
    }
  });
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
  dom.readerBackButton.addEventListener("click", () => {
    dom.reader.classList.remove("is-word-reader");
    dom.readerContent.classList.remove("is-word-document");
    dom.reader.classList.remove("is-wide-preview");
    dom.widePreviewButton.textContent = "⇱ 展开至页面宽度";
    dom.widePreviewButton.setAttribute("aria-pressed", "false");
    dom.originalPreviewFrame.src = "about:blank";
    showView("library");
    void loadLibrary();
  });
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
  dom.articleImportForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void parseArticleUrl();
  });
  dom.articleReaderBackButton.addEventListener("click", () => {
    showView("library");
    void loadLibrary();
  });
  dom.paperReaderBackButton.addEventListener("click", () => {
    showView("papers");
    void loadPapers();
  });
  await loadLibrary();
  await loadPapers();
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
