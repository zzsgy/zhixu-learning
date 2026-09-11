/**
 * 视频链接规范化、YouTube/Bilibili 字幕解析与无字幕确认测试。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createVideoArticle,
  formatVideoTimestamp,
  inspectVideoSource,
  normalizeVideoUrl,
  VideoConfirmationRequiredError,
} from "../lib/video-importer.mjs";

/**
 * 构造 JSON 响应。
 *
 * @param {unknown} value 响应对象。
 * @returns {Response} Fetch 响应。
 */
function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("规范化 YouTube 与哔哩哔哩链接并拒绝危险协议", () => {
  assert.deepEqual(normalizeVideoUrl("https://youtu.be/abcDEF_1234?t=9"), {
    platform: "youtube",
    canonicalUrl: "https://www.youtube.com/watch?v=abcDEF_1234",
    videoId: "abcDEF_1234",
  });
  assert.deepEqual(normalizeVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD?p=2"), {
    platform: "bilibili",
    canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    videoId: "BV1xx411c7mD",
  });
  assert.throws(() => normalizeVideoUrl("file:///C:/secret.mp4"), /http 或 https/);
  assert.equal(formatVideoTimestamp(65.9), "01:05");
  assert.equal(formatVideoTimestamp(3661), "01:01:01");
});

test("YouTube 导入选择中文公开字幕并解析 json3 时间戳", async () => {
  const playerResponse = {
    videoDetails: {
      title: "知序视频测试",
      author: "测试作者",
      shortDescription: "公开视频简介",
      lengthSeconds: "125",
      thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/example.jpg" }] },
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            languageCode: "en",
            name: { simpleText: "English" },
            baseUrl: "https://www.youtube.com/api/timedtext?v=test&lang=en",
          },
          {
            languageCode: "zh-Hans",
            name: { simpleText: "中文（简体）" },
            baseUrl: "https://www.youtube.com/api/timedtext?v=test&lang=zh-Hans",
          },
        ],
      },
    },
  };
  const fetcher = async (url) => {
    if (url.pathname === "/watch") {
      return new Response(`<script>ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script>`);
    }
    assert.equal(url.searchParams.get("lang"), "zh-Hans");
    assert.equal(url.searchParams.get("fmt"), "json3");
    return jsonResponse({
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "第一句字幕" }] },
        { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: "第二句 " }, { utf8: "字幕" }] },
      ],
    });
  };
  const video = await inspectVideoSource("https://www.youtube.com/watch?v=abcDEF_1234", {
    fetcher,
    preferredLanguages: ["zh-Hans", "en"],
  });
  assert.equal(video.title, "知序视频测试");
  assert.equal(video.captionLanguage, "zh-Hans");
  assert.deepEqual(video.segments, [
    { startSeconds: 1, endSeconds: 3, text: "第一句字幕" },
    { startSeconds: 3.5, endSeconds: 5, text: "第二句 字幕" },
  ]);
});

test("YouTube 导入兼容 timedtext XML 字幕", async () => {
  const playerResponse = {
    videoDetails: { title: "XML 字幕测试" },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{
          languageCode: "zh-Hans",
          baseUrl: "https://www.youtube.com/api/timedtext?v=test&lang=zh-Hans",
        }],
      },
    },
  };
  const fetcher = async (url) => url.pathname === "/watch"
    ? new Response(`<script>ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script>`)
    : new Response('<transcript><text start="1.5" dur="2">第一句 &amp; XML</text></transcript>');
  const video = await inspectVideoSource("https://youtu.be/abcDEF_1234", { fetcher });
  assert.deepEqual(video.segments, [{
    startSeconds: 1.5,
    endSeconds: 3.5,
    text: "第一句 & XML",
  }]);
});

test("哔哩哔哩导入读取公开视频字幕 JSON", async () => {
  const fetcher = async (url) => {
    if (url.pathname === "/x/web-interface/view") {
      return jsonResponse({
        code: 0,
        data: {
          title: "B站字幕测试",
          desc: "测试简介",
          duration: 90,
          pubdate: 1_700_000_000,
          owner: { name: "测试UP主" },
          pages: [{ cid: 123 }],
        },
      });
    }
    if (url.pathname === "/x/player/v2") {
      return jsonResponse({
        code: 0,
        data: {
          subtitle: {
            subtitles: [{
              lan: "zh-CN",
              lan_doc: "中文（简体）",
              subtitle_url: "//i0.hdslb.com/bfs/subtitle/test.json",
            }],
          },
        },
      });
    }
    return jsonResponse({ body: [{ from: 2.5, to: 5, content: "B站字幕内容" }] });
  };
  const video = await inspectVideoSource("https://www.bilibili.com/video/BV1xx411c7mD", {
    fetcher,
  });
  assert.equal(video.author, "测试UP主");
  assert.equal(video.captionLanguage, "zh-CN");
  assert.deepEqual(video.segments, [
    { startSeconds: 2.5, endSeconds: 5, text: "B站字幕内容" },
  ]);
});

test("无字幕时必须确认，确认后只保存链接说明", async () => {
  const video = await inspectVideoSource("https://example.com/public-video");
  await assert.rejects(
    () => createVideoArticle(video),
    (error) => error instanceof VideoConfirmationRequiredError
      && error.code === "IMPORT_CONFIRMATION_REQUIRED",
  );
  const article = await createVideoArticle(video, { saveLinkOnly: true });
  assert.equal(article.sourceType, "video");
  assert.match(article.contentText, /没有下载视频或音频/);
  assert.equal(article.transcriptSegmentCount, 0);
});
