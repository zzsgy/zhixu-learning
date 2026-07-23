/**
 * 网页与 Android 共用身份的服务端解析逻辑。
 *
 * 网页使用托管平台验证后的 ChatGPT 登录头；
 * Android 使用网页配对后签发的高熵 Bearer Token；
 * 两条路径最后都返回同一个 users 表记录。
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { deviceTokens, users } from "@/db/schema";
import { getChatGPTUser } from "@/app/chatgpt-auth";

/** 业务层使用的最小用户结构。 */
export type AuthenticatedUser = {
  /** 用户主键。 */
  id: string;
  /** 已验证邮箱。 */
  email: string;
  /** 界面显示名称。 */
  displayName: string;
};

/** 将字符串计算为小写十六进制 SHA-256，用于 ID 与令牌哈希。 */
export async function sha256Hex(value: string): Promise<string> {
  /** 文本编码器负责把 UTF-8 字符串变成字节。 */
  const encoder = new TextEncoder();
  /** digest 是不可逆哈希结果，不会保留原始令牌。 */
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  /** bytes 用于逐字节转换为十六进制。 */
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 根据已验证邮箱生成稳定且不泄露邮箱原文的用户 ID。 */
async function userIdFromEmail(email: string): Promise<string> {
  /** hash 是规范化邮箱的不可逆摘要。 */
  const hash = await sha256Hex(email.trim().toLowerCase());
  return `usr_${hash.slice(0, 24)}`;
}

/** 把网页登录身份写入或更新到 users 表。 */
async function upsertBrowserUser(
  email: string,
  displayName: string,
): Promise<AuthenticatedUser> {
  /** db 是当前请求关联的 D1 数据库客户端。 */
  const db = getDb();
  /** normalizedEmail 防止邮箱大小写导致重复账号。 */
  const normalizedEmail = email.trim().toLowerCase();
  /** userId 对同一邮箱保持稳定。 */
  const userId = await userIdFromEmail(normalizedEmail);
  /** now 作为本次更新的统一时间戳。 */
  const now = new Date().toISOString();

  await db
    .insert(users)
    .values({
      id: userId,
      email: normalizedEmail,
      displayName,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { displayName, updatedAt: now },
    });

  return { id: userId, email: normalizedEmail, displayName };
}

/** 使用 Android 提交的 Bearer Token 查找已绑定用户。 */
async function userFromDeviceToken(
  authorizationHeader: string,
): Promise<AuthenticatedUser | null> {
  /** bearerPrefix 是 HTTP Bearer 认证的固定前缀。 */
  const bearerPrefix = "Bearer ";
  if (!authorizationHeader.startsWith(bearerPrefix)) return null;

  /** rawToken 是手机安全区保存、只在 HTTPS 请求中发送的明文令牌。 */
  const rawToken = authorizationHeader.slice(bearerPrefix.length).trim();
  if (rawToken.length < 32) return null;

  /** tokenHash 与数据库中保存的不可逆摘要进行匹配。 */
  const tokenHash = await sha256Hex(rawToken);
  /** db 是当前请求关联的 D1 数据库客户端。 */
  const db = getDb();
  /** matches 最多返回一条有效且未撤销的设备记录。 */
  const matches = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      tokenId: deviceTokens.id,
    })
    .from(deviceTokens)
    .innerJoin(users, eq(deviceTokens.userId, users.id))
    .where(
      and(eq(deviceTokens.tokenHash, tokenHash), isNull(deviceTokens.revokedAt)),
    )
    .limit(1);
  /** match 是当前设备对应的用户；未配对或令牌无效时不存在。 */
  const match = matches[0];
  if (!match) return null;

  await db
    .update(deviceTokens)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(deviceTokens.id, match.tokenId));

  return {
    id: match.id,
    email: match.email,
    displayName: match.displayName,
  };
}

/** 判断当前请求是否来自本机开发预览。 */
function isLocalPreview(request: Request): boolean {
  /** hostname 用于严格限定开发回退，生产域名不会命中。 */
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * 解析当前请求身份。
 *
 * @param request 当前 HTTP 请求。
 * @returns 已验证用户；没有身份时返回 null。
 */
export async function resolveAuthenticatedUser(
  request: Request,
): Promise<AuthenticatedUser | null> {
  /** authorization 是 Android 设备令牌请求头。 */
  const authorization = request.headers.get("authorization") ?? "";
  /** deviceUser 优先处理手机身份，避免依赖网页 Cookie。 */
  const deviceUser = await userFromDeviceToken(authorization);
  if (deviceUser) return deviceUser;

  /** browserUser 来自 Sites 托管层已验证的网页登录头。 */
  const browserUser = await getChatGPTUser();
  if (browserUser) {
    return upsertBrowserUser(browserUser.email, browserUser.displayName);
  }

  if (isLocalPreview(request)) {
    return upsertBrowserUser("local@zhixu.invalid", "本地预览用户");
  }

  return null;
}

/** 生成只向手机展示一次的高熵设备令牌。 */
export function createDeviceToken(): string {
  /** randomBytes 使用浏览器兼容密码学随机源。 */
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  /** encoded 把二进制令牌转换为 URL 安全字符串。 */
  const encoded = Array.from(randomBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `zx_${encoded}`;
}
