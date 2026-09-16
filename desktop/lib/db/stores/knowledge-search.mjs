/** 把统一搜索查询引擎绑定到进程内共享 SQLite 连接。 */
import { searchKnowledgePage } from "../../knowledge-search.mjs";

/** 创建统一搜索仓储，同时保留旧数组和分页两种返回形式。 */
export function createKnowledgeSearchStore(database, {
  searchPage = searchKnowledgePage,
} = {}) {
  /** 返回去重后的搜索结果数组，兼容原有内部调用。 */
  function searchKnowledgeBase(filters = {}) {
    return searchPage(database, filters).results;
  }

  /** 返回包含总数、游标和是否还有下一页的搜索页。 */
  function searchKnowledgeBasePage(filters = {}) {
    return searchPage(database, filters);
  }

  return Object.freeze({
    searchKnowledgeBase,
    searchKnowledgeBasePage,
  });
}
