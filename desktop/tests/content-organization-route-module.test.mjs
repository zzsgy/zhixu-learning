import assert from "node:assert/strict";
import test from "node:test";
import { createContentOrganizationRouteHandler } from "../lib/http/routes/content-organization-routes.mjs";

const createRecorder = () => {
  const responses = [];
  return {
    responses,
    sendJson: (response, statusCode, payload) => responses.push({ response, statusCode, payload }),
  };
};

test("目录列表和创建路由保持 128 KB 上限、201 响应及成功后备份顺序", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const byteLimits = [];
  const folders = [{ id: "folder-1", name: "工作" }];
  const handler = createContentOrganizationRouteHandler({
    createBackup: () => sequence.push("backup"),
    createFolder: (payload) => {
      sequence.push("create");
      if (payload.name === "失败") throw new Error("模拟创建失败");
      return folders[0];
    },
    listFolders: () => {
      sequence.push("list");
      return folders;
    },
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/folders"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.deepEqual(recorder.responses.at(-1).payload, { folders });

  sequence.length = 0;
  assert.equal(await handler(
    { method: "POST", payload: { name: "工作" } },
    {},
    new URL("http://local/api/folders"),
  ), true);
  assert.deepEqual(sequence, ["create", "backup", "list"]);
  assert.equal(recorder.responses.at(-1).statusCode, 201);
  assert.deepEqual(recorder.responses.at(-1).payload, { folder: folders[0], folders });
  assert.deepEqual(byteLimits, [128 * 1024]);

  await assert.rejects(
    handler(
      { method: "POST", payload: { name: "失败" } },
      {},
      new URL("http://local/api/folders"),
    ),
    /模拟创建失败/,
  );
  assert.deepEqual(sequence, ["create", "backup", "list", "create"]);
});

test("目录移动、重命名和删除路由解码 ID，并在写入后备份和刷新目录", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const byteLimits = [];
  const folders = [{ id: "folder/1", name: "新名称" }];
  const handler = createContentOrganizationRouteHandler({
    createBackup: () => sequence.push(["backup"]),
    deleteFolder: (folderId) => {
      sequence.push(["delete", folderId]);
      return true;
    },
    listFolders: () => {
      sequence.push(["list"]);
      return folders;
    },
    moveFolder: (folderId, parentId) => {
      sequence.push(["move", folderId, parentId]);
      return folders[0];
    },
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    renameFolder: (folderId, name) => {
      sequence.push(["rename", folderId, name]);
      return folders[0];
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "PATCH", payload: { parentId: "" } },
    {},
    new URL("http://local/api/folders/folder%2F1/move"),
  ), true);
  assert.equal(await handler(
    { method: "PATCH", payload: { name: "新名称" } },
    {},
    new URL("http://local/api/folders/folder%2F1"),
  ), true);
  assert.equal(await handler(
    { method: "DELETE" },
    {},
    new URL("http://local/api/folders/folder%2F1"),
  ), true);
  assert.deepEqual(sequence, [
    ["move", "folder/1", null],
    ["backup"],
    ["list"],
    ["rename", "folder/1", "新名称"],
    ["backup"],
    ["list"],
    ["delete", "folder/1"],
    ["backup"],
    ["list"],
  ]);
  assert.deepEqual(byteLimits, [128 * 1024, 128 * 1024]);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.deepEqual(recorder.responses.at(-1).payload, { deleted: true, folders });
});

test("单项和批量归档路由保持不同请求上限，并放行高风险批量删除", async () => {
  const recorder = createRecorder();
  const byteLimits = [];
  const calls = [];
  const folders = [{ id: "folder-1" }];
  const assignments = [
    { targetType: "document", targetId: "document-1", folderId: "folder-1" },
    { targetType: "article", targetId: "article-1", folderId: "folder-1" },
  ];
  const handler = createContentOrganizationRouteHandler({
    assignContent: (...args) => {
      calls.push(["single", ...args]);
      return assignments[0];
    },
    assignContents: (...args) => {
      calls.push(["batch", ...args]);
      return assignments;
    },
    createBackup: () => calls.push(["backup"]),
    listFolders: () => folders,
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    sendJson: recorder.sendJson,
  });
  const singlePayload = {
    targetType: "document",
    targetId: "document-1",
    folderId: "folder-1",
  };
  assert.equal(await handler(
    { method: "PATCH", payload: singlePayload },
    {},
    new URL("http://local/api/folder-items"),
  ), true);
  const batchPayload = { items: assignments, folderId: "folder-1" };
  assert.equal(await handler(
    { method: "PATCH", payload: batchPayload },
    {},
    new URL("http://local/api/folder-items/batch"),
  ), true);
  assert.deepEqual(byteLimits, [128 * 1024, 512 * 1024]);
  assert.deepEqual(calls, [
    ["single", "document", "document-1", "folder-1"],
    ["backup"],
    ["batch", assignments, "folder-1"],
    ["backup"],
  ]);
  assert.deepEqual(recorder.responses.at(-1).payload, {
    assignments,
    movedCount: 2,
    folders,
  });
  assert.equal(await handler(
    { method: "DELETE" },
    {},
    new URL("http://local/api/folder-items/batch"),
  ), false);
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/other"),
  ), false);
});

test("标签和内容组织路由保持查询参数、404、256 KB 上限和备份顺序", async () => {
  const recorder = createRecorder();
  const sequence = [];
  const byteLimits = [];
  const organization = { tags: ["本地"], topics: [] };
  const handler = createContentOrganizationRouteHandler({
    addTag: (...args) => {
      sequence.push(["add", ...args]);
      return ["本地", "知识库"];
    },
    createBackup: () => sequence.push(["backup"]),
    getOrganization: (targetType, targetId) => {
      sequence.push(["organization", targetType, targetId]);
      return targetId === "document/1" ? organization : null;
    },
    listTags: () => [{ name: "本地", itemCount: 1 }],
    readRequestBuffer: async (request, byteLimit) => {
      byteLimits.push(byteLimit);
      return Buffer.from(JSON.stringify(request.payload), "utf8");
    },
    removeTag: (...args) => {
      sequence.push(["remove", ...args]);
      return ["本地"];
    },
    sendJson: recorder.sendJson,
  });

  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/tags"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 200);
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/content-organization?targetType=document&targetId=document%2F1"),
  ), true);
  assert.deepEqual(recorder.responses.at(-1).payload, { organization });
  assert.equal(await handler(
    { method: "GET" },
    {},
    new URL("http://local/api/content-organization?targetType=document&targetId=missing"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 404);
  assert.deepEqual(recorder.responses.at(-1).payload, { message: "找不到对应内容。" });

  assert.equal(await handler(
    {
      method: "POST",
      payload: { targetType: "document", targetId: "document/1", tagName: "知识库" },
    },
    {},
    new URL("http://local/api/content-tags"),
  ), true);
  assert.equal(recorder.responses.at(-1).statusCode, 201);
  assert.equal(await handler(
    { method: "DELETE" },
    {},
    new URL("http://local/api/content-tags?targetType=document&targetId=document%2F1&tagName=%E7%9F%A5%E8%AF%86%E5%BA%93"),
  ), true);
  assert.deepEqual(byteLimits, [256 * 1024]);
  assert.deepEqual(sequence, [
    ["organization", "document", "document/1"],
    ["organization", "document", "missing"],
    ["add", "document", "document/1", "知识库"],
    ["backup"],
    ["remove", "document", "document/1", "知识库"],
    ["backup"],
  ]);
  assert.deepEqual(recorder.responses.at(-1).payload, { tags: ["本地"] });
});
