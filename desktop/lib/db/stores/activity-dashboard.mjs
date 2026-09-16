/** 学习活动仪表盘的数据访问。 */

/**
 * 使用共享 SQLite 连接创建学习统计仓储。
 * 日期归档和 GitHub 汇总由兼容门面注入，仓储不创建连接或迁移表结构。
 */
export function createActivityDashboardStore(database, {
  getGitHubProjectStatistics,
  toLocalDateKey,
}) {
  /**
   * 生成连续的本机日期桶，确保没有活动的日期也会在图表中显示为零。
   *
   * @param {Date} startDate 起始日期。
   * @param {number} days 天数。
   * @returns {Array<Record<string, unknown>>} 连续日期桶。
   */
  function createActivityDateBuckets(startDate, days) {
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      return {
        date: toLocalDateKey(date.toISOString()),
        activeSeconds: 0,
        itemIds: new Set(),
        documentCount: 0,
        articleCount: 0,
        paperCount: 0,
      };
    });
  }

  /**
   * 返回学习统计页所需的阅读活动、进度分布和最近入库内容。
   *
   * @param {number} requestedDays 统计区间天数，允许选择最近 1 至 365 天。
   * @returns {Record<string, unknown>} 活动仪表盘数据。
   */
  function getActivityDashboard(requestedDays = 30) {
    const numericDays = Number(requestedDays);
    const days = Number.isFinite(numericDays)
      ? Math.min(365, Math.max(1, Math.round(numericDays)))
      : 30;
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - days + 1);
    const since = startDate.toISOString();
    const until = new Date().toISOString();
    const buckets = createActivityDateBuckets(startDate, days);
    const bucketMap = new Map(buckets.map((bucket) => [bucket.date, bucket]));

    const sessions = database.prepare(`
      SELECT s.target_type,s.target_id,d.local_day,d.active_seconds,d.updated_at AS last_active_at
      FROM reading_session_days d JOIN reading_sessions s ON s.id=d.session_id
      WHERE d.local_day >= ? AND d.local_day <= ?
      ORDER BY d.updated_at DESC
    `).all(toLocalDateKey(startDate), toLocalDateKey(until));
    for (const session of sessions) {
      const bucket = bucketMap.get(session.local_day);
      if (!bucket) continue;
      bucket.activeSeconds += Number(session.active_seconds) || 0;
      bucket.itemIds.add(`${session.target_type}:${session.target_id}`);
    }

    const importRows = database.prepare(`
      SELECT 'document' AS target_type, id AS target_id,
        COALESCE(NULLIF(display_title, ''), title) AS title,
        category, created_at, original_name AS source_label
      FROM documents WHERE created_at >= ?
      UNION ALL
      SELECT 'article', id, COALESCE(NULLIF(display_title, ''), title),
        category, created_at, source_type
      FROM articles WHERE created_at >= ?
      UNION ALL
      SELECT 'paper', id, COALESCE(NULLIF(title_zh, ''), title),
        category, created_at, source_label
      FROM papers WHERE created_at >= ?
      ORDER BY created_at DESC
    `).all(since, since, since);
    const stateRows = database.prepare(`
      SELECT rs.target_type, rs.target_id, rs.reading_status, rs.progress_percent, rs.updated_at,
        CASE rs.target_type
          WHEN 'document' THEN COALESCE(NULLIF(d.display_title, ''), d.title)
          WHEN 'article' THEN COALESCE(NULLIF(a.display_title, ''), a.title)
          WHEN 'paper' THEN COALESCE(NULLIF(p.title_zh, ''), p.title)
        END AS title,
        CASE rs.target_type
          WHEN 'document' THEN d.category
          WHEN 'article' THEN a.category
          WHEN 'paper' THEN p.category
        END AS category
      FROM reading_states rs
      LEFT JOIN documents d ON rs.target_type = 'document' AND rs.target_id = d.id
      LEFT JOIN articles a ON rs.target_type = 'article' AND rs.target_id = a.id
      LEFT JOIN papers p ON rs.target_type = 'paper' AND rs.target_id = p.id
      WHERE d.id IS NOT NULL OR a.id IS NOT NULL OR p.id IS NOT NULL
      ORDER BY rs.updated_at DESC
    `).all();
    for (const row of stateRows) {
      if (row.updated_at < since) continue;
      const bucket = bucketMap.get(toLocalDateKey(row.updated_at));
      bucket?.itemIds.add(`${row.target_type}:${row.target_id}`);
    }
    const sessionTotals = new Map();
    for (const session of sessions) {
      const key = `${session.target_type}:${session.target_id}`;
      const current = sessionTotals.get(key) || { activeSeconds: 0, lastReadAt: session.last_active_at };
      current.activeSeconds += Number(session.active_seconds) || 0;
      if (session.last_active_at > current.lastReadAt) current.lastReadAt = session.last_active_at;
      sessionTotals.set(key, current);
    }
    const recentReading = stateRows
      .filter((row) => row.updated_at >= since || sessionTotals.has(`${row.target_type}:${row.target_id}`))
      .map((row) => {
        const session = sessionTotals.get(`${row.target_type}:${row.target_id}`);
        return {
          targetType: row.target_type,
          targetId: row.target_id,
          title: row.title,
          category: row.category,
          status: row.reading_status,
          progressPercent: Number(row.progress_percent) || 0,
          lastReadAt: session?.lastReadAt > row.updated_at ? session.lastReadAt : row.updated_at,
          activeSeconds: session?.activeSeconds || 0,
        };
      })
      .sort((left, right) => String(right.lastReadAt).localeCompare(String(left.lastReadAt)))
      .slice(0, 12);

    const progressDistribution = { unread: 0, reading: 0, almost: 0, completed: 0 };
    for (const row of stateRows) {
      const progress = Number(row.progress_percent) || 0;
      if (row.reading_status === "completed" || progress >= 95) progressDistribution.completed += 1;
      else if (progress >= 75) progressDistribution.almost += 1;
      else if (progress > 0 || row.reading_status === "reading") progressDistribution.reading += 1;
      else progressDistribution.unread += 1;
    }
    const activeStateItems = new Set(
      stateRows.filter((row) => row.updated_at >= since).map((row) => `${row.target_type}:${row.target_id}`),
    );
    for (const session of sessions) activeStateItems.add(`${session.target_type}:${session.target_id}`);

    /** folderRows 是文档库目录及其直接包含的文档、网页文章数量。 */
    const folderRows = database.prepare(`
      SELECT f.id, f.parent_id, f.name, f.sort_order,
        SUM(CASE WHEN cf.target_type = 'document' THEN 1 ELSE 0 END) AS direct_document_count,
        SUM(CASE WHEN cf.target_type = 'article' THEN 1 ELSE 0 END) AS direct_article_count
      FROM folders f
      LEFT JOIN content_folders cf
        ON cf.folder_id = f.id AND cf.target_type IN ('document', 'article')
      GROUP BY f.id
      ORDER BY f.sort_order ASC, f.name COLLATE NOCASE ASC
    `).all();
    const folderById = new Map(folderRows.map((row) => [row.id, row]));
    const childrenByParent = new Map();
    for (const row of folderRows) {
      const parentKey = row.parent_id || "";
      if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
      childrenByParent.get(parentKey).push(row);
    }
    const folderTotals = new Map();
    /**
     * 递归累计目录及全部后代的文档和网页文章数量。
     *
     * @param {string} folderId 文件夹 ID。
     * @returns {{ documentCount: number, articleCount: number }} 目录子树合计。
     */
    function getFolderTotals(folderId) {
      if (folderTotals.has(folderId)) return folderTotals.get(folderId);
      const row = folderById.get(folderId);
      const total = {
        documentCount: Number(row?.direct_document_count) || 0,
        articleCount: Number(row?.direct_article_count) || 0,
      };
      for (const child of childrenByParent.get(folderId) || []) {
        const childTotal = getFolderTotals(child.id);
        total.documentCount += childTotal.documentCount;
        total.articleCount += childTotal.articleCount;
      }
      folderTotals.set(folderId, total);
      return total;
    }
    /** visibleFolderRows 按一级、二级目录顺序展开；更深层内容计入二级祖先。 */
    const visibleFolderRows = [];
    for (const rootFolder of childrenByParent.get("") || []) {
      const rootTotal = getFolderTotals(rootFolder.id);
      visibleFolderRows.push({
        id: rootFolder.id,
        parentId: null,
        name: rootFolder.name,
        level: 1,
        ...rootTotal,
        itemCount: rootTotal.documentCount + rootTotal.articleCount,
      });
      for (const childFolder of childrenByParent.get(rootFolder.id) || []) {
        const childTotal = getFolderTotals(childFolder.id);
        visibleFolderRows.push({
          id: childFolder.id,
          parentId: rootFolder.id,
          name: childFolder.name,
          level: 2,
          ...childTotal,
          itemCount: childTotal.documentCount + childTotal.articleCount,
        });
      }
    }
    const libraryTotals = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM documents) AS document_count,
        (SELECT COUNT(*) FROM articles) AS article_count,
        (SELECT COUNT(*) FROM papers) AS paper_count,
        (SELECT COUNT(*) FROM documents d
          WHERE NOT EXISTS (
            SELECT 1 FROM content_folders cf
            WHERE cf.target_type = 'document' AND cf.target_id = d.id
          )) AS unfiled_document_count,
        (SELECT COUNT(*) FROM articles a
          WHERE NOT EXISTS (
            SELECT 1 FROM content_folders cf
            WHERE cf.target_type = 'article' AND cf.target_id = a.id
          )) AS unfiled_article_count
    `).get();
    const unfiledDocumentCount = Number(libraryTotals.unfiled_document_count) || 0;
    const unfiledArticleCount = Number(libraryTotals.unfiled_article_count) || 0;
    if (unfiledDocumentCount + unfiledArticleCount > 0) {
      visibleFolderRows.push({
        id: "unfiled",
        parentId: null,
        name: "未归档",
        level: 1,
        documentCount: unfiledDocumentCount,
        articleCount: unfiledArticleCount,
        itemCount: unfiledDocumentCount + unfiledArticleCount,
      });
    }

    const trackingRow = database.prepare("SELECT MIN(started_at) AS started_at FROM reading_sessions").get();
    return {
      range: { days, since, until },
      trackingStartedAt: trackingRow?.started_at || null,
      summary: {
        totalReadingSeconds: sessions.reduce((sum, session) => sum + (Number(session.active_seconds) || 0), 0),
        readItemCount: activeStateItems.size,
        activeDays: buckets.filter((bucket) => bucket.itemIds.size > 0).length,
        newItemCount: importRows.length,
      },
      readingTrend: buckets.map((bucket) => ({
        date: bucket.date,
        activeSeconds: bucket.activeSeconds,
        itemCount: bucket.itemIds.size,
      })),
      libraryComposition: {
        documentCount: Number(libraryTotals.document_count) || 0,
        articleCount: Number(libraryTotals.article_count) || 0,
        paperCount: Number(libraryTotals.paper_count) || 0,
        folders: visibleFolderRows,
      },
      githubStatistics: getGitHubProjectStatistics(),
      progressDistribution: [
        { key: "unread", label: "未开始", count: progressDistribution.unread },
        { key: "reading", label: "阅读中", count: progressDistribution.reading },
        { key: "almost", label: "接近完成", count: progressDistribution.almost },
        { key: "completed", label: "已完成", count: progressDistribution.completed },
      ],
      recentReading,
      recentImports: importRows.slice(0, 12).map((item) => ({
        targetType: item.target_type,
        targetId: item.target_id,
        title: item.title,
        category: item.category,
        createdAt: item.created_at,
        sourceLabel: item.source_label,
      })),
    };
  }

  return Object.freeze({ getActivityDashboard });
}
