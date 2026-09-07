/** 项目导航的纯数据逻辑；排序不修改缓存，搜索覆盖名称、组织和简介。 */
export function getProjectPage(projects, { query = "", sort = "recent", page = 1 } = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = projects.filter((project) => {
    const text = [project.fullName, project.description, project.analysisSummary, project.primaryLanguage]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const byName = (a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "zh-CN", { numeric: true });
  matches.sort((a, b) => {
    if (sort === "name") return byName(a, b);
    if (sort === "stars") return (Number(b.stars) || 0) - (Number(a.stars) || 0) || byName(a, b);
    return (Date.parse(b.analyzedAt) || 0) - (Date.parse(a.analyzedAt) || 0) || byName(a, b);
  });
  const pages = Math.max(1, Math.ceil(matches.length / 10));
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
  return { items: matches.slice((current - 1) * 10, current * 10), total: matches.length, pages, page: current };
}
