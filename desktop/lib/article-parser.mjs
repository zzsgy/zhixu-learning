/**
 * 本地文章抓取、正文提取和安全清洗模块。
 *
 * 外部网页始终视为不可信输入，正文必须清理后才能保存和渲染。
 */
import dns from "node:dns/promises";
import net from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { classifyDocument } from "./classifier.mjs";

/** ordinarySourceLimit 是普通网页允许下载的最大字节数。 */
const ordinarySourceLimit = 5_000_000;
/** wechatSourceLimit 是微信公众号文章允许下载的最大字节数。 */
const wechatSourceLimit = 15_000_000;
/** minimumArticleLength 是正文提取成功所需的最少字符数。 */
const minimumArticleLength = 180;
/** maximumRedirects 是允许跟随的 HTTP 重定向次数。 */
const maximumRedirects = 5;
/** fetchTimeoutMilliseconds 是单次文章抓取超时时间。 */
const fetchTimeoutMilliseconds = 25_000;
/** maximumImageBytes 是单张文章图片允许缓存的最大容量。 */
const maximumImageBytes = 12_000_000;

/** allowedTags 是清洗后可以保留的正文 HTML 标签。 */
const allowedTags = new Set([
  "article",
  "section",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "a",
  "img",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
  "br",
  "sup",
  "sub",
]);
/** removedTags 是必须连同内容一并删除的危险或非正文标签。 */
const removedTags = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "template",
  "canvas",
  "video",
  "audio",
]);

/**
 * 判断 IP 是否属于本机、私网、链路本地或保留地址。
 *
 * @param {string} address IPv4 或 IPv6 地址。
 * @returns {boolean} 是否禁止由文章抓取器访问。
 */
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    /** parts 是 IPv4 的四个十进制分段。 */
    const parts = address.split(".").map(Number);
    /** first 是 IPv4 第一段。 */
    const first = parts[0];
    /** second 是 IPv4 第二段。 */
    const second = parts[1];
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (net.isIPv6(address)) {
    /** normalizedAddress 是移除方括号并转为小写的 IPv6。 */
    const normalizedAddress = address.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      normalizedAddress === "::" ||
      normalizedAddress === "::1" ||
      normalizedAddress.startsWith("fc") ||
      normalizedAddress.startsWith("fd") ||
      /^fe[89ab]/.test(normalizedAddress)
    );
  }
  return false;
}

/**
 * 校验外部 URL，并通过 DNS 解析阻止访问本机或局域网。
 *
 * @param {string} input 用户输入的文章链接。
 * @returns {Promise<URL>} 已验证的公开 HTTP(S) 地址。
 */
async function validatePublicUrl(input) {
  /** url 是标准 URL 解析器得到的绝对地址。 */
  const url = new URL(input.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("只支持 http 或 https 文章链接。");
  }
  if (url.username || url.password) {
    throw new Error("文章链接不能包含账号或密码。");
  }
  if (url.href.length > 2048) throw new Error("文章链接过长。");
  /** hostname 是规范化主机名。 */
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("不能读取本机或局域网地址。");
  }
  /** addresses 是 DNS 返回的全部目标地址。 */
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("不能读取本机、局域网或保留网络地址。");
  }
  return url;
}

/**
 * 根据 URL 返回网页响应容量上限。
 *
 * @param {URL} url 已验证地址。
 * @returns {number} 最大响应字节数。
 */
function sourceLimitForUrl(url) {
  return url.hostname.toLowerCase() === "mp.weixin.qq.com"
    ? wechatSourceLimit
    : ordinarySourceLimit;
}

/**
 * 跟随受控重定向并读取公开 HTML。
 *
 * @param {string} inputUrl 用户输入链接。
 * @returns {Promise<{ html: string, finalUrl: URL }>} 网页源码和最终地址。
 */
async function fetchPublicHtml(inputUrl) {
  /** currentUrl 是每轮请求前都重新校验的公开地址。 */
  let currentUrl = await validatePublicUrl(inputUrl);
  for (
    let redirectCount = 0;
    redirectCount <= maximumRedirects;
    redirectCount += 1
  ) {
    /** response 是不自动跟随重定向的网页响应。 */
    const response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36 ZhixuReader/1.0",
      },
      signal: AbortSignal.timeout(fetchTimeoutMilliseconds),
    });
    /** redirectLocation 是服务器声明的下一跳地址。 */
    const redirectLocation = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && redirectLocation) {
      if (redirectCount === maximumRedirects) {
        throw new Error("文章链接重定向次数过多。");
      }
      currentUrl = await validatePublicUrl(
        new URL(redirectLocation, currentUrl).href,
      );
      continue;
    }
    if (!response.ok) {
      throw new Error(`文章网页返回 ${response.status}，暂时无法读取。`);
    }
    /** contentType 用于拒绝 PDF、图片和其它非网页响应。 */
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error("该链接不是可解析的网页文章。");
    }
    /** sourceLimit 是本次来源允许读取的最大字节数。 */
    const sourceLimit = sourceLimitForUrl(currentUrl);
    /** declaredLength 是响应头声明的字节数。 */
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > sourceLimit) {
      throw new Error(`文章网页超过 ${Math.round(sourceLimit / 1_000_000)} MB。`);
    }
    /** bodyBytes 是下载完成的网页二进制内容。 */
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    if (bodyBytes.byteLength > sourceLimit) {
      throw new Error(`文章网页超过 ${Math.round(sourceLimit / 1_000_000)} MB。`);
    }
    return {
      html: new TextDecoder("utf-8").decode(bodyBytes),
      finalUrl: currentUrl,
    };
  }
  throw new Error("文章链接重定向失败。");
}

/**
 * 安全下载公开文章图片，供本地缓存代理使用。
 *
 * 每次重定向都会重新执行公网地址校验，防止图片 URL 访问本机或局域网。
 *
 * @param {string} inputUrl 原始远程图片地址。
 * @returns {Promise<{ bytes: Uint8Array, contentType: string }>} 图片二进制与 MIME。
 */
export async function fetchPublicImage(inputUrl) {
  /** currentUrl 是每轮请求前都重新校验的公开图片地址。 */
  let currentUrl = await validatePublicUrl(inputUrl);
  for (
    let redirectCount = 0;
    redirectCount <= maximumRedirects;
    redirectCount += 1
  ) {
    /** response 是不自动跟随重定向的图片响应。 */
    const response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9",
        Referer:
          currentUrl.hostname.toLowerCase() === "mmbiz.qpic.cn"
            ? "https://mp.weixin.qq.com/"
            : currentUrl.origin,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36 ZhixuReader/1.0",
      },
      signal: AbortSignal.timeout(fetchTimeoutMilliseconds),
    });
    /** redirectLocation 是图片服务器声明的下一跳。 */
    const redirectLocation = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && redirectLocation) {
      if (redirectCount === maximumRedirects) {
        throw new Error("图片链接重定向次数过多。");
      }
      currentUrl = await validatePublicUrl(
        new URL(redirectLocation, currentUrl).href,
      );
      continue;
    }
    if (!response.ok) {
      throw new Error(`文章图片返回 ${response.status}。`);
    }
    /** contentType 是仅允许常见位图格式的响应类型。 */
    const contentType =
      response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType)) {
      throw new Error("远程资源不是支持的文章图片。");
    }
    /** declaredLength 是图片服务器声明的容量。 */
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maximumImageBytes) {
      throw new Error("文章图片超过 12 MB 本地缓存上限。");
    }
    /** bytes 是下载完成的图片二进制数据。 */
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumImageBytes) {
      throw new Error("文章图片超过 12 MB 本地缓存上限。");
    }
    return { bytes, contentType };
  }
  throw new Error("文章图片链接重定向失败。");
}

/**
 * 读取第一个非空 meta 内容。
 *
 * @param {Document} document 网页文档。
 * @param {string[]} selectors meta 选择器。
 * @returns {string | null} 元数据文本。
 */
function readMeta(document, selectors) {
  for (const selector of selectors) {
    /** value 是当前 meta 标签的 content 值。 */
    const value = document.querySelector(selector)?.getAttribute("content")?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * 将相对 HTTP(S) 地址转换为安全绝对地址。
 *
 * @param {string | null} value 原始地址。
 * @param {URL} baseUrl 文章最终地址。
 * @param {boolean} forceHttps 是否强制升级到 HTTPS。
 * @returns {string | null} 安全绝对地址。
 */
function resolveSafeUrl(value, baseUrl, forceHttps) {
  if (!value) return null;
  try {
    /** resolvedUrl 是相对地址解析后的绝对 URL。 */
    const resolvedUrl = new URL(value, baseUrl);
    if (resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:") {
      return null;
    }
    if (forceHttps && resolvedUrl.protocol === "http:") {
      resolvedUrl.protocol = "https:";
    }
    return resolvedUrl.href;
  } catch {
    return null;
  }
}

/**
 * 删除脚本、样式、事件属性和危险 URL。
 *
 * @param {string} rawHtml Readability 或公众号正文 HTML。
 * @param {URL} baseUrl 文章最终地址。
 * @returns {{ html: string, text: string }} 安全正文与纯文本。
 */
function sanitizeArticleHtml(rawHtml, baseUrl) {
  /** parsedDocument 是专门用于清洗的隔离文档。 */
  const { document: parsedDocument } = parseHTML(
    `<body><article>${rawHtml}</article></body>`,
  );
  /** root 是正文根节点。 */
  const root = parsedDocument.querySelector("article");
  if (!root) return { html: "", text: "" };
  /** elements 是修改 DOM 前复制的元素列表。 */
  const elements = Array.from(root.querySelectorAll("*"));
  for (const element of elements) {
    /** tagName 是当前元素的小写标签名。 */
    const tagName = element.tagName.toLowerCase();
    if (removedTags.has(tagName)) {
      element.remove();
      continue;
    }
    if (!allowedTags.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    /** originalAttributes 是删除前保留的原始属性。 */
    const originalAttributes = Array.from(element.attributes);
    /** lazyImageSource 是公众号等页面使用的懒加载图片地址。 */
    const lazyImageSource =
      element.getAttribute("data-src") ??
      element.getAttribute("data-original") ??
      element.getAttribute("src");
    for (const attribute of originalAttributes) {
      element.removeAttribute(attribute.name);
    }
    if (tagName === "a") {
      /** safeHref 是经过协议白名单处理的链接。 */
      const safeHref = resolveSafeUrl(
        originalAttributes.find((attribute) => attribute.name === "href")
          ?.value ?? null,
        baseUrl,
        false,
      );
      if (safeHref) {
        element.setAttribute("href", safeHref);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer nofollow");
      }
    }
    if (tagName === "img") {
      /** safeSource 是强制使用 HTTPS 的图片地址。 */
      const safeSource = resolveSafeUrl(lazyImageSource, baseUrl, true);
      if (!safeSource) {
        element.remove();
        continue;
      }
      /** altText 是原图替代文字。 */
      const altText =
        originalAttributes.find((attribute) => attribute.name === "alt")?.value ??
        "";
      element.setAttribute("src", safeSource);
      element.setAttribute("alt", altText);
      element.setAttribute("loading", "lazy");
      element.setAttribute("referrerpolicy", "no-referrer");
    }
    if (tagName === "td" || tagName === "th") {
      for (const attributeName of ["colspan", "rowspan"]) {
        /** attributeValue 是允许保留的表格跨行列值。 */
        const attributeValue = originalAttributes.find(
          (attribute) => attribute.name === attributeName,
        )?.value;
        if (attributeValue && /^\d{1,2}$/.test(attributeValue)) {
          element.setAttribute(attributeName, attributeValue);
        }
      }
    }
  }
  /** text 是用于搜索和分类的纯文本正文。 */
  const text = (root.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 500_000);
  return { html: root.innerHTML.trim().slice(0, 800_000), text };
}

/**
 * 抓取文章、提取正文、自动分类并返回可持久化对象。
 *
 * @param {string} inputUrl 用户输入链接。
 * @returns {Promise<Record<string, unknown>>} 已整理文章。
 */
export async function parseAndClassifyArticle(inputUrl) {
  /** source 是抓取到的网页源码和最终地址。 */
  const source = await fetchPublicHtml(inputUrl);
  /** originalDocument 保留页面元数据和公众号专用节点。 */
  const { document: originalDocument } = parseHTML(source.html);
  /** sourceType 用于区分微信公众号和普通网页。 */
  const sourceType =
    source.finalUrl.hostname.toLowerCase() === "mp.weixin.qq.com"
      ? "wechat"
      : "web";
  /** wechatContent 是微信公众号正文容器。 */
  const wechatContent = originalDocument.querySelector(
    "#js_content, .rich_media_content",
  );
  /** readableDocument 是 Readability 可以安全修改的文档副本。 */
  const readableDocument = originalDocument.cloneNode(true);
  /** readable 是普通网页正文抽取结果。 */
  const readable = wechatContent
    ? null
    : new Readability(readableDocument, {
        charThreshold: minimumArticleLength,
        keepClasses: false,
      }).parse();
  /** rawContentHtml 优先使用公众号正文，其次使用 Readability 正文。 */
  const rawContentHtml =
    wechatContent?.innerHTML?.trim() ?? readable?.content?.trim() ?? "";
  /** sanitized 是移除危险内容后的正文。 */
  const sanitized = sanitizeArticleHtml(rawContentHtml, source.finalUrl);
  if (!sanitized.html || sanitized.text.length < minimumArticleLength) {
    throw new Error(
      "未能提取足够正文。文章可能需要登录、存在付费墙或启用了反抓取保护。",
    );
  }
  /** metadataTitle 是 Open Graph、公众号或网页标题。 */
  const metadataTitle =
    readMeta(originalDocument, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) ??
    originalDocument.querySelector("#activity-name")?.textContent?.trim() ??
    readable?.title?.trim() ??
    originalDocument.title?.trim() ??
    "未命名文章";
  /** title 是清理并限制长度后的文章标题。 */
  const title = metadataTitle.replace(/\s+/g, " ").slice(0, 180);
  /** author 是页面声明的作者或公众号名称。 */
  const author =
    readMeta(originalDocument, [
      'meta[name="author"]',
      'meta[property="article:author"]',
    ]) ??
    originalDocument.querySelector("#js_name")?.textContent?.trim() ??
    readable?.byline?.trim() ??
    null;
  /** publishedAt 是页面声明的发布时间。 */
  const publishedAt =
    readMeta(originalDocument, [
      'meta[property="article:published_time"]',
      'meta[name="publishdate"]',
      'meta[name="date"]',
    ]) ??
    originalDocument.querySelector("#publish_time")?.textContent?.trim() ??
    null;
  /** coverImageUrl 是经过安全处理的封面图地址。 */
  const coverImageUrl = resolveSafeUrl(
    readMeta(originalDocument, [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
    ]),
    source.finalUrl,
    true,
  );
  /** classification 是与本地文档共用的分类结果。 */
  const classification = await classifyDocument({
    fileName: title,
    text: sanitized.text,
  });
  /** summarySource 是压缩空白后的正文开头。 */
  const summarySource = sanitized.text.replace(/\s+/g, " ").trim();
  return {
    url: source.finalUrl.href,
    sourceType,
    title,
    summary: `${summarySource.slice(0, 220)}${summarySource.length > 220 ? "…" : ""}`,
    category: classification.category,
    categorySource: classification.source,
    categoryConfidence: classification.confidence,
    author,
    publishedAt,
    coverImageUrl,
    contentHtml: sanitized.html,
    contentText: sanitized.text,
    wordCount: sanitized.text.length,
  };
}
