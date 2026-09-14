/**
 * arXiv 的 xcolor RGB 写法不是 KaTeX 语法。只在渲染时转换已验证的
 * 0–1 RGB 三元组，不改动数据库原文，也不吞掉不合法的颜色值。
 */
export function normalizePaperMath(formula) {
  return formula.replace(
    /\\color\s*\[rgb\]\s*\{\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\}/g,
    (original, red, green, blue) => {
      const channels = [red, green, blue].map(Number);
      if (channels.some((channel) => channel < 0 || channel > 1)) return original;
      const hex = channels.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("");
      return `\\color{#${hex}}`;
    },
  );
}
