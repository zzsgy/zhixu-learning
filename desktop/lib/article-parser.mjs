/**
 * 本地文章抓取、正文提取和安全清洗模块。
 *
 * 外部网页始终视为不可信输入，正文必须清理后才能保存和渲染。
 */
import dns from "node:dns/promises";
import crypto from "node:crypto";
import fs, { readFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { classifyDocument } from "./classifier.mjs";
import { articleImageDirectory } from "./config.mjs";

/**
 * ordinarySourceLimit 是普通网页解压后的最大字节数。
 *
 * Jupyter、Quarto 等导出的长篇技术教程常包含大量代码高亮和公式样式，gzip
 * 响应虽然较小，解压后的 HTML 可能超过 5 MB；15 MB 在兼容这类教程的同时
 * 仍能阻止异常网页无限占用内存。
 */
const ordinarySourceLimit = 15_000_000;
/** wechatSourceLimit 是微信公众号文章允许下载的最大字节数。 */
const wechatSourceLimit = 15_000_000;
/** minimumArticleLength 是正文提取成功所需的最少字符数。 */
const minimumArticleLength = 180;
/** maximumRedirects 是允许跟随的 HTTP 重定向次数。 */
const maximumRedirects = 5;
/** fetchTimeoutMilliseconds 是单次文章抓取超时时间。 */
const fetchTimeoutMilliseconds = 25_000;
/** fetchAttemptLimit 是网络瞬断时允许执行的最大请求次数。 */
const fetchAttemptLimit = 3;
/** maximumImageBytes 是单张文章图片允许缓存的最大容量。 */
const maximumImageBytes = 12_000_000;
/**
 * letsEncryptGenerationYChain 补齐部分网站尚未随响应发送的新一代中间证书链。
 *
 * 证书来自 Let’s Encrypt 官方证书目录。它们只扩展可信 CA 链，不会关闭主机名、
 * 有效期或签名校验；系统默认根证书仍然完整保留。
 */
const letsEncryptGenerationYChain = readFileSync(
  new URL("../certificates/letsencrypt-generation-y-chain.crt", import.meta.url),
  "utf8",
);
/** trustedCertificateAuthorities 保留 Node 默认 CA，并补充 Generation Y 链。 */
const trustedCertificateAuthorities = [
  ...tls.rootCertificates,
  letsEncryptGenerationYChain,
];
/** externalRequestDispatcher 根据 HTTP_PROXY、HTTPS_PROXY 和 NO_PROXY 选择连接路径。 */
const externalRequestDispatcher = new EnvHttpProxyAgent({
  /** connect 用于未经过代理的 TLS 连接。 */
  connect: { ca: trustedCertificateAuthorities },
  /** requestTls 用于通过 HTTP CONNECT 代理建立的目标站 TLS 连接。 */
  requestTls: { ca: trustedCertificateAuthorities },
});

/** retryDelayMilliseconds 是每次网络重试前使用的递增等待时间。 */
const retryDelayMilliseconds = [250, 750];

/**
 * 等待指定时长后继续，用于避免网络瞬断时立即连续请求。
 *
 * @param {number} milliseconds 等待毫秒数。
 * @returns {Promise<void>} 等待完成信号。
 */
function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 从 Fetch 异常链中读取底层网络错误代码。
 *
 * @param {unknown} error Fetch 抛出的异常。
 * @returns {string} ECONNRESET、ETIMEDOUT 等错误代码；不存在时返回空字符串。
 */
export function readNetworkErrorCode(error) {
  /** visited 用于防止非标准 cause 链意外形成循环。 */
  const visited = new Set();
  /** current 是当前检查的异常或 cause。 */
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (typeof current.code === "string") return current.code;
    current = current.cause;
  }
  return "";
}

/**
 * 把底层网络异常转换为用户能够采取行动的中文提示。
 *
 * @param {unknown} error Fetch 抛出的异常。
 * @param {string} resourceLabel 正在读取的资源名称。
 * @returns {Error} 适合返回给本地网页的错误。
 */
export function createExternalFetchError(error, resourceLabel = "网页") {
  /** code 是底层 socket、DNS 或代理连接错误代码。 */
  const code = readNetworkErrorCode(error);
  /** errorName 是 AbortSignal 超时时常见的异常名称。 */
  const errorName = error instanceof Error ? error.name : "";
  if (code === "ECONNRESET") {
    return new Error(`${resourceLabel}连接被中途重置，请检查网络或代理后重试。`);
  }
  if (code === "ECONNREFUSED") {
    return new Error(`${resourceLabel}连接被拒绝，请检查代理是否正在运行。`);
  }
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return new Error(`${resourceLabel}域名解析失败，请检查 DNS 或网络连接。`);
  }
  if (
    [
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
    ].includes(code)
  ) {
    return new Error(`${resourceLabel}的 HTTPS 证书链无法验证，请稍后重试或联系网站维护者。`);
  }
  if (
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code) ||
    ["AbortError", "TimeoutError"].includes(errorName)
  ) {
    return new Error(`${resourceLabel}连接超时，请稍后重试或检查代理设置。`);
  }
  return new Error(`${resourceLabel}暂时无法连接，请检查网络或代理后重试。`);
}

/**
 * 根据正文中的汉字和拉丁词密度识别文章原始语言。
 *
 * 技术文章会保留模型名、代码和英文缩写，因此不能仅按是否出现英文判断。
 *
 * @param {string} text 已清洗的文章纯文本。
 * @returns {"zh" | "en" | "mixed" | "unknown"} 标准语言代码。
 */
export function detectArticleLanguage(text) {
  /** normalizedText 是去除多余空白后的语言识别样本。 */
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalizedText) return "unknown";
  /** hanCount 是正文中的中日韩统一表意文字数量。 */
  const hanCount = (normalizedText.match(/[\u3400-\u9fff]/g) || []).length;
  /** latinWordCount 是长度至少为两个字符的拉丁单词数量。 */
  const latinWordCount = (
    normalizedText.match(/[A-Za-z][A-Za-z'’-]{1,}/g) || []
  ).length;
  /** latinLetterCount 用于区分英文主体与仅含大量技术缩写的中文主体。 */
  const latinLetterCount = (normalizedText.match(/[A-Za-z]/g) || []).length;
  /** visibleLength 是排除空白后的正文长度。 */
  const visibleLength = normalizedText.replace(/\s/g, "").length;
  /** hanRatio 是汉字在全部可见字符中的比例。 */
  const hanRatio = visibleLength > 0 ? hanCount / visibleLength : 0;
  if (hanCount >= 80 && hanRatio >= 0.08) {
    return latinWordCount >= 120 && hanRatio < 0.22 && latinLetterCount > hanCount * 1.35
      ? "mixed"
      : "zh";
  }
  if (latinWordCount >= 40 && hanRatio < 0.03) return "en";
  if (hanCount >= 20 && latinWordCount >= 40) return "mixed";
  return hanCount > latinWordCount ? "zh" : latinWordCount > 0 ? "en" : "unknown";
}

/**
 * 使用环境代理访问外部资源，并对临时网络错误进行有限次数重试。
 *
 * @param {URL} url 已经过公网地址校验的目标 URL。
 * @param {Record<string, unknown>} options Undici Fetch 请求参数。
 * @param {string} resourceLabel 用户提示中的资源名称。
 * @returns {Promise<Response>} 外部资源响应。
 */
export async function fetchExternalResource(url, options, resourceLabel) {
  /** lastError 保存最后一次网络失败，用于生成准确的最终提示。 */
  let lastError;
  for (let attempt = 1; attempt <= fetchAttemptLimit; attempt += 1) {
    try {
      return await undiciFetch(url, {
        ...options,
        dispatcher: externalRequestDispatcher,
      });
    } catch (error) {
      lastError = error;
      if (attempt < fetchAttemptLimit) {
        await wait(retryDelayMilliseconds[attempt - 1] ?? 750);
      }
    }
  }
  throw createExternalFetchError(lastError, resourceLabel);
}

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
 * 对公网主机执行有限次数 DNS 查询，吸收系统解析器的短暂波动。
 *
 * @param {string} hostname 不含方括号的规范主机名。
 * @param {(hostname: string, options: { all: true }) => Promise<Array<{ address: string }>>} lookup DNS 查询函数。
 * @returns {Promise<Array<{ address: string }>>} DNS 返回的全部地址。
 */
export async function lookupPublicAddresses(hostname, lookup = dns.lookup) {
  /** lastError 保存最后一次 DNS 异常，用于生成中文错误提示。 */
  let lastError;
  for (let attempt = 1; attempt <= fetchAttemptLimit; attempt += 1) {
    try {
      /** addresses 是当前查询返回的 IPv4 与 IPv6 地址。 */
      const addresses = await lookup(hostname, { all: true });
      if (addresses.length > 0) return addresses;
      lastError = Object.assign(new Error(`No DNS records for ${hostname}`), {
        code: "ENOTFOUND",
      });
    } catch (error) {
      lastError = error;
      /** code 用于判断错误是否可能由短暂 DNS 波动造成。 */
      const code = readNetworkErrorCode(error);
      if (!["ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"].includes(code)) {
        throw createExternalFetchError(error, "文章网页");
      }
    }
    if (attempt < fetchAttemptLimit) {
      await wait(retryDelayMilliseconds[attempt - 1] ?? 750);
    }
  }
  throw createExternalFetchError(lastError, "文章网页");
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
    : await lookupPublicAddresses(hostname);
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
 * @returns {Promise<{ text: string, finalUrl: URL, contentType: string }>} 公开文本、最终地址和类型。
 */
export async function fetchPublicSource(inputUrl) {
  /** currentUrl 是每轮请求前都重新校验的公开地址。 */
  let currentUrl = await validatePublicUrl(inputUrl);
  for (
    let redirectCount = 0;
    redirectCount <= maximumRedirects;
    redirectCount += 1
  ) {
    /** response 是不自动跟随重定向的网页响应。 */
    const response = await fetchExternalResource(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,text/markdown;q=0.9,text/plain;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36 ZhixuReader/1.0",
      },
      signal: AbortSignal.timeout(fetchTimeoutMilliseconds),
    }, "文章网页");
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
      if (response.status === 403) {
        /** captureError 引导用户改用已授权浏览器读取需要验证的公开页面。 */
        const captureError = new Error(
          "该网站要求浏览器验证，知序后台无法直接读取。请在 Chrome 或 Edge 中打开文章，再使用“知序快速收藏”扩展保存当前网页。",
        );
        captureError.code = "BROWSER_CAPTURE_REQUIRED";
        throw captureError;
      }
      throw new Error(`文章网页返回 ${response.status}，暂时无法读取。`);
    }
    /** contentType 用于拒绝 PDF、图片和其它非网页响应。 */
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/markdown") &&
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
      text: new TextDecoder("utf-8").decode(bodyBytes),
      finalUrl: currentUrl,
      contentType,
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
    const response = await fetchExternalResource(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.9",
        Referer:
          currentUrl.hostname.toLowerCase() === "mmbiz.qpic.cn"
            ? "https://mp.weixin.qq.com/"
            : currentUrl.origin,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36 ZhixuReader/1.0",
      },
      signal: AbortSignal.timeout(fetchTimeoutMilliseconds),
    }, "文章图片");
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
    /** contentType 是仅允许常见文章图片格式的响应类型。 */
    const contentType =
      response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
    if (!["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"].includes(contentType)) {
      throw new Error("远程资源不是支持的文章图片。");
    }
    /** declaredLength 是图片服务器声明的容量。 */
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maximumImageBytes) {
      throw new Error("文章图片超过 12 MB 本地缓存上限。");
    }
    /** bytes 是下载完成的图片二进制数据。 */
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumImageBytes) {
      throw new Error("文章图片超过 12 MB 本地缓存上限。");
    }
    if (contentType === "image/svg+xml") {
      /** svgText 是准备移除脚本、事件处理器和外部嵌入的矢量图源码。 */
      const svgText = new TextDecoder("utf-8").decode(bytes);
      if (!/<svg\b/i.test(svgText)) throw new Error("远程 SVG 图片格式无效。");
      /** sanitizedSvg 是只能作为静态图片显示的安全 SVG。 */
      const sanitizedSvg = svgText
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
        .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s+(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|https?:|\/\/)[\s\S]*?\1/gi, "");
      bytes = new TextEncoder().encode(sanitizedSvg);
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
export function sanitizeArticleHtml(rawHtml, baseUrl) {
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
  /** emptyListItems 是网页解析时产生、但不包含文字或有效媒体的空列表项。 */
  const emptyListItems = Array.from(root.querySelectorAll("li")).filter(
    (listItem) =>
      !(listItem.textContent ?? "").trim() &&
      !listItem.querySelector("img, pre, code, table"),
  );
  for (const emptyListItem of emptyListItems) emptyListItem.remove();
  /** emptyLists 是清理空列表项后已经没有实际内容的列表容器。 */
  const emptyLists = Array.from(root.querySelectorAll("ul, ol")).filter(
    (list) => !list.querySelector("li"),
  );
  for (const emptyList of emptyLists) emptyList.remove();
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
 * 将旧网页误用的 HTML <image> 元素规范化为标准 <img>。
 *
 * SVG 内部的 <image> 具有不同语义，必须保持原状并由后续 SVG 清理规则处理；
 * 这里只兼容正文 HTML 中带 src 的非标准图片标签。
 *
 * @param {Document} document 待交给 Readability 的网页文档。
 * @returns {number} 完成规范化的图片数量。
 */
export function normalizeLegacyHtmlImages(document) {
  /** legacyImages 是不处于 SVG 内部、且确实声明图片地址的旧式节点。 */
  const legacyImages = Array.from(document.querySelectorAll("image[src]"))
    .filter((element) => !element.closest("svg"));
  for (const legacyImage of legacyImages) {
    /** standardImage 只复制图片解析需要的有限属性，其他属性由清洗器统一拒绝。 */
    const standardImage = document.createElement("img");
    for (const attributeName of ["src", "data-src", "data-original", "alt"]) {
      const attributeValue = legacyImage.getAttribute(attributeName);
      if (attributeValue !== null) standardImage.setAttribute(attributeName, attributeValue);
    }
    legacyImage.replaceWith(standardImage);
  }
  return legacyImages.length;
}

/** embeddedImageFormats 是允许从网页 data URL 落入本地缓存的非脚本图片格式。 */
const embeddedImageFormats = new Map([
  ["image/png", { extension: ".png", signature: (bytes) =>
    bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) }],
  ["image/jpeg", { extension: ".jpg", signature: (bytes) =>
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ["image/gif", { extension: ".gif", signature: (bytes) =>
    bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")) }],
  ["image/webp", { extension: ".webp", signature: (bytes) =>
    bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP" }],
]);

/**
 * 把 Notebook/Quarto 页面内嵌的 Base64 图片写入 D 盘文章图片缓存。
 *
 * 正文只保存 `.invalid` 保留域名下的稳定虚拟 HTTPS 地址；浏览器仍通过知序
 * `/api/article-images` 读取对应缓存文件，不会向该虚拟域名发送网络请求。
 *
 * @param {Document} document Readability 处理前的网页文档。
 * @param {string} imageDirectory 可覆盖的缓存目录，测试时用于隔离正式数据。
 * @returns {number} 成功持久化并改写的内嵌图片数量。
 */
export function persistEmbeddedArticleImages(
  document,
  imageDirectory = articleImageDirectory,
) {
  /** persistedCount 记录成功替换为本地缓存地址的图片数。 */
  let persistedCount = 0;
  for (const image of Array.from(document.querySelectorAll("img[src^='data:']"))) {
    /** source 是页面声明的完整 data URL。 */
    const source = image.getAttribute("src") || "";
    /** match 只接受明确的图片 MIME 与 Base64 编码，不允许 SVG 或任意文本。 */
    const match = source.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i);
    if (!match) {
      image.remove();
      continue;
    }
    /** format 是声明 MIME 对应的扩展名和文件签名校验器。 */
    const format = embeddedImageFormats.get(match[1].toLowerCase());
    /** encoded 是移除空白后的 Base64 数据。 */
    const encoded = match[2].replace(/\s+/g, "");
    if (!format || encoded.length > Math.ceil(maximumImageBytes * 4 / 3) + 4) {
      image.remove();
      continue;
    }
    /** bytes 是等待写入缓存的原始图片字节。 */
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length === 0 || bytes.length > maximumImageBytes || !format.signature(bytes)) {
      image.remove();
      continue;
    }
    /** contentHash 使相同内嵌图片跨文章复用同一份缓存。 */
    const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
    /** virtualUrl 是数据库与译文中使用的稳定受控图片地址。 */
    const virtualUrl = `https://embedded.zhixu.invalid/${contentHash}${format.extension}`;
    /** cacheHash 与服务端 `/api/article-images` 的缓存键算法保持一致。 */
    const cacheHash = crypto.createHash("sha256").update(virtualUrl).digest("hex");
    /** cachedPath 是 D 盘文章图片目录中的最终文件。 */
    const cachedPath = `${imageDirectory}/${cacheHash}${format.extension}`;
    fs.mkdirSync(imageDirectory, { recursive: true });
    try {
      fs.writeFileSync(cachedPath, bytes, { flag: "wx" });
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
    }
    image.setAttribute("src", virtualUrl);
    persistedCount += 1;
  }
  return persistedCount;
}

/**
 * 抓取文章、提取正文、自动分类并返回可持久化对象。
 *
 * @param {string} inputUrl 用户输入链接。
 * @returns {Promise<Record<string, unknown>>} 已整理文章。
 */
async function parseAndClassifyArticleSource(source) {
  /** originalDocument 保留页面元数据和公众号专用节点。 */
  const { document: originalDocument } = parseHTML(source.text);
  /** 旧博客可能误用 <image>；先规范化，避免 Readability 在入库前丢图。 */
  normalizeLegacyHtmlImages(originalDocument);
  /** Notebook 导出的 data URL 图片先写入本地缓存，避免清洗时丢失或膨胀 SQLite。 */
  persistEmbeddedArticleImages(originalDocument);
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
  /** sourceLanguage 是决定是否提供 Codex 中文翻译入口的原文语言。 */
  const sourceLanguage = detectArticleLanguage(sanitized.text);
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
    sourceLanguage,
    translationStatus:
      ["en", "mixed"].includes(sourceLanguage) ? "not_requested" : "not_required",
    wordCount: sanitized.text.length,
  };
}

/**
 * 抓取公开文章后执行正文提取、清洗和分类。
 *
 * @param {string} inputUrl 用户输入链接。
 * @returns {Promise<Record<string, unknown>>} 已整理文章。
 */
export async function parseAndClassifyArticle(inputUrl) {
  /** source 是抓取到的网页源码和最终地址。 */
  const source = await fetchPublicSource(inputUrl);
  return parseAndClassifyArticleSource(source);
}

/**
 * 解析用户已在浏览器中成功加载的公开网页源码。
 *
 * 该入口供已配对的知序扩展使用：Cloudflare 等浏览器验证通过后，扩展提交当前
 * DOM，服务端仍会重新校验 URL、限制容量并执行与普通导入相同的安全清洗。
 *
 * @param {string} inputUrl 当前浏览器标签页地址。
 * @param {string} sourceHtml 当前标签页完整 HTML。
 * @returns {Promise<Record<string, unknown>>} 已整理文章。
 */
export async function parseAndClassifyCapturedArticle(inputUrl, sourceHtml) {
  /** finalUrl 仍经过公网地址校验，浏览器内容不能把来源伪装成本机地址。 */
  const finalUrl = await validatePublicUrl(inputUrl);
  /** normalizedHtml 是扩展提交的当前页面 DOM。 */
  const normalizedHtml = String(sourceHtml || "");
  if (!normalizedHtml.trim()) throw new Error("浏览器没有返回可解析的网页正文。");
  if (Buffer.byteLength(normalizedHtml, "utf8") > sourceLimitForUrl(finalUrl)) {
    throw new Error("浏览器网页超过 15 MB，暂时无法收藏。");
  }
  return parseAndClassifyArticleSource({
    text: normalizedHtml,
    finalUrl,
    contentType: "text/html; charset=utf-8",
  });
}
