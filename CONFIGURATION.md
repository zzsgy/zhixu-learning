# 知序网页端配置说明

此文件为无法书写注释的 JSON 配置项提供中文说明。

- `.openai/hosting.json`
  - `project_id`：Sites 项目的不透明标识，只用于把本地源码关联到正确站点。
  - `d1`：D1 数据库逻辑绑定名。程序统一使用 `DB`，不包含数据库地址或密码。
  - `r2`：对象存储绑定。第一版没有上传大文件，因此保持 `null`。
- `package.json`
  - `dev`：启动本地网页与 Worker 预览。
  - `build`：生成 Sites 可部署产物。
  - `test`：验证生产首页可以由 Worker 正确渲染。
  - `db:generate`：根据 `db/schema.ts` 生成 D1 迁移。
- `DEEPSEEK_API_KEY`
  - 只配置在 Sites 的生产环境变量中。
  - 不写入源码、网页 JavaScript、Git 或 APK。
  - 未配置时，浏览和同步仍可使用；网页实时生成与 AI 追问会给出明确提示。
