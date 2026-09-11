import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, fontStyles] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/vendor/lxgw-wenkai/lxgwwenkai-regular.css", import.meta.url), "utf8"),
]);

test("阅读工作台提供三个互斥且可记忆的阅读样式", () => {
  for (const theme of ["classic", "immersive", "paper"]) {
    assert.match(html, new RegExp(`data-reading-theme="${theme}"`));
  }
  assert.match(script, /zhixu-reading-theme/);
  assert.match(script, /document\.documentElement\.dataset\.readingTheme = theme/);
  assert.match(script, /document\.body\.classList\.add\("is-reading-page"\)/);
  assert.match(script, /document\.body\.classList\.remove\("is-reading-page"\)/);
  assert.match(script, /setAttribute\("aria-checked"/);
});

test("沉浸夜读使用本地霞鹜文楷并把目录移到右侧", () => {
  assert.match(html, /\/vendor\/lxgw-wenkai\/lxgwwenkai-regular\.css/);
  assert.match(styles, /--reading-wenkai: "LXGW WenKai"/);
  assert.match(styles, /data-reading-theme="immersive"/);
  assert.match(styles, /body\.is-reading-page \.main-content/);
  assert.match(styles, /--sidebar-bg: #11111d/);
  assert.match(styles, /width: min\(1120px, 100%\);/);
  assert.match(styles, /right: 22px;[\s\S]*left: auto;[\s\S]*width: 192px;/);
  assert.match(fontStyles, /font-family: 'LXGW WenKai'/);
  assert.doesNotMatch(fontStyles, /https?:\/\//);
});

test("沉浸夜读中的 PDF 文档使用居中单列正文和顶部信息条", () => {
  assert.match(styles, /\.reader:not\(\.is-word-reader\) \.reader-layout \{[\s\S]*max-width: 1400px;[\s\S]*grid-template-columns: minmax\(0, 1fr\);[\s\S]*margin: 0 auto;/);
  assert.match(styles, /\.reader:not\(\.is-word-reader\) \.reader-aside \{[\s\S]*grid-row: 1;[\s\S]*width: min\(1120px, 100%\);[\s\S]*grid-template-columns: minmax\(190px, 240px\) minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.reader:not\(\.is-word-reader\) \.reader-article \{ grid-row: 2; \}/);
  assert.match(styles, /\.reader-article > :is\(\.eyebrow, h1, \.reader-summary\)/);
});

test("超长文章标题和重复竖长装饰图不会破坏阅读页比例", () => {
  assert.match(script, /function removeDecorativeArticleImage\(image, sourceCount\)/);
  assert.match(script, /image\.naturalWidth <= 400[\s\S]*image\.naturalHeight >= 1200[\s\S]*aspectRatio >= 4/);
  assert.match(script, /sourceCount >= 2[\s\S]*image\.naturalWidth <= 180[\s\S]*image\.naturalHeight <= 320/);
  assert.match(script, /safeArticleRoot\.querySelectorAll\("section, div, p"\)\)\.reverse\(\)/);
  assert.match(script, /paragraph\.classList\.add\("article-section-heading"\)/);
  assert.match(script, /classList\.toggle\([\s\S]*"is-long-title"[\s\S]*length >= 34/);
  assert.match(styles, /\.article-reading-page h1\.is-long-title \{ font-size: clamp\(32px, 3\.6vw, 54px\)/);
  assert.match(styles, /\.article-prose p\.article-section-heading \{/);
});

test("三类阅读正文统一增强代码块、行内代码和特殊提示字段", () => {
  assert.match(script, /function enhanceReadingSemantics\(readingSurface\)/);
  assert.match(script, /function normalizeReadingPreformattedLines\(preElement\)/);
  assert.match(script, /normalizeReadingPreformattedLines\(preElement\)/);
  assert.match(script, /inferReadingCodeLanguage/);
  assert.match(script, /navigator\.clipboard\.writeText\(sourceCode\)/);
  assert.match(script, /shell\.append\(preElement, copyButton\)/);
  assert.match(script, /\["example", \/\^\(\?:示例\|示意片段/);
  assert.match(script, /enhanceReadingSemantics\(dom\.readerContent\)/);
  assert.match(script, /enhanceReadingSemantics\(dom\.articleReaderContent\)/);
  assert.match(script, /enhanceReadingSemantics\(dom\.paperReaderContent\)/);
  assert.match(styles, /\.reading-code-shell/);
  assert.match(styles, /width: min\(100%, 920px\)/);
  assert.match(styles, /\.reading-code-shell:hover \.reading-code-copy/);
  assert.match(styles, /\.reading-surface :not\(pre\) > code/);
  assert.match(styles, /\.reading-callout\.is-warning/);
});
