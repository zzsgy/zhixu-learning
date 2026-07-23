/**
 * 首次使用时写入数据库的少量体系化样例卡片。
 *
 * 这里只提供验证产品流程所需的起点，不会一次生成数百张内容。
 * 后续卡片由手机到点触发或网页主动触发 DeepSeek 实时生成，然后写入同一数据库。
 */

/** 卡片一级领域。 */
export type CardDomain = "AI" | "BIO" | "DB";

/** 数据库写入所需的基础卡片结构。 */
export type StarterCard = {
  /** 稳定的跨端 ID。 */
  id: string;
  /** 一级领域。 */
  domain: CardDomain;
  /** 体系化系列。 */
  series: string;
  /** 难度层级。 */
  level: number;
  /** 系列顺序。 */
  sequence: number;
  /** 标题。 */
  title: string;
  /** 一句话摘要。 */
  summary: string;
  /** 卡片正文。 */
  content: string;
  /** 可选公式。 */
  formula: string | null;
  /** 可选流程步骤。 */
  flow: string[];
  /** 参考资料。 */
  sources: string[];
};

/** 九张起始卡片，用于展示 AI、生物工程与 PostgreSQL 三条学习主线。 */
export const STARTER_CARDS: StarterCard[] = [
  {
    id: "seed-ai-attention-001",
    domain: "AI",
    series: "Transformer 基础",
    level: 1,
    sequence: 1,
    title: "Attention 到底在计算什么",
    summary: "把查询与键的相关性变成权重，再对值做加权汇总。",
    content:
      "Self-Attention 的核心不是“记忆整个句子”，而是在当前层中，为每个 token 动态计算它应当从其他 token 取回多少信息。输入向量分别经过三个线性变换得到 Query、Key 与 Value。Query 和 Key 的点积表示匹配程度，除以根号下维度是为了控制数值尺度，再经过 Softmax 得到总和为 1 的权重。最后用这些权重对 Value 加权求和，形成新的上下文表示。多头注意力则让不同子空间分别学习语法依赖、实体关系、位置模式等关联。工程上应特别关注序列长度，因为标准注意力矩阵的时间和显存开销都近似随长度平方增长。",
    formula: "Attention(Q,K,V)=softmax(QKᵀ/√dₖ)V",
    flow: ["输入向量", "生成 Q/K/V", "相似度与缩放", "Softmax", "加权汇总"],
    sources: ["Attention Is All You Need", "The Annotated Transformer"],
  },
  {
    id: "seed-ai-rag-002",
    domain: "AI",
    series: "RAG 工程",
    level: 1,
    sequence: 1,
    title: "RAG 的最小闭环",
    summary: "检索不是终点，关键是让证据进入可验证的生成链路。",
    content:
      "Retrieval-Augmented Generation 将外部知识检索和大模型生成串成一个闭环。最小流程包括文档切分、Embedding、向量或混合检索、重排、上下文组装、回答与引用。切分过大时单个片段主题混杂，切分过小时上下文不完整，因此应根据文档结构和任务类型选择窗口，并保留标题、章节、时间等元数据。仅依赖向量相似度容易漏掉专有名词和编号，生产系统通常结合 BM25 与向量检索，再通过 reranker 精排。评估时要把“有没有检到证据”和“模型有没有忠实使用证据”分开，否则很难定位错误到底来自检索还是生成。",
    formula: "P(y|x)=Σz P(y|x,z)P(z|x)",
    flow: ["文档切分", "建立索引", "召回", "重排", "带证据生成", "引用与评估"],
    sources: ["Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"],
  },
  {
    id: "seed-ai-agent-003",
    domain: "AI",
    series: "Agent 可靠性",
    level: 1,
    sequence: 1,
    title: "Agent 为什么需要状态机",
    summary: "把自由生成约束为可观察、可恢复、可审计的状态迁移。",
    content:
      "Agent 如果只靠一段长 Prompt 循环调用工具，很容易出现重复执行、步骤丢失和失败后无法恢复。状态机把任务拆成明确状态，例如计划、待审批、执行、验证、完成与失败；每次迁移都记录输入、输出和原因。这样系统可以为高风险动作设置审批门，在网络错误后从最近的安全状态继续，也能限制最大重试次数。状态机并不要求所有推理都写死，它只约束生命周期与副作用，状态内部仍可由模型决定策略。工程上还应为每个工具调用分配幂等键，避免超时重试造成重复扣款、重复发信或重复写入。",
    formula: "sₜ₊₁ = δ(sₜ, observationₜ, policyₜ)",
    flow: ["计划", "选择工具", "执行", "验证", "成功或受控重试"],
    sources: ["ReAct: Synergizing Reasoning and Acting in Language Models"],
  },
  {
    id: "seed-bio-cip-001",
    domain: "BIO",
    series: "洁净生产与 CIP",
    level: 1,
    sequence: 1,
    title: "CIP 的四个关键变量",
    summary: "清洗效果由时间、温度、化学作用和机械作用共同决定。",
    content:
      "CIP（Cleaning in Place）不是把设备“冲一遍”，而是在不拆卸主要部件的前提下，用可重复、可验证的程序去除产品残留、微生物和清洗剂。常用的 Sinner Circle 将清洗能力拆成时间、温度、化学浓度和机械作用四部分；某一项降低时，通常要由其他项补偿。对罐体而言，机械作用取决于喷淋装置覆盖与液膜剪切；对管路而言，关键是保持足够流速并避免气囊和死腿。开发周期时应先识别最难清洗部位，再定义预冲洗、碱洗、中间水洗、酸洗与终洗的判定条件。验证不能只看程序执行完成，还应结合电导、TOC、微生物或特定残留检测证明终点。",
    formula: "清洗能力 ≈ f(时间, 温度, 化学作用, 机械作用)",
    flow: ["预冲洗", "碱洗", "中间水洗", "必要时酸洗", "终洗", "排净与确认"],
    sources: ["ASME BPE", "ISPE Cleaning Validation Lifecycle"],
  },
  {
    id: "seed-bio-pump-002",
    domain: "BIO",
    series: "卫生级流体设备",
    level: 1,
    sequence: 1,
    title: "离心泵为什么会汽蚀",
    summary: "入口绝对压力不足时，液体先汽化再在高压区塌陷。",
    content:
      "离心泵汽蚀发生在叶轮入口局部压力低于液体饱和蒸气压时。液体形成气泡，气泡随流体进入高压区域后迅速塌陷，产生冲击、噪声、振动和材料点蚀，同时流量与扬程下降。判断时比较装置可用汽蚀余量 NPSHa 与泵要求的 NPSHr，并留出工程裕量。提高储罐液位、增大吸入管径、减少弯头与阀门阻力、降低液体温度或降低泵转速，都可能改善 NPSHa。生物工艺还要注意介质含气、泡沫和高温 SIP 后启动条件，因为常规清水曲线未必能代表实际料液。",
    formula: "NPSHa = P绝对入口/ρg + v²/2g − P蒸气/ρg",
    flow: ["核对液温", "计算吸入损失", "比较 NPSH", "检查含气", "调整系统或泵"],
    sources: ["Hydraulic Institute Pump Standards", "ASME BPE"],
  },
  {
    id: "seed-bio-hx-003",
    domain: "BIO",
    series: "换热与灭菌",
    level: 1,
    sequence: 1,
    title: "换热器的 LMTD 为什么有用",
    summary: "两端温差不同，用对数平均温差表示整个设备的有效驱动力。",
    content:
      "换热器沿程的冷热流体温度都在变化，因此不能直接用入口温差或出口温差计算总换热量。对数平均温差 LMTD 将两端温差折算成一个等效驱动力，再与总传热系数 U 和面积 A 相乘。逆流通常比并流保持更均匀的温差，因此在相同端温条件下更有利。生物制药中还必须同时考虑可清洗性、交叉污染风险与压差方向，例如纯化水或产品侧通常应维持更高压力，避免换热面泄漏时公用介质进入产品。结垢会增加污垢热阻，使 U 下降，因此趋势监控不应只看出口温度，还应结合流量、压差和阀门开度。",
    formula: "Q = U·A·ΔTₗₘ；ΔTₗₘ=(ΔT₁−ΔT₂)/ln(ΔT₁/ΔT₂)",
    flow: ["确定流向", "计算两端温差", "求 LMTD", "估算 UA", "校核压降与卫生设计"],
    sources: ["Perry's Chemical Engineers' Handbook", "ASME BPE"],
  },
  {
    id: "seed-bio-fermentation-004",
    domain: "BIO",
    series: "发酵过程控制",
    level: 1,
    sequence: 1,
    title: "DO 串级控制的基本逻辑",
    summary: "先用温和变量调节，能力不足时再逐级调用更强手段。",
    content:
      "发酵罐溶氧 DO 是供氧与耗氧动态平衡的结果。单独依靠搅拌转速控制，在高细胞密度阶段可能达到机械上限，因此常采用串级策略：DO 控制器输出依次分配给搅拌、空气流量、背压和富氧比例。调节顺序应根据剪切敏感性、能耗、排气能力和设备约束确定。串级切换点如果过于接近，多个执行变量会频繁来回动作；如果跨度过大，又会造成 DO 长时间偏离。工艺开发时应同时观察 OUR、CER、RQ、泡沫与排气氧浓度，避免只把 DO 数字稳定误认为细胞处于理想代谢状态。",
    formula: "dCₗ/dt = kLa(C*−Cₗ) − OUR",
    flow: ["DO 偏低", "提高搅拌", "增加通气", "提高背压", "必要时富氧"],
    sources: ["Biochemical Engineering Fundamentals", "ICH Q8"],
  },
  {
    id: "seed-db-mvcc-001",
    domain: "DB",
    series: "PostgreSQL 内核",
    level: 1,
    sequence: 1,
    title: "MVCC 如何减少读写阻塞",
    summary: "更新创建新版本，读者依据快照判断哪一版对自己可见。",
    content:
      "PostgreSQL 的 MVCC（Multi-Version Concurrency Control）让读取通常不阻塞写入。UPDATE 并不是原地覆盖旧元组，而是创建新元组版本，并通过 xmin、xmax 等事务信息描述版本生命周期。查询开始时获得快照，再根据事务可见性规则选择应看到的版本。这样，不同事务可以在同一时刻看到同一行的不同历史状态。代价是旧版本不会立即从数据页消失，需要 VACUUM 回收空间并维护可见性信息。长事务会长期保留旧快照，使 dead tuples 无法清理，进而造成表膨胀、索引膨胀与冻结压力，因此生产排查不能只盯慢 SQL，也要关注长事务和 autovacuum 是否跟得上变化速率。",
    formula: "可见性 = f(snapshot, xmin, xmax, transaction status)",
    flow: ["创建快照", "读取元组版本", "执行可见性判断", "返回可见版本", "VACUUM 回收旧版本"],
    sources: ["PostgreSQL Documentation: Concurrency Control"],
  },
  {
    id: "seed-db-index-002",
    domain: "DB",
    series: "PostgreSQL 查询优化",
    level: 1,
    sequence: 1,
    title: "为什么有索引仍然走顺序扫描",
    summary: "优化器比较的是总成本，而不是机械地优先选择索引。",
    content:
      "PostgreSQL 是否使用索引取决于成本估算。若查询会返回表中很大比例的行，索引扫描需要在索引页与数据页之间进行大量随机访问，可能比连续读取整表更贵。统计信息过旧、字段分布倾斜、表达式不匹配、隐式类型转换，以及函数使条件不可索引，也会让优化器放弃预期索引。排查时应使用 EXPLAIN (ANALYZE, BUFFERS) 比较估算行数与实际行数，并观察 shared hit、read 和循环次数。不要一看到 Seq Scan 就强制加索引；应先确认选择性、返回行数、缓存状态和查询是否可以改写，再决定普通索引、部分索引、表达式索引或覆盖索引。",
    formula: "总成本 ≈ I/O 成本 + CPU 成本 + 行数估算误差的影响",
    flow: ["查看执行计划", "比较估算与实际", "检查选择性", "检查条件可索引性", "再决定索引策略"],
    sources: ["PostgreSQL Documentation: Using EXPLAIN"],
  },
];
