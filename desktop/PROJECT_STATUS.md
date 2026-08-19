# 知序本地知识库：项目状态

更新时间：2026-08-19

## 当前定位

知序是仅供个人使用的 Windows 本地知识库。网页服务监听 `127.0.0.1:47821`，正文、阅读记录、论文、问答记录和目录结构保存在本机 SQLite；上传附件与论文 PDF 保存在本地数据目录。

当前只考虑电脑端，不包含账号、多用户和远程云数据库。

## 已完成模块

- 文档库：本地文档上传、网页文章解析、文件夹分层、移动、收藏、删除、搜索。
- 阅读页：目录侧栏、阅读工作台、字体和行距调整、批注、文章内 AI 问答、悬浮返回。
- 教程导入：支持 Docsify/GitHub docs 目录识别与批量章节导入。
- 论文库：经典论文推荐、PDF/链接导入、英文原文保存、Codex 中文翻译队列。
- 资料问答：基于本地资料检索、引用核验、对话历史。
- 本地运维：SQLite 备份、服务守护进程和 Windows 自启动任务。
- 第五批第一阶段：统一后台导入任务、任务恢复与失败重试、Chrome/Edge 快速收藏扩展、一次性配对和客户端撤销。
- 第五批第二阶段：图片及扫描 PDF 本地 OCR、分页正文与坐标、置信度、自动入队和阅读页重试。
- 第五批第三阶段：YouTube/哔哩哔哩视频链接、公开字幕优先提取、时间戳正文、无字幕等待确认与仅保存链接流程。

“专题”和“卡片复习”入口目前隐藏，数据结构和代码仍保留。

## 重要目录和文件

- `server.mjs`：本地 HTTP/API 服务与静态资源响应。
- `public/index.html`：页面结构。
- `public/app.js`：浏览器端交互与状态管理。
- `public/styles.css`：界面样式。
- `lib/database.mjs`：SQLite 表结构、迁移和数据访问。
- `lib/article-parser.mjs`：网页抓取、代理、正文解析和安全清洗。
- `lib/paper-fulltext.mjs`：论文 PDF 下载、缓存和全文提取。
- `lib/codex-paper-translator.mjs`：Codex 论文翻译工作器。
- `lib/import-job-runner.mjs`：OCR、视频和浏览器收藏共用的持久化后台任务执行器。
- `lib/ocr-service.mjs`：Tesseract 图片识别、扫描 PDF 页面渲染和 TSV 版面结果解析。
- `lib/video-importer.mjs`：视频链接规范化、平台元数据、公开字幕选择与时间戳正文生成。
- `browser-extension/`：仅连接本机知序服务的 Chrome/Edge 快速收藏扩展。
- `scripts/`：翻译队列及运维脚本。
- `work/`：运行日志和任务状态。

## 外部网络规则

外部网页和论文请求必须通过 `EnvHttpProxyAgent` 读取 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。当前电脑代理地址为本机代理，Node 原生 `fetch` 不会自动读取这些变量，因此不能直接用于外部资源。

论文 PDF 导入采用异步流程：先保存论文记录，再在后台下载、解析、分类并唤醒 Codex 翻译。失败原因写入 SQLite，论文卡片提供重试入口。

## 开发与验证约定

- UI/文字/样式小改：运行 `node --check public/app.js` 和相关页面定向检查。
- 导入与解析：运行 `npm run test:import`。
- 数据库和持久化：运行 `npm run test:database`。
- 页面/API 集成：运行 `npm run test:ui`。
- 浏览器收藏和后台任务：运行 `npm run test:browser`。
- 视频链接、字幕解析和确认流程：运行 `npm run test:video`。
- 版本阶段完成或高风险修改：运行 `npm test` 全量测试。

本地静态资源使用 `Cache-Control: no-store`，修改后普通刷新即可，不再依赖手工版本号解决缓存混用。

## 当前待办

- 第六批：积累学习事件后实现知识关联、主题路线和统计分析。
- Android 端暂不在当前范围。
