import test from 'node:test';
import assert from 'node:assert/strict';
import { extractArticleVideos } from '../lib/article-video.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML, DOMParser } from 'linkedom';

test('保留 YouTube 视频 ID 与下一段标题，去重并拒绝伪造平台', () => {
  const videos = extractArticleVideos(`<iframe src="https://www.youtube.com/embed/JWMF5EpP0KE"></iframe><h2>Transcript</h2>
    <iframe src="https://www.youtube.com/embed/JWMF5EpP0KE"></iframe>
    <iframe src="https://www.youtube.com.evil.test/embed/JWMF5EpP0KE"></iframe>
    <iframe src="javascript:alert(1)"></iframe>`);
  assert.deepEqual(videos, [{ platform: 'youtube', id: 'JWMF5EpP0KE', title: 'YouTube 视频', anchor: 'Transcript' }]);
});

test('阅读页点击才加载播放器，保留来源入口并定位到正文标题前', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function renderArticleVideos(');
  const end = source.indexOf('\n/**', start);
  const { document } = parseHTML('<html><body><main><h2>Transcript</h2><p>Text</p></main></body></html>');
  const surface = document.querySelector('main');
  const context = vm.createContext({ document, DOMParser, dom: { articleReaderContent: surface }, createTextElement: (tag, cls, text) => {
    const element = document.createElement(tag); element.className = cls; element.textContent = text; return element;
  } });
  vm.runInContext(source.slice(start, end), context);
  context.renderArticleVideos({ contentHtml: '<h2>Transcript</h2>', videos: [{ platform: 'youtube', id: 'JWMF5EpP0KE', anchor: 'Transcript' }] }, 'original');
  assert.equal(surface.firstElementChild.className, 'article-video-card');
  assert.equal(surface.querySelector('iframe'), null);
  assert.match(surface.querySelector('a').href, /watch\?v=JWMF5EpP0KE/);
  surface.querySelector('button').click();
  assert.equal(surface.querySelector('iframe').src, 'https://www.youtube-nocookie.com/embed/JWMF5EpP0KE?autoplay=1');
});
