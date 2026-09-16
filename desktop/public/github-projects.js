import { getProjectPage } from "./project-index.js";

/**
 * 挂载 GitHub 项目研读模块。
 *
 * 项目索引、报告缓存、筛选分页和分析表单均封装在模块内部；主应用只负责
 * 页面切换，以及在分析完成后刷新学习统计。
 */
export function mountGitHubProjects({
  document,
  request,
  notify = () => {},
  formatDate,
  onProjectAnalyzed = () => {},
}) {
  const elements = {
    form: document.querySelector("#github-project-form"),
    url: document.querySelector("#github-project-url"),
    analyzeButton: document.querySelector("#github-analyze-button"),
    analysisStatus: document.querySelector("#github-analysis-status"),
    count: document.querySelector("#github-project-count"),
    list: document.querySelector("#github-project-list"),
    search: document.querySelector("#github-project-search"),
    sort: document.querySelector("#github-project-sort"),
    pageLabel: document.querySelector("#github-project-page-label"),
    previous: document.querySelector("#github-project-previous"),
    next: document.querySelector("#github-project-next"),
    results: document.querySelector("#github-project-results"),
    detail: document.querySelector("#github-project-detail"),
  };
  const state = {
    projects: [],
    query: "",
    sort: "recent",
    page: 1,
    details: new Map(),
    activeProjectId: "",
    analysisInProgress: false,
  };

  const createTextElement = (tagName, className, textContent) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = textContent;
    return element;
  };

  /** 统一更新研读表单的状态文字。 */
  const setAnalysisStatus = (message, isError = false) => {
    elements.analysisStatus.textContent = message;
    elements.analysisStatus.classList.toggle("is-error", isError);
  };

  /** 创建项目报告内的标题段。 */
  const createReportSection = (eyebrow, title) => {
    const section = document.createElement("section");
    section.className = "github-report-section";
    const header = document.createElement("header");
    header.append(
      createTextElement("span", "", eyebrow),
      createTextElement("h3", "", title),
    );
    section.append(header);
    return section;
  };

  /** 在项目报告中渲染一组带依据的模块或技术条目。 */
  const appendDetailCards = (section, items) => {
    const grid = document.createElement("div");
    grid.className = "github-detail-card-grid";
    for (const item of Array.isArray(items) ? items : []) {
      const card = document.createElement("article");
      card.append(
        createTextElement("h4", "", item.name || "未命名条目"),
        createTextElement("p", "", item.detail || "暂无说明。"),
      );
      if (item.evidence) card.append(createTextElement("small", "", `依据：${item.evidence}`));
      grid.append(card);
    }
    if (!grid.childElementCount) {
      grid.append(createTextElement("p", "github-report-missing", "现有仓库证据不足，暂未形成可靠判断。"));
    }
    section.append(grid);
  };

  /** 在项目报告中渲染有顺序的研读要点。 */
  const appendTextList = (section, items, ordered = false) => {
    const list = document.createElement(ordered ? "ol" : "ul");
    list.className = "github-report-list";
    for (const item of Array.isArray(items) ? items : []) {
      list.append(createTextElement("li", "", item));
    }
    if (!list.childElementCount) {
      list.append(createTextElement("li", "is-muted", "现有仓库证据不足，暂未形成可靠判断。"));
    }
    section.append(list);
  };

  /** 渲染一份完整的 GitHub 项目研读报告。 */
  const renderProjectDetail = (project) => {
    elements.detail.replaceChildren();
    const analysis = project.analysis || {};
    const header = document.createElement("header");
    header.className = "github-detail-header";
    const titleGroup = document.createElement("div");
    titleGroup.append(
      createTextElement("p", "eyebrow", "项目技术档案"),
      createTextElement("h2", "", project.fullName || "未命名项目"),
      createTextElement("p", "", analysis.positioning || analysis.overview || project.description || "这个仓库没有填写项目说明。"),
    );
    const sourceLink = document.createElement("a");
    sourceLink.className = "secondary-button github-source-link";
    sourceLink.href = project.url;
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer";
    sourceLink.textContent = "打开 GitHub ↗";
    header.append(titleGroup, sourceLink);

    const topics = document.createElement("div");
    topics.className = "github-topic-list";
    for (const topic of project.topics || []) topics.append(createTextElement("span", "", topic));
    if (project.archived) topics.append(createTextElement("span", "is-archived", "已归档"));

    const metrics = document.createElement("div");
    metrics.className = "github-detail-metrics";
    for (const [label, value] of [
      ["STAR 数", Number(project.stars) || 0],
      ["派生项目", Number(project.forks) || 0],
      ["未关闭问题", Number(project.openIssues) || 0],
      ["主要语言", project.primaryLanguage || "未知"],
      ["开源许可", project.licenseName || "未声明"],
      ["最近更新", project.pushedAt ? formatDate(project.pushedAt) : "未知"],
    ]) {
      const item = document.createElement("span");
      item.append(createTextElement("small", "", label), createTextElement("strong", "", String(value)));
      metrics.append(item);
    }

    const provenance = document.createElement("div");
    provenance.className = "github-analysis-provenance";
    provenance.append(
      createTextElement("strong", "", project.analysisSource === "deepseek" ? "DeepSeek 深度研读" : "本地规则概览"),
      createTextElement("span", "", `分析于 ${project.analyzedAt ? formatDate(project.analyzedAt) : "刚刚"} · 默认分支 ${project.defaultBranch || "未知"}`),
    );
    if (project.analysisWarning) provenance.append(createTextElement("p", "", project.analysisWarning));

    const overview = createReportSection("01 / 项目总览", "项目定位与整体判断");
    overview.append(
      createTextElement("p", "github-report-lead", analysis.overview || "暂无整体概览。"),
      createTextElement("p", "", analysis.positioning || "暂无定位说明。"),
    );
    const architecture = createReportSection("02 / 整体架构", "架构与代码组织");
    architecture.append(createTextElement("p", "github-report-lead", analysis.architecture || "现有仓库证据不足，暂时无法判断整体架构。"));
    const structureNames = [...new Set((project.structure || []).map((item) => String(item.path || "").split("/")[0]).filter(Boolean))].slice(0, 14);
    if (structureNames.length) {
      const structure = document.createElement("div");
      structure.className = "github-structure-tags";
      structure.append(...structureNames.map((name) => createTextElement("code", "", name)));
      architecture.append(structure);
    }
    const modules = createReportSection("03 / 核心模块", "核心模块与职责");
    appendDetailCards(modules, analysis.coreModules);
    const stack = createReportSection("04 / 技术栈", "技术栈与使用目的");
    appendDetailCards(stack, analysis.technologyStack);
    const flow = createReportSection("05 / 执行流程", "关键执行链路");
    appendTextList(flow, analysis.executionFlow, true);

    const judgmentGrid = document.createElement("div");
    judgmentGrid.className = "github-judgment-grid";
    const strengths = createReportSection("06 / 设计优势", "值得关注的设计");
    appendTextList(strengths, analysis.strengths);
    const risks = createReportSection("07 / 风险边界", "局限、风险与待核验点");
    appendTextList(risks, analysis.risks);
    judgmentGrid.append(strengths, risks);

    const learningGrid = document.createElement("div");
    learningGrid.className = "github-learning-grid";
    const start = createReportSection("08 / 上手路线", "建议上手顺序");
    appendTextList(start, analysis.gettingStarted, true);
    const learning = createReportSection("09 / 学习建议", "学习与借鉴建议");
    appendTextList(learning, analysis.learningSuggestions);
    learningGrid.append(start, learning);

    const evidence = document.createElement("footer");
    evidence.className = "github-report-evidence";
    const evidenceText = [
      `${(project.structure || []).length} 个目录树条目`,
      `${(project.importantFiles || []).length} 个关键配置文件`,
      `${(project.contributors || []).length} 位主要贡献者`,
    ];
    if (project.treeTruncated) evidenceText.push("GitHub 返回的目录树已截断");
    evidence.append(
      createTextElement("strong", "", "本次分析证据"),
      createTextElement("span", "", evidenceText.join(" · ")),
    );

    elements.detail.append(
      header,
      topics,
      metrics,
      provenance,
      overview,
      architecture,
      modules,
      stack,
      flow,
      judgmentGrid,
      learningGrid,
      evidence,
    );
  };

  /** 渲染左侧轻量档案索引。 */
  const renderProjectList = () => {
    elements.list.replaceChildren();
    const result = getProjectPage(state.projects, {
      query: state.query,
      sort: state.sort,
      page: state.page,
    });
    state.page = result.page;
    elements.pageLabel.textContent = `${result.page} / ${result.pages}`;
    elements.previous.disabled = result.page === 1;
    elements.next.disabled = result.page === result.pages;
    elements.results.textContent = state.query.trim()
      ? `找到 ${result.total} 个项目 · 每页 10 项`
      : `共 ${result.total} 个项目 · 每页 10 项`;
    elements.count.textContent = String(state.projects.length);
    if (!result.total) {
      const empty = document.createElement("div");
      empty.className = "github-project-list-empty";
      empty.append(
        createTextElement("strong", "", state.projects.length ? "没有匹配的项目" : "尚无项目档案"),
        createTextElement("p", "", state.projects.length ? "试试项目名、组织名或简介关键词；清空搜索可查看全部。" : "提交第一个公开仓库，开始建立项目档案。"),
      );
      elements.list.append(empty);
      return;
    }
    for (const project of result.items) {
      const button = document.createElement("button");
      button.className = "github-project-index-item";
      button.classList.toggle("is-active", project.id === state.activeProjectId);
      button.type = "button";
      button.setAttribute("aria-current", project.id === state.activeProjectId ? "true" : "false");
      button.title = `${project.fullName}\n${project.analysisSummary || project.description || ""}`;
      button.addEventListener("click", () => void open(project.id));
      const heading = document.createElement("span");
      heading.className = "github-project-index-heading";
      heading.append(
        createTextElement("strong", "", project.fullName || "未命名项目"),
        createTextElement("small", "", `${project.primaryLanguage || "语言未知"} · ★ ${Number(project.stars) || 0}`),
      );
      const description = createTextElement(
        "span",
        "github-project-index-description",
        project.analysisSummary || project.description || "这个仓库没有填写项目说明。",
      );
      const footer = document.createElement("span");
      footer.className = "github-project-index-footer";
      footer.append(
        createTextElement("small", "", project.analysisSource === "deepseek" ? "AI 深度分析" : "本地概览"),
        createTextElement("time", "", project.analyzedAt ? formatDate(project.analyzedAt) : "刚刚"),
      );
      button.append(heading, description, footer);
      elements.list.append(button);
    }
  };

  /** 打开一份项目档案，并在需要时读取完整报告。 */
  async function open(projectId) {
    state.activeProjectId = projectId;
    renderProjectList();
    let project = state.details.get(projectId);
    if (!project) {
      elements.detail.replaceChildren(createTextElement("p", "github-project-loading", "正在打开项目档案……"));
      const payload = await request(`/api/github-projects/${encodeURIComponent(projectId)}`);
      project = payload.project;
      state.details.set(projectId, project);
    }
    if (state.activeProjectId === projectId) renderProjectDetail(project);
  }

  /** 加载已有项目档案，并自动选中最近一次研读。 */
  async function load(options = {}) {
    const payload = await request("/api/github-projects");
    state.projects = Array.isArray(payload.projects) ? payload.projects : [];
    if (options.selectId) {
      state.query = "";
      state.sort = "recent";
      state.page = 1;
      elements.search.value = "";
      for (const option of elements.sort.options) option.selected = option.value === "recent";
    }
    const requestedId = options.selectId || state.activeProjectId;
    const selectedId = state.projects.some((project) => project.id === requestedId)
      ? requestedId
      : state.projects[0]?.id || "";
    state.activeProjectId = selectedId;
    renderProjectList();
    if (selectedId) {
      await open(selectedId);
      return;
    }
    elements.detail.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "github-project-empty";
    empty.append(
      createTextElement("span", "", "GH"),
      createTextElement("h3", "", "从一个值得拆解的项目开始"),
      createTextElement("p", "", "粘贴仓库主页链接。完成后，这里会呈现项目画像、代码结构、关键模块、运行链路、优势风险与建议学习路径。"),
    );
    elements.detail.append(empty);
  }

  /** 提交一个公开 GitHub 仓库并等待本地服务完成研读。 */
  async function analyze() {
    if (state.analysisInProgress) return;
    const url = elements.url.value.trim();
    if (!url) return;
    state.analysisInProgress = true;
    elements.analyzeButton.disabled = true;
    elements.analyzeButton.textContent = "研读中…";
    setAnalysisStatus("正在读取仓库元数据、README、目录树和关键配置，并形成中文研读报告……");
    try {
      const payload = await request("/api/github-projects/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const project = payload.project;
      state.details.set(project.id, project);
      state.activeProjectId = project.id;
      elements.url.value = "";
      setAnalysisStatus(`${project.fullName} 已完成研读，并保存到本机项目档案。`);
      await load({ selectId: project.id });
      void Promise.resolve(onProjectAnalyzed(project)).catch(() => {});
    } catch (error) {
      setAnalysisStatus(error.message, true);
      notify(error.message);
    } finally {
      state.analysisInProgress = false;
      elements.analyzeButton.disabled = false;
      elements.analyzeButton.textContent = "深度研读";
    }
  }

  /** 让统计首页先指定项目，再由页面切换触发统一加载。 */
  const select = (projectId) => {
    state.activeProjectId = projectId || "";
  };

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    state.page = 1;
    renderProjectList();
    elements.list.scrollTop = 0;
  });
  elements.sort.addEventListener("change", () => {
    state.sort = elements.sort.value;
    state.page = 1;
    renderProjectList();
    elements.list.scrollTop = 0;
  });
  for (const [button, delta] of [[elements.previous, -1], [elements.next, 1]]) {
    button.addEventListener("click", () => {
      state.page += delta;
      renderProjectList();
      elements.list.scrollTop = 0;
    });
  }
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void analyze();
  });

  return { analyze, load, open, select };
}
