/** GitHub 项目档案与统计的数据访问。 */
import crypto from "node:crypto";

/** 使用进程内共享 SQLite 连接创建 GitHub 项目仓储。 */
export function createGitHubProjectStore(database) {
  /** 安全读取 SQLite 中保存的 JSON 字段。 */
  function parseStoredJson(value, fallback) {
    try {
      return JSON.parse(String(value || ""));
    } catch {
      return fallback;
    }
  }

  /** 将 GitHub 项目数据库行转换为浏览器字段。 */
  function mapGitHubProjectRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      owner: row.owner,
      repository: row.repository,
      fullName: row.full_name,
      url: row.url,
      description: row.description,
      defaultBranch: row.default_branch,
      primaryLanguage: row.primary_language,
      languages: parseStoredJson(row.languages_json, {}),
      topics: parseStoredJson(row.topics_json, []),
      stars: Number(row.stars) || 0,
      forks: Number(row.forks) || 0,
      watchers: Number(row.watchers) || 0,
      openIssues: Number(row.open_issues) || 0,
      sizeKb: Number(row.size_kb) || 0,
      licenseName: row.license_name,
      archived: Boolean(row.archived),
      pushedAt: row.pushed_at,
      latestRelease: parseStoredJson(row.latest_release_json, null),
      contributors: parseStoredJson(row.contributors_json, []),
      structure: parseStoredJson(row.structure_json, []),
      treeTruncated: Boolean(row.tree_truncated),
      readmeExcerpt: row.readme_excerpt,
      importantFiles: parseStoredJson(row.important_files_json, []),
      analysis: parseStoredJson(row.analysis_json, {}),
      analysisSource: row.analysis_source,
      analysisWarning: row.analysis_warning,
      analyzedAt: row.analyzed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** 将 GitHub 项目数据库行转换为左侧索引需要的轻量摘要。 */
  function mapGitHubProjectSummaryRow(row) {
    if (!row) return null;
    const analysis = parseStoredJson(row.analysis_json, {});
    return {
      id: row.id,
      fullName: row.full_name,
      url: row.url,
      description: row.description,
      analysisSummary: String(analysis.overview || ""),
      primaryLanguage: row.primary_language,
      stars: Number(row.stars) || 0,
      forks: Number(row.forks) || 0,
      archived: Boolean(row.archived),
      pushedAt: row.pushed_at,
      analysisSource: row.analysis_source,
      analyzedAt: row.analyzed_at,
      updatedAt: row.updated_at,
    };
  }

  /** 保存或刷新一个 GitHub 项目分析档案。 */
  function upsertGitHubProject(project) {
    const fullName = String(project.fullName || "").trim();
    if (!fullName) throw new Error("GitHub 项目名称不能为空。");
    const existing = database.prepare("SELECT id, created_at FROM github_projects WHERE full_name = ? COLLATE NOCASE").get(fullName);
    const now = new Date().toISOString();
    const projectId = existing?.id || `github_project_${crypto.randomUUID()}`;
    database.prepare(`
      INSERT INTO github_projects(
        id, owner, repository, full_name, url, description, default_branch,
        primary_language, languages_json, topics_json, stars, forks, watchers,
        open_issues, size_kb, license_name, archived, pushed_at,
        latest_release_json, contributors_json, structure_json, tree_truncated,
        readme_excerpt, important_files_json, analysis_json, analysis_source,
        analysis_warning, analyzed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(full_name) DO UPDATE SET
        owner = excluded.owner,
        repository = excluded.repository,
        url = excluded.url,
        description = excluded.description,
        default_branch = excluded.default_branch,
        primary_language = excluded.primary_language,
        languages_json = excluded.languages_json,
        topics_json = excluded.topics_json,
        stars = excluded.stars,
        forks = excluded.forks,
        watchers = excluded.watchers,
        open_issues = excluded.open_issues,
        size_kb = excluded.size_kb,
        license_name = excluded.license_name,
        archived = excluded.archived,
        pushed_at = excluded.pushed_at,
        latest_release_json = excluded.latest_release_json,
        contributors_json = excluded.contributors_json,
        structure_json = excluded.structure_json,
        tree_truncated = excluded.tree_truncated,
        readme_excerpt = excluded.readme_excerpt,
        important_files_json = excluded.important_files_json,
        analysis_json = excluded.analysis_json,
        analysis_source = excluded.analysis_source,
        analysis_warning = excluded.analysis_warning,
        analyzed_at = excluded.analyzed_at,
        updated_at = excluded.updated_at
    `).run(
      projectId,
      String(project.owner || ""),
      String(project.repository || ""),
      fullName,
      String(project.url || ""),
      String(project.description || "").slice(0, 4000),
      String(project.defaultBranch || "main"),
      String(project.primaryLanguage || "Unknown"),
      JSON.stringify(project.languages || {}),
      JSON.stringify(project.topics || []),
      Number(project.stars) || 0,
      Number(project.forks) || 0,
      Number(project.watchers) || 0,
      Number(project.openIssues) || 0,
      Number(project.sizeKb) || 0,
      String(project.licenseName || ""),
      project.archived ? 1 : 0,
      project.pushedAt || null,
      project.latestRelease ? JSON.stringify(project.latestRelease) : null,
      JSON.stringify(project.contributors || []),
      JSON.stringify(project.structure || []),
      project.treeTruncated ? 1 : 0,
      String(project.readmeExcerpt || "").slice(0, 100_000),
      JSON.stringify(project.importantFiles || []),
      JSON.stringify(project.analysis || {}),
      String(project.analysisSource || "local"),
      String(project.analysisWarning || "").slice(0, 2000),
      now,
      existing?.created_at || now,
      now,
    );
    return getGitHubProject(projectId);
  }

  /** 读取一个 GitHub 项目分析档案。 */
  function getGitHubProject(projectId) {
    return mapGitHubProjectRow(
      database.prepare("SELECT * FROM github_projects WHERE id = ? LIMIT 1").get(projectId),
    );
  }

  /** 按最近分析时间返回 GitHub 项目档案。 */
  function listGitHubProjects(limit = 100) {
    // null 用于完整的轻量导航索引；其它调用保留原有上限。
    const safeLimit = limit === null ? -1 : Math.min(500, Math.max(1, Number(limit) || 100));
    return database.prepare(`
      SELECT id, full_name, url, description, primary_language, stars, forks,
        archived, pushed_at, analysis_json, analysis_source, analyzed_at, updated_at
      FROM github_projects
      ORDER BY analyzed_at DESC
      LIMIT ?
    `).all(safeLimit).map(mapGitHubProjectSummaryRow);
  }

  /** 返回统计首页使用的 GitHub 项目数量、活跃度与主要语言。 */
  function getGitHubProjectStatistics() {
    const rows = database.prepare(`
      SELECT id, full_name, primary_language, languages_json, stars, forks,
        pushed_at, analyzed_at, analysis_source
      FROM github_projects ORDER BY analyzed_at DESC
    `).all();
    const languageCounts = new Map();
    let totalStars = 0;
    let totalForks = 0;
    const activeThreshold = new Date();
    activeThreshold.setDate(activeThreshold.getDate() - 90);
    let activeProjectCount = 0;
    for (const row of rows) {
      totalStars += Number(row.stars) || 0;
      totalForks += Number(row.forks) || 0;
      if (row.pushed_at && new Date(row.pushed_at) >= activeThreshold) activeProjectCount += 1;
      const languages = parseStoredJson(row.languages_json, {});
      const names = Object.keys(languages);
      const primaryLanguage = row.primary_language && row.primary_language !== "Unknown"
        ? row.primary_language
        : names[0] || "未知";
      languageCounts.set(primaryLanguage, (languageCounts.get(primaryLanguage) || 0) + 1);
    }
    return {
      projectCount: rows.length,
      activeProjectCount,
      totalStars,
      totalForks,
      languageDistribution: [...languageCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
        .slice(0, 8),
      recentProjects: rows.slice(0, 5).map((row) => ({
        id: row.id,
        fullName: row.full_name,
        primaryLanguage: row.primary_language,
        stars: Number(row.stars) || 0,
        pushedAt: row.pushed_at,
        analyzedAt: row.analyzed_at,
        analysisSource: row.analysis_source,
      })),
    };
  }

  return Object.freeze({
    getGitHubProject,
    getGitHubProjectStatistics,
    listGitHubProjects,
    upsertGitHubProject,
  });
}
