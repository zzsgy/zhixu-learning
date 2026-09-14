import renderMathInElement from "/vendor/katex/contrib/auto-render.mjs";
import { normalizePaperMath } from "./paper-math.js";

// 独立模块避免服务器 HTML 模板和浏览器 JS 两层字符串转义损坏 LaTeX 分隔符。
renderMathInElement(document.body, {
  delimiters: [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
    { left: "$", right: "$", display: false },
  ],
  ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
  preProcess: normalizePaperMath,
  throwOnError: false,
  strict: "ignore",
  trust: false,
});
document.documentElement.dataset.pdfReady = "true";
