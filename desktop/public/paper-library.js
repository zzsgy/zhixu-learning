import { arrangePaperCard } from "./paper-card-layout.js";

/** 论文专用目录控制器。所有名称经 textContent 写入，路径始终使用稳定 ID。 */
export function createPaperLibrary({ request, notify, reload }) {
  const $ = id => document.getElementById(id);
  const el = (tag, text, className = "") => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
  const button = (text, action, className = "secondary-button") => { const node = el("button", text, className); node.type = "button"; node.addEventListener("click", action); return node; };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("zhixu-paper-organization") || "{}"); } catch {}
  const state = { folder: typeof saved.folder === "string" ? saved.folder : "", page: 1, folders: [], papers: [], selected: new Map(), expanded: new Set(Array.isArray(saved.expanded) ? saved.expanded : []), total: 0, libraryTotal: 0, unfiledCount: 0 };
  $("paper-sort").value = ["recent", "oldest", "published", "title"].includes(saved.sort) ? saved.sort : "recent";
  const save = () => { try { localStorage.setItem("zhixu-paper-organization", JSON.stringify({ folder: state.folder, sort: $("paper-sort").value, expanded: [...state.expanded] })); } catch {} };
  function changed({ keepSelection = false } = {}) {
    state.page = 1;
    if (!keepSelection) state.selected.clear();
    save();
    void reload();
  }
  function chooseFolder(id) {
    state.folder = id;
    for (const part of state.folders.find(f => f.id === id)?.path || []) state.expanded.add(part.id);
    $("paper-folder-search").value = "";
    changed();
  }
  function tree() {
    const root = $("paper-folder-tree"); root.replaceChildren();
    const add = (id, label, count, depth = 0, hasChildren = false) => {
      const row = el("div", "", "paper-folder-row"); row.style.setProperty("--folder-depth", String(depth));
      if (hasChildren) {
        const toggle = button(state.expanded.has(id) ? "▾" : "▸", () => { state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); save(); tree(); }, "paper-folder-toggle");
        toggle.setAttribute("aria-label", `${state.expanded.has(id) ? "折叠" : "展开"}${label}`); toggle.setAttribute("aria-expanded", String(state.expanded.has(id))); row.append(toggle);
      } else row.append(el("span", "", "paper-folder-spacer"));
      const entry = button("", () => chooseFolder(id), "paper-folder-entry"); entry.append(el("span", label), el("small", String(count)));
      entry.classList.toggle("is-active", state.folder === id); if (state.folder === id) entry.setAttribute("aria-current", "page");
      entry.title = state.folders.find(f => f.id === id)?.path.map(p => p.name).join(" / ") || label;
      row.append(entry); root.append(row);
    };
    add("", "全部论文", state.libraryTotal); add("unfiled", "未归档", state.unfiledCount);
    const query = $("paper-folder-search").value.trim().toLocaleLowerCase();
    const allowed = new Set();
    if (query) for (const f of state.folders) if (f.path.map(p => p.name).join(" / ").toLocaleLowerCase().includes(query)) for (const p of f.path) allowed.add(p.id);
    const visit = (parentId, depth) => {
      for (const f of state.folders.filter(item => (item.parentId || "") === parentId)) {
        if (query && !allowed.has(f.id)) continue;
        const children = state.folders.some(item => item.parentId === f.id);
        add(f.id, f.name, f.count, depth, children);
        if (query || state.expanded.has(f.id)) visit(f.id, depth + 1);
      }
    };
    visit("", 0);
    if (!state.folders.length) root.append(el("p", "还没有目录。点击“新建”创建你的第一条研究线索。", "paper-directory-hint"));
    else if (query && !allowed.size) root.append(el("p", "没有匹配目录", "paper-directory-hint"));
  }
  function render() {
    tree();
    const current = state.folders.find(f => f.id === state.folder);
    const crumbs = $("paper-folder-breadcrumbs"); crumbs.replaceChildren(button("全部论文", () => chooseFolder("")));
    for (const part of current?.path || []) crumbs.append(el("span", "/"), button(part.name, () => chooseFolder(part.id)));
    if (state.folder === "unfiled") crumbs.append(el("span", "/ 未归档"));
    const actions = $("paper-folder-actions"); actions.replaceChildren();
    if (current) actions.append(button("新建子目录", () => edit("create", current)), button("重命名", () => edit("rename", current)), button("移动目录", () => edit("reparent", current)), button("删除目录", () => remove(current), "danger-button"));
    $("paper-descendants-label").hidden = !current;
    $("paper-result-status").textContent = `${current ? current.path.map(p => p.name).join(" / ") : state.folder === "unfiled" ? "未归档" : "全部论文"} · 匹配 ${state.total} 篇 / 全库 ${state.libraryTotal} 篇`;
    $("paper-page-status").textContent = `第 ${state.page} / ${Math.max(1, Math.ceil(state.total / 24))} 页 · 每页 24 篇`;
    $("paper-prev-page").disabled = state.page <= 1; $("paper-next-page").disabled = state.page * 24 >= state.total;
    $("paper-pagination").hidden = state.total <= 24;
    selection();
  }
  function selection() {
    const count = state.selected.size;
    $("paper-selection-count").textContent = `已选 ${count} 篇`;
    $("paper-move-selected").disabled = !count; $("paper-clear-selection").disabled = !count;
    const pageSelected = state.papers.filter(p => state.selected.has(p.id)).length;
    $("paper-select-page").checked = !!state.papers.length && pageSelected === state.papers.length;
    $("paper-select-page").indeterminate = pageSelected > 0 && pageSelected < state.papers.length;
    $("paper-select-page").disabled = !state.papers.length;
    for (const input of document.querySelectorAll("input[data-paper-select]")) {
      input.checked = state.selected.has(input.dataset.paperSelect);
      input.closest(".paper-card")?.classList.toggle("is-selected", input.checked);
    }
  }
  const dialog = document.createElement("dialog"); dialog.className = "paper-organization-dialog"; document.body.append(dialog);
  function showForm(title, fields, submit) {
    dialog.replaceChildren();
    const form = document.createElement("form"), heading = el("h2", title), error = el("p", "", "paper-dialog-error");
    heading.id = "paper-organization-title"; dialog.setAttribute("aria-labelledby", heading.id); error.setAttribute("role", "alert");
    const confirm = button("保存", () => {}); confirm.type = "submit";
    form.append(heading, ...fields, error, el("div", "", "paper-dialog-footer"));
    form.lastChild.append(button("取消", () => dialog.close()), confirm);
    form.addEventListener("submit", async event => { event.preventDefault(); confirm.disabled = true; try { await submit(); dialog.close(); } catch (e) { error.textContent = e.message; } finally { confirm.disabled = false; } });
    dialog.append(form); dialog.showModal(); form.querySelector("input,select")?.focus();
  }
  function folderSelect(emptyLabel, selected, exclude) {
    const select = document.createElement("select"); select.setAttribute("aria-label", "目标论文目录");
    select.append(new Option(emptyLabel, ""));
    const folders = [...state.folders].sort((a,b) => a.path.map(p=>p.name).join("/").localeCompare(b.path.map(p=>p.name).join("/"), "zh-CN"));
    for (const f of folders) if (!exclude || !f.path.some(p => p.id === exclude)) select.append(new Option(f.path.map(p => p.name).join(" / "), f.id));
    select.value = selected || ""; return select;
  }
  function label(text, control) { const node = el("label", text); node.append(control); return node; }
  function edit(mode, current) {
    const input = document.createElement("input"); input.maxLength = 80; input.required = true; input.value = mode === "rename" ? current.name : "";
    const select = folderSelect("论文目录根层级", mode === "reparent" ? current.parentId : current?.id, mode === "reparent" ? current.id : null);
    const fields = mode === "reparent" ? [label("移动到", select)] : [label("目录名称", input), ...(mode === "create" ? [label("上级目录", select)] : [])];
    showForm({ create: "新建论文目录", rename: "重命名论文目录", reparent: "移动论文目录" }[mode], fields, async () => {
      const body = mode === "reparent" ? { parentId: select.value || null } : { name: input.value, ...(mode === "create" ? { parentId: select.value || null } : {}) };
      const result = await request(mode === "create" ? "/api/paper-folders" : `/api/paper-folders/${encodeURIComponent(current.id)}`, { method: mode === "create" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (mode === "create") { state.folder = result.folder.id; state.selected.clear(); }
      for (const p of result.folder.path) state.expanded.add(p.id);
      state.folders = result.folders; changed({ keepSelection: true }); notify("论文目录已保存。");
    });
  }
  async function remove(current) {
    if (state.folders.some(f => f.parentId === current.id)) { notify("目录含子目录，请先移动或删除子目录；论文不会被删除。"); return; }
    if (!window.confirm(`删除目录“${current.name}”？其中 ${current.directCount} 篇论文将回到“未归档”，论文正文、笔记和阅读进度均保留。`)) return;
    try { await request(`/api/paper-folders/${encodeURIComponent(current.id)}`, { method: "DELETE" }); state.folder = "unfiled"; changed(); notify("目录已删除，论文已保留在未归档。"); } catch(e) { notify(e.message); }
  }
  function move(papers) {
    const selected = folderSelect("未归档（移出当前目录）", papers.length === 1 ? papers[0].folderId : "");
    showForm(`移动 ${papers.length} 篇论文`, [el("p", papers.slice(0,3).map(p=>p.titleZh || p.title).join("、") + (papers.length > 3 ? "…" : "")), label("目标目录", selected), el("small", "只改变归档位置，不复制或删除论文。")], async () => {
      await request("/api/paper-folder-items", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paperIds: papers.map(p => p.id), folderId: selected.value || null }) });
      changed(); notify(`${papers.length} 篇论文已移动。`);
    });
  }
  function decorate(card, paper) {
    const input = document.createElement("input"); input.type = "checkbox"; input.dataset.paperSelect = paper.id; input.checked = state.selected.has(paper.id);
    input.setAttribute("aria-label", `选择论文：${paper.titleZh || paper.title}`);
    input.addEventListener("change", () => { input.checked ? state.selected.set(paper.id, paper) : state.selected.delete(paper.id); selection(); });
    const location = state.folders.find(f => f.id === paper.folderId);
    arrangePaperCard(card, {
      paper, checkbox: input,
      location: button(location ? location.path.map(p=>p.name).join(" / ") : "未归档", () => chooseFolder(location?.id || "unfiled"), "paper-location-link"),
      readingStatus: { unread: "未读", reading: "在读", completed: "已读" }[paper.readingStatus] || "未读",
      moveButton: button("移动目录", () => move([paper])),
    });
    card.classList.toggle("is-selected", state.selected.has(paper.id));
  }
  document.addEventListener("click", event => {
    for (const more of $("paper-grid").querySelectorAll(".paper-card-more[open]")) {
      if (!more.contains(event.target)) more.open = false;
    }
  });
  let searchTimer;
  $("paper-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => changed(), 220); });
  $("paper-folder-search").addEventListener("input", tree);
  for (const id of ["paper-sort", "paper-reading-filter", "paper-descendants"]) $(id).addEventListener("change", () => changed());
  $("paper-folder-new").addEventListener("click", () => edit("create", null));
  $("paper-prev-page").addEventListener("click", () => { state.page--; void reload(); });
  $("paper-next-page").addEventListener("click", () => { state.page++; void reload(); });
  $("paper-select-page").addEventListener("change", event => { for (const p of state.papers) event.target.checked ? state.selected.set(p.id,p) : state.selected.delete(p.id); selection(); });
  $("paper-clear-selection").addEventListener("click", () => { state.selected.clear(); selection(); });
  $("paper-move-selected").addEventListener("click", () => move([...state.selected.values()]));
  const importSelect = folderSelect("未归档", ""); importSelect.id = "paper-import-folder";
  $("paper-import-form").before(label("论文保存目录", importSelect));
  async function prepareImport(fromPapers) {
    const desiredId = fromPapers && state.folder !== "unfiled" ? state.folder : "";
    const update = () => { const select = folderSelect("未归档", desiredId); const selectedId = select.value; importSelect.replaceChildren(...select.children); importSelect.value = selectedId; };
    update(); importSelect.disabled = true;
    try { const payload = await request("/api/paper-folders"); state.folders = payload.folders; update(); }
    catch (error) { notify(error.message); }
    finally { importSelect.disabled = false; }
  }
  return {
    changed, decorate, prepareImport,
    query(source) { return new URLSearchParams({ page: String(state.page), folder: state.folder, q: $("paper-search").value, source, quality: $("paper-quality-filter").value, reading: $("paper-reading-filter").value, sort: $("paper-sort").value, descendants: $("paper-descendants").checked ? "1" : "0" }).toString(); },
    setData(data) { Object.assign(state, { folders: data.folders, papers: data.papers, page: data.page, total: data.total, libraryTotal: data.libraryTotal, unfiledCount: data.unfiledCount }); render(); },
    async recoverFolder() { const result = await request("/api/paper-folders"); if (state.folder && state.folder !== "unfiled" && !result.folders.some(f => f.id === state.folder)) { state.folder = ""; changed(); return true; } return false; },
    importFolderId() { return importSelect.value; },
    libraryTotal() { return state.libraryTotal; },
  };
}
