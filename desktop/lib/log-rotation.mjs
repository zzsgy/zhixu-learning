import fs from "node:fs";
import path from "node:path";

/** 把日期转换为可用于 Windows 文件名的 UTC 时间戳。 */
function formatArchiveTimestamp(date) {
  return date.toISOString().replaceAll(":", "-");
}

/**
 * 在跨日或达到大小上限时归档日志，并删除超过保留期的旧归档。
 *
 * @param {string} logPath 当前日志路径。
 * @param {{maxBytes?: number, retentionDays?: number, now?: Date}} options 轮换参数。
 * @returns {string | null} 新归档路径；无需轮换时返回空值。
 */
export function rotateLogFile(logPath, options = {}) {
  const maximumBytes = Number(options.maxBytes) || 5 * 1024 * 1024;
  const retentionDays = Number(options.retentionDays) || 30;
  const now = options.now instanceof Date ? options.now : new Date();
  const directory = path.dirname(logPath);
  const baseName = path.basename(logPath);
  fs.mkdirSync(directory, { recursive: true });

  let archivePath = null;
  if (fs.existsSync(logPath)) {
    const status = fs.statSync(logPath);
    const isFromPreviousUtcDay = status.mtime.toISOString().slice(0, 10)
      !== now.toISOString().slice(0, 10);
    if (status.size > 0 && (isFromPreviousUtcDay || status.size >= maximumBytes)) {
      const archiveBase = `${logPath}.${formatArchiveTimestamp(now)}`;
      archivePath = archiveBase;
      let suffix = 1;
      while (fs.existsSync(archivePath)) {
        archivePath = `${archiveBase}.${suffix}`;
        suffix += 1;
      }
      fs.renameSync(logPath, archivePath);
    }
  }

  const expirationTime = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(`${baseName}.`)) continue;
    const candidatePath = path.join(directory, entry.name);
    if (fs.statSync(candidatePath).mtimeMs < expirationTime) fs.rmSync(candidatePath);
  }
  return archivePath;
}
