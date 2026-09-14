import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeGitHubRepository,
  parseGitHubRepositoryUrl,
} from "../lib/github-project-service.mjs";

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("GitHub 仓库链接只接受公开主页地址并生成规范身份", () => {
  assert.deepEqual(
    parseGitHubRepositoryUrl("https://github.com/openai/openai-node/tree/master"),
    {
      owner: "openai",
      repository: "openai-node",
      fullName: "openai/openai-node",
      url: "https://github.com/openai/openai-node",
    },
  );
  assert.equal(
    parseGitHubRepositoryUrl("https://github.com/openai/openai-node.git").repository,
    "openai-node",
  );
  assert.throws(
    () => parseGitHubRepositoryUrl("https://example.com/openai/openai-node"),
    /只支持/,
  );
  assert.throws(
    () => parseGitHubRepositoryUrl("https://github.com/openai"),
    /缺少仓库名称/,
  );
});

test("项目研读汇总 GitHub 证据并返回稳定的中文分析结构", async () => {
  const requestedUrls = [];
  const fetcher = async (url) => {
    requestedUrls.push(url);
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    if (pathname === "/repos/example/field-notes") {
      return jsonResponse({
        name: "field-notes",
        full_name: "example/field-notes",
        html_url: "https://github.com/example/field-notes",
        description: "A test knowledge project",
        private: false,
        owner: { login: "example" },
        default_branch: "main",
        language: "JavaScript",
        topics: ["knowledge-base", "rag"],
        stargazers_count: 42,
        forks_count: 7,
        subscribers_count: 3,
        open_issues_count: 2,
        size: 512,
        license: { spdx_id: "MIT" },
        archived: false,
        pushed_at: "2026-08-20T08:00:00.000Z",
      });
    }
    if (pathname.endsWith("/languages")) return jsonResponse({ JavaScript: 8000, CSS: 2000 });
    // 28,000 字符截断处正好落在 emoji 代理对中间，复现上游 HTTP 400。
    if (pathname.endsWith("/readme")) return new Response("x".repeat(27_999) + "😀末尾", { status: 200 });
    if (pathname.includes("/git/trees/")) {
      return jsonResponse({
        truncated: false,
        tree: [
          { path: "src", type: "tree" },
          { path: "src/index.js", type: "blob", size: 800 },
          { path: "package.json", type: "blob", size: 300 },
        ],
      });
    }
    if (pathname.endsWith("/contributors")) {
      return jsonResponse([{ login: "maintainer", contributions: 18 }]);
    }
    if (pathname.endsWith("/releases/latest")) return jsonResponse({ message: "Not Found" }, 404);
    if (pathname.endsWith("/contents/package.json")) {
      return new Response('{"scripts":{"start":"node src/index.js"}}', { status: 200 });
    }
    throw new Error(`测试没有覆盖请求：${url}`);
  };
  let aiRequestCount = 0;
  const aiFetcher = async (_url, options) => {
    aiRequestCount += 1;
    const requestPayload = JSON.parse(options.body);
    for (const message of requestPayload.messages) assert.equal(message.content.isWellFormed(), true);
    if (aiRequestCount === 1) assert.match(requestPayload.messages[1].content, /\uFFFD/);
    assert.equal(requestPayload.max_tokens, 8192);
    if (aiRequestCount === 1) {
      return jsonResponse({ choices: [{ message: { content: '{"overview":"回复被截断"' } }] });
    }
    const analysis = aiRequestCount === 2 ? {
      overview: "This is a local knowledge project used to validate repository research.",
      positioning: "It targets local knowledge management workflows.",
      architecture: "The src directory contains the application entry point and service logic.",
      coreModules: [{ name: "src", detail: "Contains the primary application code.", evidence: "Repository tree" }],
      technologyStack: [{ name: "JavaScript", detail: "Implements the service logic.", evidence: "Language statistics" }],
      executionFlow: ["Run npm start", "Load src/index.js"],
      strengths: ["The structure is concise and easy to inspect."],
      risks: ["The available evidence is limited."],
      gettingStarted: ["Read the README before running the project."],
      learningSuggestions: ["Trace the calls from the application entry point."],
    } : {
      overview: "这是一个用于验证项目研读流程的本地知识库示例。",
      positioning: "面向本地知识管理工作流，重点验证项目资料采集和分析过程。",
      architecture: "src 目录负责应用入口和主要服务逻辑，package.json 保存启动脚本。",
      coreModules: [{ name: "src", detail: "承载主程序入口和核心服务代码。", evidence: "依据仓库目录树判断。" }],
      technologyStack: [{ name: "JavaScript", detail: "用于实现本地服务和应用逻辑。", evidence: "依据 GitHub 语言统计。" }],
      executionFlow: ["执行 npm start 启动项目。", "启动脚本加载 src/index.js 应用入口。"],
      strengths: ["项目结构精简，入口和配置文件容易定位。"],
      risks: ["测试仓库提供的实现证据有限，部分结论仍需查看源码。"],
      gettingStarted: ["先阅读 README 中的安装和运行说明。"],
      learningSuggestions: ["从应用入口沿调用链阅读核心服务代码。"],
    };
    return jsonResponse({
    choices: [{
      message: {
        content: JSON.stringify(analysis),
      },
    }],
    });
  };

  const project = await analyzeGitHubRepository("https://github.com/example/field-notes", {
    deepSeekApiKey: "test-key",
    fetcher,
    aiFetcher,
  });

  assert.equal(project.fullName, "example/field-notes");
  assert.equal(project.primaryLanguage, "JavaScript");
  assert.equal(project.stars, 42);
  assert.equal(project.latestRelease, null);
  assert.equal(project.importantFiles[0], "package.json");
  assert.equal(project.analysisSource, "deepseek");
  assert.equal(project.analysis.coreModules[0].name, "src");
  assert.deepEqual(project.analysis.executionFlow, ["执行 npm start 启动项目。", "启动脚本加载 src/index.js 应用入口。"]);
  assert.equal(aiRequestCount, 3);
  assert.ok(requestedUrls.some((url) => url.includes("/git/trees/main?recursive=1")));
});

test("GitHub 匿名 API 限流时改用公开项目页和 README", async () => {
  const fetcher = async (url) => {
    if (url === "https://api.github.com/repos/example/rate-limited") {
      return jsonResponse(
        { message: "API rate limit exceeded" },
        403,
        { "x-ratelimit-remaining": "0" },
      );
    }
    if (url === "https://github.com/example/rate-limited") {
      return new Response(`<!doctype html><html><head>
        <meta name="octolytics-dimension-repository_default_branch" content="main">
        <meta property="og:description" content="example/rate-limited: A public fallback repository">
      </head><body><script type="application/json">{"stargazerCount":1234,"forksCount":35}</script>
        <a href="/example/rate-limited/stargazers" aria-label="1.2k stars">Stars</a>
        <a href="/example/rate-limited/forks">34 forks</a>
        <a href="/example/rate-limited/tree/main/src">src</a>
        <a href="/example/rate-limited/blob/main/package.json">package.json</a>
        <a href="/topics/rag">rag</a>
      </body></html>`, { status: 200 });
    }
    if (url === "https://raw.githubusercontent.com/example/rate-limited/HEAD/README.md") {
      return new Response("# Rate Limited\nPublic README evidence.", { status: 200 });
    }
    throw new Error(`测试没有覆盖请求：${url}`);
  };
  const project = await analyzeGitHubRepository("https://github.com/example/rate-limited", { fetcher });
  assert.equal(project.fullName, "example/rate-limited");
  assert.equal(project.stars, 1234);
  assert.equal(project.forks, 35);
  assert.equal(project.defaultBranch, "main");
  assert.deepEqual(project.topics, ["rag"]);
  assert.equal(project.structure[0].path, "src");
  assert.match(project.readmeExcerpt, /Public README evidence/);
  assert.match(project.analysisWarning, /公开项目页与 README/);
});
