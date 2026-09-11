/**
 * Docsify 目录层级解析测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDocumentationSourceUrl,
  parseDocsifySidebar,
  parseReadmeChapterLinks,
} from "../lib/docsify-importer.mjs";

/**
 * 验证无链接章标题会作为其后小节的父级分组保存。
 */
test("保留 Docsify 侧栏中的章级分组和章内顺序", () => {
  /** sidebarMarkdown 是与 All-in-RAG 相同层级形式的最小目录样本。 */
  const sidebarMarkdown = `
- 目录
  - 第一章 解锁RAG
    - [第一节 RAG简介](chapter1/01_RAG_intro.md)
    - [第二节 准备工作](chapter1/02_preparation.md)
  - 第二章 数据准备
    - [第一节 数据加载](chapter2/04_data_load.md)
  `;
  /** chapters 是解析后保持章、节归属的链接条目。 */
  const chapters = parseDocsifySidebar(
    sidebarMarkdown,
    new URL("https://example.com/tutorial/"),
  );

  assert.equal(chapters.length, 3);
  assert.deepEqual(
    chapters.map((chapter) => ({
      title: chapter.title,
      groupTitle: chapter.groupTitle,
      groupOrder: chapter.groupOrder,
      groupItemOrder: chapter.groupItemOrder,
    })),
    [
      { title: "第一节 RAG简介", groupTitle: "第一章 解锁RAG", groupOrder: 1, groupItemOrder: 1 },
      { title: "第二节 准备工作", groupTitle: "第一章 解锁RAG", groupOrder: 1, groupItemOrder: 2 },
      { title: "第一节 数据加载", groupTitle: "第二章 数据准备", groupOrder: 2, groupItemOrder: 1 },
    ],
  );
});

/**
 * 验证 GitHub tree 文档目录会转换为 Raw 读取地址和 GitHub 原文地址。
 */
test("识别 GitHub docs 教程根目录", () => {
  /** normalized 是 Happy-LLM 公共文档目录的标准地址集合。 */
  const normalized = normalizeDocumentationSourceUrl(
    "https://github.com/datawhalechina/happy-llm/tree/main/docs",
  );

  assert.equal(normalized.sourceKind, "github-docs");
  assert.equal(normalized.repository, "happy-llm");
  assert.equal(
    normalized.baseUrl.href,
    "https://raw.githubusercontent.com/datawhalechina/happy-llm/main/docs/",
  );
  assert.equal(
    normalized.publicBaseUrl.href,
    "https://github.com/datawhalechina/happy-llm/blob/main/docs/",
  );
});

/**
 * 验证 README 补充发现只接收正式章级导航，不混入 WIP 专题或外链。
 */
test("从 README 补齐侧栏遗漏的正式章节", () => {
  /** baseUrl 是测试使用的 Raw 教程目录。 */
  const baseUrl = new URL("https://raw.githubusercontent.com/example/course/main/docs/");
  /** publicBaseUrl 是测试使用的 GitHub 浏览目录。 */
  const publicBaseUrl = new URL("https://github.com/example/course/blob/main/docs/");
  /** readmeMarkdown 同时包含正式章节、补充专题和外部链接。 */
  const readmeMarkdown = `
| [第七章 大模型应用](./chapter7/第七章.md) | 正式章节 |
| [第八章 大模型强化学习](./chapter8/第八章.md) | 正式章节 |
[第六章补充专题](./chapter6/WIP.md)
[项目主页](https://example.com)
  `;
  /** chapters 是规则筛选后保留的正式章节。 */
  const chapters = parseReadmeChapterLinks(readmeMarkdown, baseUrl, publicBaseUrl);

  assert.deepEqual(chapters.map((chapter) => chapter.title), [
    "第七章 大模型应用",
    "第八章 大模型强化学习",
  ]);
  assert.equal(
    chapters[1].publicUrl,
    "https://github.com/example/course/blob/main/docs/chapter8/%E7%AC%AC%E5%85%AB%E7%AB%A0.md",
  );
});
