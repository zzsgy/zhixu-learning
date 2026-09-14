import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { rotateLogFile } from "../lib/log-rotation.mjs";

test("守护日志跨日轮换并清理超期归档", () => {
  const root = fs.mkdtempSync(path.join(import.meta.dirname, "..", ".test-data", "log-rotation-"));
  const logPath = path.join(root, "zhixu-service.log");
  const oldArchive = `${logPath}.old`;
  try {
    fs.writeFileSync(logPath, "历史日志\n", "utf8");
    fs.utimesSync(logPath, new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T00:00:00Z"));
    fs.writeFileSync(oldArchive, "过期日志\n", "utf8");
    fs.utimesSync(oldArchive, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"));

    const archivePath = rotateLogFile(logPath, {
      maxBytes: 1024,
      retentionDays: 30,
      now: new Date("2026-09-10T08:00:00Z"),
    });

    assert.ok(archivePath);
    assert.equal(fs.existsSync(logPath), false);
    assert.equal(fs.readFileSync(archivePath, "utf8"), "历史日志\n");
    assert.equal(fs.existsSync(oldArchive), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("同日未达到上限时继续使用当前日志", () => {
  const root = fs.mkdtempSync(path.join(import.meta.dirname, "..", ".test-data", "log-rotation-"));
  const logPath = path.join(root, "zhixu-service.log");
  try {
    fs.writeFileSync(logPath, "当前日志\n", "utf8");
    fs.utimesSync(logPath, new Date("2026-09-10T01:00:00Z"), new Date("2026-09-10T01:00:00Z"));
    const archivePath = rotateLogFile(logPath, {
      maxBytes: 1024,
      retentionDays: 30,
      now: new Date("2026-09-10T08:00:00Z"),
    });
    assert.equal(archivePath, null);
    assert.equal(fs.readFileSync(logPath, "utf8"), "当前日志\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
