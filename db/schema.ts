/**
 * 知序云端数据库结构。
 *
 * 设计原则：
 * 1. D1 是账号数据的唯一主数据源；
 * 2. Android SQLite 与网页 IndexedDB 只承担离线缓存；
 * 3. 所有用户数据均通过 userId 做归属隔离；
 * 4. 所有可同步记录均带有 updatedAt，供双端做增量同步与冲突判断。
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** 用户表：网页身份和手机设备最终都映射到这里。 */
export const users = sqliteTable(
  "users",
  {
    /** 不透明的用户主键。 */
    id: text("id").primaryKey(),
    /** 经网页登录验证后的邮箱，也是当前版本的唯一账号标识。 */
    email: text("email").notNull(),
    /** 用于界面展示的名称。 */
    displayName: text("display_name").notNull(),
    /** 创建时间，使用 ISO 8601 字符串便于跨端处理。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 最近更新时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 邮箱必须唯一，防止同一登录身份生成两份账号。 */
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

/** 知识卡片表：系统卡片与实时生成卡片使用同一结构。 */
export const cards = sqliteTable(
  "cards",
  {
    /** 跨手机和网页保持不变的卡片 ID。 */
    id: text("id").primaryKey(),
    /** null 表示公共基础卡片；非 null 表示该用户实时生成的卡片。 */
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /** AI、BIO 或 DB 三个一级领域。 */
    domain: text("domain").notNull(),
    /** 系列名称，用来保证推送内容有体系。 */
    series: text("series").notNull(),
    /** 由浅入深的阶段编号。 */
    level: integer("level").notNull().default(1),
    /** 系列内部顺序。 */
    sequence: integer("sequence").notNull().default(1),
    /** 卡片标题。 */
    title: text("title").notNull(),
    /** 列表页的一句话摘要。 */
    summary: text("summary").notNull(),
    /** 约 300 字以上的技术正文；不设置硬性上限。 */
    content: text("content").notNull(),
    /** 可选公式，使用纯文本或 LaTeX 语法保存。 */
    formula: text("formula"),
    /** 可选流程步骤，保存为 JSON 字符串。 */
    flowJson: text("flow_json"),
    /** 来源与参考资料，保存为 JSON 字符串。 */
    sourcesJson: text("sources_json").notNull().default("[]"),
    /** 内容生成方式，例如 seed、deepseek 或 manual。 */
    origin: text("origin").notNull().default("seed"),
    /** 创建时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 最近更新时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 按用户和更新时间读取增量内容。 */
    index("cards_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
    /** 按领域和学习顺序筛选。 */
    index("cards_domain_series_idx").on(
      table.domain,
      table.series,
      table.sequence,
    ),
  ],
);

/** 文章收藏表：保存公开网页或微信公众号文章的清洗后正文与分类结果。 */
export const articles = sqliteTable(
  "articles",
  {
    /** 跨会话保持稳定的文章 ID。 */
    id: text("id").primaryKey(),
    /** 文章所属用户，确保不同账号的数据彼此隔离。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 用户提交并经过重定向解析后的最终公开网址。 */
    url: text("url").notNull(),
    /** web 表示普通网页，wechat 表示微信公众号文章。 */
    sourceType: text("source_type").notNull().default("web"),
    /** 原网页标题。 */
    title: text("title").notNull(),
    /** DeepSeek 或本地规则生成的简介。 */
    summary: text("summary").notNull(),
    /** AI、BIO、DB 或 OTHER。 */
    domain: text("domain").notNull(),
    /** 原网页作者或公众号名称。 */
    author: text("author"),
    /** 原网页声明的发布时间。 */
    publishedAt: text("published_at"),
    /** 原网页封面图的绝对 HTTPS 地址。 */
    coverImageUrl: text("cover_image_url"),
    /** 仅包含允许标签和安全属性的正文 HTML。 */
    contentHtml: text("content_html").notNull(),
    /** 纯文本正文，用于检索、分类和字数统计。 */
    contentText: text("content_text").notNull(),
    /** 正文字数。 */
    wordCount: integer("word_count").notNull().default(0),
    /** JSON 编码的主题标签。 */
    tagsJson: text("tags_json").notNull().default("[]"),
    /** 首次保存时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 最近重新解析时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 同一用户重复导入同一最终网址时更新原记录。 */
    uniqueIndex("articles_user_url_unique").on(table.userId, table.url),
    /** 支持按用户与更新时间读取文章库。 */
    index("articles_user_updated_idx").on(table.userId, table.updatedAt),
    /** 支持按用户与领域筛选文章。 */
    index("articles_user_domain_idx").on(table.userId, table.domain),
  ],
);

/** 知识状态表：统一记录卡片与文章在个人学习流程中的位置。 */
export const knowledgeStates = sqliteTable(
  "knowledge_states",
  {
    /** 对用户、目标类型和目标 ID 保持稳定的状态记录 ID。 */
    id: text("id").primaryKey(),
    /** 状态所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** card 或 article。 */
    targetType: text("target_type").notNull(),
    /** 卡片或文章的稳定 ID。 */
    targetId: text("target_id").notNull(),
    /** inbox、organizing、learning、mastered 或 archived。 */
    status: text("status").notNull().default("inbox"),
    /** 最近更新时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 一名用户对一个知识目标只保留一条当前状态。 */
    uniqueIndex("knowledge_states_user_target_unique").on(
      table.userId,
      table.targetType,
      table.targetId,
    ),
    /** 支持按用户和状态筛选个人知识流。 */
    index("knowledge_states_user_status_idx").on(table.userId, table.status),
  ],
);

/** 个人批注表：保存正文引用与用户自己的理解、疑问或实践记录。 */
export const annotations = sqliteTable(
  "annotations",
  {
    /** 批注稳定 ID。 */
    id: text("id").primaryKey(),
    /** 批注所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** card 或 article。 */
    targetType: text("target_type").notNull(),
    /** 卡片或文章的稳定 ID。 */
    targetId: text("target_id").notNull(),
    /** 可选的原文引用；没有选中文字时为 null。 */
    quoteText: text("quote_text"),
    /** 用户输入的批注正文。 */
    noteText: text("note_text").notNull(),
    /** 首次创建时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 最近更新时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 支持按知识目标读取全部个人批注。 */
    index("annotations_user_target_idx").on(
      table.userId,
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    /** 支持按用户增量同步批注。 */
    index("annotations_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

/** 专题集合表：由用户按项目、主题或学习目标组织知识内容。 */
export const collections = sqliteTable(
  "collections",
  {
    /** 专题稳定 ID。 */
    id: text("id").primaryKey(),
    /** 专题所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 专题名称。 */
    name: text("name").notNull(),
    /** 可选的专题说明。 */
    description: text("description").notNull().default(""),
    /** 首次创建时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 最近更新时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 同一用户不能创建两个完全同名的专题。 */
    uniqueIndex("collections_user_name_unique").on(table.userId, table.name),
    /** 支持按用户和更新时间读取专题。 */
    index("collections_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

/** 专题成员表：把卡片或文章加入一个或多个专题。 */
export const collectionItems = sqliteTable(
  "collection_items",
  {
    /** 专题成员记录 ID。 */
    id: text("id").primaryKey(),
    /** 记录所属用户，用于服务端归属校验和跨端同步。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 所属专题。 */
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    /** card 或 article。 */
    targetType: text("target_type").notNull(),
    /** 卡片或文章的稳定 ID。 */
    targetId: text("target_id").notNull(),
    /** 加入专题的时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 同一个知识目标在一个专题中只出现一次。 */
    uniqueIndex("collection_items_collection_target_unique").on(
      table.collectionId,
      table.targetType,
      table.targetId,
    ),
    /** 支持读取一个用户的全部专题关系。 */
    index("collection_items_user_idx").on(table.userId, table.collectionId),
    /** 支持反向查找知识目标所属专题。 */
    index("collection_items_user_target_idx").on(
      table.userId,
      table.targetType,
      table.targetId,
    ),
  ],
);

/** 阅读进度表：一名用户对一张卡片只有一条当前状态。 */
export const progress = sqliteTable(
  "progress",
  {
    /** 进度记录 ID。 */
    id: text("id").primaryKey(),
    /** 记录所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 对应卡片。 */
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** unseen、reading 或 completed。 */
    status: text("status").notNull().default("reading"),
    /** 多端累计的阅读秒数。 */
    readingSeconds: integer("reading_seconds").notNull().default(0),
    /** 最近更新时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 保证用户和卡片组合唯一。 */
    uniqueIndex("progress_user_card_unique").on(table.userId, table.cardId),
    /** 支持按用户增量同步。 */
    index("progress_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

/** 收藏表：存在记录即表示已收藏。 */
export const favorites = sqliteTable(
  "favorites",
  {
    /** 收藏记录 ID。 */
    id: text("id").primaryKey(),
    /** 收藏所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 被收藏卡片。 */
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** 收藏时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 最近更新时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 保证同一张卡片不会重复收藏。 */
    uniqueIndex("favorites_user_card_unique").on(table.userId, table.cardId),
    /** 支持按用户快速读取收藏。 */
    index("favorites_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

/** 深度内容表：允许正文超过 5000 字，只要求生成时不少于 2000 字。 */
export const deepDives = sqliteTable(
  "deep_dives",
  {
    /** 深度内容记录 ID。 */
    id: text("id").primaryKey(),
    /** 内容所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 对应卡片。 */
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** 深度内容标题。 */
    title: text("title").notNull(),
    /** 深度正文；数据库层不设置最大长度限制。 */
    content: text("content").notNull(),
    /** 参考资料，保存为 JSON 字符串。 */
    sourcesJson: text("sources_json").notNull().default("[]"),
    /** 生成模型或 manual。 */
    origin: text("origin").notNull().default("manual"),
    /** 创建时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 最近更新时间。 */
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 每名用户对每张卡片保留一份当前深度内容。 */
    uniqueIndex("deep_dives_user_card_unique").on(table.userId, table.cardId),
    /** 支持按用户增量同步。 */
    index("deep_dives_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

/** AI 追问消息表：手机与网页可以继续同一张卡片下的对话。 */
export const aiMessages = sqliteTable(
  "ai_messages",
  {
    /** 消息 ID。 */
    id: text("id").primaryKey(),
    /** 消息所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 对应卡片。 */
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** user 或 assistant。 */
    role: text("role").notNull(),
    /** 消息正文。 */
    content: text("content").notNull(),
    /** 创建时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 支持按用户、卡片和时间恢复对话。 */
    index("ai_messages_user_card_idx").on(
      table.userId,
      table.cardId,
      table.createdAt,
    ),
  ],
);

/** 用户设置表：手机端与网页端读取同一份推送偏好。 */
export const settings = sqliteTable("settings", {
  /** 用户 ID 同时也是设置表主键。 */
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 每日推送开始时间。 */
  startTime: text("start_time").notNull().default("07:30"),
  /** 每日推送结束时间。 */
  endTime: text("end_time").notNull().default("17:30"),
  /** 推送间隔分钟数，默认每小时一次。 */
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  /** AI 内容权重。 */
  aiWeight: integer("ai_weight").notNull().default(40),
  /** 生物制药与洁净工艺内容权重。 */
  bioWeight: integer("bio_weight").notNull().default(45),
  /** PostgreSQL 内容权重。 */
  dbWeight: integer("db_weight").notNull().default(15),
  /** 最近更新时间。 */
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** 一次性配对码表：网页生成，手机只可领取一次。 */
export const devicePairCodes = sqliteTable(
  "device_pair_codes",
  {
    /** 配对记录 ID。 */
    id: text("id").primaryKey(),
    /** 六位配对码。 */
    code: text("code").notNull(),
    /** 配对码所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 到期时间。 */
    expiresAt: text("expires_at").notNull(),
    /** 手机领取时间；null 表示尚未领取。 */
    claimedAt: text("claimed_at"),
    /** 创建时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 配对码必须唯一。 */
    uniqueIndex("device_pair_codes_code_unique").on(table.code),
    /** 支持按用户查找最近的配对码。 */
    index("device_pair_codes_user_idx").on(table.userId, table.createdAt),
  ],
);

/** 手机设备令牌表：数据库只保存令牌哈希，不保存明文令牌。 */
export const deviceTokens = sqliteTable(
  "device_tokens",
  {
    /** 设备令牌记录 ID。 */
    id: text("id").primaryKey(),
    /** 设备所属用户。 */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 后的令牌值。 */
    tokenHash: text("token_hash").notNull(),
    /** 用户可识别的设备名称。 */
    deviceName: text("device_name").notNull(),
    /** 设备最近同步时间。 */
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    /** 主动撤销时间；null 表示仍有效。 */
    revokedAt: text("revoked_at"),
    /** 创建时间。 */
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    /** 令牌哈希必须唯一。 */
    uniqueIndex("device_tokens_hash_unique").on(table.tokenHash),
    /** 支持按用户列出已绑定设备。 */
    index("device_tokens_user_idx").on(table.userId, table.createdAt),
  ],
);
