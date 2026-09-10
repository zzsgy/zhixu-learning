# 知序

知序是一个面向个人长期使用的 Windows 本地知识库与学习工作台。当前主版本以本机 Node.js 服务、SQLite 数据库和 Electron 桌面外壳为核心，文档、网页文章、论文、阅读记录、批注、项目研读结果及附件均保存在用户自己的电脑中。

当前只考虑单用户电脑端，不使用云端数据库作为主库，也不包含账号体系和 Android 客户端。

## 当前能力

- 文档库：导入 Word、PDF、图片和其他可解析资料，支持文件夹层级、搜索、收藏、重命名、批量移动与删除。
- 网页文章：安全抓取和浏览器快速收藏，保留正文图片、公式及受支持的视频入口；英文文章可加入本机 Codex 翻译队列。
- 论文库：经典论文、PDF 与公开链接导入，保存英文原文，并生成保持章节、公式、表格和图片结构的中文阅读版及缓存 PDF。
- 阅读工作台：章节目录、阅读进度、字号和行距、笔记、高亮批注、原文/中文/双语切换。
- 项目研读：采集公开 GitHub 仓库的 README、目录树、版本和关键配置，形成有证据来源的中文项目画像。
- OCR 与视频整理：扫描文档 OCR，以及公开视频字幕、语音转写、关键画面和可搜索图文 PDF。
- 学习统计：最近阅读、资料增长、活跃天数、阅读时长和知识库目录分布。
- 本地运维：SQLite 每日一致性备份、日志轮换、Windows 登录自启动和服务异常恢复。

## 项目结构

当前持续维护的本地版本位于 [`desktop/`](desktop/)：

- `desktop/server.mjs`：仅监听本机回环地址的 HTTP/API 服务。
- `desktop/public/`：浏览器端页面、交互和样式。
- `desktop/lib/`：SQLite、文档解析、网页抓取、OCR、论文、翻译和视频处理模块。
- `desktop/desktop/`：Electron 窗口、托盘、菜单和本机服务启动编排。
- `desktop/browser-extension/`：连接本机知序服务的 Chrome/Edge 快速收藏扩展。
- `desktop/scripts/`：翻译队列、备份与 Windows 自启动脚本。
- [`desktop/PROJECT_STATUS.md`](desktop/PROJECT_STATUS.md)：当前功能边界、已完成模块、验证结果和后续计划。
- [`desktop/README.md`](desktop/README.md)：本地安装、数据目录、使用方式和运维说明。

仓库根目录中原有的网页、Worker、D1 和 Android 协作相关代码属于早期云端原型，不再代表知序当前的数据架构和产品方向。

## 数据与安全边界

- 服务默认只监听 `127.0.0.1:47821`，不会直接向局域网或公网开放。
- SQLite 是当前唯一主数据库；浏览器页面不是数据主库。
- 原始附件、文章图片、论文 PDF、生成文件和备份均位于本机数据目录。
- `.env.local`、数据库、附件、日志、测试数据和视频运行资产不会提交到 Git。
- 外部网页和论文请求执行公网地址校验，拒绝本机、私网和保留地址。
- 浏览器扩展不读取或保存 Cookie、密码和浏览器存储，只在用户主动操作后提交当前公开页面内容。
- Codex 翻译不会自动改用 DeepSeek、百度、有道、Google Translate 或其他第三方翻译服务。
- DeepSeek 仅用于用户主动启用的辅助分类或资料问答，并由本机私密环境变量配置。

## 本地运行

进入当前本地版本目录：

```powershell
cd desktop
npm install
Copy-Item .env.example .env.local
npm start
```

浏览器访问：`http://127.0.0.1:47821`

启动 Electron 桌面版：

```powershell
npm run desktop
```

安装 Windows 登录自启动：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-autostart.ps1
```

## 验证与打包

```powershell
npm test
npm run test:ui
npm run test:import
npm run test:database
npm run test:video
npm run pack:win
npm run dist:win
```

当前维护收口已通过 74 项自动化测试。Windows 安装包通过 Electron Builder 生成；正式发布前仍需对当次构建执行独立数据目录启动和安装包冒烟验证。

## 当前规划边界

- 多端同步尚未实施；不能通过网盘直接同步正在使用的 SQLite、WAL 或附件目录。
- Android 端不在当前开发范围。
- 知识关联、主题学习路线和跨设备冲突处理仍属于后续规划，不应视为已经完成。
- 本机每日数据库备份不能代替异盘备份；重要资料仍需复制到另一物理介质并定期做恢复验证。

## 注释约定

手写业务源码中的类型、常量、函数、参数、关键局部变量、数据库字段和配置使用中文注释。第三方依赖与构建工具生成文件不属于手写业务源码。
