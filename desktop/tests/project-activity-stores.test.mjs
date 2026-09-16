import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createActivityDashboardStore } from "../lib/db/stores/activity-dashboard.mjs";
import { createGitHubProjectStore } from "../lib/db/stores/github-projects.mjs";

function createGitHubDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE github_projects (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      repository TEXT NOT NULL,
      full_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      url TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      default_branch TEXT NOT NULL DEFAULT 'main',
      primary_language TEXT NOT NULL DEFAULT 'Unknown',
      languages_json TEXT NOT NULL DEFAULT '{}',
      topics_json TEXT NOT NULL DEFAULT '[]',
      stars INTEGER NOT NULL DEFAULT 0,
      forks INTEGER NOT NULL DEFAULT 0,
      watchers INTEGER NOT NULL DEFAULT 0,
      open_issues INTEGER NOT NULL DEFAULT 0,
      size_kb INTEGER NOT NULL DEFAULT 0,
      license_name TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      pushed_at TEXT,
      latest_release_json TEXT,
      contributors_json TEXT NOT NULL DEFAULT '[]',
      structure_json TEXT NOT NULL DEFAULT '[]',
      tree_truncated INTEGER NOT NULL DEFAULT 0,
      readme_excerpt TEXT NOT NULL DEFAULT '',
      important_files_json TEXT NOT NULL DEFAULT '[]',
      analysis_json TEXT NOT NULL DEFAULT '{}',
      analysis_source TEXT NOT NULL DEFAULT 'local',
      analysis_warning TEXT NOT NULL DEFAULT '',
      analyzed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

function createProject(overrides = {}) {
  return {
    owner: "openai",
    repository: "zhixu",
    fullName: "openai/zhixu",
    url: "https://github.com/openai/zhixu",
    description: "本地知识库",
    defaultBranch: "main",
    primaryLanguage: "JavaScript",
    languages: { JavaScript: 90, CSS: 10 },
    topics: ["knowledge-base"],
    stars: 12,
    forks: 3,
    watchers: 4,
    openIssues: 2,
    sizeKb: 1024,
    licenseName: "MIT",
    archived: false,
    pushedAt: new Date().toISOString(),
    latestRelease: { tagName: "v1.0.0" },
    contributors: [{ login: "tester" }],
    structure: [{ path: "server.mjs" }],
    treeTruncated: false,
    readmeExcerpt: "README",
    importantFiles: [{ path: "package.json" }],
    analysis: { overview: "用于验证独立项目仓储。" },
    analysisSource: "local",
    analysisWarning: "",
    ...overrides,
  };
}

test("GitHub 项目仓储保持保存、更新、详情、轻量列表和统计契约", () => {
  const database = createGitHubDatabase();
  try {
    const store = createGitHubProjectStore(database);
    const created = store.upsertGitHubProject(createProject());
    assert.match(created.id, /^github_project_/);
    assert.equal(created.fullName, "openai/zhixu");
    assert.deepEqual(created.languages, { JavaScript: 90, CSS: 10 });
    assert.deepEqual(created.analysis, { overview: "用于验证独立项目仓储。" });

    const updated = store.upsertGitHubProject(createProject({
      fullName: "OPENAI/ZHIXU",
      stars: 20,
      analysis: { overview: "更新后的项目概览。" },
    }));
    assert.equal(updated.id, created.id);
    assert.equal(updated.stars, 20);
    assert.equal(store.getGitHubProject("missing"), null);
    const summaries = store.listGitHubProjects(null);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].analysisSummary, "更新后的项目概览。");
    const statistics = store.getGitHubProjectStatistics();
    assert.equal(statistics.projectCount, 1);
    assert.equal(statistics.activeProjectCount, 1);
    assert.equal(statistics.totalStars, 20);
    assert.deepEqual(statistics.languageDistribution, [{ name: "JavaScript", count: 1 }]);
    assert.equal(statistics.recentProjects[0].id, created.id);
  } finally {
    database.close();
  }
});

function createActivityDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, display_title TEXT, title TEXT, category TEXT,
      created_at TEXT, original_name TEXT
    );
    CREATE TABLE articles (
      id TEXT PRIMARY KEY, display_title TEXT, title TEXT, category TEXT,
      created_at TEXT, source_type TEXT
    );
    CREATE TABLE papers (
      id TEXT PRIMARY KEY, title_zh TEXT, title TEXT, category TEXT,
      created_at TEXT, source_label TEXT
    );
    CREATE TABLE reading_states (
      target_type TEXT, target_id TEXT, reading_status TEXT,
      progress_percent REAL, updated_at TEXT
    );
    CREATE TABLE reading_sessions (
      id TEXT PRIMARY KEY, target_type TEXT, target_id TEXT, started_at TEXT
    );
    CREATE TABLE reading_session_days (
      session_id TEXT, local_day TEXT, active_seconds INTEGER, updated_at TEXT
    );
    CREATE TABLE folders (
      id TEXT PRIMARY KEY, parent_id TEXT, name TEXT, sort_order INTEGER
    );
    CREATE TABLE content_folders (
      folder_id TEXT, target_type TEXT, target_id TEXT
    );
  `);
  return database;
}

function toLocalDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("学习统计仓储汇总阅读、进度、导入、目录层级和 GitHub 统计", () => {
  const database = createActivityDatabase();
  try {
    const now = new Date().toISOString();
    const localDay = toLocalDateKey(now);
    database.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?)")
      .run("doc-1", "设备手册", "原始文档名", "工作", now, "manual.pdf");
    database.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?)")
      .run("doc-unfiled", "", "待整理文档", "待整理", now, "todo.txt");
    database.prepare("INSERT INTO articles VALUES (?, ?, ?, ?, ?, ?)")
      .run("article-1", "技术文章", "原文章名", "学习", now, "web");
    database.prepare("INSERT INTO papers VALUES (?, ?, ?, ?, ?, ?)")
      .run("paper-1", "中文论文", "English Paper", "论文", now, "手动导入");
    database.prepare("INSERT INTO reading_states VALUES (?, ?, ?, ?, ?)")
      .run("document", "doc-1", "reading", 80, now);
    database.prepare("INSERT INTO reading_sessions VALUES (?, ?, ?, ?)")
      .run("session-1", "document", "doc-1", now);
    database.prepare("INSERT INTO reading_session_days VALUES (?, ?, ?, ?)")
      .run("session-1", localDay, 95, now);
    database.prepare("INSERT INTO folders VALUES (?, ?, ?, ?)")
      .run("root", null, "工作资料", 1);
    database.prepare("INSERT INTO folders VALUES (?, ?, ?, ?)")
      .run("child", "root", "项目", 1);
    database.prepare("INSERT INTO content_folders VALUES (?, ?, ?)")
      .run("root", "document", "doc-1");
    database.prepare("INSERT INTO content_folders VALUES (?, ?, ?)")
      .run("child", "article", "article-1");

    const githubStatistics = { projectCount: 2, totalStars: 30 };
    const store = createActivityDashboardStore(database, {
      getGitHubProjectStatistics: () => githubStatistics,
      toLocalDateKey,
    });
    const dashboard = store.getActivityDashboard(14);
    assert.equal(dashboard.range.days, 14);
    assert.equal(dashboard.readingTrend.length, 14);
    assert.equal(dashboard.summary.totalReadingSeconds, 95);
    assert.equal(dashboard.summary.readItemCount, 1);
    assert.equal(dashboard.summary.activeDays, 1);
    assert.equal(dashboard.summary.newItemCount, 4);
    assert.equal(dashboard.progressDistribution.find((item) => item.key === "almost").count, 1);
    assert.deepEqual(dashboard.githubStatistics, githubStatistics);
    assert.deepEqual(
      [dashboard.libraryComposition.documentCount, dashboard.libraryComposition.articleCount, dashboard.libraryComposition.paperCount],
      [2, 1, 1],
    );
    const root = dashboard.libraryComposition.folders.find((folder) => folder.id === "root");
    const child = dashboard.libraryComposition.folders.find((folder) => folder.id === "child");
    const unfiled = dashboard.libraryComposition.folders.find((folder) => folder.id === "unfiled");
    assert.deepEqual([root.documentCount, root.articleCount, root.itemCount], [1, 1, 2]);
    assert.deepEqual([child.level, child.articleCount], [2, 1]);
    assert.equal(unfiled.documentCount, 1);
    assert.equal(dashboard.recentReading[0].targetId, "doc-1");
    assert.equal(store.getActivityDashboard(999).range.days, 365);
  } finally {
    database.close();
  }
});
