const knownNumber = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const dateText = value => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).format(new Date(value));
};
export function storageSizeText(bytes) {
  if (!knownNumber(bytes)) return "大小未知";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = bytes > 0 ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function text(root, id, value) { root.querySelector(`#${id}`).textContent = value; }
function state(root, id, label, tone = "neutral") {
  const node = root.querySelector(`#${id}`); node.textContent = label; node.dataset.tone = tone;
}

/** Render only API evidence. A missing value is unknown, not a successful zero. */
export function renderStorageDashboard(storage, cleanup, root = document, errors = []) {
  const snapshot = storage?.latestDatabaseBackup;
  const full = storage?.latestFullBackup;
  const verified = Boolean(full && dateText(full.verifiedAt) !== "—");
  const count = knownNumber(cleanup?.pendingFileCount) ? cleanup.pendingFileCount : null;
  const volume = full ? `${knownNumber(full.fileCount) ? full.fileCount.toLocaleString("zh-CN") + " 个文件" : "文件数未知"} · ${storageSizeText(full.totalBytes)}` : "数据库与本地资料";
  text(root, "storage-data-path", storage?.dataDirectory || "路径未获取");
  text(root, "storage-database-path", storage?.databasePath || "路径未获取");
  text(root, "storage-attachment-path", storage?.attachmentDirectory || "路径未获取");
  text(root, "storage-backup-path", storage?.backupDirectory || "路径未获取");
  text(root, "storage-snapshot-path", snapshot?.path || (storage ? "尚未创建数据库快照" : "路径未获取"));
  text(root, "storage-full-path", full?.path || (storage ? "尚未创建完整备份" : "路径未获取"));
  text(root, "storage-snapshot-time", dateText(snapshot?.createdAt));
  text(root, "storage-snapshot-size", snapshot ? storageSizeText(snapshot.sizeBytes) : "—");
  text(root, "storage-full-time", dateText(full?.verifiedAt));
  text(root, "storage-full-size", full ? volume : "—");
  state(root, "storage-snapshot-state", !storage ? "状态未知" : snapshot ? "已有快照" : "尚未创建", snapshot ? "success" : "neutral");
  state(root, "storage-full-state", !storage ? "状态未知" : verified ? "已校验" : full ? "待核验" : "尚未创建", verified ? "success" : "warning");
  text(root, "storage-snapshot-overview", snapshot ? dateText(snapshot.createdAt) : storage ? "尚未创建" : "读取失败");
  text(root, "storage-full-overview", !storage ? "读取失败" : verified ? "已校验" : full ? "待核验" : "尚未创建");
  text(root, "storage-full-volume", volume);
  text(root, "storage-backup-status", !storage ? "未能获取快照状态，请稍后刷新。" : snapshot ? "每日自动快照默认保留 30 天。" : "建议先创建一份数据库快照。");
  text(root, "storage-full-backup-status", !storage ? "未能获取完整备份状态，请稍后刷新。" : verified ? "上次备份已通过完整性校验。" : full ? "这份备份尚无有效校验记录，请核验后再用于恢复。" : "尚无完整副本，数据库快照不能替代它。");
  text(root, "storage-cleanup-overview", count === null ? "读取失败" : count ? `${count} 个待处理` : "无需处理");
  state(root, "storage-cleanup-state", count === null ? "状态未知" : count ? "待清理" : "无待清理项", count === null || count ? "warning" : "success");
  text(root, "storage-cleanup-status", count === null ? "未能获取维护队列；不会将未知状态显示为已清理。" : count
    ? `${count} 个已删除资料的文件尚待清理。最近原因：${cleanup.pending?.[0]?.lastError || cleanup.pending?.[0]?.errorMessage || "文件占用或权限限制"}`
    : "没有待清理文件，无需操作。");
  root.querySelector("#storage-cleanup-retry").disabled = !count;
  const messages = [...errors];
  if (storage?.lastError) messages.unshift(`最近备份异常：${storage.lastError.message}（${dateText(storage.lastError.occurredAt)}）`);
  const error = root.querySelector("#storage-last-error"); error.textContent = messages.join("；"); error.hidden = messages.length === 0;
}

export function renderStorageJobOverview(jobs, root = document) {
  const attention = jobs.filter(j => j.status === "failed" || j.stage === "awaiting_confirmation").length;
  const active = jobs.filter(j => ["queued", "running"].includes(j.status) && j.stage !== "awaiting_confirmation").length;
  const overview = root.querySelector("#storage-jobs-overview");
  overview.textContent = attention ? `${attention} 项需关注` : active ? `${active} 项处理中` : "暂无待办";
  overview.dataset.tone = attention ? "warning" : "neutral";
  text(root, "storage-jobs-detail", `${active} 项处理中 · ${jobs.length >= 200 ? "最近 " : ""}${jobs.length} 条任务记录`);
}

export function renderStorageBrowserOverview(clients, root = document) {
  const count = clients.filter(c => c.active).length;
  state(root, "storage-browser-state", count ? `已连接 ${count} 个` : "未配对", count ? "success" : "neutral");
}
