export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINE_LOGIN_CHANNEL_ID?: string;
  CARE_WEDO_SESSION_SECRET?: string;
  CARE_WEDO_ALERT_WEBHOOK_URL?: string;
  CARE_WEDO_ALERT_WEBHOOK_SECRET?: string;
  CARE_WEDO_ENV?: string;
  WEDO_BILLING_CHECKOUT_SECRET?: string;
  WEDO_BILLING_SUBSCRIPTION_CANCEL_URL?: string;
  CARE_WEDO_PUBLIC_BASE_URL?: string;
};

export type VerifiedLineIdentity = {
  lineUserId: string;
  name?: string;
  pictureUrl?: string;
};

export type VerifiedSupabaseIdentity = {
  provider: "supabase";
  authUserId: string;
  authProvider: string;
  email?: string;
  name?: string;
  pictureUrl?: string;
};

export type VerifiedCareIdentity =
  | (VerifiedLineIdentity & { provider: "line" })
  | VerifiedSupabaseIdentity;

export const CARE_WEDO_SESSION_COOKIE = "care_wedo_session";
export const CARE_WEDO_SESSION_MAX_AGE_SECONDS = 60 * 24 * 60 * 60;
const CARE_WEDO_SESSION_PREFIX = "cw_session.";
const CARE_WEDO_HANDOFF_PREFIX = "cw_handoff.";
const CARE_WEDO_HANDOFF_MAX_AGE_SECONDS = 5 * 60;

type CareWedoSessionPayload = {
  lineUserId: string;
  name?: string;
  pictureUrl?: string;
  iat: number;
  exp: number;
};

type CareWedoHandoffPayload = {
  lineUserId: string;
  name?: string;
  pictureUrl?: string;
  iat: number;
  exp: number;
};

function assertAuthEnv(env: Partial<Env>) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment variables are not configured.");
  }
}

export function getBearerToken(request: Request) {
  const authToken = getAuthorizationBearerToken(request);
  if (authToken) return authToken;
  return getCookieValue(request, CARE_WEDO_SESSION_COOKIE);
}

export function getAuthorizationBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeText(text: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

function base64UrlDecodeText(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    return JSON.parse(base64UrlDecodeText(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function looksLikeSupabaseAccessToken(env: Env, token: string): boolean {
  if (token.startsWith(CARE_WEDO_SESSION_PREFIX)) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return false;

  const issuer = readString(payload.iss) || "";
  const authIssuerPrefix = `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
  return (
    issuer.startsWith(authIssuerPrefix)
    || payload.aud === "authenticated"
    || payload.role === "authenticated"
  );
}

function getSessionSecret(env: Env): string {
  const secret = env.CARE_WEDO_SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Care WEDO session secret is not configured.");
  return secret;
}

async function signSessionPayload(env: Env, encodedPayload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = cookieHeader.split(";").map((item) => item.trim()).filter(Boolean);
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator <= 0) continue;
    const key = cookie.slice(0, separator);
    if (key !== name) continue;
    return decodeURIComponent(cookie.slice(separator + 1));
  }
  return null;
}

export async function createCareWedoSessionToken(
  env: Env,
  identity: VerifiedLineIdentity,
  now = Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const payload: CareWedoSessionPayload = {
    lineUserId: identity.lineUserId,
    name: identity.name,
    pictureUrl: identity.pictureUrl,
    iat: issuedAt,
    exp: issuedAt + CARE_WEDO_SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = base64UrlEncodeText(JSON.stringify(payload));
  const signature = await signSessionPayload(env, encodedPayload);
  return `${CARE_WEDO_SESSION_PREFIX}${encodedPayload}.${signature}`;
}

export async function createCareWedoHandoffToken(
  env: Env,
  identity: VerifiedLineIdentity,
  now = Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const payload: CareWedoHandoffPayload = {
    lineUserId: identity.lineUserId,
    name: identity.name,
    pictureUrl: identity.pictureUrl,
    iat: issuedAt,
    exp: issuedAt + CARE_WEDO_HANDOFF_MAX_AGE_SECONDS,
  };
  const encodedPayload = base64UrlEncodeText(JSON.stringify(payload));
  const signature = await signSessionPayload(env, encodedPayload);
  return `${CARE_WEDO_HANDOFF_PREFIX}${encodedPayload}.${signature}`;
}

export function buildCareWedoSessionCookie(token: string): string {
  return [
    `${CARE_WEDO_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${CARE_WEDO_SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function buildExpiredCareWedoSessionCookie(): string {
  return [
    `${CARE_WEDO_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export async function verifyCareWedoSessionToken(env: Env, token: string): Promise<VerifiedLineIdentity> {
  if (!token.startsWith(CARE_WEDO_SESSION_PREFIX)) {
    throw new Error("Invalid Care WEDO session.");
  }
  const raw = token.slice(CARE_WEDO_SESSION_PREFIX.length);
  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid Care WEDO session.");

  const expectedSignature = await signSessionPayload(env, encodedPayload);
  if (signature !== expectedSignature) throw new Error("Care WEDO session signature mismatch.");

  const payload = JSON.parse(base64UrlDecodeText(encodedPayload)) as Partial<CareWedoSessionPayload>;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.lineUserId || !payload.exp || payload.exp <= now) {
    throw new Error("Care WEDO session expired.");
  }

  return {
    lineUserId: payload.lineUserId,
    name: payload.name,
    pictureUrl: payload.pictureUrl,
  };
}

export async function verifyCareWedoHandoffToken(env: Env, token: string): Promise<VerifiedLineIdentity> {
  if (!token.startsWith(CARE_WEDO_HANDOFF_PREFIX)) {
    throw new Error("Invalid Care WEDO handoff.");
  }
  const raw = token.slice(CARE_WEDO_HANDOFF_PREFIX.length);
  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid Care WEDO handoff.");

  const expectedSignature = await signSessionPayload(env, encodedPayload);
  if (signature !== expectedSignature) throw new Error("Care WEDO handoff signature mismatch.");

  const payload = JSON.parse(base64UrlDecodeText(encodedPayload)) as Partial<CareWedoHandoffPayload>;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.lineUserId || !payload.exp || payload.exp <= now) {
    throw new Error("Care WEDO handoff expired.");
  }

  return {
    lineUserId: payload.lineUserId,
    name: payload.name,
    pictureUrl: payload.pictureUrl,
  };
}

export async function verifyLineIdToken(env: Env, token: string): Promise<VerifiedLineIdentity> {
  if (token.startsWith(CARE_WEDO_SESSION_PREFIX)) {
    return verifyCareWedoSessionToken(env, token);
  }

  if (!env.LINE_LOGIN_CHANNEL_ID) {
    throw new Error("LINE_LOGIN_CHANNEL_ID is not configured.");
  }

  const body = new URLSearchParams({
    id_token: token,
    client_id: env.LINE_LOGIN_CHANNEL_ID,
  });

  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const result = await response.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || typeof result.sub !== "string") {
    const detail = typeof result.error_description === "string" ? result.error_description : "LINE token verify failed.";
    throw new Error(detail);
  }

  return {
    lineUserId: result.sub,
    name: typeof result.name === "string" ? result.name : undefined,
    pictureUrl: typeof result.picture === "string" ? result.picture : undefined,
  };
}

export async function verifySupabaseAccessToken(env: Env, token: string): Promise<VerifiedSupabaseIdentity> {
  assertAuthEnv(env);

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const result = await response.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || typeof result.id !== "string") {
    throw new Error("Google 登入已失效，請重新登入。");
  }

  const appMetadata = readRecord(result.app_metadata);
  const userMetadata = readRecord(result.user_metadata);
  const identities = Array.isArray(result.identities) ? result.identities : [];
  const firstIdentity = readRecord(identities[0]);
  const firstIdentityData = readRecord(firstIdentity.identity_data);
  const authProvider = readString(appMetadata.provider) || readString(firstIdentity.provider) || "google";
  const email = readString(result.email) || readString(firstIdentityData.email);
  const name = readString(userMetadata.full_name)
    || readString(userMetadata.name)
    || readString(firstIdentityData.full_name)
    || readString(firstIdentityData.name)
    || email;
  const pictureUrl = readString(userMetadata.avatar_url)
    || readString(userMetadata.picture)
    || readString(firstIdentityData.avatar_url)
    || readString(firstIdentityData.picture);

  return {
    provider: "supabase",
    authUserId: result.id,
    authProvider,
    email,
    name,
    pictureUrl,
  };
}

export async function verifyCareIdentity(env: Env, token: string): Promise<VerifiedCareIdentity> {
  if (looksLikeSupabaseAccessToken(env, token)) {
    return verifySupabaseAccessToken(env, token);
  }
  const lineIdentity = await verifyLineIdToken(env, token);
  return { ...lineIdentity, provider: "line" };
}
