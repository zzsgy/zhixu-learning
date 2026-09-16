import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  normalizeStandaloneNoteContent,
  readingNotePlainText,
  sanitizeReadingNoteHtml,
  sanitizeWordNoteHtml,
} from "../lib/note-content.mjs";
import { createWordNoteDocument } from "../lib/note-docx.mjs";

test("Word 笔记服务端清洗危险 HTML 并保留基础语义格式", () => {
  const html = sanitizeWordNoteHtml('<h2 onclick="alert(1)">标题</h2><p style="text-align:center;color:red" data-indent="2"><strong>重点</strong><img src=x onerror=alert(1)></p><div align="right">结论</div><script>alert(1)</script>');
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<p[^>]*data-align="center"/);
  assert.match(html, /<p[^>]*data-indent="2"/);
  assert.match(html, /<div[^>]*data-align="right"/);
  assert.doesNotMatch(html, /onclick|onerror|<img|<script|style=|color:/i);
  const normalized = normalizeStandaloneNoteContent("word", { contentData: { html } });
  assert.match(normalized.contentText, /标题/);
  assert.match(normalized.contentText, /重点/);
  assert.doesNotMatch(normalized.contentText, /alert/);
});

test("Word 笔记导出标准 docx 容器", async () => {
  const buffer = await createWordNoteDocument({
    title: "本地周报",
    html: '<h2>进展</h2><p data-align="center" data-indent="1"><strong>完成</strong>导出。</p><ul><li>项目符号</li></ul><ol><li>第一项</li><li>第二项</li></ol>',
  });
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /本地周报/);
  assert.match(xml, /完成/);
  assert.match(xml, /w:jc w:val="center"/);
  assert.match(xml, /w:numPr/);
  assert.match(xml, /项目符号/);
  assert.match(xml, /第一项/);
  const numberingXml = await zip.file("word/numbering.xml").async("string");
  assert.match(numberingXml, /w:numFmt w:val="decimal"/);
});

test("伴读富文本保留字体、图片和表格并清除主动内容", () => {
  const source = `<section onclick="alert(1)" style="font-family: SimSun; font-size: 18px; color: #123456; position: fixed; background-image: url(javascript:alert(1))">
    <h2>方案设计</h2><p><font face="Microsoft YaHei" color="#334455" size="4">原字体</font><mark>重点</mark><sup>1</sup></p>
    <table style="border-collapse: collapse; width: 100%"><tr><th rowspan="2">步骤</th><td>验证</td></tr></table>
    <img src="data:image/png;base64,iVBORw0KGgo=" alt="流程图" onerror="alert(1)">
    <img src="http://127.0.0.1:47821/api/article-images/local.png" alt="本地图">
    <img src="https://example.com/tracker.png" alt="远程图">
    <a href="javascript:alert(1)">危险链接</a><script>恶意脚本</script>
  </section>`;
  const html = sanitizeReadingNoteHtml(source);
  assert.match(html, /font-family: SimSun/);
  assert.match(html, /font-size: 18px/);
  assert.match(html, /color: #123456/);
  assert.match(html, /<font[^>]*face="Microsoft YaHei"/);
  assert.match(html, /<font[^>]*color="#334455"/);
  assert.match(html, /<font[^>]*size="4"/);
  assert.match(html, /<table[^>]*border-collapse: collapse/);
  assert.match(html, /<th rowspan="2">步骤<\/th>/);
  assert.match(html, /<img[^>]*src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(html, /<img[^>]*alt="流程图"/);
  assert.match(html, /src="\/api\/article-images\/local.png"/);
  assert.match(html, /远程图/);
  assert.doesNotMatch(html, /example\.com\/tracker/);
  assert.doesNotMatch(html, /onclick|onerror|position:|background-image|javascript:|<script/i);
  const text = readingNotePlainText(html);
  assert.match(text, /方案设计/);
  assert.match(text, /步骤/);
  assert.match(text, /\[图片：流程图\]/);
});
