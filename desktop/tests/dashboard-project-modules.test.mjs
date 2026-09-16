import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountActivityDashboard } from "../public/activity-dashboard.js";
import { mountGitHubProjects } from "../public/github-projects.js";

const pageHtml = fs.readFileSync(path.resolve(import.meta.dirname, "../public/index.html"), "utf8");
const formatDate = () => "2026/09/16";

const makeProject = (id, overrides = {}) => ({
  id,
  fullName: `openai/project-${id}`,
  url: `https://github.com/openai/project-${id}`,
  description: "模块化示例项目",
  analysisSummary: "用于验证项目研读模块",
  primaryLanguage: "JavaScript",
  stars: Number(id) || 1,
  forks: 2,
  openIssues: 3,
  licenseName: "MIT",
  analyzedAt: "2026-09-16T08:00:00.000Z",
  pushedAt: "2026-09-15T08:00:00.000Z",
  defaultBranch: "main",
  analysisSource: "local",
  topics: ["knowledge-base"],
  structure: [{ path: "public/app.js" }],
  importantFiles: [{ path: "package.json" }],
  contributors: [{ login: "tester" }],
  analysis: {
    overview: "项目总览",
    positioning: "本地知识库",
    architecture: "浏览器与本地服务分层",
    coreModules: [{ name: "前端", detail: "负责交互", evidence: "public" }],
    technologyStack: [{ name: "Node.js", detail: "本地服务" }],
    executionFlow: ["加载", "渲染"],
    strengths: ["本地优先"],
    risks: ["需要备份"],
    gettingStarted: ["阅读入口"],
    learningSuggestions: ["先看数据流"],
  },
  ...overrides,
});

test("学习统计模块独立加载、切换目录层级并转交打开动作", async () => {
  const { document, window } = parseHTML(pageHtml);
  const requestUrls = [];
  const openedContent = [];
  const openedGithub = [];
  const dashboard = {
    summary: { totalReadingSeconds: 3660, readItemCount: 2, activeDays: 1, newItemCount: 3 },
    trackingStartedAt: "2026-09-16T08:00:00.000Z",
    range: { days: 30 },
    readingTrend: [
      { date: "2026-09-15", activeSeconds: 0 },
      { date: "2026-09-16", activeSeconds: 1800 },
    ],
    progressDistribution: [
      { label: "未开始", count: 1 },
      { label: "阅读中", count: 1 },
    ],
    libraryComposition: {
      documentCount: 2,
      articleCount: 1,
      paperCount: 1,
      folders: [
        { id: "folder-1", name: "工作", level: 1, documentCount: 1, articleCount: 0, paperCount: 0, itemCount: 1 },
        { id: "folder-2", name: "项目", level: 2, documentCount: 1, articleCount: 1, paperCount: 0, itemCount: 2 },
      ],
    },
    githubStatistics: {
      projectCount: 1,
      activeProjectCount: 1,
      totalStars: 10,
      totalForks: 2,
      languageDistribution: [{ name: "JavaScript", count: 1 }],
      recentProjects: [{ id: "1", fullName: "openai/project-1", primaryLanguage: "JavaScript", stars: 10, analyzedAt: "2026-09-16T08:00:00.000Z" }],
    },
    recentReading: [{ targetType: "document", targetId: "doc-1", title: "操作手册", category: "工作", progressPercent: 60, activeSeconds: 600, lastReadAt: "2026-09-16T08:00:00.000Z" }],
    recentImports: [{ targetType: "article", targetId: "article-1", title: "技术文章", category: "学习", createdAt: "2026-09-16T08:00:00.000Z", sourceLabel: "网页导入" }],
  };
  const activity = mountActivityDashboard({
    document,
    request: async (url) => {
      requestUrls.push(url);
      return { dashboard: { ...dashboard, range: { days: Number(new URL(`http://local${url}`).searchParams.get("days")) } } };
    },
    formatDate,
    formatReadingDuration: (seconds) => `${seconds} 秒`,
    openContent: (type, id) => openedContent.push([type, id]),
    openGithub: (id) => openedGithub.push(id),
  });

  await activity.load();
  assert.equal(document.querySelector("#activity-reading-time").textContent, "3660 秒");
  assert.equal(document.querySelector("#activity-library-chart .is-level-2"), null);
  assert.match(document.querySelector("#activity-github-statistics").textContent, /openai\/project-1/);
  document.querySelector("#activity-secondary-toggle").click();
  assert.ok(document.querySelector("#activity-library-chart .is-level-2"));
  assert.equal(document.querySelector("#activity-secondary-toggle").textContent, "收起二级");
  document.querySelector("#activity-recent-reading button").click();
  document.querySelector("#activity-github-statistics .activity-github-recent button").click();
  assert.deepEqual(openedContent, [["document", "doc-1"]]);
  assert.deepEqual(openedGithub, ["1"]);

  const days = document.querySelector("#activity-range-days");
  days.value = "999";
  document.querySelector("#activity-range-form").dispatchEvent(new window.Event("submit"));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(requestUrls.at(-1), "/api/activity-dashboard?days=365");
});

test("GitHub 研读模块独立管理索引、详情、筛选和分析回调", async () => {
  const { document, window } = parseHTML(pageHtml);
  let projects = Array.from({ length: 11 }, (_, index) => makeProject(String(index + 1)));
  const requests = [];
  const notifications = [];
  const analyzedProjects = [];
  const github = mountGitHubProjects({
    document,
    request: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === "/api/github-projects/analyze") {
        const project = makeProject("new", { fullName: "openai/new-project", stars: 99 });
        projects = [project, ...projects];
        return { project };
      }
      if (url === "/api/github-projects") return { projects };
      const id = decodeURIComponent(url.split("/").at(-1));
      return { project: projects.find((project) => project.id === id) };
    },
    notify: (message) => notifications.push(message),
    formatDate,
    onProjectAnalyzed: (project) => analyzedProjects.push(project.id),
  });

  await github.load();
  assert.equal(document.querySelector("#github-project-count").textContent, "11");
  assert.equal(document.querySelectorAll("#github-project-list .github-project-index-item").length, 10);
  assert.match(document.querySelector("#github-project-detail h2").textContent, /openai\/project-/);
  assert.equal(document.querySelector("#github-project-next").disabled, false);
  document.querySelector("#github-project-next").click();
  assert.equal(document.querySelectorAll("#github-project-list .github-project-index-item").length, 1);

  const search = document.querySelector("#github-project-search");
  search.value = "project-3";
  search.dispatchEvent(new window.Event("input"));
  assert.equal(document.querySelectorAll("#github-project-list .github-project-index-item").length, 1);
  assert.match(document.querySelector("#github-project-results").textContent, /找到 1 个项目/);

  document.querySelector("#github-project-url").value = "https://github.com/openai/new-project";
  await github.analyze();
  assert.deepEqual(notifications, []);
  assert.deepEqual(analyzedProjects, ["new"]);
  assert.equal(document.querySelector("#github-project-url").value, "");
  assert.equal(document.querySelector("#github-project-detail h2").textContent, "openai/new-project");
  assert.equal(requests.some((entry) => entry.url === "/api/github-projects/analyze" && entry.options.method === "POST"), true);
});
