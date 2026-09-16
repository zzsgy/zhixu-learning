/** 可恢复后台导入任务的状态机与数据访问。 */
import crypto from "node:crypto";

/** 使用共享 SQLite 连接创建后台导入任务仓储。 */
export function createImportJobStore(database, {
  currentDate = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  /** 返回可用于计算延迟并序列化的当前时间。 */
  function getCurrentDate() {
    const value = currentDate();
    return value instanceof Date ? value : new Date(value);
  }

  /** 安全解析数据库中的 JSON 对象；旧数据或异常值回退为空对象。 */
  function parseStoredObject(value) {
    try {
      const parsedValue = JSON.parse(String(value || "{}"));
      return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
        ? parsedValue
        : {};
    } catch {
      return {};
    }
  }

  /** 将后台导入任务行转换为 API 使用的驼峰对象。 */
  function mapImportJobRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      jobType: row.job_type,
      sourceLabel: row.source_label,
      sourceUrl: row.source_url,
      status: row.status,
      stage: row.stage,
      progressPercent: Number(row.progress_percent) || 0,
      payload: parseStoredObject(row.payload_json),
      result: parseStoredObject(row.result_json),
      targetType: row.target_type || null,
      targetId: row.target_id || null,
      errorMessage: row.error_message || "",
      attemptCount: Number(row.attempt_count) || 0,
      retryCount: Number(row.retry_count) || 0,
      nextAttemptAt: row.next_attempt_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  /** 只保留执行器已注册且符合命名约束的任务类型。 */
  function normalizeJobTypes(jobTypes) {
    return [...new Set(
      (Array.isArray(jobTypes) ? jobTypes : [])
        .map((value) => String(value || "").trim())
        .filter((value) => /^[a-z][a-z0-9_-]*$/i.test(value)),
    )];
  }

  /** 按 ID 读取后台导入任务。 */
  function getImportJob(jobId) {
    return mapImportJobRow(
      database.prepare("SELECT * FROM import_jobs WHERE id = ? LIMIT 1").get(String(jobId || "")),
    );
  }

  /** 创建一个可在服务重启后恢复的后台导入任务。 */
  function createImportJob(input) {
    const jobType = String(input.jobType || "").trim().slice(0, 80);
    if (!/^[a-z][a-z0-9_-]*$/i.test(jobType)) throw new TypeError("导入任务类型无效。");
    const now = getCurrentDate().toISOString();
    const jobId = `import_${randomUUID()}`;
    database.prepare(`
      INSERT INTO import_jobs(
        id, job_type, source_label, source_url, status, stage,
        progress_percent, payload_json, result_json, error_message,
        attempt_count, created_at, updated_at, target_type, target_id
      ) VALUES (?, ?, ?, ?, 'queued', 'queued', 0, ?, '{}', '', 0, ?, ?, ?, ?)
    `).run(
      jobId,
      jobType,
      String(input.sourceLabel || "").replace(/\s+/g, " ").trim().slice(0, 240),
      String(input.sourceUrl || "").trim().slice(0, 4096),
      JSON.stringify(input.payload && typeof input.payload === "object" ? input.payload : {}),
      now,
      now,
      input.targetType || null,
      input.targetId || null,
    );
    return getImportJob(jobId);
  }

  /** 查询最近的后台导入任务。 */
  function listImportJobs(filters = {}) {
    const status = ["queued", "running", "completed", "failed"].includes(filters.status)
      ? filters.status
      : "";
    const jobType = String(filters.jobType || "").trim().slice(0, 80);
    const limit = Math.min(Math.max(Number(filters.limit) || 30, 1), 200);
    return database.prepare(`
      SELECT * FROM import_jobs
      WHERE (? = '' OR status = ?) AND (? = '' OR job_type = ?)
      ORDER BY updated_at DESC LIMIT ?
    `).all(status, status, jobType, jobType, limit).map(mapImportJobRow);
  }

  /** 原子领取一个当前进程能够处理的排队任务。 */
  function claimNextImportJob(jobTypes) {
    const normalizedTypes = normalizeJobTypes(jobTypes);
    if (normalizedTypes.length === 0) return null;
    const placeholders = normalizedTypes.map(() => "?").join(", ");
    database.exec("BEGIN IMMEDIATE;");
    try {
      const candidate = database.prepare(`
        SELECT id FROM import_jobs
        WHERE status = 'queued' AND job_type IN (${placeholders})
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at ASC LIMIT 1
      `).get(...normalizedTypes, getCurrentDate().toISOString());
      if (!candidate) {
        database.exec("COMMIT;");
        return null;
      }
      const now = getCurrentDate().toISOString();
      database.prepare(`
        UPDATE import_jobs SET
          status = 'running', stage = 'starting', progress_percent = MAX(progress_percent, 1),
          error_message = '', attempt_count = attempt_count + 1,
          next_attempt_at = NULL, started_at = ?, completed_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(now, now, candidate.id);
      database.exec("COMMIT;");
      return getImportJob(candidate.id);
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }

  /** 更新运行任务的阶段和进度。 */
  function updateImportJobProgress(jobId, changes = {}) {
    const stage = String(changes.stage || "running").trim().slice(0, 80) || "running";
    const progressPercent = Math.min(
      Math.max(Number(changes.progressPercent) || 0, 0),
      99,
    );
    database.prepare(`
      UPDATE import_jobs SET stage = ?, progress_percent = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(stage, progressPercent, getCurrentDate().toISOString(), String(jobId || ""));
    return getImportJob(jobId);
  }

  /** 将后台导入任务标记为成功，并保存目标内容与轻量结果。 */
  function completeImportJob(jobId, result = {}) {
    const now = getCurrentDate().toISOString();
    database.prepare(`
      UPDATE import_jobs SET
        status = 'completed', stage = 'completed', progress_percent = 100,
        result_json = ?, target_type = ?, target_id = ?, error_message = '',
        next_attempt_at = NULL, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(result && typeof result === "object" ? result : {}),
      result.targetType ? String(result.targetType).slice(0, 40) : null,
      result.targetId ? String(result.targetId).slice(0, 180) : null,
      now,
      now,
      String(jobId || ""),
    );
    return getImportJob(jobId);
  }

  /** 将后台导入任务标记为失败并保留可操作错误信息。 */
  function failImportJob(jobId, error) {
    const now = getCurrentDate().toISOString();
    const message = String(error instanceof Error ? error.message : error || "导入失败。")
      .trim()
      .slice(0, 2000);
    const stage = error && typeof error === "object"
      && error.code === "IMPORT_CONFIRMATION_REQUIRED"
      ? "awaiting_confirmation"
      : "failed";
    database.prepare(`
      UPDATE import_jobs SET
        status = 'failed', stage = ?, error_message = ?, next_attempt_at = NULL,
        completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(stage, message || "导入失败。", now, now, String(jobId || ""));
    return getImportJob(jobId);
  }

  /** 临时错误不结束任务，而是持久化为等待重试。 */
  function deferImportJob(jobId, error, delayMilliseconds) {
    const now = getCurrentDate();
    const safeDelay = Math.min(
      Math.max(Number(delayMilliseconds) || 1_000, 10),
      60 * 60 * 1000,
    );
    const nextAttemptAt = new Date(now.getTime() + safeDelay).toISOString();
    const message = String(error instanceof Error ? error.message : error || "来源暂时不可用。")
      .trim()
      .slice(0, 2000);
    const result = database.prepare(`
      UPDATE import_jobs SET
        status = 'queued', stage = 'waiting_retry', error_message = ?,
        retry_count = retry_count + 1, next_attempt_at = ?,
        started_at = NULL, completed_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(
      message || "来源暂时不可用。",
      nextAttemptAt,
      now.toISOString(),
      String(jobId || ""),
    );
    return Number(result.changes) > 0 ? getImportJob(jobId) : null;
  }

  /** 返回已注册任务中最早的未来唤醒时间。 */
  function getNextImportJobAttemptAt(jobTypes) {
    const normalizedTypes = normalizeJobTypes(jobTypes);
    if (!normalizedTypes.length) return null;
    const placeholders = normalizedTypes.map(() => "?").join(", ");
    const row = database.prepare(`
      SELECT MIN(next_attempt_at) AS next_attempt_at FROM import_jobs
      WHERE status = 'queued' AND next_attempt_at IS NOT NULL
        AND job_type IN (${placeholders})
    `).get(...normalizedTypes);
    return row?.next_attempt_at || null;
  }

  /** 服务异常退出后把运行中任务放回队列。 */
  function resetInterruptedImportJobs() {
    const now = getCurrentDate().toISOString();
    const result = database.prepare(`
      UPDATE import_jobs SET
        status = 'queued', stage = 'queued', progress_percent = 0,
        error_message = '', next_attempt_at = NULL, started_at = NULL,
        completed_at = NULL, updated_at = ?
      WHERE status = 'running'
    `).run(now);
    return Number(result.changes) || 0;
  }

  /** 用户重试失败任务时将其重新放回队列。 */
  function retryImportJob(jobId) {
    const now = getCurrentDate().toISOString();
    const result = database.prepare(`
      UPDATE import_jobs SET
        status = 'queued', stage = 'queued', progress_percent = 0,
        error_message = '', retry_count = 0, next_attempt_at = NULL, started_at = NULL,
        completed_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'failed'
    `).run(now, String(jobId || ""));
    return Number(result.changes) > 0 ? getImportJob(jobId) : null;
  }

  /** 用户确认无字幕视频的处理方式后，写入确认动作并重新排队。 */
  function confirmVideoImportJob(jobId, action) {
    if (!["save_link", "generate_study_pdf"].includes(action)) {
      throw new TypeError("不支持的视频确认动作。");
    }
    const existingJob = getImportJob(jobId);
    if (
      !existingJob
      || existingJob.jobType !== "video_transcript"
      || existingJob.status !== "failed"
      || existingJob.stage !== "awaiting_confirmation"
    ) {
      return null;
    }
    const nextPayload = {
      ...existingJob.payload,
      confirmationAction: action,
    };
    const now = getCurrentDate().toISOString();
    database.prepare(`
      UPDATE import_jobs SET
        status = 'queued', stage = 'queued', progress_percent = 0,
        payload_json = ?, error_message = '', retry_count = 0,
        next_attempt_at = NULL, started_at = NULL,
        completed_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'failed' AND stage = 'awaiting_confirmation'
    `).run(JSON.stringify(nextPayload), now, String(jobId || ""));
    return getImportJob(jobId);
  }

  return Object.freeze({
    claimNextImportJob,
    completeImportJob,
    confirmVideoImportJob,
    createImportJob,
    deferImportJob,
    failImportJob,
    getImportJob,
    getNextImportJobAttemptAt,
    listImportJobs,
    resetInterruptedImportJobs,
    retryImportJob,
    updateImportJobProgress,
  });
}
