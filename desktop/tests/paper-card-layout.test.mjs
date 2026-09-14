import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { arrangePaperCard } from "../public/paper-card-layout.js";

function fixture({ fidelity = "complete", error = false } = {}) {
  const { document, Event } = parseHTML(`<html><body><div id="paper-grid"><article class="paper-card">
    <div class="paper-card-meta"><span>AI</span><span>2026/09/12</span></div>
    <div class="paper-card-content"><span class="paper-source-label">手动导入</span><h3>长论文标题</h3>
      <span class="paper-translation-state ${error ? "is-failed" : "is-translated"}">${error ? "全文导入失败：网络超时" : "Codex 中文全文已完成 · 完整性已校验"}</span>
      <p class="paper-authors">作者</p><p class="paper-abstract">摘要</p></div>
    <footer><button class="primary-button">中文阅读</button><a href="https://example.com/paper">论文原文</a><a href="https://example.com/pdf">英文 PDF</a><button class="danger-button">删除</button></footer>
  </article></div></body></html>`);
  const card = document.querySelector("article");
  const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.setAttribute("aria-label", "选择论文：长论文标题");
  const location = document.createElement("button"); location.textContent = "智能体 / 同名目录";
  const moveButton = document.createElement("button"); moveButton.textContent = "移动目录";
  return { document, card, Event, checkbox, location, moveButton, paper: { titleZh: "长论文标题", fullTranslationFidelity: fidelity, readingStatus: "reading" } };
}

test("列表和网格共用两列结构，元数据和横向操作均归入正文", () => {
  const f = fixture(); arrangePaperCard(f.card, { ...f, readingStatus: "在读" });
  assert.deepEqual([...f.card.children].map(e => e.className), ["paper-card-select", "paper-card-content"]);
  const content = f.card.querySelector(".paper-card-content");
  assert.equal(content.firstElementChild.className, "paper-card-meta");
  assert.equal(content.lastElementChild.tagName, "FOOTER");
  assert.equal(content.querySelector(".paper-card-meta .paper-source-label").textContent, "手动导入");
  assert.equal(content.querySelector(".paper-location-link").title, "智能体 / 同名目录");
  assert.equal(content.querySelector(".paper-card-reading-status").dataset.status, "reading");
  assert.equal(f.card.querySelector(".paper-card-select input"), f.checkbox);
  assert.equal(f.card.querySelector(".paper-card-actions > button:nth-child(2)"), f.moveButton);
  assert.equal(f.card.querySelector(".paper-card-more summary").getAttribute("aria-label"), "更多操作：长论文标题");
});

test("更多收纳原操作节点，不改变链接、删除确认或事件绑定", () => {
  const f = fixture();
  const originalDelete = f.card.querySelector(".danger-button");
  let calls = 0; originalDelete.addEventListener("click", () => calls++);
  arrangePaperCard(f.card, { ...f, readingStatus: "在读" });
  const panel = f.card.querySelector(".paper-card-more-panel");
  assert.equal(panel.children.length, 3);
  assert.equal(panel.querySelector(".danger-button"), originalDelete);
  assert.equal(panel.querySelector("a").getAttribute("href"), "https://example.com/paper");
  originalDelete.dispatchEvent(new f.Event("click", { bubbles: true }));
  assert.equal(calls, 1);
  assert.equal(f.card.querySelector(".paper-card-more").open, false);
});

test("完整状态收为轻量提示，降级、未知及错误仍明确展示", () => {
  for (const [fidelity, text] of [["complete", "中文全文 · 已校验"], ["degraded", "中文全文 · 图文结构降级"], ["unknown", "中文全文 · 完整性待核验"]]) {
    const f = fixture({ fidelity }); arrangePaperCard(f.card, { ...f, readingStatus: "未读" });
    const state = f.card.querySelector(".paper-translation-state");
    assert.equal(state.textContent, text);
    assert.equal(state.title, "Codex 中文全文已完成 · 完整性已校验");
    assert.equal(state.classList.contains("is-warning"), fidelity !== "complete");
  }
  const f = fixture({ error: true }); arrangePaperCard(f.card, { ...f, readingStatus: "未读" });
  assert.equal(f.card.querySelector(".is-failed").textContent, "全文导入失败：网络超时");
  for (const text of ["全文导入失败：网络超时", "正在下载论文 · 50% · 第 2 次"]) {
    const active = fixture();
    active.card.querySelector(".paper-translation-state").textContent = text;
    arrangePaperCard(active.card, { ...active, readingStatus: "未读" });
    assert.equal(active.card.querySelector(".paper-translation-state").textContent, text, "旧译文不能覆盖当前错误或导入进度");
  }
});
