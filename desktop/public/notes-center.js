const sourceTypeLabels = { document: "文档伴读", article: "网页伴读", paper: "论文伴读" };
const noteTypeLabels = { markdown: "Markdown", text: "TXT 纯文本", word: "Word" };
const richBlockTagNames = new Set(["P", "DIV", "H1", "H2", "H3", "BLOCKQUOTE", "LI", "PRE"]);

function createElement(doc, tagName, className = "", text = "") {
  const element = doc.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function compactNote(value) {
  return String(value || "").replace(/^#{1,6}\s*/gm, "").replace(/\s+/g, " ").trim();
}

function setControlValue(control, value) {
  if (!control) return;
  try { control.value = String(value); } catch { control.setAttribute("value", String(value)); }
}

function triggerDownload(doc, href) {
  const link = doc.createElement("a");
  link.href = href;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
}

function wrapMarkdownInline(source, start, end, before, after = before, placeholder = "") {
  const selected = source.slice(start, end);
  const content = selected || placeholder;
  const replacement = `${before}${content}${after}`;
  const value = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
  const selectionStart = start + before.length;
  const selectionEnd = selectionStart + content.length;
  return {
    value,
    selectionStart: selected || placeholder ? selectionStart : selectionEnd,
    selectionEnd,
  };
}

function applyMarkdownLinePrefix(source, start, end, action) {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const nextLineBreak = source.indexOf("\n", end);
  const lineEnd = nextLineBreak === -1 ? source.length : nextLineBreak;
  const block = source.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const matcher = {
    heading: /^#{1,6}\s+/,
    bullet: /^[-*+]\s+/,
    ordered: /^\d+[.)]\s+/,
    quote: /^>\s?/,
  }[action];
  const contentLines = lines.filter((line) => line.length > 0);
  const shouldRemove = contentLines.length > 0 && contentLines.every((line) => matcher.test(line));
  let itemNumber = 0;
  const transformed = lines.map((line) => {
    if (shouldRemove) return line.replace(matcher, "");
    if (!line && lines.length > 1) return line;
    if (action === "ordered") { itemNumber += 1; return `${itemNumber}. ${line}`; }
    const prefix = { heading: "# ", bullet: "- ", quote: "> " }[action];
    return `${prefix}${line}`;
  }).join("\n");
  const value = `${source.slice(0, lineStart)}${transformed}${source.slice(lineEnd)}`;
  if (start !== end) return { value, selectionStart: lineStart, selectionEnd: lineStart + transformed.length };
  const originalPrefixLength = shouldRemove ? (block.match(matcher)?.[0].length || 0) : 0;
  const addedPrefixLength = shouldRemove ? 0 : transformed.length - block.length;
  const cursor = lineStart + Math.max(0, start - lineStart - originalPrefixLength) + addedPrefixLength;
  return { value, selectionStart: cursor, selectionEnd: cursor };
}

/** 把工具栏动作转换为普通 Markdown 文本，并返回下一次输入所需的光标位置。 */
export function applyMarkdownAction(value, selectionStart, selectionEnd, action) {
  const source = String(value || "");
  const rawStart = Math.max(0, Math.min(source.length, Number(selectionStart) || 0));
  const rawEnd = Math.max(0, Math.min(source.length, Number(selectionEnd) || 0));
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd);
  if (["heading", "bullet", "ordered", "quote"].includes(action)) {
    return applyMarkdownLinePrefix(source, start, end, action);
  }
  if (action === "bold") return wrapMarkdownInline(source, start, end, "**");
  if (action === "italic") return wrapMarkdownInline(source, start, end, "*");
  if (action === "inline-code") return wrapMarkdownInline(source, start, end, "`");
  if (action === "link") {
    const selected = source.slice(start, end);
    if (selected) {
      const replacement = `[${selected}](https://)`;
      const linkStart = start + selected.length + 3;
      return {
        value: `${source.slice(0, start)}${replacement}${source.slice(end)}`,
        selectionStart: linkStart,
        selectionEnd: linkStart + 8,
      };
    }
    return wrapMarkdownInline(source, start, end, "[", "](https://)", "链接文字");
  }
  if (action === "code-block") {
    const selected = source.slice(start, end);
    const leadingBreak = start > 0 && source[start - 1] !== "\n" ? "\n" : "";
    const trailingBreak = end < source.length && source[end] !== "\n" ? "\n" : "";
    const replacement = `${leadingBreak}\`\`\`\n${selected}\n\`\`\`${trailingBreak}`;
    const contentStart = start + leadingBreak.length + 4;
    return {
      value: `${source.slice(0, start)}${replacement}${source.slice(end)}`,
      selectionStart: contentStart,
      selectionEnd: contentStart + selected.length,
    };
  }
  return { value: source, selectionStart: start, selectionEnd: end };
}

function appendMarkdownInline(doc, parent, value) {
  const source = String(value || "");
  const tokenPattern = /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|\*[^*\n]+\*/gi;
  let cursor = 0;
  for (const match of source.matchAll(tokenPattern)) {
    if (match.index > cursor) parent.append(doc.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("**")) parent.append(createElement(doc, "strong", "", token.slice(2, -2)));
    else if (token.startsWith("`")) parent.append(createElement(doc, "code", "", token.slice(1, -1)));
    else if (token.startsWith("[")) {
      const parts = token.match(/^\[([^\]]+)\]\((.+)\)$/);
      const link = createElement(doc, "a", "", parts[1]);
      link.href = parts[2]; link.target = "_blank"; link.rel = "noopener noreferrer";
      parent.append(link);
    } else parent.append(createElement(doc, "em", "", token.slice(1, -1)));
    cursor = match.index + token.length;
  }
  if (cursor < source.length) parent.append(doc.createTextNode(source.slice(cursor)));
}

function renderMarkdown(doc, container, value, emptyText = "Markdown 预览会显示在这里。") {
  if (!container) return;
  container.replaceChildren();
  const lines = String(value || "").split(/\r?\n/);
  let list = null;
  let code = null;
  const flushList = () => { if (list) { container.append(list); list = null; } };
  const flushCode = () => { if (code) { const pre = doc.createElement("pre"); pre.append(code); container.append(pre); code = null; } };
  for (const line of lines) {
    if (/^```/.test(line)) {
      flushList();
      if (code) flushCode(); else code = doc.createElement("code");
      continue;
    }
    if (code) { code.textContent += `${code.textContent ? "\n" : ""}${line}`; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)/);
    const quote = line.match(/^>\s?(.+)/);
    if (heading) {
      flushList();
      const title = doc.createElement(`h${heading[1].length}`);
      appendMarkdownInline(doc, title, heading[2]); container.append(title);
    } else if (bullet || numbered) {
      const tag = numbered ? "ol" : "ul";
      if (list?.tagName.toLowerCase() !== tag) { flushList(); list = doc.createElement(tag); }
      const item = doc.createElement("li");
      appendMarkdownInline(doc, item, (numbered || bullet)[1]); list.append(item);
    } else if (quote) {
      flushList();
      const blockquote = doc.createElement("blockquote");
      appendMarkdownInline(doc, blockquote, quote[1]); container.append(blockquote);
    } else if (line.trim()) {
      flushList();
      const paragraph = doc.createElement("p");
      appendMarkdownInline(doc, paragraph, line); container.append(paragraph);
    } else flushList();
  }
  flushList(); flushCode();
  if (!container.children.length) container.append(createElement(doc, "p", "notes-preview-placeholder", emptyText));
}

/** 挂载统一笔记库：伴读笔记只读汇总，独立笔记可新建、编辑和导出。 */
export function mountNotesCenter({ document: doc, request, notify, openSource }) {
  const view = doc.defaultView || globalThis.window;
  const dom = {
    total: doc.querySelector("#notes-total"), pending: doc.querySelector("#notes-pending"),
    latest: doc.querySelector("#notes-latest"), organized: doc.querySelector("#notes-organized"),
    resultStatus: doc.querySelector("#notes-result-status"), search: doc.querySelector("#notes-search"),
    typeFilter: doc.querySelector("#notes-type-filter"), list: doc.querySelector("#notes-list"),
    empty: doc.querySelector("#notes-empty"), create: doc.querySelector("#notes-create"),
    organizeNow: doc.querySelector("#notes-organize-now"), scheduleForm: doc.querySelector("#notes-schedule-form"),
    scheduleEnabled: doc.querySelector("#notes-schedule-enabled"), scheduleFrequency: doc.querySelector("#notes-schedule-frequency"),
    scheduleWeekday: doc.querySelector("#notes-schedule-weekday"), scheduleWeekdayField: doc.querySelector("#notes-schedule-weekday-field"),
    scheduleTime: doc.querySelector("#notes-schedule-time"), nextRun: doc.querySelector("#notes-next-run"),
    digests: doc.querySelector("#notes-digests"), digestCount: doc.querySelector("#notes-digest-count"),
    typeDialog: doc.querySelector("#notes-type-dialog"), typeClose: doc.querySelector("#notes-type-close"),
    typeButtons: [...doc.querySelectorAll("[data-create-note]")], editor: doc.querySelector("#notes-editor"),
    reader: doc.querySelector("#notes-reader"), readerClose: doc.querySelector("#notes-reader-close"),
    readerType: doc.querySelector("#notes-reader-type"), readerMeta: doc.querySelector("#notes-reader-meta"),
    readerTitle: doc.querySelector("#notes-reader-title"), readerContent: doc.querySelector("#notes-reader-content"),
    readerExport: doc.querySelector("#notes-reader-export"), readerOpen: doc.querySelector("#notes-reader-open"),
    editorClose: doc.querySelector("#notes-editor-close"), editorType: doc.querySelector("#notes-editor-type"),
    editorTitle: doc.querySelector("#notes-editor-title"), saveStatus: doc.querySelector("#notes-save-status"),
    save: doc.querySelector("#notes-save"), export: doc.querySelector("#notes-export"), delete: doc.querySelector("#notes-delete"),
    plainWorkspace: doc.querySelector("#notes-plain-workspace"), plainEditor: doc.querySelector("#notes-plain-editor"),
    markdownToolbar: doc.querySelector("#notes-markdown-toolbar"), markdownCommands: [...doc.querySelectorAll("[data-markdown-action]")],
    markdownPreview: doc.querySelector("#notes-markdown-preview"), wordWorkspace: doc.querySelector("#notes-word-workspace"),
    richEditor: doc.querySelector("#notes-rich-editor"), richCommands: [...doc.querySelectorAll("[data-rich-command]")],
  };
  if (!dom.list || !dom.scheduleForm) return { load: async () => {}, openStandalone: async () => {} };

  let requestSequence = 0;
  let searchTimer = 0;
  let saveTimer = 0;
  let currentNote = null;
  let previewNote = null;
  let editRevision = 0;
  let savedRevision = 0;
  let activeSave = Promise.resolve();

  function updateScheduleControls() {
    const enabled = dom.scheduleEnabled.checked;
    dom.scheduleFrequency.disabled = !enabled; dom.scheduleWeekday.disabled = !enabled; dom.scheduleTime.disabled = !enabled;
    dom.scheduleWeekdayField.hidden = dom.scheduleFrequency.value !== "weekly";
  }

  function renderSummary(summary) {
    dom.total.textContent = String(summary.noteCount || 0); dom.pending.textContent = String(summary.pendingCount || 0);
    dom.latest.textContent = summary.latestNoteAt ? formatDateTime(summary.latestNoteAt) : "暂无";
    dom.organized.textContent = summary.lastOrganizedAt ? formatDateTime(summary.lastOrganizedAt) : "尚未整理";
  }

  function openTarget(item) {
    if (item.targetType === "standalone") void openStandalone(item.targetId).catch((error) => notify(error.message));
    else openSource(item.targetType, item.targetId);
  }

  function renderNotes(notes, total) {
    dom.list.replaceChildren(); dom.empty.hidden = notes.length > 0; dom.resultStatus.textContent = `找到 ${total} 条笔记`;
    for (const note of notes) {
      const standalone = note.targetType === "standalone";
      const card = createElement(doc, "article", `notes-card${standalone ? " is-standalone" : ""}`);
      const main = createElement(doc, "div", "notes-card-main");
      const meta = createElement(doc, "div", "notes-card-meta");
      meta.append(
        createElement(doc, "span", "notes-type", standalone ? noteTypeLabels[note.noteType] || "独立笔记" : sourceTypeLabels[note.targetType] || "阅读笔记"),
        createElement(doc, "span", "", note.category || "未分类"), createElement(doc, "span", "", `更新于 ${formatDateTime(note.updatedAt)}`),
      );
      if (note.annotationCount) meta.append(createElement(doc, "span", "", `${note.annotationCount} 条高亮/批注`));
      main.append(meta, createElement(doc, "h4", "", note.title || "未命名笔记"));
      main.append(createElement(doc, "p", "notes-card-excerpt", compactNote(note.noteText) || (standalone ? "这条笔记还没有正文。" : "")));
      const actions = createElement(doc, "div", "notes-card-actions");
      const previewButton = createElement(doc, "button", "notes-card-action notes-preview-button", "查看");
      previewButton.type = "button"; previewButton.addEventListener("click", () => void openPreview(note).catch((error) => notify(error.message)));
      const openButton = createElement(doc, "button", "notes-card-action notes-open-source", standalone ? "编辑" : "继续阅读");
      openButton.type = "button"; openButton.addEventListener("click", () => openTarget(note));
      actions.append(previewButton, openButton); card.append(main, actions); dom.list.append(card);
    }
  }

  function appendDigestGroup(parent, title, points) {
    if (!Array.isArray(points) || !points.length) return;
    const group = createElement(doc, "section", "notes-digest-group"); group.append(createElement(doc, "h5", "", title));
    const list = doc.createElement("ul");
    for (const point of points.slice(0, 8)) {
      const item = doc.createElement("li"); const button = createElement(doc, "button", "", point.text || "");
      button.type = "button"; button.title = `来自：${point.title || "未命名笔记"}`;
      button.addEventListener("click", () => openTarget(point)); item.append(button); list.append(item);
    }
    group.append(list); parent.append(group);
  }

  function renderDigests(digests) {
    dom.digests.replaceChildren(); dom.digestCount.textContent = `${digests.length} 份`;
    if (!digests.length) {
      dom.digests.append(createElement(doc, "p", "notes-digest-empty", "还没有整理记录。可以点击“立即整理新笔记”，或等待计划时间自动生成。")); return;
    }
    digests.forEach((entry, index) => {
      const details = createElement(doc, "details", "notes-digest"); details.open = index === 0;
      const summary = doc.createElement("summary");
      summary.append(createElement(doc, "strong", "", entry.digest?.title || "笔记整理"), createElement(doc, "small", "", `${entry.noteCount} 条笔记 · ${formatDateTime(entry.createdAt)}`));
      const body = createElement(doc, "div", "notes-digest-body"); body.append(createElement(doc, "p", "notes-digest-overview", entry.digest?.overview || ""));
      if (entry.digest?.themes?.length) {
        const themes = createElement(doc, "div", "notes-theme-list");
        for (const theme of entry.digest.themes) themes.append(createElement(doc, "span", "", `${theme.name} ${theme.count}`));
        body.append(themes);
      }
      appendDigestGroup(body, "重点", entry.digest?.keyPoints); appendDigestGroup(body, "待澄清的问题", entry.digest?.questions); appendDigestGroup(body, "下一步行动", entry.digest?.actions);
      details.append(summary, body); dom.digests.append(details);
    });
  }

  function renderSettings(settings) {
    dom.scheduleEnabled.checked = Boolean(settings.enabled);
    setControlValue(dom.scheduleFrequency, settings.frequency === "daily" ? "daily" : "weekly");
    setControlValue(dom.scheduleWeekday, String(Number(settings.weekday) || 0)); setControlValue(dom.scheduleTime, settings.time || "21:00");
    dom.nextRun.textContent = settings.enabled && settings.nextRunAt ? `下次整理：${formatDateTime(settings.nextRunAt)}` : "自动整理已关闭；仍可随时手动整理。";
    updateScheduleControls();
  }

  async function load() {
    const sequence = ++requestSequence; dom.resultStatus.textContent = "正在读取…";
    const query = new URLSearchParams();
    if (dom.search.value.trim()) query.set("query", dom.search.value.trim());
    if (dom.typeFilter.value) query.set("targetType", dom.typeFilter.value);
    const payload = await request(`/api/notes?${query.toString()}`);
    if (sequence !== requestSequence) return;
    renderSummary(payload.summary || {}); renderNotes(payload.notes || [], Number(payload.total) || 0);
    renderSettings(payload.settings || {}); renderDigests(payload.digests || []);
  }

  function collectEditorPayload() {
    const payload = { title: dom.editorTitle.value.trim() };
    if (currentNote.noteType === "word") payload.contentData = { html: dom.richEditor.innerHTML };
    else payload.contentText = dom.plainEditor.value;
    return payload;
  }

  function markDirty() {
    if (!currentNote) return;
    editRevision += 1; dom.saveStatus.textContent = "有未保存修改"; dom.saveStatus.classList.add("is-dirty");
    view.clearTimeout(saveTimer); saveTimer = view.setTimeout(() => void saveCurrent().catch((error) => notify(error.message)), 800);
  }

  async function saveCurrent() {
    if (!currentNote || savedRevision === editRevision) return activeSave;
    const noteId = currentNote.id; const revision = editRevision; const payload = collectEditorPayload(); dom.saveStatus.textContent = "保存中…";
    activeSave = activeSave.catch(() => {}).then(() => request(`/api/notes/${encodeURIComponent(noteId)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })).then((result) => {
      if (currentNote?.id === noteId) currentNote = result.note;
      savedRevision = Math.max(savedRevision, revision);
      if (savedRevision === editRevision) { dom.saveStatus.textContent = "已保存"; dom.saveStatus.classList.remove("is-dirty"); }
      else dom.saveStatus.textContent = "有未保存修改";
      return result.note;
    });
    return activeSave;
  }

  function updateLivePreview() {
    if (!currentNote) return;
    if (currentNote.noteType === "markdown") renderMarkdown(doc, dom.markdownPreview, dom.plainEditor.value);
  }

  function applyMarkdownCommand(action) {
    if (currentNote?.noteType !== "markdown") return;
    const scrollTop = dom.plainEditor.scrollTop;
    const result = applyMarkdownAction(
      dom.plainEditor.value,
      dom.plainEditor.selectionStart,
      dom.plainEditor.selectionEnd,
      action,
    );
    dom.plainEditor.value = result.value;
    dom.plainEditor.focus();
    dom.plainEditor.setSelectionRange(result.selectionStart, result.selectionEnd);
    dom.plainEditor.scrollTop = scrollTop;
    markDirty(); updateLivePreview();
  }

  function selectedRichBlock() {
    const selection = view.getSelection?.() || doc.getSelection?.();
    let node = selection?.anchorNode || null;
    if (node?.nodeType === 3) node = node.parentElement;
    while (node && node !== dom.richEditor) {
      if (richBlockTagNames.has(node.tagName)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function adjustRichIndent(delta) {
    const block = selectedRichBlock();
    if (!block) return;
    const currentLevel = Number(block.getAttribute("data-indent")) || 0;
    const nextLevel = Math.max(0, Math.min(4, currentLevel + delta));
    if (nextLevel) block.setAttribute("data-indent", String(nextLevel));
    else block.removeAttribute("data-indent");
  }

  function showEditor(note) {
    currentNote = note; editRevision = 0; savedRevision = 0;
    dom.editorType.textContent = noteTypeLabels[note.noteType] || "笔记"; dom.editorTitle.value = note.title || "";
    dom.plainWorkspace.hidden = !["markdown", "text"].includes(note.noteType); dom.wordWorkspace.hidden = note.noteType !== "word";
    dom.plainWorkspace.classList.toggle("is-text-only", note.noteType === "text");
    dom.markdownToolbar.hidden = note.noteType !== "markdown";
    dom.markdownPreview.hidden = note.noteType !== "markdown";
    if (["markdown", "text"].includes(note.noteType)) dom.plainEditor.value = note.contentText || "";
    if (note.noteType === "word") dom.richEditor.innerHTML = note.contentData?.html || "<p><br></p>";
    dom.saveStatus.textContent = "已保存"; dom.saveStatus.classList.remove("is-dirty"); dom.editor.hidden = false; updateLivePreview(); dom.editorTitle.focus();
  }

  async function openStandalone(id) {
    const payload = await request(`/api/notes/${encodeURIComponent(id)}`); showEditor(payload.note);
  }

  function showPreview(note) {
    previewNote = note;
    const standalone = note.targetType === "standalone";
    const typeLabel = standalone ? noteTypeLabels[note.noteType] || "独立笔记" : sourceTypeLabels[note.targetType] || "阅读笔记";
    const metaParts = [note.category || "未分类", `更新于 ${formatDateTime(note.updatedAt)}`];
    if (note.annotationCount) metaParts.push(`${note.annotationCount} 条高亮/批注`);
    dom.readerType.textContent = typeLabel;
    dom.readerMeta.textContent = metaParts.join(" · ");
    dom.readerTitle.textContent = note.title || "未命名笔记";
    dom.readerContent.className = "notes-reader-content";
    dom.readerContent.replaceChildren();
    if (standalone && note.noteType === "word") {
      dom.readerContent.classList.add("is-word");
      dom.readerContent.innerHTML = note.contentData?.html || "";
      if (!dom.readerContent.textContent.trim()) {
        dom.readerContent.replaceChildren(createElement(doc, "p", "notes-preview-placeholder", "这条笔记还没有正文。"));
      }
    } else if (standalone && note.noteType === "text") {
      dom.readerContent.classList.add("is-text");
      const text = String(note.contentText ?? note.noteText ?? "");
      dom.readerContent.append(createElement(doc, "div", text ? "" : "notes-preview-placeholder", text || "这条笔记还没有正文。"));
    } else if (!standalone && note.noteHtml) {
      dom.readerContent.classList.add("is-rich-reading-note");
      dom.readerContent.innerHTML = note.noteHtml;
      if (!dom.readerContent.textContent.trim() && !dom.readerContent.querySelector("img,table")) {
        dom.readerContent.replaceChildren(createElement(doc, "p", "notes-preview-placeholder", "这条笔记还没有正文。"));
      }
    } else {
      dom.readerContent.classList.add(standalone ? "is-markdown" : "is-reading-note");
      renderMarkdown(doc, dom.readerContent, note.contentText ?? note.noteText ?? "", "这条笔记还没有正文。");
    }
    dom.readerExport.hidden = !standalone;
    dom.readerOpen.textContent = standalone ? "编辑这条笔记" : "继续阅读原资料";
    dom.reader.hidden = false;
    dom.readerClose.focus();
  }

  async function openPreview(item) {
    if (item.targetType === "standalone") {
      const payload = await request(`/api/notes/${encodeURIComponent(item.targetId)}`);
      showPreview(payload.note);
      return;
    }
    showPreview(item);
  }

  function closePreview() {
    dom.reader.hidden = true;
    previewNote = null;
  }

  async function closeEditor() {
    view.clearTimeout(saveTimer); await saveCurrent(); dom.editor.hidden = true; currentNote = null; await load();
  }

  function exportCurrent() {
    if (!currentNote) return;
    void saveCurrent()
      .then(() => triggerDownload(doc, `/api/notes/${encodeURIComponent(currentNote.id)}/export`))
      .catch((error) => notify(error.message));
  }

  dom.search.addEventListener("input", () => {
    view.clearTimeout(searchTimer); searchTimer = view.setTimeout(() => void load().catch((error) => notify(error.message)), 250);
  });
  dom.typeFilter.addEventListener("change", () => void load().catch((error) => notify(error.message)));
  dom.scheduleEnabled.addEventListener("change", updateScheduleControls); dom.scheduleFrequency.addEventListener("change", updateScheduleControls);
  dom.scheduleForm.addEventListener("submit", (event) => {
    event.preventDefault(); const submit = dom.scheduleForm.querySelector("button[type='submit']"); submit.disabled = true;
    void request("/api/notes/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: dom.scheduleEnabled.checked, frequency: dom.scheduleFrequency.value, weekday: Number(dom.scheduleWeekday.value), time: dom.scheduleTime.value }),
    }).then((payload) => { renderSettings(payload.settings || {}); notify("笔记整理计划已保存。"); })
      .catch((error) => notify(error.message)).finally(() => { submit.disabled = false; });
  });
  dom.organizeNow.addEventListener("click", () => {
    dom.organizeNow.disabled = true; dom.organizeNow.textContent = "正在整理…";
    void request("/api/notes/organize", { method: "POST" })
      .then((payload) => { notify(payload.message || "整理完成。"); return load(); })
      .catch((error) => notify(error.message)).finally(() => { dom.organizeNow.disabled = false; dom.organizeNow.textContent = "立即整理新笔记"; });
  });
  dom.create?.addEventListener("click", () => { dom.typeDialog.hidden = false; }); dom.typeClose?.addEventListener("click", () => { dom.typeDialog.hidden = true; });
  dom.typeDialog?.addEventListener("click", (event) => { if (event.target === dom.typeDialog) dom.typeDialog.hidden = true; });
  dom.readerClose?.addEventListener("click", closePreview);
  dom.reader?.addEventListener("click", (event) => { if (event.target === dom.reader) closePreview(); });
  dom.readerOpen?.addEventListener("click", () => {
    if (!previewNote) return;
    const note = previewNote;
    closePreview();
    if (note.targetType === "standalone") showEditor(note);
    else openSource(note.targetType, note.targetId);
  });
  dom.readerExport?.addEventListener("click", () => {
    if (previewNote?.targetType === "standalone") triggerDownload(doc, `/api/notes/${encodeURIComponent(previewNote.id)}/export`);
  });
  for (const button of dom.typeButtons) button.addEventListener("click", () => {
    button.disabled = true;
    void request("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noteType: button.dataset.createNote }) })
      .then((payload) => { dom.typeDialog.hidden = true; showEditor(payload.note); })
      .catch((error) => notify(error.message)).finally(() => { button.disabled = false; });
  });
  dom.editorTitle?.addEventListener("input", markDirty);
  dom.plainEditor?.addEventListener("input", () => { markDirty(); updateLivePreview(); });
  dom.richEditor?.addEventListener("input", markDirty);
  for (const button of dom.markdownCommands) {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => applyMarkdownCommand(button.dataset.markdownAction));
  }
  dom.save?.addEventListener("click", () => {
    dom.save.disabled = true;
    void closeEditor()
      .then(() => notify("笔记已保存。"))
      .catch((error) => notify(error.message))
      .finally(() => { dom.save.disabled = false; });
  });
  dom.editorClose?.addEventListener("click", () => void closeEditor().catch((error) => notify(error.message))); dom.export?.addEventListener("click", exportCurrent);
  dom.delete?.addEventListener("click", () => {
    if (!currentNote || !view.confirm?.("确认删除这条独立笔记？此操作不会删除任何原始资料。")) return;
    const id = currentNote.id;
    void request(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(() => { dom.editor.hidden = true; currentNote = null; notify("独立笔记已删除。"); return load(); }).catch((error) => notify(error.message));
  });
  for (const button of dom.richCommands) {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const command = button.dataset.richCommand;
      if (command === "indent" || command === "outdent") adjustRichIndent(command === "indent" ? 1 : -1);
      else doc.execCommand?.(command, false, button.dataset.richValue || null);
      dom.richEditor.focus(); markDirty();
    });
  }

  updateScheduleControls();
  return { load, openStandalone, openPreview };
}
