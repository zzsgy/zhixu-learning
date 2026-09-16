/** 阅读状态、会话和高亮批注的数据访问。 */
import crypto from "node:crypto";
import { readingNotePlainText, sanitizeReadingNoteHtml } from "../../note-content.mjs";
import { localReadingDay, recordReadingDayIncrement } from "../../reading-session-days.mjs";

/** 使用进程内共享 SQLite 连接创建阅读仓储。 */
export function createReadingStore(database, {
  currentTimestamp = () => new Date().toISOString(),
  toLocalDateKey = localReadingDay,
} = {}) {
  /** 阅读工作台允许访问的内容类型与数据表映射。 */
  const readingTargetTables = Object.freeze({
    document: "documents",
    article: "articles",
    paper: "papers",
  });
  const readingStatuses = new Set(["unread", "reading", "completed"]);
  const annotationColors = new Set(["yellow", "green", "blue", "red"]);

  /** 确认阅读目标类型有效，并返回对应的固定表名。 */
  function getReadingTargetTable(targetType) {
    const targetTable = readingTargetTables[targetType];
    if (!targetTable) throw new Error("不支持的阅读内容类型。");
    return targetTable;
  }

  /** 检查阅读目标是否仍存在于本地知识库。 */
  function readingTargetExists(targetType, targetId) {
    const targetTable = getReadingTargetTable(targetType);
    const targetRow = database
      .prepare(`SELECT id FROM ${targetTable} WHERE id = ? LIMIT 1`)
      .get(targetId);
    return Boolean(targetRow);
  }

  /** 将阅读状态数据库行转换为浏览器字段。 */
  function mapReadingStateRow(row) {
    return {
      status: row?.reading_status ?? "unread",
      progressPercent: Number(row?.progress_percent ?? 0),
      noteText: row?.note_text ?? "",
      noteHtml: row?.note_html ?? "",
      updatedAt: row?.updated_at ?? null,
    };
  }

  /** 将高亮批注数据库行转换为浏览器字段。 */
  function mapReadingAnnotationRow(row) {
    return {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      quoteText: row.quote_text,
      anchorStart: Number(row.anchor_start),
      anchorEnd: Number(row.anchor_end),
      color: row.color,
      noteText: row.note_text,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** 读取某项内容的进度、笔记和全部高亮批注。 */
  function getReadingWorkspace(targetType, targetId) {
    if (!readingTargetExists(targetType, targetId)) return null;
    const stateRow = database
      .prepare(`
        SELECT reading_status, progress_percent, note_text, note_html, updated_at
        FROM reading_states
        WHERE target_type = ? AND target_id = ?
        LIMIT 1
      `)
      .get(targetType, targetId);
    const annotationRows = database
      .prepare(`
        SELECT * FROM reading_annotations
        WHERE target_type = ? AND target_id = ?
        ORDER BY anchor_start, created_at
      `)
      .all(targetType, targetId);
    return {
      targetType,
      targetId,
      state: mapReadingStateRow(stateRow),
      annotations: annotationRows.map(mapReadingAnnotationRow),
    };
  }

  /** 新增或更新某项内容的阅读进度、状态和个人笔记。 */
  function updateReadingState(targetType, targetId, changes) {
    if (!readingTargetExists(targetType, targetId)) return null;
    const existingRow = database
      .prepare(`
        SELECT reading_status, progress_percent, note_text, note_html, updated_at
        FROM reading_states
        WHERE target_type = ? AND target_id = ?
        LIMIT 1
      `)
      .get(targetType, targetId);
    const existingState = mapReadingStateRow(existingRow);
    const requestedStatus = String(changes.status ?? existingState.status);
    if (!readingStatuses.has(requestedStatus)) throw new Error("阅读状态无效。");
    const requestedProgress = Math.min(
      100,
      Math.max(0, Number(changes.progressPercent ?? existingState.progressPercent) || 0),
    );
    const hasRichNote = changes.noteHtml !== undefined;
    const hasLegacyTextNote = !hasRichNote && changes.noteText !== undefined;
    const requestedNoteHtml = hasRichNote
      ? sanitizeReadingNoteHtml(changes.noteHtml)
      : hasLegacyTextNote ? "" : existingState.noteHtml;
    const requestedNoteText = hasRichNote
      ? readingNotePlainText(requestedNoteHtml)
      : String(changes.noteText ?? existingState.noteText).slice(0, 100000);
    const updatedAt = currentTimestamp();
    database
      .prepare(`
        INSERT INTO reading_states(
          target_type, target_id, reading_status, progress_percent, note_text, note_html, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_type, target_id) DO UPDATE SET
          reading_status = excluded.reading_status,
          progress_percent = excluded.progress_percent,
          note_text = excluded.note_text,
          note_html = excluded.note_html,
          updated_at = excluded.updated_at
      `)
      .run(
        targetType,
        targetId,
        requestedStatus,
        requestedProgress,
        requestedNoteText,
        requestedNoteHtml,
        updatedAt,
      );
    return mapReadingStateRow({
      reading_status: requestedStatus,
      progress_percent: requestedProgress,
      note_text: requestedNoteText,
      note_html: requestedNoteHtml,
      updated_at: updatedAt,
    });
  }

  /** 创建一次阅读会话。会话时长由浏览器按活跃阅读时间累计提交。 */
  function startReadingSession(targetType, targetId, progressPercent = 0) {
    if (!readingTargetExists(targetType, targetId)) return null;
    const now = currentTimestamp();
    const normalizedProgress = Math.min(100, Math.max(0, Number(progressPercent) || 0));
    const session = {
      id: `reading_session_${crypto.randomUUID()}`,
      targetType,
      targetId,
      startedAt: now,
      lastActiveAt: now,
      endedAt: null,
      activeSeconds: 0,
      progressStart: normalizedProgress,
      progressEnd: normalizedProgress,
    };
    database.prepare(`
      INSERT INTO reading_sessions(
        id, target_type, target_id, started_at, last_active_at, ended_at,
        active_seconds, progress_start, progress_end
      ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)
    `).run(
      session.id,
      targetType,
      targetId,
      now,
      now,
      normalizedProgress,
      normalizedProgress,
    );
    database.prepare(`INSERT INTO reading_session_days(session_id,local_day,active_seconds,updated_at)
      VALUES (?,?,0,?)`).run(session.id, toLocalDateKey(now), now);
    return session;
  }

  /** 幂等更新阅读会话。浏览器提交累计秒数，重复请求不会重复计时。 */
  function updateReadingSession(sessionId, changes = {}) {
    const existing = database.prepare("SELECT * FROM reading_sessions WHERE id = ? LIMIT 1").get(sessionId);
    if (!existing) return null;
    const activeSeconds = Math.min(
      24 * 60 * 60,
      Math.max(Number(existing.active_seconds) || 0, Math.floor(Number(changes.activeSeconds) || 0)),
    );
    const progressEnd = Math.min(
      100,
      Math.max(0, Number(changes.progressPercent ?? existing.progress_end) || 0),
    );
    const now = currentTimestamp();
    const endedAt = changes.ended ? (existing.ended_at || now) : existing.ended_at;
    database.exec("BEGIN IMMEDIATE;");
    try {
      recordReadingDayIncrement(database, {
        sessionId,
        startedAt: existing.started_at,
        previousSeconds: Number(existing.active_seconds) || 0,
        activeSeconds,
        activeSecondsByDay: changes.activeSecondsByDay,
        now,
      });
      database.prepare(`
        UPDATE reading_sessions
        SET last_active_at = ?, ended_at = ?, active_seconds = ?, progress_end = ?
        WHERE id = ?
      `).run(now, endedAt, activeSeconds, progressEnd, sessionId);
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
    return {
      id: existing.id,
      targetType: existing.target_type,
      targetId: existing.target_id,
      startedAt: existing.started_at,
      lastActiveAt: now,
      endedAt,
      activeSeconds,
      progressStart: Number(existing.progress_start) || 0,
      progressEnd,
    };
  }

  /** 为选中的原文片段创建本地高亮批注。 */
  function createReadingAnnotation(targetType, targetId, annotation) {
    if (!readingTargetExists(targetType, targetId)) return null;
    const quoteText = String(annotation.quoteText ?? "").trim().slice(0, 8000);
    const anchorStart = Math.max(0, Math.trunc(Number(annotation.anchorStart) || 0));
    const anchorEnd = Math.max(anchorStart, Math.trunc(Number(annotation.anchorEnd) || 0));
    const color = String(annotation.color ?? "yellow");
    if (!quoteText || anchorEnd <= anchorStart) throw new Error("请选择有效的原文内容。");
    if (!annotationColors.has(color)) throw new Error("高亮颜色无效。");
    const noteText = String(annotation.noteText ?? "").slice(0, 20000);
    const annotationId = `annotation_${crypto.randomUUID()}`;
    const now = currentTimestamp();
    database
      .prepare(`
        INSERT INTO reading_annotations(
          id, target_type, target_id, quote_text, anchor_start, anchor_end,
          color, note_text, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        annotationId,
        targetType,
        targetId,
        quoteText,
        anchorStart,
        anchorEnd,
        color,
        noteText,
        now,
        now,
      );
    const savedRow = database
      .prepare("SELECT * FROM reading_annotations WHERE id = ? LIMIT 1")
      .get(annotationId);
    return mapReadingAnnotationRow(savedRow);
  }

  /** 修改高亮颜色或批注正文。 */
  function updateReadingAnnotation(annotationId, changes) {
    const existingRow = database
      .prepare("SELECT * FROM reading_annotations WHERE id = ? LIMIT 1")
      .get(annotationId);
    if (!existingRow) return null;
    const requestedColor = String(changes.color ?? existingRow.color);
    if (!annotationColors.has(requestedColor)) throw new Error("高亮颜色无效。");
    const requestedNoteText = String(changes.noteText ?? existingRow.note_text).slice(0, 20000);
    const updatedAt = currentTimestamp();
    database
      .prepare(`
        UPDATE reading_annotations
        SET color = ?, note_text = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(requestedColor, requestedNoteText, updatedAt, annotationId);
    const updatedRow = database
      .prepare("SELECT * FROM reading_annotations WHERE id = ? LIMIT 1")
      .get(annotationId);
    return mapReadingAnnotationRow(updatedRow);
  }

  /** 删除一条本地高亮批注。 */
  function deleteReadingAnnotation(annotationId) {
    const result = database
      .prepare("DELETE FROM reading_annotations WHERE id = ?")
      .run(annotationId);
    return result.changes > 0;
  }

  return Object.freeze({
    createReadingAnnotation,
    deleteReadingAnnotation,
    getReadingWorkspace,
    startReadingSession,
    updateReadingAnnotation,
    updateReadingSession,
    updateReadingState,
  });
}
