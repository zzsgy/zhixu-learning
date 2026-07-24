/**
 * 李沐论文精读 README 解析测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 验证公开目录中的论文、视频和时长能够保持关联。
 */
test("解析李沐论文精读表格", async () => {
  /** projectDirectory 是桌面版项目根目录。 */
  const projectDirectory = path.resolve(import.meta.dirname, "..");
  /** testDataRoot 是项目内允许测试写入的数据目录。 */
  const testDataRoot = path.join(projectDirectory, ".test-data");
  fs.mkdirSync(testDataRoot, { recursive: true });
  /** temporaryDirectory 是本测试独占的 SQLite 数据目录。 */
  const temporaryDirectory = fs.mkdtempSync(path.join(testDataRoot, "zhixu-mli-"));
  process.env.ZHIXU_DATA_DIR = temporaryDirectory;
  /** serviceModule 是李沐论文目录解析模块。 */
  const serviceModule = await import(
    `../lib/mli-paper-service.mjs?test=${Date.now()}`
  );
  /** readmeFixture 是一条精简但结构真实的 Markdown 表格。 */
  const readmeFixture = `
# 深度学习论文精读
## 录制完成的论文
| 日期 | 标题 | 封面 | 时长 | 视频（播放数） |
| --: | -- | -- | --: | -- |
| 3/10/22 | [OpenAI Codex](https://arxiv.org/pdf/2107.03374.pdf) 论文精读 | ![](cover.jpg) | 47:58 | [bilibili](https://www.bilibili.com/video/BV1example) [youtube](https://youtu.be/example) |

## 所有论文
`;
  try {
    /** papers 是从测试 Markdown 解析出的精读条目。 */
    const papers = serviceModule.parseMliPaperReadme(readmeFixture);
    assert.equal(papers.length, 1);
    assert.equal(papers[0].title, "OpenAI Codex 论文精读");
    assert.equal(papers[0].sourceUrl, "https://arxiv.org/abs/2107.03374");
    assert.equal(papers[0].pdfUrl, "https://arxiv.org/pdf/2107.03374.pdf");
    assert.equal(
      papers[0].videoUrl,
      "https://www.bilibili.com/video/BV1example",
    );
    assert.equal(papers[0].videoAltUrl, "https://youtu.be/example");
    assert.equal(papers[0].duration, "47:58");
  } finally {
    /** databaseModule 用于关闭解析模块间接创建的测试数据库。 */
    const databaseModule = await import("../lib/database.mjs");
    databaseModule.closeDatabase();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
