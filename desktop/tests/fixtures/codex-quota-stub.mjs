import fs from "node:fs";
const args = process.argv.slice(2);
const control = JSON.parse(fs.readFileSync(process.env.ZHIXU_TEST_TRANSLATION_CONTROL, "utf8"));
fs.appendFileSync(control.logPath, `${args[0]}\n`);
if (args[0] === "login") { process.stdout.write("Logged in to ChatGPT\n"); process.exit(0); }
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (control.mode === "quota") { process.stderr.write("You've hit your usage limit. Try again later.\n"); process.exit(1); }
const html = "<h2>完整中文译文</h2><p>" + "这是模拟的完整中文正文，保留分段进度用于恢复测试。".repeat(70) + "</p>";
const output = { translatedHtml: html };
const schema = JSON.parse(fs.readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"));
if (schema.properties.translatedTitle) output.translatedTitle = "测试文章";
if (schema.properties.translatedSummary) output.translatedSummary = "用于验证暂停和恢复的完整中文测试摘要。";
fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify(output));
