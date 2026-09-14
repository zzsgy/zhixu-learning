/** A shared, left-aligned card structure for both paper list and grid views. */
export function arrangePaperCard(card, { paper, checkbox, location, readingStatus, moveButton }) {
  const doc = card.ownerDocument;
  const make = (tag, className, text = "") => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const content = card.querySelector(".paper-card-content");
  const metadata = card.querySelector(".paper-card-meta");
  const footer = card.querySelector("footer");
  const source = content.querySelector(".paper-source-label");
  if (source) metadata.prepend(source);
  location.classList.add("paper-location-link");
  location.title = location.textContent;
  const reading = make("span", "paper-card-reading-status", readingStatus);
  reading.dataset.status = paper.readingStatus || "unread";
  metadata.append(location, reading);
  content.prepend(metadata);

  const selection = make("label", "paper-card-select");
  selection.title = checkbox.getAttribute("aria-label");
  selection.append(checkbox);
  card.prepend(selection);

  const states = make("div", "paper-card-states");
  for (const state of content.querySelectorAll(".paper-translation-state")) {
    state.title = state.textContent;
    if (state.classList.contains("is-translated") && !state.classList.contains("is-failed")
        && state.textContent.startsWith("Codex 中文全文已完成 ·")) {
      state.textContent = paper.fullTranslationFidelity === "complete"
        ? "中文全文 · 已校验"
        : paper.fullTranslationFidelity === "degraded"
          ? "中文全文 · 图文结构降级"
          : "中文全文 · 完整性待核验";
      state.classList.toggle("is-warning", paper.fullTranslationFidelity !== "complete");
    }
    states.append(state);
  }

  // Keep existing elements and listeners: moving an action must not rebind it.
  const actions = make("div", "paper-card-actions");
  const reader = footer.firstElementChild;
  const more = make("details", "paper-card-more");
  const summary = make("summary", "paper-card-more-trigger", "更多");
  summary.setAttribute("aria-label", `更多操作：${paper.titleZh || paper.title}`);
  const menu = make("div", "paper-card-more-panel");
  for (const action of [...footer.children].slice(1)) menu.append(action);
  more.append(summary, menu);
  more.addEventListener("toggle", () => {
    if (!more.open) return;
    for (const other of card.parentElement?.querySelectorAll(".paper-card-more[open]") || []) {
      if (other !== more) other.open = false;
    }
  });
  more.addEventListener("keydown", event => {
    if (event.key === "Escape") { more.open = false; summary.focus(); }
  });
  menu.addEventListener("click", event => {
    if (event.target.closest("a, button")) more.open = false;
  });
  if (reader) actions.append(reader);
  actions.append(moveButton, more);
  footer.replaceChildren(states, actions);
  content.append(footer);
}
