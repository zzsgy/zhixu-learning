/**
 * 知序的数据访问层。
 *
 * 页面与 API 路由只调用这里的业务函数，不直接散落数据库语句，
 * 便于后续 Android 与网页共享同一套同步规则。
 */
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  aiMessages,
  annotations,
  articles,
  cards,
  collectionItems,
  collections,
  deepDives,
  deviceTokens,
  favorites,
  knowledgeStates,
  progress,
  settings,
} from "@/db/schema";
import type { AuthenticatedUser } from "@/lib/auth";
import { STARTER_CARDS } from "@/lib/starter-cards";

/**
 * 每批写入的起始卡片数量。
 *
 * 一张卡片当前会绑定 13 个 SQL 参数；Cloudflare D1 单条语句最多允许
 * 100 个绑定参数，因此每批限制为 4 张，为以后增加字段保留余量。
 */
const STARTER_CARD_INSERT_BATCH_SIZE = 4;

/** 网页启动接口返回的完整数据结构。 */
export type BootstrapData = {
  /** 当前账号。 */
  user: AuthenticatedUser;
  /** 当前账号可见卡片。 */
  cards: Array<typeof cards.$inferSelect>;
  /** 当前账号保存的外部文章。 */
  articles: Array<typeof articles.$inferSelect>;
  /** 卡片与文章的个人学习状态。 */
  knowledgeStates: Array<typeof knowledgeStates.$inferSelect>;
  /** 当前账号保存的个人批注。 */
  annotations: Array<typeof annotations.$inferSelect>;
  /** 当前账号建立的专题集合。 */
  collections: Array<typeof collections.$inferSelect>;
  /** 专题与卡片、文章之间的归属关系。 */
  collectionItems: Array<typeof collectionItems.$inferSelect>;
  /** 阅读进度。 */
  progress: Array<typeof progress.$inferSelect>;
  /** 收藏记录。 */
  favorites: Array<typeof favorites.$inferSelect>;
  /** 深度内容。 */
  deepDives: Array<typeof deepDives.$inferSelect>;
  /** 最近的 AI 追问消息。 */
  aiMessages: Array<typeof aiMessages.$inferSelect>;
  /** 跨端设置。 */
  settings: typeof settings.$inferSelect;
  /** 已配对设备。 */
  devices: Array<{
    id: string;
    deviceName: string;
    lastSeenAt: string;
    createdAt: string;
  }>;
};

/** 写入九张起始卡片；已存在时跳过，因此可安全重复调用。 */
export async function ensureStarterCards(): Promise<void> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** starterRows 将内容对象转换为数据库字段。 */
  const starterRows = STARTER_CARDS.map((card) => ({
    id: card.id,
    ownerUserId: null,
    domain: card.domain,
    series: card.series,
    level: card.level,
    sequence: card.sequence,
    title: card.title,
    summary: card.summary,
    content: card.content,
    formula: card.formula,
    flowJson: JSON.stringify(card.flow),
    sourcesJson: JSON.stringify(card.sources),
    origin: "seed",
  }));

  /**
   * batchStart 是当前小批次在 starterRows 中的起始下标。
   * 拆分写入可以保证每条 INSERT 都低于 D1 的参数数量上限。
   */
  for (
    let batchStart = 0;
    batchStart < starterRows.length;
    batchStart += STARTER_CARD_INSERT_BATCH_SIZE
  ) {
    /** batchRows 是本轮写入数据库的少量起始卡片。 */
    const batchRows = starterRows.slice(
      batchStart,
      batchStart + STARTER_CARD_INSERT_BATCH_SIZE,
    );
    await db.insert(cards).values(batchRows).onConflictDoNothing();
  }
}

/** 确保用户拥有一条默认设置记录，并返回当前设置。 */
async function ensureSettings(userId: string): Promise<typeof settings.$inferSelect> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  await db.insert(settings).values({ userId }).onConflictDoNothing();

  /** rows 最多包含当前用户的一条设置。 */
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1);
  /** row 理论上必然存在；缺失说明数据库写入失败。 */
  const row = rows[0];
  if (!row) throw new Error("无法创建用户设置");
  return row;
}

/** 读取网页首页与 Android 首次同步所需的完整数据。 */
export async function loadBootstrapData(
  user: AuthenticatedUser,
): Promise<BootstrapData> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  await ensureStarterCards();
  /** userSettings 是手机与网页共享的推送偏好。 */
  const userSettings = await ensureSettings(user.id);

  /** 并行读取互不依赖的数据集合，减少接口等待时间。 */
  const [
    visibleCards,
    userArticles,
    userKnowledgeStates,
    userAnnotations,
    userCollections,
    userCollectionItems,
    userProgress,
    userFavorites,
    userDeepDives,
    userAiMessages,
    userDevices,
  ] = await Promise.all([
    db
      .select()
      .from(cards)
      .where(
        or(isNull(cards.ownerUserId), eq(cards.ownerUserId, user.id)),
      )
      .orderBy(desc(cards.createdAt), cards.domain, cards.sequence),
    db
      .select()
      .from(articles)
      .where(eq(articles.userId, user.id))
      .orderBy(desc(articles.updatedAt)),
    db
      .select()
      .from(knowledgeStates)
      .where(eq(knowledgeStates.userId, user.id))
      .orderBy(desc(knowledgeStates.updatedAt)),
    db
      .select()
      .from(annotations)
      .where(eq(annotations.userId, user.id))
      .orderBy(desc(annotations.createdAt)),
    db
      .select()
      .from(collections)
      .where(eq(collections.userId, user.id))
      .orderBy(desc(collections.updatedAt)),
    db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.userId, user.id))
      .orderBy(desc(collectionItems.createdAt)),
    db
      .select()
      .from(progress)
      .where(eq(progress.userId, user.id))
      .orderBy(desc(progress.updatedAt)),
    db
      .select()
      .from(favorites)
      .where(eq(favorites.userId, user.id))
      .orderBy(desc(favorites.updatedAt)),
    db
      .select()
      .from(deepDives)
      .where(eq(deepDives.userId, user.id))
      .orderBy(desc(deepDives.updatedAt)),
    db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.userId, user.id))
      .orderBy(aiMessages.createdAt)
      .limit(200),
    db
      .select({
        id: deviceTokens.id,
        deviceName: deviceTokens.deviceName,
        lastSeenAt: deviceTokens.lastSeenAt,
        createdAt: deviceTokens.createdAt,
      })
      .from(deviceTokens)
      .where(
        and(eq(deviceTokens.userId, user.id), isNull(deviceTokens.revokedAt)),
      )
      .orderBy(desc(deviceTokens.lastSeenAt)),
  ]);

  return {
    user,
    cards: visibleCards,
    articles: userArticles,
    knowledgeStates: userKnowledgeStates,
    annotations: userAnnotations,
    collections: userCollections,
    collectionItems: userCollectionItems,
    progress: userProgress,
    favorites: userFavorites,
    deepDives: userDeepDives,
    aiMessages: userAiMessages,
    settings: userSettings,
    devices: userDevices,
  };
}

/** 保存解析并清洗后的公开文章；重复网址会更新原记录。 */
export async function saveArticle(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 新文章 ID。 */
  id: string;
  /** 重定向后的最终公开网址。 */
  url: string;
  /** 普通网页或微信公众号来源。 */
  sourceType: "web" | "wechat";
  /** 原网页标题。 */
  title: string;
  /** 自动生成的文章简介。 */
  summary: string;
  /** 自动识别的文章领域。 */
  domain: "AI" | "BIO" | "DB" | "OTHER";
  /** 可选作者或公众号名称。 */
  author: string | null;
  /** 可选发布时间。 */
  publishedAt: string | null;
  /** 可选封面图绝对地址。 */
  coverImageUrl: string | null;
  /** 经过安全过滤的正文 HTML。 */
  contentHtml: string;
  /** 纯文本正文。 */
  contentText: string;
  /** 正文字数。 */
  wordCount: number;
  /** 自动生成的主题标签。 */
  tags: string[];
}): Promise<typeof articles.$inferSelect> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** now 是本次解析完成时间。 */
  const now = new Date().toISOString();
  await db
    .insert(articles)
    .values({
      id: input.id,
      userId: input.userId,
      url: input.url,
      sourceType: input.sourceType,
      title: input.title,
      summary: input.summary,
      domain: input.domain,
      author: input.author,
      publishedAt: input.publishedAt,
      coverImageUrl: input.coverImageUrl,
      contentHtml: input.contentHtml,
      contentText: input.contentText,
      wordCount: input.wordCount,
      tagsJson: JSON.stringify(input.tags),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [articles.userId, articles.url],
      set: {
        sourceType: input.sourceType,
        title: input.title,
        summary: input.summary,
        domain: input.domain,
        author: input.author,
        publishedAt: input.publishedAt,
        coverImageUrl: input.coverImageUrl,
        contentHtml: input.contentHtml,
        contentText: input.contentText,
        wordCount: input.wordCount,
        tagsJson: JSON.stringify(input.tags),
        updatedAt: now,
      },
    });

  /** rows 最多包含当前用户与网址对应的一篇文章。 */
  const rows = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.userId, input.userId),
        eq(articles.url, input.url),
      ),
    )
    .limit(1);
  /** row 缺失表示数据库没有返回刚刚保存的文章。 */
  const row = rows[0];
  if (!row) throw new Error("文章保存失败，请稍后重试。");
  return row;
}

/** 个人知识管理支持的目标类型。 */
export type KnowledgeTargetType = "card" | "article";

/** 个人知识管理支持的学习状态。 */
export type KnowledgeStatus =
  | "inbox"
  | "organizing"
  | "learning"
  | "mastered"
  | "archived";

/** 确认当前用户有权读取并管理指定知识目标。 */
async function assertKnowledgeTargetAccess(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** card 或 article。 */
  targetType: KnowledgeTargetType;
  /** 目标稳定 ID。 */
  targetId: string;
}): Promise<void> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  if (input.targetType === "card") {
    /** matches 是当前用户可见的公共卡片或私有卡片。 */
    const matches = await db
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(
          eq(cards.id, input.targetId),
          or(isNull(cards.ownerUserId), eq(cards.ownerUserId, input.userId)),
        ),
      )
      .limit(1);
    if (!matches[0]) throw new Error("找不到这张卡片，或当前账号无权修改。");
    return;
  }

  /** matches 是当前用户拥有的目标文章。 */
  const matches = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.id, input.targetId),
        eq(articles.userId, input.userId),
      ),
    )
    .limit(1);
  if (!matches[0]) throw new Error("找不到这篇文章，或当前账号无权修改。");
}

/** 保存卡片或文章在个人学习流程中的状态。 */
export async function saveKnowledgeState(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** card 或 article。 */
  targetType: KnowledgeTargetType;
  /** 目标稳定 ID。 */
  targetId: string;
  /** 新的个人学习状态。 */
  status: KnowledgeStatus;
}): Promise<typeof knowledgeStates.$inferSelect> {
  await assertKnowledgeTargetAccess(input);
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** now 是跨端同步使用的更新时间。 */
  const now = new Date().toISOString();
  /** recordId 对同一用户和知识目标保持稳定。 */
  const recordId = `state_${input.userId}_${input.targetType}_${input.targetId}`;

  await db
    .insert(knowledgeStates)
    .values({
      id: recordId,
      userId: input.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      status: input.status,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        knowledgeStates.userId,
        knowledgeStates.targetType,
        knowledgeStates.targetId,
      ],
      set: { status: input.status, updatedAt: now },
    });

  /** rows 返回刚刚保存的知识状态。 */
  const rows = await db
    .select()
    .from(knowledgeStates)
    .where(
      and(
        eq(knowledgeStates.userId, input.userId),
        eq(knowledgeStates.targetType, input.targetType),
        eq(knowledgeStates.targetId, input.targetId),
      ),
    )
    .limit(1);
  /** row 缺失表示状态写入后没有成功返回记录。 */
  const row = rows[0];
  if (!row) throw new Error("知识状态保存失败，请稍后重试。");
  return row;
}

/** 新增一条带可选原文引用的个人批注。 */
export async function createAnnotation(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** card 或 article。 */
  targetType: KnowledgeTargetType;
  /** 目标稳定 ID。 */
  targetId: string;
  /** 可选的原文引用。 */
  quoteText: string | null;
  /** 用户自己的批注正文。 */
  noteText: string;
}): Promise<typeof annotations.$inferSelect> {
  await assertKnowledgeTargetAccess(input);
  /** normalizedNote 是移除首尾空白后的批注正文。 */
  const normalizedNote = input.noteText.trim();
  if (!normalizedNote) throw new Error("批注内容不能为空。");
  if (normalizedNote.length > 4000) throw new Error("单条批注不能超过 4000 字。");

  /** normalizedQuote 是限制长度后的可选原文引用。 */
  const normalizedQuote = input.quoteText?.trim().slice(0, 1000) || null;
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** now 是批注创建与同步使用的统一时间。 */
  const now = new Date().toISOString();
  /** annotationId 是本条批注的不可预测稳定 ID。 */
  const annotationId = `annotation_${crypto.randomUUID()}`;
  await db.insert(annotations).values({
    id: annotationId,
    userId: input.userId,
    targetType: input.targetType,
    targetId: input.targetId,
    quoteText: normalizedQuote,
    noteText: normalizedNote,
    createdAt: now,
    updatedAt: now,
  });

  /** rows 返回刚刚创建的批注。 */
  const rows = await db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.id, annotationId),
        eq(annotations.userId, input.userId),
      ),
    )
    .limit(1);
  /** row 缺失表示批注写入后没有成功返回记录。 */
  const row = rows[0];
  if (!row) throw new Error("批注保存失败，请稍后重试。");
  return row;
}

/** 删除当前用户拥有的一条个人批注。 */
export async function deleteAnnotation(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 待删除批注 ID。 */
  annotationId: string;
}): Promise<{ deleted: boolean }> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  await db
    .delete(annotations)
    .where(
      and(
        eq(annotations.id, input.annotationId),
        eq(annotations.userId, input.userId),
      ),
    );
  return { deleted: true };
}

/** 创建专题；同名专题已存在时更新说明并返回原记录。 */
export async function saveCollection(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 专题名称。 */
  name: string;
  /** 可选专题说明。 */
  description: string;
}): Promise<typeof collections.$inferSelect> {
  /** normalizedName 是移除首尾空白后的专题名称。 */
  const normalizedName = input.name.trim();
  /** normalizedDescription 是移除首尾空白后的专题说明。 */
  const normalizedDescription = input.description.trim();
  if (!normalizedName) throw new Error("专题名称不能为空。");
  if (normalizedName.length > 48) throw new Error("专题名称不能超过 48 字。");
  if (normalizedDescription.length > 300) {
    throw new Error("专题说明不能超过 300 字。");
  }

  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** now 是专题创建与更新使用的统一时间。 */
  const now = new Date().toISOString();
  await db
    .insert(collections)
    .values({
      id: `collection_${crypto.randomUUID()}`,
      userId: input.userId,
      name: normalizedName,
      description: normalizedDescription,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [collections.userId, collections.name],
      set: { description: normalizedDescription, updatedAt: now },
    });

  /** rows 返回当前用户指定名称的专题。 */
  const rows = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.userId, input.userId),
        eq(collections.name, normalizedName),
      ),
    )
    .limit(1);
  /** row 缺失表示专题写入后没有成功返回记录。 */
  const row = rows[0];
  if (!row) throw new Error("专题保存失败，请稍后重试。");
  return row;
}

/** 把知识目标加入专题，或从专题中移除。 */
export async function toggleCollectionItem(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 目标专题 ID。 */
  collectionId: string;
  /** card 或 article。 */
  targetType: KnowledgeTargetType;
  /** 目标稳定 ID。 */
  targetId: string;
  /** true 表示加入，false 表示移除。 */
  active: boolean;
}): Promise<{
  active: boolean;
  item: typeof collectionItems.$inferSelect | null;
}> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** ownedCollections 用于确认专题确实属于当前用户。 */
  const ownedCollections = await db
    .select({ id: collections.id })
    .from(collections)
    .where(
      and(
        eq(collections.id, input.collectionId),
        eq(collections.userId, input.userId),
      ),
    )
    .limit(1);
  if (!ownedCollections[0]) throw new Error("找不到这个专题，或当前账号无权修改。");
  await assertKnowledgeTargetAccess(input);

  if (!input.active) {
    await db
      .delete(collectionItems)
      .where(
        and(
          eq(collectionItems.userId, input.userId),
          eq(collectionItems.collectionId, input.collectionId),
          eq(collectionItems.targetType, input.targetType),
          eq(collectionItems.targetId, input.targetId),
        ),
      );
    await db
      .update(collections)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(collections.id, input.collectionId));
    return { active: false, item: null };
  }

  /** now 是加入专题与刷新专题排序使用的时间。 */
  const now = new Date().toISOString();
  await db
    .insert(collectionItems)
    .values({
      id: `collection_item_${crypto.randomUUID()}`,
      userId: input.userId,
      collectionId: input.collectionId,
      targetType: input.targetType,
      targetId: input.targetId,
      createdAt: now,
    })
    .onConflictDoNothing();
  await db
    .update(collections)
    .set({ updatedAt: now })
    .where(eq(collections.id, input.collectionId));

  /** rows 返回专题中对应知识目标的关系记录。 */
  const rows = await db
    .select()
    .from(collectionItems)
    .where(
      and(
        eq(collectionItems.userId, input.userId),
        eq(collectionItems.collectionId, input.collectionId),
        eq(collectionItems.targetType, input.targetType),
        eq(collectionItems.targetId, input.targetId),
      ),
    )
    .limit(1);
  /** row 缺失表示专题关系没有成功建立。 */
  const row = rows[0];
  if (!row) throw new Error("加入专题失败，请稍后重试。");
  return { active: true, item: row };
}

/** 把卡片标记为阅读中或已完成，并合并累计阅读时长。 */
export async function saveProgress(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 卡片 ID。 */
  cardId: string;
  /** reading 或 completed。 */
  status: "reading" | "completed";
  /** 当前设备本次新增的阅读秒数。 */
  readingSeconds: number;
}): Promise<typeof progress.$inferSelect> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** now 是跨端冲突判断使用的更新时间。 */
  const now = new Date().toISOString();
  /** recordId 对用户和卡片组合保持稳定。 */
  const recordId = `prg_${input.userId}_${input.cardId}`;
  /** safeSeconds 限制单次提交范围，避免异常客户端写入负数或超大值。 */
  const safeSeconds = Math.min(Math.max(Math.round(input.readingSeconds), 0), 86400);

  await db
    .insert(progress)
    .values({
      id: recordId,
      userId: input.userId,
      cardId: input.cardId,
      status: input.status,
      readingSeconds: safeSeconds,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [progress.userId, progress.cardId],
      set: {
        status: input.status,
        readingSeconds: safeSeconds,
        updatedAt: now,
      },
    });

  /** rows 返回刚刚保存的进度。 */
  const rows = await db
    .select()
    .from(progress)
    .where(
      and(
        eq(progress.userId, input.userId),
        eq(progress.cardId, input.cardId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** 新增或取消收藏。 */
export async function saveFavorite(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 卡片 ID。 */
  cardId: string;
  /** true 表示收藏，false 表示取消。 */
  active: boolean;
}): Promise<{ active: boolean }> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  if (!input.active) {
    await db
      .delete(favorites)
      .where(
        and(
          eq(favorites.userId, input.userId),
          eq(favorites.cardId, input.cardId),
        ),
      );
    return { active: false };
  }

  /** now 是收藏更新时间。 */
  const now = new Date().toISOString();
  await db
    .insert(favorites)
    .values({
      id: `fav_${input.userId}_${input.cardId}`,
      userId: input.userId,
      cardId: input.cardId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [favorites.userId, favorites.cardId],
      set: { updatedAt: now },
    });
  return { active: true };
}

/** 保存手机生成或网页生成的深度内容；只校验最低字数，不限制最大字数。 */
export async function saveDeepDive(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 卡片 ID。 */
  cardId: string;
  /** 深度标题。 */
  title: string;
  /** 不少于 2000 字的正文。 */
  content: string;
  /** 参考资料数组。 */
  sources: string[];
  /** 内容来源。 */
  origin: string;
}): Promise<typeof deepDives.$inferSelect> {
  /** normalizedContent 去除首尾空白后用于最低长度检查。 */
  const normalizedContent = input.content.trim();
  if (normalizedContent.length < 2000) {
    throw new Error("深度内容不足 2000 字，请继续生成或补充后再保存。");
  }

  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** now 是跨端同步使用的更新时间。 */
  const now = new Date().toISOString();
  await db
    .insert(deepDives)
    .values({
      id: `deep_${input.userId}_${input.cardId}`,
      userId: input.userId,
      cardId: input.cardId,
      title: input.title.trim(),
      content: normalizedContent,
      sourcesJson: JSON.stringify(input.sources),
      origin: input.origin,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [deepDives.userId, deepDives.cardId],
      set: {
        title: input.title.trim(),
        content: normalizedContent,
        sourcesJson: JSON.stringify(input.sources),
        origin: input.origin,
        updatedAt: now,
      },
    });

  /** rows 返回刚保存的深度内容。 */
  const rows = await db
    .select()
    .from(deepDives)
    .where(
      and(
        eq(deepDives.userId, input.userId),
        eq(deepDives.cardId, input.cardId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** 保存实时生成卡片，供 Android 到点生成后上传。 */
export async function saveGeneratedCard(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 客户端或服务端生成的卡片 ID。 */
  id: string;
  /** 一级领域。 */
  domain: "AI" | "BIO" | "DB";
  /** 体系化系列。 */
  series: string;
  /** 难度级别。 */
  level: number;
  /** 系列顺序。 */
  sequence: number;
  /** 标题。 */
  title: string;
  /** 摘要。 */
  summary: string;
  /** 正文。 */
  content: string;
  /** 可选公式。 */
  formula: string | null;
  /** 流程步骤。 */
  flow: string[];
  /** 参考资料。 */
  sources: string[];
  /** 生成来源。 */
  origin: string;
}): Promise<typeof cards.$inferSelect> {
  /** normalizedContent 用于最低长度校验。 */
  const normalizedContent = input.content.trim();
  if (normalizedContent.length < 300) {
    throw new Error("卡片正文不足 300 字。");
  }

  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** now 是跨端同步使用的更新时间。 */
  const now = new Date().toISOString();
  await db
    .insert(cards)
    .values({
      id: input.id,
      ownerUserId: input.userId,
      domain: input.domain,
      series: input.series.trim(),
      level: Math.max(1, Math.round(input.level)),
      sequence: Math.max(1, Math.round(input.sequence)),
      title: input.title.trim(),
      summary: input.summary.trim(),
      content: normalizedContent,
      formula: input.formula?.trim() || null,
      flowJson: JSON.stringify(input.flow),
      sourcesJson: JSON.stringify(input.sources),
      origin: input.origin,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cards.id,
      set: {
        title: input.title.trim(),
        summary: input.summary.trim(),
        content: normalizedContent,
        formula: input.formula?.trim() || null,
        flowJson: JSON.stringify(input.flow),
        sourcesJson: JSON.stringify(input.sources),
        updatedAt: now,
      },
    });

  /** rows 返回刚保存的卡片，并再次校验归属。 */
  const rows = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, input.id), eq(cards.ownerUserId, input.userId)))
    .limit(1);
  /** row 缺失表示客户端试图覆盖不属于自己的卡片。 */
  const row = rows[0];
  if (!row) throw new Error("不能覆盖公共卡片或其他账号的卡片。");
  return row;
}

/** 更新手机与网页共享的推送时间和领域权重。 */
export async function saveSettings(input: {
  /** 当前用户 ID。 */
  userId: string;
  /** 开始时间。 */
  startTime: string;
  /** 结束时间。 */
  endTime: string;
  /** 推送间隔分钟数。 */
  intervalMinutes: number;
  /** AI 权重。 */
  aiWeight: number;
  /** 生物工程权重。 */
  bioWeight: number;
  /** PostgreSQL 权重。 */
  dbWeight: number;
}): Promise<typeof settings.$inferSelect> {
  /** db 是 D1 的 Drizzle 客户端。 */
  const db = getDb();
  /** now 是跨端同步使用的更新时间。 */
  const now = new Date().toISOString();
  await db
    .insert(settings)
    .values({ ...input, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.userId,
      set: {
        startTime: input.startTime,
        endTime: input.endTime,
        intervalMinutes: input.intervalMinutes,
        aiWeight: input.aiWeight,
        bioWeight: input.bioWeight,
        dbWeight: input.dbWeight,
        updatedAt: now,
      },
    });
  return ensureSettings(input.userId);
}
