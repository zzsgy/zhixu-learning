/**
 * 主题初始化脚本。
 * 在首屏渲染前以阻塞方式执行，根据 localStorage 或系统偏好设置
 * html[data-theme]，避免页面加载时出现明暗闪烁。
 * 站点 Content-Security-Policy 禁止内联脚本，因此必须放在外部文件中。
 */
(function () {
  /** savedTheme 是用户手动选择过的主题，键名 zhixu-theme。 */
  var savedTheme = null;
  try {
    savedTheme = window.localStorage.getItem("zhixu-theme");
  } catch (error) {}
  /** prefersDark 表示操作系统当前是否处于深色外观。 */
  var prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme =
    savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : prefersDark
        ? "dark"
        : "light";
})();
