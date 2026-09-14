/**
 * 论文阅读版面语义增强。
 *
 * 数据库只保存安全的语义 HTML；本模块把论文特有的表格、提示轨迹、题注和
 * 跨页标记转换为知序自有展示类。浏览器阅读页和中文 PDF 导出共用同一规则。
 */

/** 论文提示轨迹中独立成行的字段标签。 */
const promptLabelPattern = /^(?:问题|答案|声明|指令|思考(?:\s*\d+)?|(?:动作|行动)(?:\s*\d+)?|观察(?:结果)?(?:\s*\d+)?|Question|Answer|Claim|Instruction|Thought(?:\s*\d+)?|Action(?:\s*\d+)?|Observation(?:\s*\d+)?)\s*[：:]?$/i;
/** 论文提示轨迹中与正文写在同一段开头的字段标签。 */
const inlinePromptPattern = /^(?:问题|答案|声明|指令|思考(?:\s*\d+)?|(?:动作|行动)(?:\s*\d+)?|观察(?:结果)?(?:\s*\d+)?|Question|Answer|Claim|Instruction|Thought(?:\s*\d+)?|Action(?:\s*\d+)?|Observation(?:\s*\d+)?)\s*[：:]/i;
/** PDF 转换或译文中残留的跨页提示。 */
const pageContinuationPattern = /^(?:下页续|续上页|续前页|continued\s+on\s+(?:the\s+)?next\s+page|continued\s+from\s+(?:the\s+)?previous\s+page|.+?[—-]{1,3}\s*续(?:上|前)页)$/i;
/** 图表题注，而不是普通正文。 */
const captionPattern = /^(?:图|表)\s*\d+[a-zA-Z]?\s*[：:]|^(?:fig(?:ure)?\.?|table)\s*\d+[a-zA-Z]?\s*[.:]/i;

/** @param {Element | null | undefined} element @returns {string} */
function compactText(element) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

/** @param {Element} element @returns {string} */
function promptTone(element) {
  const text = compactText(element).replace(/[：:].*$/s, "").toLowerCase();
  if (/^(?:思考|thought)/i.test(text)) return "thought";
  if (/^(?:动作|行动|action)/i.test(text)) return "action";
  if (/^(?:观察|observation)/i.test(text)) return "observation";
  if (/^(?:答案|answer)/i.test(text)) return "answer";
  return "question";
}

/**
 * 清理相邻重复的上下标。部分 arXiv MathML 同时带可视层和后备层，翻译后会
 * 产生 `<sup>4</sup><sup>4</sup>`，这不是论文作者有意重复。
 *
 * @param {Element} root 论文正文根节点。
 * @returns {number} 删除的重复节点数。
 */
export function deduplicatePaperScripts(root) {
  let removed = 0;
  for (const script of Array.from(root?.querySelectorAll?.("sup, sub") || [])) {
    if (!script.isConnected) continue;
    let sibling = script.nextElementSibling;
    while (
      sibling
      && sibling.tagName === script.tagName
      && compactText(sibling) === compactText(script)
    ) {
      const duplicate = sibling;
      sibling = sibling.nextElementSibling;
      duplicate.remove();
      removed += 1;
    }
  }
  return removed;
}

/**
 * 给论文阅读页补充安全、可复用的版面语义。
 *
 * @param {Element} root 论文正文根节点。
 * @returns {{ duplicateScriptsRemoved: number, promptRows: number, tables: number, captions: number }} 处理统计。
 */
export function normalizePaperReadingLayout(root) {
  if (!root?.querySelectorAll) {
    return { duplicateScriptsRemoved: 0, promptRows: 0, tables: 0, captions: 0 };
  }
  const duplicateScriptsRemoved = deduplicatePaperScripts(root);
  let captions = 0;
  for (const element of Array.from(root.querySelectorAll("p, figcaption"))) {
    const text = compactText(element);
    if (captionPattern.test(text)) {
      element.classList.add("paper-caption");
      captions += 1;
    } else if (pageContinuationPattern.test(text)) {
      element.classList.add("paper-page-continuation");
    }
  }

  let tables = 0;
  for (const table of Array.from(root.querySelectorAll("table"))) {
    tables += 1;
    table.classList.add("paper-data-table");
    const tableText = compactText(table);
    const hasTranscript = table.querySelector("pre") || /(?:(?:动作|行动)|思考|观察(?:结果)?|Action|Thought|Observation)\s*[：:]/i.test(tableText);
    if (hasTranscript) table.classList.add("paper-transcript-table");
    const maximumColumns = Math.max(0, ...Array.from(table.querySelectorAll("tr"), (row) => (
      Array.from(row.children).reduce((total, cell) => (
        total + Math.max(1, Number(cell.getAttribute("colspan")) || 1)
      ), 0)
    )));
    const isDense = hasTranscript || maximumColumns >= 6 || tableText.length >= 1_200;
    if (isDense) table.classList.add("is-dense");
    for (const pre of Array.from(table.querySelectorAll("pre"))) {
      pre.classList.add("paper-transcript-pre");
    }
    for (const paragraph of Array.from(table.querySelectorAll("p"))) {
      if (!inlinePromptPattern.test(compactText(paragraph))) continue;
      paragraph.classList.add("paper-transcript-line", `is-${promptTone(paragraph)}`);
    }
    const firstRow = table.querySelector("tr");
    if (firstRow) firstRow.classList.add("paper-table-heading-row");
    if (!table.parentElement?.classList.contains("paper-table-scroll")) {
      const wrapper = table.ownerDocument.createElement("section");
      wrapper.className = `paper-table-scroll${isDense ? " is-dense" : ""}`;
      table.before(wrapper);
      wrapper.append(table);
    }
  }

  let promptRows = 0;
  const labelCandidates = Array.from(root.querySelectorAll("p, h4"));
  for (const label of labelCandidates) {
    if (!label.isConnected || label.closest("table, .paper-prompt-row")) continue;
    const text = compactText(label);
    if (inlinePromptPattern.test(text) && !promptLabelPattern.test(text)) {
      label.classList.add("paper-transcript-line", `is-${promptTone(label)}`);
      continue;
    }
    if (!promptLabelPattern.test(text)) continue;
    const value = label.nextElementSibling;
    if (
      !value
      || /^(?:H2|H3|H4|TABLE)$/.test(value.tagName)
      || value.classList.contains("paper-caption")
      || value.classList.contains("paper-page-continuation")
    ) continue;
    const row = label.ownerDocument.createElement("section");
    row.className = `paper-prompt-row is-${promptTone(label)}`;
    label.before(row);
    label.classList.add("paper-prompt-label");
    value.classList.add("paper-prompt-value");
    if (value.tagName === "PRE") value.classList.add("paper-transcript-pre");
    row.append(label, value);
    promptRows += 1;
  }

  for (const row of Array.from(root.querySelectorAll(".paper-prompt-row"))) {
    if (!row.isConnected || row.parentElement?.classList.contains("paper-prompt-transcript")) continue;
    const group = row.ownerDocument.createElement("section");
    group.className = "paper-prompt-transcript";
    row.before(group);
    let current = row;
    while (current?.classList.contains("paper-prompt-row")) {
      const next = current.nextElementSibling;
      group.append(current);
      current = next;
    }
  }

  return { duplicateScriptsRemoved, promptRows, tables, captions };
}
