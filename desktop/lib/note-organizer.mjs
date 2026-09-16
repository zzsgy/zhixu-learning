/** 笔记定时整理的纯本地规则，不联网，也不修改原始笔记。 */

/** 计算下一次本地运行时间。 */
export function calculateNextNoteRun(settings, from = new Date()) {
  const [hours, minutes] = String(settings.time || "21:00").split(":").map(Number);
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(Number.isFinite(hours) ? hours : 21, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  if (settings.frequency === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  const weekday = Math.min(6, Math.max(0, Number(settings.weekday) || 0));
  let days = (weekday - next.getDay() + 7) % 7;
  if (days === 0 && next <= from) days = 7;
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function cleanLine(line) {
  return String(line || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .trim();
}

function noteLines(noteText) {
  return String(noteText || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length >= 3 && !/^(核心问题|我的理解|证据与局限|下一步行动)$/.test(line));
}

function excerpt(value, maximum = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function toDigestPoint(note, text) {
  return {
    text: excerpt(text),
    targetType: note.targetType,
    targetId: note.targetId,
    title: note.title,
  };
}

/**
 * 把本期新增或修改的笔记归纳为主题、重点、疑问和下一步行动。
 * 结果只保存派生摘要，来源文本保持不变。
 */
export function createLocalNoteDigest(notes, now = new Date()) {
  const safeNotes = Array.isArray(notes) ? notes.filter((note) => String(note.noteText || "").trim()) : [];
  const themes = new Map();
  const keyPoints = [];
  const questions = [];
  const actions = [];

  for (const note of safeNotes) {
    const themeName = String(note.category || "未分类").trim() || "未分类";
    const theme = themes.get(themeName) || { name: themeName, count: 0, sources: [] };
    theme.count += 1;
    if (!theme.sources.some((source) => source.targetType === note.targetType && source.targetId === note.targetId)) {
      theme.sources.push({ targetType: note.targetType, targetId: note.targetId, title: note.title });
    }
    themes.set(themeName, theme);

    const lines = noteLines(note.noteText);
    for (const line of lines.slice(0, 2)) {
      if (keyPoints.length < 10) keyPoints.push(toDigestPoint(note, line));
    }
    for (const line of lines) {
      if (questions.length < 8 && /[?？]|^(为什么|如何|是否|疑问|问题)/.test(line)) {
        questions.push(toDigestPoint(note, line));
      }
      if (actions.length < 8 && /(下一步|待办|TODO|行动|尝试|验证|补充|复现|阅读)/i.test(line)) {
        actions.push(toDigestPoint(note, line));
      }
    }
  }

  const sourceCount = new Set(safeNotes.map((note) => `${note.targetType}:${note.targetId}`)).size;
  return {
    title: `${settingsLabel(safeNotes.length)} · ${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(now)}`,
    overview: safeNotes.length
      ? `本期整理了 ${safeNotes.length} 条笔记，来自 ${sourceCount} 份资料，归入 ${themes.size} 个主题。`
      : "本期没有需要整理的新笔记。",
    themes: [...themes.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN")),
    keyPoints,
    questions,
    actions,
  };
}

function settingsLabel(count) {
  return count ? "笔记整理" : "整理检查";
}
