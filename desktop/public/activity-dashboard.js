/**
 * 挂载学习与资料统计首页。
 *
 * 时间范围、二级目录展开状态、图表 DOM 和交互都封装在模块内部；打开具体
 * 资料或 GitHub 项目时，通过回调交还给主应用协调。
 */
export function mountActivityDashboard({
  document,
  request,
  formatDate,
  formatReadingDuration,
  openContent,
  openGithub,
  notify = () => {},
}) {
  const elements = {
    trackingNote: document.querySelector("#activity-tracking-note"),
    rangeForm: document.querySelector("#activity-range-form"),
    rangeDaysInput: document.querySelector("#activity-range-days"),
    secondaryToggle: document.querySelector("#activity-secondary-toggle"),
    readingTime: document.querySelector("#activity-reading-time"),
    readItems: document.querySelector("#activity-read-items"),
    activeDays: document.querySelector("#activity-active-days"),
    newItems: document.querySelector("#activity-new-items"),
    readingChart: document.querySelector("#activity-reading-chart"),
    progressChart: document.querySelector("#activity-progress-chart"),
    libraryChart: document.querySelector("#activity-library-chart"),
    githubStatistics: document.querySelector("#activity-github-statistics"),
    recentReading: document.querySelector("#activity-recent-reading"),
    recentImports: document.querySelector("#activity-recent-imports"),
  };
  const state = {
    dashboard: null,
    rangeDays: 30,
    showSecondaryFolders: false,
  };

  const createTextElement = (tagName, className, textContent) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = textContent;
    return element;
  };
  const getTypeLabel = (targetType) => (
    { document: "文档", article: "网页文章", paper: "论文" }[targetType] || "资料"
  );
  const createSvgElement = (name, attributes = {}) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };

  /** 渲染阅读活跃度折线图。 */
  const renderReadingActivityChart = (points) => {
    elements.readingChart.replaceChildren();
    const width = 760;
    const height = 272;
    const padding = { top: 24, right: 24, bottom: 64, left: 48 };
    const values = points.map((point) => (Number(point.activeSeconds) || 0) / 60);
    const observedMaximum = Math.max(0, ...values);
    const maximum = Math.max(5, observedMaximum);
    const svg = createSvgElement("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" });
    for (let index = 0; index <= 4; index += 1) {
      const y = padding.top + ((height - padding.top - padding.bottom) * index) / 4;
      svg.append(createSvgElement("line", { x1: padding.left, x2: width - padding.right, y1: y, y2: y, class: "activity-grid-line" }));
      const label = createSvgElement("text", { x: padding.left - 10, y: y + 4, class: "activity-axis-label", "text-anchor": "end" });
      label.textContent = String(Math.round(maximum * (1 - index / 4)));
      svg.append(label);
    }
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const coordinates = values.map((value, index) => ({
      x: padding.left + (chartWidth * index) / Math.max(1, values.length - 1),
      y: padding.top + chartHeight * (1 - value / maximum),
    }));
    const area = createSvgElement("path", {
      d: coordinates.length ? `M ${coordinates[0].x} ${padding.top + chartHeight} L ${coordinates.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${coordinates.at(-1).x} ${padding.top + chartHeight} Z` : "",
      class: "activity-line-area",
    });
    const line = createSvgElement("polyline", {
      points: coordinates.map((point) => `${point.x},${point.y}`).join(" "),
      class: "activity-line-path",
    });
    svg.append(area, line);
    const labelStep = points.length <= 31 ? 1 : Math.ceil(points.length / 31);
    const labelIndexes = new Set(
      points.map((_, index) => index).filter((index) => index % labelStep === 0),
    );
    if (points.length) labelIndexes.add(points.length - 1);
    const chartBottom = padding.top + chartHeight;
    for (const index of labelIndexes) {
      if (!points[index]) continue;
      const x = coordinates[index].x;
      svg.append(createSvgElement("line", {
        x1: x,
        x2: x,
        y1: chartBottom,
        y2: chartBottom + 4,
        class: "activity-axis-tick",
      }));
      const y = chartBottom + 11;
      const label = createSvgElement("text", {
        x,
        y,
        class: "activity-axis-label activity-axis-day-label",
        "text-anchor": points.length > 14 ? "end" : index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
        transform: points.length > 14 ? `rotate(-55 ${x} ${y})` : "",
      });
      label.textContent = points[index].date.slice(5).replace("-", "/");
      svg.append(label);
    }
    elements.readingChart.append(svg);
    elements.readingChart.setAttribute("aria-label", `阅读活跃度折线图，最高单日 ${Math.round(observedMaximum)} 分钟`);
  };

  /** 渲染当前阅读进度的环形分布图和图例。 */
  const renderProgressDistribution = (items) => {
    elements.progressChart.replaceChildren();
    const total = items.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const chart = document.createElement("div");
    chart.className = "activity-donut";
    const colors = ["var(--line-dark)", "var(--blue)", "var(--amber)", "var(--cyan-strong)"];
    let cursor = 0;
    const segments = items.map((item, index) => {
      const start = cursor;
      cursor += total ? (Number(item.count) / total) * 360 : 0;
      return `${colors[index]} ${start}deg ${cursor}deg`;
    });
    chart.style.background = total ? `conic-gradient(${segments.join(",")})` : "var(--line)";
    const center = document.createElement("span");
    center.append(
      createTextElement("strong", "", String(total)),
      createTextElement("small", "", "有进度记录"),
    );
    chart.append(center);
    const legend = document.createElement("div");
    legend.className = "activity-legend";
    items.forEach((item, index) => {
      const row = document.createElement("div");
      const marker = document.createElement("i");
      marker.style.background = colors[index];
      row.append(marker, createTextElement("span", "", item.label), createTextElement("strong", "", String(item.count)));
      legend.append(row);
    });
    elements.progressChart.append(chart, legend);
  };

  /** 渲染以文件夹为横轴、内容数量为纵轴的堆叠柱状图。 */
  const renderLibraryComposition = (composition) => {
    elements.libraryChart.replaceChildren();
    const folders = Array.isArray(composition?.folders) ? composition.folders : [];
    const visibleFolders = folders.filter(
      (folder) => Number(folder.level) === 1 || state.showSecondaryFolders,
    );
    const maximum = Math.max(1, Number(composition?.paperCount) || 0, ...visibleFolders.map((folder) => Number(folder.itemCount) || 0));
    const firstLevelCount = folders.filter((folder) => Number(folder.level) === 1).length;
    const secondLevelCount = folders.filter((folder) => Number(folder.level) === 2).length;

    const summary = document.createElement("div");
    summary.className = "activity-library-summary";
    for (const [label, value] of [
      ["文档", composition?.documentCount],
      ["网页文章", composition?.articleCount],
      ["论文", composition?.paperCount],
    ]) {
      const item = document.createElement("span");
      item.append(createTextElement("small", "", label), createTextElement("strong", "", String(Number(value) || 0)));
      summary.append(item);
    }

    const legend = document.createElement("div");
    legend.className = "activity-library-legend";
    for (const [className, label] of [["is-document", "文档"], ["is-article", "网页文章"], ["is-paper", "论文"]]) {
      const item = document.createElement("span");
      const marker = document.createElement("i");
      marker.className = className;
      item.append(marker, label);
      legend.append(item);
    }
    legend.append(createTextElement("small", "", `${firstLevelCount} 个一级目录${state.showSecondaryFolders ? ` · 已展开 ${secondLevelCount} 个二级目录` : " · 二级目录已收起"}`));

    const plot = document.createElement("div");
    plot.className = "activity-library-plot";
    const scale = document.createElement("div");
    scale.className = "activity-library-scale";
    for (const ratio of [1, 0.75, 0.5, 0.25, 0]) {
      const tick = document.createElement("span");
      tick.style.bottom = `${ratio * 100}%`;
      tick.textContent = String(Math.round(maximum * ratio));
      scale.append(tick);
    }
    const columns = document.createElement("div");
    columns.className = "activity-library-columns";
    const chartItems = [{
      id: "paper-library",
      name: "论文库",
      level: 0,
      documentCount: 0,
      articleCount: 0,
      paperCount: Number(composition?.paperCount) || 0,
      itemCount: Number(composition?.paperCount) || 0,
    }, ...visibleFolders];
    columns.classList.toggle("is-expanded", state.showSecondaryFolders);
    columns.style.setProperty("--activity-library-column-count", String(chartItems.length));
    const createLibraryColumn = (item) => {
      const column = document.createElement("div");
      column.className = `activity-library-column is-level-${Number(item.level) || 0}`;
      column.title = `${item.name}：${Number(item.itemCount) || 0}`;
      const value = createTextElement("strong", "activity-library-value", String(Number(item.itemCount) || 0));
      const track = document.createElement("span");
      track.className = "activity-library-track";
      for (const [key, className] of [["documentCount", "is-document"], ["articleCount", "is-article"], ["paperCount", "is-paper"]]) {
        const count = Number(item[key]) || 0;
        if (!count) continue;
        const segment = document.createElement("i");
        segment.className = className;
        segment.style.height = `${(count / maximum) * 100}%`;
        track.append(segment);
      }
      const label = document.createElement("span");
      label.className = "activity-library-label";
      label.append(createTextElement("small", "", item.level === 2 ? "二级" : item.level === 1 ? "一级" : "论文"));
      label.append(createTextElement("strong", "", item.name));
      column.append(value, track, label);
      return column;
    };
    if (state.showSecondaryFolders) {
      const groups = [];
      for (const item of chartItems) {
        if (Number(item.level) !== 2 || groups.length === 0) {
          groups.push({ name: item.name, level: Number(item.level) || 0, items: [item] });
        } else {
          groups.at(-1).items.push(item);
        }
      }
      groups.forEach((group, groupIndex) => {
        const groupElement = document.createElement("div");
        groupElement.className = `activity-library-group is-group-${groupIndex % 2 ? "even" : "odd"}`;
        groupElement.style.setProperty("--activity-library-group-count", String(group.items.length));
        group.items.forEach((item) => groupElement.append(createLibraryColumn(item)));
        groupElement.append(createTextElement(
          "span",
          "activity-library-group-label",
          group.level === 0 ? "论文库 · 独立统计" : group.name,
        ));
        columns.append(groupElement);
      });
    } else {
      chartItems.forEach((item) => columns.append(createLibraryColumn(item)));
    }
    plot.append(scale, columns);
    elements.libraryChart.append(summary, legend, plot);
    elements.libraryChart.setAttribute(
      "aria-label",
      `资料库内容统计：${composition?.documentCount || 0} 份文档，${composition?.articleCount || 0} 篇网页文章，${composition?.paperCount || 0} 篇论文，${firstLevelCount} 个一级目录，${secondLevelCount} 个二级目录。`,
    );
    elements.secondaryToggle.textContent = state.showSecondaryFolders ? "收起二级" : "展开二级";
    elements.secondaryToggle.setAttribute("aria-pressed", String(state.showSecondaryFolders));
  };

  /** 渲染 GitHub 收藏规模、语言分布与最近项目。 */
  const renderGitHubStatistics = (statistics) => {
    elements.githubStatistics.replaceChildren();
    const projectCount = Number(statistics?.projectCount) || 0;
    if (!projectCount) {
      const empty = document.createElement("div");
      empty.className = "activity-github-empty";
      const copy = document.createElement("div");
      copy.append(
        createTextElement("strong", "", "还没有 GitHub 项目档案"),
        createTextElement("p", "", "研读一个公开仓库后，这里会展示收藏规模、项目活跃度与技术语言分布。"),
      );
      const button = createTextElement("button", "secondary-button", "开始项目研读");
      button.type = "button";
      button.addEventListener("click", () => openGithub(""));
      empty.append(copy, button);
      elements.githubStatistics.append(empty);
      return;
    }

    const summary = document.createElement("div");
    summary.className = "activity-github-summary";
    for (const [label, value, note] of [
      ["PROJECTS", projectCount, "项目档案"],
      ["ACTIVE 90D", Number(statistics.activeProjectCount) || 0, "近 90 天仍更新"],
      ["TOTAL STARS", Number(statistics.totalStars) || 0, "累计关注"],
      ["TOTAL FORKS", Number(statistics.totalForks) || 0, "累计分支"],
    ]) {
      const item = document.createElement("span");
      item.append(
        createTextElement("small", "", label),
        createTextElement("strong", "", String(value)),
        createTextElement("em", "", note),
      );
      summary.append(item);
    }

    const body = document.createElement("div");
    body.className = "activity-github-body";
    const languagePanel = document.createElement("section");
    languagePanel.className = "activity-language-panel";
    languagePanel.append(createTextElement("h4", "", "主要技术语言"));
    const languages = Array.isArray(statistics.languageDistribution) ? statistics.languageDistribution : [];
    const maximum = Math.max(1, ...languages.map((item) => Number(item.count) || 0));
    const languageRows = document.createElement("div");
    languageRows.className = "activity-language-rows";
    for (const item of languages) {
      const row = document.createElement("div");
      row.append(createTextElement("span", "", item.name || "未知"));
      const track = document.createElement("i");
      const fill = document.createElement("b");
      fill.style.width = `${((Number(item.count) || 0) / maximum) * 100}%`;
      track.append(fill);
      row.append(track, createTextElement("strong", "", String(Number(item.count) || 0)));
      languageRows.append(row);
    }
    languagePanel.append(languageRows);

    const recentPanel = document.createElement("section");
    recentPanel.className = "activity-github-recent";
    recentPanel.append(createTextElement("h4", "", "最近研读"));
    const recentList = document.createElement("div");
    for (const project of statistics.recentProjects || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => openGithub(project.id));
      const copy = document.createElement("span");
      copy.append(
        createTextElement("strong", "", project.fullName || "未命名项目"),
        createTextElement("small", "", `${project.primaryLanguage || "语言未知"} · ${project.analyzedAt ? formatDate(project.analyzedAt) : "刚刚"}`),
      );
      button.append(copy, createTextElement("em", "", `★ ${Number(project.stars) || 0}`));
      recentList.append(button);
    }
    recentPanel.append(recentList);
    body.append(languagePanel, recentPanel);
    elements.githubStatistics.append(summary, body);
  };

  /** 渲染最近阅读或最近入库的可操作列表。 */
  const renderActivityList = (container, items, mode) => {
    container.replaceChildren();
    if (!items.length) {
      container.append(createTextElement("p", "activity-empty", mode === "reading" ? "这个时间范围内还没有阅读记录。" : "这个时间范围内还没有新增资料。"));
      return;
    }
    for (const item of items) {
      const button = document.createElement("button");
      button.className = "activity-list-item";
      button.type = "button";
      button.addEventListener("click", () => openContent(item.targetType, item.targetId));
      const main = document.createElement("span");
      main.className = "activity-list-main";
      main.append(createTextElement("strong", "", item.title || "未命名资料"));
      main.append(createTextElement("small", "", `${getTypeLabel(item.targetType)} · ${item.category || "未分类"}`));
      const detail = document.createElement("span");
      detail.className = "activity-list-detail";
      if (mode === "reading") {
        detail.append(createTextElement("strong", "", `${Math.round(Number(item.progressPercent) || 0)}%`));
        detail.append(createTextElement("small", "", item.activeSeconds ? formatReadingDuration(item.activeSeconds) : formatDate(item.lastReadAt)));
      } else {
        detail.append(createTextElement("strong", "", formatDate(item.createdAt)));
        detail.append(createTextElement("small", "", item.sourceLabel || "本地导入"));
      }
      button.append(main, detail);
      container.append(button);
    }
  };

  /** 加载并渲染学习与资料活动仪表盘。 */
  async function load() {
    const payload = await request(`/api/activity-dashboard?days=${state.rangeDays}`);
    const dashboard = payload.dashboard;
    state.dashboard = dashboard;
    elements.readingTime.textContent = formatReadingDuration(dashboard.summary.totalReadingSeconds);
    elements.readItems.textContent = String(dashboard.summary.readItemCount);
    elements.activeDays.textContent = String(dashboard.summary.activeDays);
    elements.newItems.textContent = String(dashboard.summary.newItemCount);
    elements.trackingNote.textContent = dashboard.trackingStartedAt
      ? `阅读时长从 ${formatDate(dashboard.trackingStartedAt)} 起按可见页面与活跃交互精确记录；此前仅展示阅读进度。`
      : "阅读时长将从下一次打开正文开始，按可见页面与活跃交互精确记录；既有进度仍会正常展示。";
    elements.rangeDaysInput.value = String(dashboard.range.days);
    renderReadingActivityChart(dashboard.readingTrend);
    renderProgressDistribution(dashboard.progressDistribution);
    renderLibraryComposition(dashboard.libraryComposition);
    renderGitHubStatistics(dashboard.githubStatistics);
    renderActivityList(elements.recentReading, dashboard.recentReading, "reading");
    renderActivityList(elements.recentImports, dashboard.recentImports, "imports");
  }

  elements.rangeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const requestedDays = Math.round(Number(elements.rangeDaysInput.value));
    state.rangeDays = Number.isFinite(requestedDays)
      ? Math.min(365, Math.max(1, requestedDays))
      : 30;
    elements.rangeDaysInput.value = String(state.rangeDays);
    void load().catch((error) => notify(error.message));
  });
  elements.secondaryToggle.addEventListener("click", () => {
    state.showSecondaryFolders = !state.showSecondaryFolders;
    renderLibraryComposition(state.dashboard?.libraryComposition);
  });

  return { load, renderLibraryComposition };
}
