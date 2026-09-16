import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseHTML } from "linkedom";
import { applyMarkdownAction, mountNotesCenter } from "../public/notes-center.js";

test("Markdown 编辑器提供可操作工具栏且不再提供思维导图", () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../public/index.html"), "utf8");
  const serverSource = fs.readFileSync(path.resolve(import.meta.dirname, "../server.mjs"), "utf8");
  const { document } = parseHTML(html);
  const actions = new Set(
    [...document.querySelectorAll("#notes-markdown-toolbar [data-markdown-action]")]
      .map((button) => button.dataset.markdownAction),
  );
  assert.deepEqual(actions, new Set([
    "heading", "bold", "italic", "bullet", "ordered", "quote", "inline-code", "code-block", "link",
  ]));
  assert.equal(document.querySelector('[data-create-note="mindmap"]'), null);
  assert.equal(document.querySelector('#notes-type-filter option[value="mindmap"]'), null);
  assert.equal(document.querySelector("#notes-mindmap-workspace"), null);
  assert.match(serverSource, /!\["markdown", "text", "word"\]\.includes\(noteType\)/);
  assert.match(serverSource, /sendJson\(response, 400, \{ message: "不支持这种笔记类型。" \}\)/);
});

test("Markdown 工具动作包裹选区并把空光标放在继续输入的位置", () => {
  const bold = applyMarkdownAction("前后", 1, 1, "bold");
  assert.equal(bold.value, "前****后");
  assert.deepEqual([bold.selectionStart, bold.selectionEnd], [3, 3]);
  assert.equal(
    `${bold.value.slice(0, bold.selectionStart)}重点${bold.value.slice(bold.selectionEnd)}`,
    "前**重点**后",
  );

  const selected = applyMarkdownAction("重要内容", 0, 4, "bold");
  assert.equal(selected.value, "**重要内容**");
  assert.deepEqual([selected.selectionStart, selected.selectionEnd], [2, 6]);

  const list = applyMarkdownAction("第一项\n第二项", 0, 7, "ordered");
  assert.equal(list.value, "1. 第一项\n2. 第二项");
  const quote = applyMarkdownAction("结论", 0, 0, "quote");
  assert.equal(quote.value, "> 结论");
  assert.deepEqual([quote.selectionStart, quote.selectionEnd], [2, 2]);

  const codeBlock = applyMarkdownAction("", 0, 0, "code-block");
  assert.equal(codeBlock.value, "```\n\n```");
  assert.deepEqual([codeBlock.selectionStart, codeBlock.selectionEnd], [4, 4]);
  const link = applyMarkdownAction("参考", 0, 2, "link");
  assert.equal(link.value, "[参考](https://)");
  assert.equal(link.value.slice(link.selectionStart, link.selectionEnd), "https://");
});

test("Word 工具栏提供常用段落、对齐、缩进和列表功能", () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../public/index.html"), "utf8");
  const { document } = parseHTML(html);
  const commands = new Set(
    [...document.querySelectorAll(".notes-format-toolbar [data-rich-command]")]
      .map((button) => button.dataset.richCommand),
  );
  for (const command of [
    "formatBlock", "bold", "italic", "underline",
    "justifyLeft", "justifyCenter", "justifyRight", "justifyFull",
    "indent", "outdent", "insertUnorderedList", "insertOrderedList",
  ]) {
    assert.equal(commands.has(command), true, `缺少 ${command} 格式按钮`);
  }
  assert.equal(document.querySelectorAll(".notes-format-group").length, 5);
});

test("笔记列表提供独立只读查看页，并可从预览进入编辑或原资料", async () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../public/index.html"), "utf8");
  const css = fs.readFileSync(path.resolve(import.meta.dirname, "../public/notes-center.css"), "utf8");
  assert.doesNotMatch(css, /var\(--accent\)/, "笔记页不能引用项目中不存在的颜色变量");
  assert.match(css, /#notes-view\s*\{[^}]*--muted:\s*var\(--ink-soft\)/s, "笔记页的次要文字变量必须有真实来源");
  assert.match(css, /\.notes-card-action\s*\{[^}]*background:\s*var\(--notes-accent\)[^}]*color:\s*var\(--notes-on-accent\)/s);
  assert.match(css, /:root\[data-theme="dark"\] #notes-view\s*\{[^}]*--notes-on-accent:\s*#102420/s);
  const { document, window } = parseHTML(html);
  const standalone = {
    id: "note-preview", targetType: "standalone", targetId: "note-preview", noteType: "markdown",
    title: "向量检索笔记", category: "独立笔记", noteText: "# 结论\n**召回率**优先",
    contentText: "# 结论\n**召回率**优先", contentData: {}, updatedAt: "2026-09-14T12:00:00Z",
  };
  const reading = {
    targetType: "document", targetId: "doc-1", title: "设备说明书", category: "工作资料",
    noteText: "注意 断电后维护", noteHtml: '<blockquote>注意</blockquote><p style="font-family: SimSun"><strong>断电</strong>后维护</p><table><tr><td>步骤</td></tr></table>',
    annotationCount: 2, updatedAt: "2026-09-14T11:00:00Z",
  };
  const listing = {
    notes: [standalone, reading], total: 2, summary: {},
    settings: { enabled: false, frequency: "weekly", weekday: 0, time: "21:00" }, digests: [],
  };
  const openedSources = [];
  const request = async (url) => {
    if (url === "/api/notes/note-preview") return { note: standalone };
    return listing;
  };
  const center = mountNotesCenter({
    document, request, notify: () => {},
    openSource: (type, id) => openedSources.push([type, id]),
  });
  await center.load();

  const previewButtons = [...document.querySelectorAll(".notes-preview-button")];
  assert.equal(previewButtons.length, 2);
  assert.equal(previewButtons.every((button) => button.classList.contains("notes-card-action")), true);
  assert.equal([...document.querySelectorAll(".notes-open-source")].every((button) => button.classList.contains("notes-card-action")), true);
  assert.equal(document.querySelectorAll(".notes-card-actions")[0].textContent, "查看编辑");

  previewButtons[1].click();
  assert.equal(document.querySelector("#notes-reader").hidden, false);
  assert.equal(document.querySelector("#notes-reader-title").textContent, "设备说明书");
  assert.equal(document.querySelector("#notes-reader-content strong").textContent, "断电");
  assert.equal(document.querySelector("#notes-reader-content table td").textContent, "步骤");
  assert.match(document.querySelector("#notes-reader-content p").getAttribute("style"), /SimSun/);
  assert.match(document.querySelector("#notes-reader-meta").textContent, /2 条高亮\/批注/);
  assert.equal(document.querySelector("#notes-reader-export").hidden, true);
  document.querySelector("#notes-reader-open").click();
  assert.deepEqual(openedSources, [["document", "doc-1"]]);
  assert.equal(document.querySelector("#notes-reader").hidden, true);

  previewButtons[0].click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(document.querySelector("#notes-reader-title").textContent, "向量检索笔记");
  assert.equal(document.querySelector("#notes-reader-content strong").textContent, "召回率");
  assert.equal(document.querySelector("#notes-reader-content textarea"), null);
  assert.equal(document.querySelector("#notes-reader-export").hidden, false);
  document.querySelector("#notes-reader-open").click();
  assert.equal(document.querySelector("#notes-reader").hidden, true);
  assert.equal(document.querySelector("#notes-editor").hidden, false);
});

test("笔记页可选择 Markdown、新建、编辑并在保存成功后关闭编辑器", async () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../public/index.html"), "utf8");
  const { document, window } = parseHTML(html);
  const calls = [];
  let saved = { id: "note-1", targetType: "standalone", targetId: "note-1", noteType: "markdown", title: "未命名 Markdown 笔记", contentText: "# 新笔记\n\n", contentData: {}, category: "独立笔记", updatedAt: "2026-09-14T12:00:00Z" };
  const listing = { notes: [], total: 0, summary: {}, settings: { enabled: false, frequency: "weekly", weekday: 0, time: "21:00" }, digests: [] };
  const request = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/notes" && options.method === "POST") return { note: saved };
    if (url === "/api/notes/note-1" && options.method === "PATCH") {
      const body = JSON.parse(options.body);
      saved = { ...saved, ...body };
      return { note: saved };
    }
    return listing;
  };
  const notifications = [];
  const center = mountNotesCenter({ document, request, notify: (message) => notifications.push(message), openSource: () => {} });
  await center.load();
  document.querySelector("#notes-create").click();
  assert.equal(document.querySelector("#notes-type-dialog").hidden, false);
  document.querySelector('[data-create-note="markdown"]').click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(document.querySelector("#notes-editor").hidden, false);
  const title = document.querySelector("#notes-editor-title");
  title.value = "RAG 实验"; title.dispatchEvent(new window.Event("input"));
  const editor = document.querySelector("#notes-plain-editor");
  editor.setSelectionRange = (start, end) => { editor.selectionStart = start; editor.selectionEnd = end; };
  editor.value = ""; editor.setSelectionRange(0, 0);
  document.querySelector('[data-markdown-action="bold"]').click();
  assert.equal(editor.value, "****");
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [2, 2]);
  editor.value = "# 检索\n**重点**与`代码`\n1. 验证召回率\n[参考](https://example.com)";
  editor.dispatchEvent(new window.Event("input"));
  const preview = document.querySelector("#notes-markdown-preview");
  assert.equal(document.querySelector("#notes-markdown-toolbar").hidden, false);
  assert.equal(preview.querySelector("strong").textContent, "重点");
  assert.equal(preview.querySelector("code").textContent, "代码");
  assert.equal(preview.querySelector("ol li").textContent, "验证召回率");
  assert.equal(preview.querySelector("a").getAttribute("href"), "https://example.com");
  document.querySelector("#notes-save").click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(saved.title, "RAG 实验");
  assert.match(saved.contentText, /召回率/);
  assert.equal(calls.some((call) => call.options.method === "PATCH"), true);
  assert.equal(document.querySelector("#notes-editor").hidden, true);
  assert.deepEqual(notifications, ["笔记已保存。"]);
});
