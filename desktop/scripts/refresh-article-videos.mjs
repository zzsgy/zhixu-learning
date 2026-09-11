import { DatabaseSync } from 'node:sqlite';
import { databasePath } from '../lib/config.mjs';
import { getArticleById, createDailyBackup } from '../lib/database.mjs';
import { fetchPublicSource } from '../lib/article-parser.mjs';
import { extractArticleVideos } from '../lib/article-video.mjs';

const id = process.argv[2];
const article = getArticleById(id);
if (!article) throw new Error('找不到指定文章');
const source = await fetchPublicSource(article.url);
const videos = extractArticleVideos(source.text);
if (!videos.length) throw new Error('未发现可支持的视频，保留现有信息');
createDailyBackup();
const db = new DatabaseSync(databasePath);
db.prepare('UPDATE articles SET videos_json = ? WHERE id = ?').run(JSON.stringify(videos), id);
db.close();
console.log(JSON.stringify({ id, videos }, null, 2));
