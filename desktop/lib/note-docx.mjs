import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import { parseHTML } from "linkedom";
import { sanitizeWordNoteHtml } from "./note-content.mjs";

const blockTags = new Set(["p", "div", "h1", "h2", "h3", "blockquote", "li", "pre"]);
const alignmentMap = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

function inlineRuns(node, style = {}) {
  if (node.nodeType === 3) return [new TextRun({ text: node.textContent || "", ...style })];
  if (node.nodeType !== 1) return [];
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return [new TextRun({ break: 1 })];
  const next = { ...style };
  if (["strong", "b"].includes(tag)) next.bold = true;
  if (["em", "i"].includes(tag)) next.italics = true;
  if (tag === "u") next.underline = {};
  if (tag === "s") next.strike = true;
  if (tag === "code") next.font = "Consolas";
  return [...node.childNodes].flatMap((child) => inlineRuns(child, next));
}

function paragraphFor(element, { listType = "", listLevel = 0 } = {}) {
  const tag = element.tagName.toLowerCase();
  const inlineChildren = [...element.childNodes].filter((child) => (
    child.nodeType !== 1 || !["ul", "ol"].includes(child.tagName.toLowerCase())
  ));
  const options = { children: inlineChildren.flatMap((child) => inlineRuns(child)) };
  if (tag === "h1") options.heading = HeadingLevel.HEADING_1;
  if (tag === "h2") options.heading = HeadingLevel.HEADING_2;
  if (tag === "h3") options.heading = HeadingLevel.HEADING_3;
  if (tag === "li" && listType === "ol") options.numbering = { reference: "notes-numbering", level: listLevel };
  if (tag === "li" && listType !== "ol") options.bullet = { level: listLevel };
  const alignment = alignmentMap[element.getAttribute("data-align")];
  if (alignment) options.alignment = alignment;
  const indentLevel = Math.max(0, Math.min(4, Number(element.getAttribute("data-indent")) || 0));
  const leftIndent = (tag === "blockquote" ? 720 : 0) + indentLevel * 360;
  if (leftIndent) options.indent = { left: leftIndent };
  if (tag === "pre") options.style = "No Spacing";
  return new Paragraph(options);
}

function appendListParagraphs(paragraphs, list, level = 0) {
  const listType = list.tagName.toLowerCase();
  for (const item of [...list.children].filter((child) => child.tagName.toLowerCase() === "li")) {
    paragraphs.push(paragraphFor(item, { listType, listLevel: Math.min(level, 4) }));
    for (const nested of [...item.children].filter((child) => ["ul", "ol"].includes(child.tagName.toLowerCase()))) {
      appendListParagraphs(paragraphs, nested, level + 1);
    }
  }
}

/** 把本地 Word 风格笔记导出为真正的 Office Open XML .docx。 */
export async function createWordNoteDocument({ title, html }) {
  const safeHtml = sanitizeWordNoteHtml(html);
  const { document } = parseHTML(`<main>${safeHtml}</main>`);
  const root = document.querySelector("main");
  const paragraphs = [new Paragraph({ text: String(title || "未命名 Word 笔记"), heading: HeadingLevel.TITLE })];
  for (const child of [...(root?.childNodes || [])]) {
    if (child.nodeType === 3 && String(child.textContent || "").trim()) {
      paragraphs.push(new Paragraph({ children: inlineRuns(child) }));
    } else if (child.nodeType === 1) {
      const tag = child.tagName.toLowerCase();
      if (["ul", "ol"].includes(tag)) {
        appendListParagraphs(paragraphs, child);
      } else if (blockTags.has(tag)) {
        paragraphs.push(paragraphFor(child));
      } else {
        paragraphs.push(new Paragraph({ children: inlineRuns(child) }));
      }
    }
  }
  if (paragraphs.length === 1) paragraphs.push(new Paragraph(""));
  const docx = new Document({
    creator: "知序",
    title: String(title || "未命名 Word 笔记"),
    description: "由知序本地笔记库导出",
    numbering: {
      config: [{
        reference: "notes-numbering",
        levels: Array.from({ length: 5 }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
        })),
      }],
    },
    sections: [{ properties: {}, children: paragraphs }],
  });
  return Packer.toBuffer(docx);
}
