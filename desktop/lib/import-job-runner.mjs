/**
 * 知序通用后台导入任务执行器。
 *
 * 所有任务状态保存在 SQLite；进程重启时会把中断任务放回队列。
 */
import {
  claimNextImportJob,
  completeImportJob,
  failImportJob,
  resetInterruptedImportJobs,
  updateImportJobProgress,
} from "./database.mjs";

/**
 * 创建顺序执行、可重复唤醒的本地导入任务执行器。
 *
 * @param {{ handlers: Record<string, Function> }} options 任务类型到异步处理器的映射。
 * @returns {{ start: Function, trigger: Function, getStatus: Function }} 执行器控制接口。
 */
export function createImportJobRunner(options = {}) {
  /** handlers 保存当前版本能够执行的任务类型。 */
  const handlers = new Map(
    Object.entries(options.handlers || {}).filter(([, handler]) => typeof handler === "function"),
  );
  /** state 保存执行器单实例运行状态。 */
  const state = {
    active: false,
    started: false,
    currentJobId: "",
    lastError: "",
  };

  /**
   * 顺序领取并处理任务，避免重任务抢占本机资源。
   *
   * @returns {Promise<void>}
   */
  async function drainQueue() {
    if (state.active || handlers.size === 0) return;
    state.active = true;
    try {
      while (true) {
        /** job 是数据库中最早的可处理排队任务。 */
        const job = claimNextImportJob([...handlers.keys()]);
        if (!job) break;
        state.currentJobId = job.id;
        /** handler 是任务类型对应的可信本地处理器。 */
        const handler = handlers.get(job.jobType);
        try {
          /** result 是处理器返回的目标内容和轻量结果。 */
          const result = await handler(job, {
            updateProgress(changes) {
              return updateImportJobProgress(job.id, changes);
            },
          });
          completeImportJob(job.id, result || {});
          state.lastError = "";
        } catch (error) {
          failImportJob(job.id, error);
          state.lastError = error instanceof Error ? error.message : String(error || "导入失败。");
          console.error(`后台导入任务 ${job.id} 失败：${state.lastError}`);
        } finally {
          state.currentJobId = "";
        }
      }
    } finally {
      state.active = false;
    }
  }

  return {
    /**
     * 初始化执行器并恢复上次异常中断的任务。
     *
     * @returns {void}
     */
    start() {
      if (state.started) return;
      state.started = true;
      /** recoveredCount 是从运行中状态恢复的任务数量。 */
      const recoveredCount = resetInterruptedImportJobs();
      if (recoveredCount > 0) console.log(`已恢复 ${recoveredCount} 个中断的导入任务。`);
      queueMicrotask(() => void drainQueue());
    },

    /**
     * 新任务入队或重试后唤醒执行器。
     *
     * @returns {void}
     */
    trigger() {
      queueMicrotask(() => void drainQueue());
    },

    /**
     * 返回不包含任务参数的运行状态。
     *
     * @returns {Record<string, unknown>} 当前执行器状态。
     */
    getStatus() {
      return {
        status: state.active ? "running" : "idle",
        currentJobId: state.currentJobId || null,
        supportedJobTypes: [...handlers.keys()],
        lastError: state.lastError,
      };
    },
  };
}
