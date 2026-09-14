import fs from "node:fs";
import path from "node:path";
import { parsePaperAssetUrl } from "../public/paper-assets.js";

export function resolvePaperAsset(paperDirectory, requestPath) {
  const asset = parsePaperAssetUrl(requestPath);
  if (!asset) return null;
  const root = path.resolve(paperDirectory, "assets");
  const candidate = path.join(root, asset.paperId, asset.fileName);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  const realRoot = fs.realpathSync(root);
  const realPath = fs.realpathSync(candidate);
  const relative = path.relative(realRoot, realPath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return null;
  const contentType = /\.png$/.test(asset.fileName) ? "image/png" : /\.webp$/.test(asset.fileName) ? "image/webp" : "image/jpeg";
  return { ...asset, path: realPath, contentType };
}
