/** 阅读会话按本地自然日记账；接受累计值，重复或迟到提交不重复加时。 */
export function localReadingDay(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function initializeReadingSessionDays(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS reading_session_days (
      session_id TEXT NOT NULL,
      local_day TEXT NOT NULL,
      active_seconds INTEGER NOT NULL DEFAULT 0 CHECK(active_seconds >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(session_id, local_day),
      FOREIGN KEY(session_id) REFERENCES reading_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS reading_session_days_day_idx ON reading_session_days(local_day);
    INSERT OR IGNORE INTO reading_session_days(session_id,local_day,active_seconds,updated_at)
      SELECT s.id,date(s.last_active_at,'localtime'),s.active_seconds,s.last_active_at
      FROM reading_sessions s
      WHERE NOT EXISTS (SELECT 1 FROM reading_session_days d WHERE d.session_id=s.id);
  `);
}

/** 调用者应与会话累计值更新放在同一个事务中。旧客户端没有分日字段时增量归当前本地日。 */
export function recordReadingDayIncrement(database, {
  sessionId, startedAt, previousSeconds, activeSeconds, activeSecondsByDay, now,
}) {
  let remaining = Math.max(0, activeSeconds - previousSeconds);
  if (!remaining) return;
  const today = localReadingDay(now);
  const firstDay = localReadingDay(startedAt);
  const existing = new Map(database.prepare("SELECT local_day,active_seconds FROM reading_session_days WHERE session_id=?")
    .all(sessionId).map((row) => [row.local_day, Number(row.active_seconds)]));
  const add = database.prepare(`INSERT INTO reading_session_days(session_id,local_day,active_seconds,updated_at)
    VALUES (?,?,?,?) ON CONFLICT(session_id,local_day) DO UPDATE
    SET active_seconds=reading_session_days.active_seconds+excluded.active_seconds,updated_at=excluded.updated_at`);
  const incoming = activeSecondsByDay && typeof activeSecondsByDay === "object" && !Array.isArray(activeSecondsByDay)
    ? Object.entries(activeSecondsByDay).slice(0, 370).sort(([a], [b]) => a.localeCompare(b)) : [];
  for (const [day, rawSeconds] of incoming) {
    if (!remaining) break;
    const seconds = Number(rawSeconds);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < firstDay || day > today
      || localReadingDay(`${day}T12:00:00`) !== day || !Number.isFinite(seconds)) continue;
    const increment = Math.min(remaining, Math.max(0, Math.floor(seconds) - (existing.get(day) || 0)));
    if (increment > 0) { add.run(sessionId, day, increment, now); remaining -= increment; }
  }
  if (remaining > 0) add.run(sessionId, today, remaining, now);
}
