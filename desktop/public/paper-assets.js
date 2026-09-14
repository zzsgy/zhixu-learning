/** Only library-owned raster assets are accepted; no arbitrary local paths. */
export function parsePaperAssetUrl(value) {
  const match = String(value || "").match(/^\/api\/papers\/([a-zA-Z0-9_-]+)\/assets\/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp))$/);
  return match ? { paperId: match[1], fileName: match[2] } : null;
}
