import fs from "node:fs";
import path from "node:path";

/** 只处理数据库事务记录的精确文件；任何失败都保留任务供重试。 */
export function createFileDeletionRunner(options) {
  const roots = Object.fromEntries(Object.entries(options.directories).map(([kind, root]) => [kind, path.resolve(root)]));
  const unlinkFile = options.unlinkFile || ((filePath) => fs.unlinkSync(filePath));

  function safeFilePath(item) {
    const root = roots[item.assetKind];
    if (!root || !item.fileName || path.basename(item.fileName) !== item.fileName
      || /[\\/:]/.test(item.fileName) || [".", ".."].includes(item.fileName)) {
      throw new Error("待清理文件超出允许的资产目录。");
    }
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("资产目录不是可信的本机普通目录。");
    const candidate = path.join(root, item.fileName);
    let stat;
    try { stat = fs.lstatSync(candidate); } catch (error) {
      if (error.code === "ENOENT") return candidate;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("只允许清理普通资产文件，拒绝目录和符号链接。");
    if (path.dirname(fs.realpathSync(candidate)) !== fs.realpathSync(root)) throw new Error("待清理文件不在真实资产目录中。");
    return candidate;
  }

  function run() {
    let deletedFileCount = 0;
    let preservedFileCount = 0;
    const warnings = [];
    for (const item of options.listPending()) {
      try {
        const candidate = safeFilePath(item);
        if (options.isReferenced(item)) {
          // 共用文件仍属于现存内容。以后最后一个引用删除时会重新登记清理。
          options.markComplete(item.id);
          preservedFileCount += 1;
          continue;
        }
        try { unlinkFile(candidate); } catch (error) { if (error.code !== "ENOENT") throw error; }
        options.markComplete(item.id);
        deletedFileCount += 1;
      } catch (error) {
        try { options.markFailed(item.id, error); } catch {}
        warnings.push(`资料记录已删除，文件“${item.fileName}”尚待清理：${error.message}`);
      }
    }
    return { deletedFileCount, preservedFileCount, pendingFileCount: options.listPending().length, warnings };
  }
  return { run };
}
