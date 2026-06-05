const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const ACCESS_TOKEN_KEY = "care_wedo_supabase_access_token";
const REFRESH_TOKEN_KEY = "care_wedo_supabase_refresh_token";
const EXPIRES_AT_KEY = "care_wedo_supabase_expires_at";

function normalizeSupabaseUrl(value = SUPABASE_URL) {
  return String(value || "").replace(/\/+$/, "");
}

function safeNextPath(value = "/app") {
  const text = String(value || "/app");
  if (!text.startsWith("/") || text.startsWith("//")) return "/app";
  if (/^\/(app|login)(\/|\?|#|$)/.test(text)) return text;
  return "/app";
}

function decodeJwtPayload(token = "") {
  try {
    const [, payload] = String(token).split(".");
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded));
  } catch {
    return {};
  }
}

export function hasSupabaseAuthConfig() {
  return Boolean(normalizeSupabaseUrl() && SUPABASE_PUBLISHABLE_KEY);
}

export function buildSupabaseGoogleOAuthUrl({
  supabaseUrl = SUPABASE_URL,
  redirectTo = `${window.location.origin}/auth/callback`,
  next = "/app",
} = {}) {
  const baseUrl = normalizeSupabaseUrl(supabaseUrl);
  if (!baseUrl || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Google 登入尚未設定。請先設定 Supabase Auth public config。");
  }
  const url = new URL(`${baseUrl}/auth/v1/authorize?provider=google`);
  url.searchParams.set("redirect_to", `${redirectTo}?next=${encodeURIComponent(safeNextPath(next))}`);
  return url.toString();
}

export function storeSupabaseAuthSession({ accessToken, refreshToken, expiresIn } = {}) {
  if (!accessToken) return null;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (expiresIn) {
    const expiresAt = Math.floor(Date.now() / 1000) + Number(expiresIn);
    window.localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt));
  }
  return getStoredSupabaseIdentity();
}

export function getStoredSupabaseIdentity() {
  const accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!accessToken) return null;
  const expiresAt = Number(window.localStorage.getItem(EXPIRES_AT_KEY) || 0);
  if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000)) {
    clearSupabaseAuthSession();
    return null;
  }
  const payload = decodeJwtPayload(accessToken);
  const profile = {
    provider: "supabase",
    authUserId: payload.sub || null,
    email: payload.email || null,
    displayName: payload.user_metadata?.full_name || payload.user_metadata?.name || payload.email || "Google 帳號",
    pictureUrl: payload.user_metadata?.avatar_url || payload.user_metadata?.picture || null,
  };
  return {
    status: "authenticated",
    provider: "supabase",
    accessToken,
    idToken: accessToken,
    profile,
    message: null,
  };
}

export function clearSupabaseAuthSession() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(EXPIRES_AT_KEY);
}

export function completeSupabaseOAuthCallback(locationLike = window.location) {
  const hashParams = new URLSearchParams(String(locationLike.hash || "").replace(/^#/, ""));
  const queryParams = new URLSearchParams(String(locationLike.search || ""));
  const error = hashParams.get("error_description") || hashParams.get("error") || queryParams.get("error_description") || queryParams.get("error");
  if (error) throw new Error(error);

  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const expiresIn = hashParams.get("expires_in");
  if (!accessToken) throw new Error("Google 登入未回傳有效 session，請重新登入。");

  const identity = storeSupabaseAuthSession({ accessToken, refreshToken, expiresIn });
  const next = safeNextPath(queryParams.get("next") || "/app");
  window.history.replaceState(null, "", next);
  window.dispatchEvent(new PopStateEvent("popstate"));
  return identity;
}

export function loginWithGoogle({ next = "/app" } = {}) {
  window.location.assign(buildSupabaseGoogleOAuthUrl({ next }));
}
