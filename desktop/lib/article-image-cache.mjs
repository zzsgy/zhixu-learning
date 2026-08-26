/**
 * 文章远程图片的并发安全本地缓存。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 支持写入磁盘缓存的图片 MIME、扩展名映射。 */
const imageFormats = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"],
]);

/**
 * 创建同一图片地址只执行一次下载的缓存解析器。
 *
 * @param {{ imageDirectory: string, fetchImage: Function }} options 缓存目录与安全下载函数。
 * @returns {{ resolve: (remoteUrl: string) => Promise<{ cachedPath: string, contentType: string }> }}
 */
export function createArticleImageCache(options) {
  const imageDirectory = path.resolve(String(options.imageDirectory || ""));
  const fetchImage = options.fetchImage;
  if (typeof fetchImage !== "function") throw new TypeError("缺少文章图片下载函数。");
  /** pendingByHash 让同一进程中的并发请求共享一次下载和写入。 */
  const pendingByHash = new Map();

  function findCachedImage(imageHash) {
    for (const [contentType, extension] of imageFormats) {
      const candidatePath = path.join(imageDirectory, `${imageHash}${extension}`);
      if (fs.existsSync(candidatePath)) return { cachedPath: candidatePath, contentType };
    }
    return null;
  }

  async function resolve(remoteUrl) {
    const imageHash = crypto.createHash("sha256").update(remoteUrl).digest("hex");
    const cachedImage = findCachedImage(imageHash);
    if (cachedImage) return cachedImage;
    const existingPending = pendingByHash.get(imageHash);
    if (existingPending) return existingPending;

    let pendingRequest;
    pendingRequest = (async () => {
      try {
        const cacheAfterWait = findCachedImage(imageHash);
        if (cacheAfterWait) return cacheAfterWait;
        const downloadedImage = await fetchImage(remoteUrl);
        const imageExtension = imageFormats.get(downloadedImage.contentType);
        if (!imageExtension) throw new Error("远程资源不是支持的文章图片。");
        fs.mkdirSync(imageDirectory, { recursive: true });
        const cachedPath = path.join(imageDirectory, `${imageHash}${imageExtension}`);
        try {
          fs.writeFileSync(cachedPath, downloadedImage.bytes, { flag: "wx" });
        } catch (error) {
          /** 进程外竞争已完成同一路径写入时直接复用，不能把首次阅读变成 500。 */
          if (!error || error.code !== "EEXIST") throw error;
        }
        return { cachedPath, contentType: downloadedImage.contentType };
      } finally {
        if (pendingByHash.get(imageHash) === pendingRequest) pendingByHash.delete(imageHash);
      }
    })();
    pendingByHash.set(imageHash, pendingRequest);
    return pendingRequest;
  }

  return { resolve };
}
