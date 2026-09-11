import { parseHTML } from 'linkedom';

// Store only a validated platform ID and a text anchor, never publisher iframe HTML.
export function extractArticleVideos(html) {
  const { document } = parseHTML(String(html || ''));
  const blocks = Array.from(document.querySelectorAll('iframe, h1, h2, h3, h4, p'));
  const result = [];
  for (const [index, element] of blocks.entries()) {
    if (element.tagName.toLowerCase() !== 'iframe') continue;
    let url;
    try { url = new URL(element.getAttribute('src') || element.getAttribute('data-src')); } catch { continue; }
    if (url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(url.hostname)) continue;
    const id = url.pathname.match(/^\/embed\/([\w-]{11})$/)?.[1];
    if (!id || result.some((video) => video.id === id)) continue;
    const next = blocks.slice(index + 1).find((block) => block.tagName.toLowerCase() !== 'iframe' && block.textContent.trim().length >= 8);
    result.push({ platform: 'youtube', id, title: 'YouTube 视频', anchor: next?.textContent.trim().slice(0, 300) || '' });
  }
  return result.slice(0, 20);
}
