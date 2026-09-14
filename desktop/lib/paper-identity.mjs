/** 纯论文身份解析；身份忽略 arXiv 版本，来源地址保留用户指定版本。 */
export function parseArxivIdentity(input) {
  const raw = String(input || "").trim().replace(/^arxiv\s*:\s*/i, "");
  let value = raw;
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try { url = new URL(raw); } catch { return null; }
    if (!/^(?:www\.|export\.)?arxiv\.org$/i.test(url.hostname) || url.username || url.password) return null;
    value = url.pathname.replace(/^\/(?:abs|pdf|html)\//i, "");
  }
  value = value.replace(/\.pdf$/i, "").replace(/\/$/, "");
  const match = value.match(/^((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7}))(v[1-9]\d*)?$/i);
  if (!match) return null;
  const arxivId = match[1].toLowerCase();
  const requestedVersion = (match[2] || "").toLowerCase();
  return {
    identityKey: `arxiv:${arxivId}`,
    arxivId,
    requestedVersion,
    externalId: `https://arxiv.org/abs/${arxivId}`,
    canonicalSourceUrl: `https://arxiv.org/abs/${arxivId}`,
    sourceUrl: `https://arxiv.org/abs/${arxivId}${requestedVersion}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}${requestedVersion}`,
  };
}

/** DOI 自身不改写版本后缀；URL 的 query/hash 不属于 DOI。 */
export function parseDoiIdentity(input) {
  let value = String(input || "").trim().replace(/^doi\s*:\s*/i, "");
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (!/^(?:dx\.)?doi\.org$/i.test(url.hostname) || url.username || url.password) return null;
    try { value = decodeURIComponent(url.pathname.slice(1)); } catch { return null; }
  }
  if (!/^10\.\d{4,9}\/\S+$/i.test(value) || /[\u0000-\u001f<>]/.test(value)) return null;
  const doi = value.toLowerCase();
  return { identityKey: `doi:${doi}`, doi, canonicalSourceUrl: `https://doi.org/${encodeURI(doi).replace(/#/g, "%23").replace(/\?/g, "%3F")}` };
}

export function normalizePaperIdentity(input) {
  if (typeof input === "string") return parseArxivIdentity(input) || parseDoiIdentity(input);
  if (!input || typeof input !== "object") return null;
  for (const value of [input.externalId, input.sourceUrl, input.pdfUrl, input.doi]) {
    const identity = normalizePaperIdentity(String(value || "").replace(/^manual-url:/i, ""));
    if (identity) return identity;
  }
  return null;
}

export function getPaperIdentityKey(input) {
  return normalizePaperIdentity(input)?.identityKey || "";
}
