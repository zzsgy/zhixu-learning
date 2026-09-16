/** 笔记库 HTTP 路由。URL、状态码和响应结构保持兼容。 */
import {
  createDailyBackup,
  createStandaloneNote,
  deleteStandaloneNote,
  getNoteLibrarySummary,
  getStandaloneNote,
  listAllNotes,
  listNoteDigests,
  updateNoteOrganizationSettings,
  updateStandaloneNote,
} from "../../database.mjs";
import { normalizeStandaloneNoteContent } from "../../note-content.mjs";
import { createWordNoteDocument } from "../../note-docx.mjs";
import { calculateNextNoteRun } from "../../note-organizer.mjs";

/**
 * 创建笔记路由处理器。通用 HTTP 帮助函数由服务入口注入，避免反向依赖 server.mjs。
 */
export function createNoteRouteHandler({
  createExportFileName,
  ensureNoteOrganizationSchedule,
  readRequestBuffer,
  runNoteOrganization,
  sendJson,
}) {
  return async function handleNoteRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/notes") {
      const settings = ensureNoteOrganizationSchedule();
      const notes = listAllNotes({
        query: url.searchParams.get("query") || "",
        targetType: url.searchParams.get("targetType") || "",
        limit: Number(url.searchParams.get("limit") || 100),
        offset: Number(url.searchParams.get("offset") || 0),
      });
      const pending = listAllNotes({ updatedAfter: settings.lastRunAt || "", limit: 5000 })
        .items.filter((note) => String(note.noteText || "").trim()).length;
      sendJson(response, 200, {
        notes: notes.items,
        total: notes.total,
        hasMore: notes.hasMore,
        summary: { ...getNoteLibrarySummary(), pendingCount: pending },
        settings,
        digests: listNoteDigests(12),
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/notes") {
      const payload = JSON.parse((await readRequestBuffer(request, 32 * 1024)).toString("utf8") || "{}");
      const noteType = String(payload.noteType || "").trim().toLowerCase();
      if (!["markdown", "text", "word"].includes(noteType)) {
        sendJson(response, 400, { message: "不支持这种笔记类型。" });
        return true;
      }
      const note = createStandaloneNote(noteType);
      createDailyBackup();
      sendJson(response, 201, { note });
      return true;
    }

    if (request.method === "PATCH" && url.pathname === "/api/notes/settings") {
      const requestBuffer = await readRequestBuffer(request, 32 * 1024);
      const payload = JSON.parse(requestBuffer.toString("utf8") || "{}");
      const base = updateNoteOrganizationSettings({
        enabled: payload.enabled,
        frequency: payload.frequency,
        weekday: payload.weekday,
        time: payload.time,
        nextRunAt: null,
      });
      const settings = updateNoteOrganizationSettings({
        nextRunAt: base.enabled ? calculateNextNoteRun(base) : null,
      });
      sendJson(response, 200, { settings });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/notes/organize") {
      const result = runNoteOrganization({ manual: true });
      sendJson(response, result.digest ? 201 : 200, {
        organized: Boolean(result.digest),
        message: result.digest ? "新笔记已完成本地整理。" : "没有需要整理的新笔记。",
        ...result,
      });
      return true;
    }

    const noteExportMatch = url.pathname.match(/^\/api\/notes\/([^/]+)\/export$/);
    if (request.method === "GET" && noteExportMatch) {
      const note = getStandaloneNote(decodeURIComponent(noteExportMatch[1]));
      if (!note) {
        sendJson(response, 404, { message: "找不到这条独立笔记。" });
        return true;
      }
      let body;
      let extension;
      let contentType;
      if (note.noteType === "word") {
        body = await createWordNoteDocument({ title: note.title, html: note.contentData?.html || "" });
        extension = "docx";
        contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else {
        body = Buffer.from(note.contentText || "", "utf8");
        extension = note.noteType === "markdown" ? "md" : "txt";
        contentType = "text/plain; charset=utf-8";
      }
      const fileName = createExportFileName(note.title, extension);
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": body.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(body);
      return true;
    }

    const standaloneNoteMatch = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
    if (standaloneNoteMatch && ["GET", "PATCH", "DELETE"].includes(request.method)) {
      const id = decodeURIComponent(standaloneNoteMatch[1]);
      if (request.method === "GET") {
        const note = getStandaloneNote(id);
        sendJson(response, note ? 200 : 404, note ? { note } : { message: "找不到这条独立笔记。" });
        return true;
      }
      if (request.method === "DELETE") {
        const deleted = deleteStandaloneNote(id);
        if (deleted) createDailyBackup();
        sendJson(response, deleted ? 200 : 404, deleted ? { deleted: true } : { message: "找不到这条独立笔记。" });
        return true;
      }
      const current = getStandaloneNote(id);
      if (!current) {
        sendJson(response, 404, { message: "找不到这条独立笔记。" });
        return true;
      }
      const payload = JSON.parse((await readRequestBuffer(request, 2_200_000)).toString("utf8") || "{}");
      const normalized = normalizeStandaloneNoteContent(current.noteType, payload);
      const note = updateStandaloneNote(id, { title: payload.title, ...normalized });
      createDailyBackup();
      sendJson(response, 200, { note });
      return true;
    }

    return false;
  };
}
