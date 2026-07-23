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
  cards,
  deepDives,
  deviceTokens,
  favorites,
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
    progress: userProgress,
    favorites: userFavorites,
    deepDives: userDeepDives,
    aiMessages: userAiMessages,
    settings: userSettings,
    devices: userDevices,
  };
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
