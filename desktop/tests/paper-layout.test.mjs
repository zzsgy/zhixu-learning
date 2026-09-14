/** 论文阅读版面语义增强测试。 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";

import { normalizePaperReadingLayout } from "../public/paper-layout.js";

test("提示轨迹变为紧凑字段行并保留跨页提示", () => {
  const { document } = parseHTML(`<main>
    <p><strong>问题</strong></p><p>哪本杂志更早？</p>
    <h4>动作 1</h4><pre>Search[Arthur's Magazine]</pre>
    <p>下页续</p><p>Hotpot QA 提示——续上页</p>
  </main>`);
  const root = document.querySelector("main");
  const result = normalizePaperReadingLayout(root);
  assert.equal(result.promptRows, 2);
  assert.equal(root.querySelectorAll(".paper-prompt-row").length, 2);
  assert.equal(root.querySelectorAll(".paper-prompt-transcript").length, 1);
  assert.equal(root.querySelectorAll(".paper-page-continuation").length, 2);
  assert.equal(root.querySelectorAll("pre.paper-transcript-pre").length, 1);
});

test("行动与观察结果同义标签在嵌套块中也组成提示轨迹", () => {
  const { document } = parseHTML(`
    <main><section><h4>行动 1</h4><pre>Search[ReAct]</pre><h4>观察结果 1</h4><p>找到结果。</p></section></main>
  `);
  const root = document.querySelector("main");
  const result = normalizePaperReadingLayout(root);
  assert.equal(result.promptRows, 2);
  assert.equal(root.querySelectorAll(".paper-prompt-transcript").length, 1);
  assert.equal(root.querySelectorAll("pre.paper-transcript-pre").length, 1);
  assert.equal(root.querySelectorAll(".is-action").length, 1);
  assert.equal(root.querySelectorAll(".is-observation").length, 1);
});

test("宽表格获得滚动容器且表内轨迹不再进入普通代码卡片", () => {
  const { document } = parseHTML(`<main><p>表 6：WebShop prompts.</p><table>
    <tr><td colspan="2">Instruction</td></tr><tr><td>Act</td><td>ReAct</td></tr>
    <tr><td><pre>Action: search[x]\nObservation: result</pre></td><td>Thought: inspect</td></tr>
  </table></main>`);
  const root = document.querySelector("main");
  const result = normalizePaperReadingLayout(root);
  assert.equal(result.tables, 1);
  assert.equal(result.captions, 1);
  assert.equal(root.querySelectorAll(".paper-table-scroll.is-dense").length, 1);
  assert.equal(root.querySelector("td")?.getAttribute("colspan"), "2");
  assert.equal(root.querySelectorAll("pre.paper-transcript-pre").length, 1);
});

test("相邻重复上下标只显示一次", () => {
  const { document } = parseHTML('<main><p>x<sup>5</sup><sup>5</sup><sup>5</sup> + y<sub>t</sub><sub>t</sub></p></main>');
  const root = document.querySelector("main");
  const result = normalizePaperReadingLayout(root);
  assert.equal(result.duplicateScriptsRemoved, 3);
  assert.equal(root.querySelectorAll("sup").length, 1);
  assert.equal(root.querySelectorAll("sub").length, 1);
});
