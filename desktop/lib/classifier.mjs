/**
 * 文档领域自动分类模块。
 *
 * 先使用可解释的本地关键词评分；配置 DeepSeek 后，再使用 AI 校正分类。
 */
import { serverConfig } from "./config.mjs";

/** 允许持久化的全部知识分类。 */
export const DOCUMENT_CATEGORIES = Object.freeze([
  "AI",
  "数据库",
  "安全",
  "程序",
  "生物工程",
  "工艺工程",
  "其它",
]);

/** categoryKeywords 是每个领域的中英文技术关键词。 */
const categoryKeywords = Object.freeze({
  AI: [
    "人工智能",
    "大模型",
    "语言模型",
    "llm",
    "agent",
    "transformer",
    "attention",
    "机器学习",
    "深度学习",
    "神经网络",
    "embedding",
    "rag",
    "推理模型",
    "prompt",
    "微调",
    "多模态",
  ],
  数据库: [
    "数据库",
    "postgresql",
    "postgres",
    "mysql",
    "sqlite",
    "sql",
    "索引",
    "事务",
    "mvcc",
    "查询优化",
    "存储过程",
    "数据仓库",
    "redis",
    "mongodb",
  ],
  安全: [
    "网络安全",
    "信息安全",
    "漏洞",
    "攻击",
    "防火墙",
    "加密",
    "解密",
    "认证",
    "授权",
    "零信任",
    "渗透测试",
    "恶意软件",
    "威胁",
    "xss",
    "csrf",
    "sql注入",
    "security",
  ],
  程序: [
    "编程",
    "程序设计",
    "软件工程",
    "源代码",
    "算法",
    "数据结构",
    "javascript",
    "typescript",
    "python",
    "java",
    "kotlin",
    "golang",
    "rust",
    "react",
    "api",
    "微服务",
    "测试",
    "debug",
    "git",
  ],
  生物工程: [
    "生物工程",
    "生物制药",
    "细胞培养",
    "发酵",
    "菌种",
    "培养基",
    "生物反应器",
    "蛋白纯化",
    "层析",
    "过滤",
    "疫苗",
    "抗体",
    "上游工艺",
    "下游工艺",
    "微生物",
    "代谢",
  ],
  工艺工程: [
    "工艺工程",
    "cip",
    "sip",
    "清洁验证",
    "洁净生产",
    "洁净室",
    "泵",
    "换热器",
    "管道",
    "阀门",
    "流体",
    "传热",
    "传质",
    "压降",
    "雷诺数",
    "p&id",
    "公用工程",
    "纯化水",
    "注射用水",
  ],
});

/**
 * 统计关键词在文本中的出现次数。
 *
 * @param {string} text 已转换为小写的待分类文本。
 * @param {string} keyword 领域关键词。
 * @returns {number} 关键词命中次数。
 */
function countKeywordOccurrences(text, keyword) {
  /** escapedKeyword 是可安全用于正则表达式的关键词。 */
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(escapedKeyword, "gi"))].length;
}

/**
 * 使用本地关键词规则完成初步分类。
 *
 * @param {{ fileName: string, text: string }} input 文件名和正文。
 * @returns {{ category: string, confidence: number, scores: Record<string, number> }} 分类结果。
 */
export function classifyWithRules(input) {
  /** searchableText 将文件名赋予更高权重后与正文组合。 */
  const searchableText = `${input.fileName} ${input.fileName} ${input.text.slice(0, 120000)}`.toLowerCase();
  /** scores 保存每个候选分类的关键词得分。 */
  const scores = {};
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    scores[category] = keywords.reduce(
      (score, keyword) =>
        score + countKeywordOccurrences(searchableText, keyword.toLowerCase()),
      0,
    );
  }
  /** orderedScores 是按得分从高到低排列的分类结果。 */
  const orderedScores = Object.entries(scores).sort(
    (left, right) => right[1] - left[1],
  );
  /** bestCategory 是得分最高的候选分类。 */
  const [bestCategory, bestScore] = orderedScores[0] ?? ["其它", 0];
  /** secondScore 是次高分类得分，用于评估置信度。 */
  const secondScore = orderedScores[1]?.[1] ?? 0;
  if (bestScore === 0) {
    return { category: "其它", confidence: 0.2, scores };
  }
  /** confidence 综合最高分绝对值和领先幅度。 */
  const confidence = Math.min(
    0.95,
    0.45 + bestScore * 0.05 + Math.max(bestScore - secondScore, 0) * 0.05,
  );
  return { category: bestCategory, confidence, scores };
}

/**
 * 判断未知值是否是允许的文档分类。
 *
 * @param {unknown} value 待校验值。
 * @returns {boolean} 是否属于允许分类。
 */
export function isDocumentCategory(value) {
  return typeof value === "string" && DOCUMENT_CATEGORIES.includes(value);
}

/**
 * 请求 DeepSeek 对规则结果进行校正。
 *
 * @param {{ fileName: string, text: string, ruleCategory: string }} input 分类上下文。
 * @returns {Promise<{ category: string, confidence: number, source: string } | null>} AI 分类或空值。
 */
async function classifyWithDeepSeek(input) {
  if (!serverConfig.deepSeekApiKey || !input.text.trim()) return null;
  /** prompt 是限制输出为 JSON 的中文分类指令。 */
  const prompt = [
    "你是个人技术知识库的文档分类器。",
    `只能选择以下一个分类：${DOCUMENT_CATEGORIES.join("、")}。`,
    "分类时以正文技术主题为准，不要仅根据偶然出现的单个词判断。",
    '只返回 JSON：{"category":"分类","confidence":0到1之间的小数}。',
    `文件名：${input.fileName}`,
    `本地规则初判：${input.ruleCategory}`,
    `正文节选：${input.text.slice(0, 12000)}`,
  ].join("\n");
  /** response 是 DeepSeek 聊天补全接口响应。 */
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverConfig.deepSeekApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) return null;
  /** payload 是 DeepSeek 返回的完整 JSON。 */
  const payload = await response.json();
  /** rawContent 是模型消息正文。 */
  const rawContent = payload?.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string") return null;
  /** parsedContent 是模型给出的分类对象。 */
  const parsedContent = JSON.parse(rawContent);
  if (!isDocumentCategory(parsedContent.category)) return null;
  /** confidence 是限制到 0 至 1 的置信度。 */
  const confidence = Math.min(
    Math.max(Number(parsedContent.confidence) || 0.75, 0),
    1,
  );
  return { category: parsedContent.category, confidence, source: "deepseek" };
}

/**
 * 先执行本地规则，再在可用时使用 DeepSeek 提升分类准确率。
 *
 * @param {{ fileName: string, text: string }} input 文件名和提取正文。
 * @returns {Promise<{ category: string, confidence: number, source: string }>} 最终分类。
 */
export async function classifyDocument(input) {
  /** ruleResult 是无需联网即可得到的初步分类。 */
  const ruleResult = classifyWithRules(input);
  try {
    /** aiResult 是可选的 DeepSeek 分类校正。 */
    const aiResult = await classifyWithDeepSeek({
      ...input,
      ruleCategory: ruleResult.category,
    });
    if (aiResult) return aiResult;
  } catch {
    // AI 分类失败不影响上传，系统会保留可解释的本地规则结果。
  }
  return {
    category: ruleResult.category,
    confidence: ruleResult.confidence,
    source: "rules",
  };
}
