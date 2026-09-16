import { parseHTML } from "linkedom";

const wordTags = new Set([
  "p", "div", "h1", "h2", "h3", "blockquote", "ul", "ol", "li", "pre", "code",
  "strong", "b", "em", "i", "u", "s", "span", "br", "a",
]);
const wordBlockTags = new Set(["p", "div", "h1", "h2", "h3", "blockquote", "li", "pre"]);
const droppedTags = new Set(["script", "style", "noscript", "iframe", "object", "embed", "svg", "math", "form"]);
const wordAlignments = new Set(["left", "center", "right", "justify"]);
const readingNoteTags = new Set([
  "p", "div", "section", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
  "ul", "ol", "li", "pre", "code", "strong", "b", "em", "i", "u", "s", "mark",
  "small", "sub", "sup", "span", "font", "br", "hr", "a", "img", "figure", "figcaption",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col",
  "details", "summary",
]);
const readingNoteDroppedTags = new Set([
  "script", "style", "noscript", "iframe", "object", "embed", "svg", "math", "form",
  "input", "button", "textarea", "select", "option", "template", "link", "meta", "base",
  "audio", "video", "source", "canvas",
]);
const readingNoteStyleProperties = new Set([
  "color", "background-color", "font-family", "font-size", "font-weight", "font-style",
  "text-decoration", "text-decoration-line", "text-align", "line-height", "letter-spacing",
  "text-indent", "white-space", "vertical-align", "margin", "margin-top", "margin-right",
  "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom",
  "padding-left", "border", "border-width", "border-style", "border-color", "border-top",
  "border-right", "border-bottom", "border-left", "border-collapse", "border-spacing", "width",
  "min-width", "max-width", "height", "max-height", "list-style-type",
]);

function safeLink(value) {
  const href = String(value || "").trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href.slice(0, 2000) : "";
}

function safeBlockFormat(element, tag) {
  if (!wordBlockTags.has(tag)) return {};
  const style = String(element.getAttribute("style") || "");
  const requestedAlignment = String(
    element.getAttribute("data-align")
      || element.getAttribute("align")
      || style.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\b/i)?.[1]
      || "",
  ).toLowerCase();
  const alignment = wordAlignments.has(requestedAlignment) ? requestedAlignment : "";
  const explicitIndent = element.hasAttribute("data-indent")
    ? Number(element.getAttribute("data-indent"))
    : Number.NaN;
  const margin = style.match(/(?:^|;)\s*margin-left\s*:\s*(\d+(?:\.\d+)?)\s*(px|em)\b/i);
  const marginLevel = margin
    ? Math.round(Number(margin[1]) / (margin[2].toLowerCase() === "em" ? 2 : 40))
    : 0;
  const indent = Math.max(0, Math.min(4, Number.isFinite(explicitIndent) ? Math.round(explicitIndent) : marginLevel));
  return { alignment, indent };
}

function safeReadingNoteStyle(value) {
  const declarations = [];
  for (const declaration of String(value || "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const cssValue = declaration.slice(separator + 1).trim();
    if (!readingNoteStyleProperties.has(property) || !cssValue || cssValue.length > 240) continue;
    if (/[{}<>\x00-\x1f]/.test(cssValue) || /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i.test(cssValue)) continue;
    declarations.push(`${property}: ${cssValue}`);
  }
  return declarations.join("; ");
}

function safeReadingNoteImage(value) {
  const source = String(value || "").trim();
  if (/^\/api\/[a-z0-9_./%?=&+-]+$/i.test(source)) return source.slice(0, 4000);
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(source)) return source;
  try {
    const url = new URL(source);
    if (["127.0.0.1", "localhost"].includes(url.hostname.toLowerCase()) && url.pathname.startsWith("/api/")) {
      return `${url.pathname}${url.search}`.slice(0, 4000);
    }
  } catch {}
  return "";
}

function boundedInteger(value, maximum = 100) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? String(Math.min(maximum, number)) : "";
}

function safeFontFace(value) {
  const face = String(value || "").trim();
  return face && face.length <= 200 && /^[\p{L}\p{N}\s,"'._-]+$/u.test(face) ? face : "";
}

function safeFontColor(value) {
  const color = String(value || "").trim();
  return /^(?:#[0-9a-f]{3,8}|[a-z]{1,30}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%a-z]+\))$/i.test(color) ? color : "";
}

/** 清洗阅读工作台粘贴的富文本，同时保留常见字体、图片、表格和文档结构。 */
export function sanitizeReadingNoteHtml(value) {
  const { document } = parseHTML(`<main>${String(value || "")}</main>`);
  const root = document.querySelector("main");
  if (!root) return "";
  for (const element of [...root.querySelectorAll("*")].reverse()) {
    const tag = element.tagName.toLowerCase();
    if (!readingNoteTags.has(tag)) {
      if (readingNoteDroppedTags.has(tag)) element.remove();
      else element.replaceWith(...element.childNodes);
      continue;
    }
    const attributes = {
      style: safeReadingNoteStyle(element.getAttribute("style")),
      href: tag === "a" ? safeLink(element.getAttribute("href")) : "",
      src: tag === "img" ? safeReadingNoteImage(element.getAttribute("src")) : "",
      alt: tag === "img" ? String(element.getAttribute("alt") || "").slice(0, 500) : "",
      title: ["a", "img"].includes(tag) ? String(element.getAttribute("title") || "").slice(0, 500) : "",
      width: ["img", "table", "col", "th", "td"].includes(tag) ? boundedInteger(element.getAttribute("width"), 4000) : "",
      height: tag === "img" ? boundedInteger(element.getAttribute("height"), 4000) : "",
      colspan: ["th", "td"].includes(tag) ? boundedInteger(element.getAttribute("colspan"), 50) : "",
      rowspan: ["th", "td"].includes(tag) ? boundedInteger(element.getAttribute("rowspan"), 100) : "",
      face: tag === "font" ? safeFontFace(element.getAttribute("face")) : "",
      color: tag === "font" ? safeFontColor(element.getAttribute("color")) : "",
      size: tag === "font" ? boundedInteger(element.getAttribute("size"), 7) : "",
    };
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    if (attributes.style) element.setAttribute("style", attributes.style);
    if (tag === "a" && attributes.href) {
      element.setAttribute("href", attributes.href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "img") {
      if (!attributes.src) {
        element.replaceWith(document.createTextNode(attributes.alt || "[图片已移除]"));
        continue;
      }
      element.setAttribute("src", attributes.src);
      element.setAttribute("loading", "lazy");
      if (attributes.alt) element.setAttribute("alt", attributes.alt);
      if (attributes.title) element.setAttribute("title", attributes.title);
    }
    for (const name of ["width", "height", "colspan", "rowspan"]) {
      if (attributes[name]) element.setAttribute(name, attributes[name]);
    }
    for (const name of ["face", "color", "size"]) {
      if (attributes[name]) element.setAttribute(name, attributes[name]);
    }
  }
  const html = root.innerHTML;
  if (Buffer.byteLength(html, "utf8") > 8_000_000) throw new TypeError("富文本笔记过大，请减少粘贴图片的数量或尺寸。");
  return html;
}

/** 从阅读富文本生成搜索、整理和卡片摘要使用的纯文本。 */
export function readingNotePlainText(html) {
  const withBreaks = String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|h[1-6]|blockquote|li|pre|tr|caption|figcaption|summary)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t");
  const { document } = parseHTML(`<main>${withBreaks}</main>`);
  const root = document.querySelector("main");
  for (const image of root?.querySelectorAll("img") || []) {
    const alt = String(image.getAttribute("alt") || "").trim();
    image.replaceWith(document.createTextNode(`[图片${alt ? `：${alt}` : ""}]`));
  }
  return String(root?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 100_000);
}

/** 清洗 Word 风格编辑器产生的 HTML，只保留离线笔记需要的语义标签。 */
export function sanitizeWordNoteHtml(value) {
  const { document } = parseHTML(`<main>${String(value || "")}</main>`);
  const root = document.querySelector("main");
  if (!root) return "";
  for (const element of [...root.querySelectorAll("*")].reverse()) {
    const tag = element.tagName.toLowerCase();
    if (!wordTags.has(tag)) {
      if (droppedTags.has(tag)) element.remove();
      else element.replaceWith(document.createTextNode(element.textContent || ""));
      continue;
    }
    const blockFormat = safeBlockFormat(element, tag);
    const originalHref = tag === "a" ? element.getAttribute("href") : "";
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    if (blockFormat.alignment) element.setAttribute("data-align", blockFormat.alignment);
    if (blockFormat.indent) element.setAttribute("data-indent", String(blockFormat.indent));
    if (tag === "a") {
      const href = safeLink(originalHref);
      if (href) element.setAttribute("href", href);
    }
  }
  return root.innerHTML.slice(0, 2_000_000);
}

/** 从安全富文本生成搜索与定时整理所需的纯文本。 */
export function wordNotePlainText(html) {
  const withBreaks = String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-3]|blockquote|li|pre)>/gi, "\n");
  const { document } = parseHTML(`<main>${withBreaks}</main>`);
  return String(document.querySelector("main")?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2_000_000);
}

/** 规范化三种编辑器提交的数据；富文本必须在服务端再次清洗。 */
export function normalizeStandaloneNoteContent(noteType, payload = {}) {
  if (noteType === "word") {
    const html = sanitizeWordNoteHtml(payload.contentData?.html || "");
    return { contentText: wordNotePlainText(html), contentData: { html } };
  }
  return {
    contentText: String(payload.contentText || "").slice(0, 2_000_000),
    contentData: {},
  };
}
