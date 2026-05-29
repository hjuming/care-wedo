// LIFF ID is public. Keep a code fallback so manual local builds cannot produce
// a login button that silently skips LINE OAuth.
import {
  clearServerSession,
  createServerSession,
  exchangeBrowserHandoffToken,
  fetchSessionIdentity,
  issueBrowserHandoffToken,
} from "./api.js";
import { isLineCallbackSearch } from "../routing.js";

const DEFAULT_LIFF_ID = "2009972224-fQcfBXw5";
const LIFF_ID = import.meta.env?.VITE_LINE_LIFF_ID || DEFAULT_LIFF_ID;

// LINE Developers Console 的 LIFF Endpoint URL 必須設為此值：
// https://care.wedopr.com/app
// redirectUri 需與 Endpoint URL 完全相符（或為其子路徑）
function getAppUrl() {
  return `${window.location.origin}/app`;
}

export function buildLiffEntryUrl(liffId = LIFF_ID) {
  return `https://liff.line.me/${encodeURIComponent(liffId)}`;
}

export function buildLineAppLiffFallbackUrl(liffId = LIFF_ID) {
  return `https://line.me/R/app/${encodeURIComponent(liffId)}`;
}

export function buildExternalAppUrl(path = "/app") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${window.location.origin}${normalizedPath}`;
}

export function isLineInAppBrowser(userAgent = globalThis.window?.navigator?.userAgent || "") {
  return /\bLine\//i.test(userAgent);
}

export function shouldOpenLiffEntryUrl(
  userAgent = globalThis.window?.navigator?.userAgent || "",
  maxTouchPoints = globalThis.window?.navigator?.maxTouchPoints || 0,
) {
  const isIpad = /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  if (isIpad) return false;
  if (/iPhone|iPod/i.test(userAgent)) return true;
  if (/Android/i.test(userAgent)) return /Mobile/i.test(userAgent);
  return false;
}

function openDashboardRoute() {
  window.history.pushState(null, "", "/app");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export async function openUrlInExternalBrowser(url = buildExternalAppUrl("/app")) {
  if (!isLineInAppBrowser()) {
    window.location.assign(url);
    return true;
  }

  try {
    const { default: liff } = await import("@line/liff");
    await liff.init({ liffId: LIFF_ID });
    liff.openWindow({ url, external: true });
    return true;
  } catch {
    window.location.assign(url);
    return false;
  }
}

export function clearCareWedoLocalSession() {
  Object.keys(window.localStorage)
    .filter((key) => {
      const normalized = key.toLowerCase();
      return key.startsWith("care_wedo_") || normalized.includes("liff") || normalized.includes("line");
    })
    .forEach((key) => window.localStorage.removeItem(key));

  Object.keys(window.sessionStorage || {})
    .filter((key) => {
      const normalized = key.toLowerCase();
      return key.startsWith("care_wedo_") || normalized.includes("liff") || normalized.includes("line");
    })
    .forEach((key) => window.sessionStorage.removeItem(key));
}

export async function resetCareWedoSessionAndReturnHome() {
  await clearServerSession();
  clearCareWedoLocalSession();

  try {
    const cacheNames = await window.caches?.keys?.();
    await Promise.all(
      (cacheNames || [])
        .filter((name) => name.toLowerCase().includes("care-wedo"))
        .map((name) => window.caches.delete(name)),
    );
  } catch {
    // Cache cleanup is best-effort; local auth state cleanup is the important part.
  }

  if (LIFF_ID) {
    try {
      const { default: liff } = await import("@line/liff");
      await liff.init({ liffId: LIFF_ID });
      if (liff.isLoggedIn()) liff.logout();
    } catch {
      // ignore
    }
  }

  window.location.replace("/");
}

/** 初始化 LIFF 並取得身分。在 DashboardApp boot() 中呼叫。 */
export async function initLineIdentity() {
  const searchParams = new URLSearchParams(window.location.search || "");
  const handoffToken = searchParams.get("handoff");

  if (handoffToken) {
    const handoffSession = await exchangeBrowserHandoffToken(handoffToken).catch(() => null);
    if (handoffSession) {
      window.history.replaceState(null, "", "/app");
      return handoffSession;
    }
  }

  const serverSession = await fetchSessionIdentity();
  if (serverSession) return serverSession;

  if (!LIFF_ID) {
    if (import.meta.env.PROD) {
      return {
        status: "unauthenticated",
        idToken: null,
        profile: null,
        message: "請點擊下方按鈕，使用 LINE 帳號登入。",
      };
    }
    // 本機開發：無 LIFF_ID → demo 模式
    return {
      status: "demo",
      idToken: null,
      profile: null,
      message: "現在先用範例畫面給您看。之後從 LINE 打開，就會看到自己的資料。",
    };
  }

  try {
    const { default: liff } = await import("@line/liff");
    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      // 無論在 LINE App 內或一般瀏覽器，都觸發 LINE OAuth。
      // redirectUri 必須與 LINE Developers 的 LIFF Endpoint URL 相符。
      liff.login({ redirectUri: getAppUrl() });
      return {
        status: "redirecting",
        idToken: null,
        profile: null,
        message: "正在開啟 LINE 登入...",
      };
    }

    const [profile, idToken] = await Promise.all([
      liff.getProfile(),
      Promise.resolve(liff.getIDToken()),
    ]);

    if (idToken) {
      await createServerSession(idToken).catch(() => null);
    }

    return {
      status: idToken ? "authenticated" : "unauthenticated",
      idToken,
      profile,
      message: idToken ? null : "無法取得 LINE 身分，請重新登入。",
    };
  } catch (err) {
    return {
      status: "unauthenticated",
      idToken: null,
      profile: null,
      message: err instanceof Error ? err.message : "LIFF 初始化失敗，請重新嘗試。",
    };
  }
}

/** 從登入頁直接觸發 LINE OAuth，登入後導回 /app */
export async function loginWithLine() {
  if (shouldOpenLiffEntryUrl()) {
    window.location.assign(buildLineAppLiffFallbackUrl());
    return;
  }

  if (!LIFF_ID) {
    // 開發環境：直接進 /app（demo 模式）
    openDashboardRoute();
    return;
  }

  try {
    const { default: liff } = await import("@line/liff");
    await liff.init({ liffId: LIFF_ID });
    if (liff.isLoggedIn()) {
      const idToken = liff.getIDToken();
      if (idToken) await createServerSession(idToken).catch(() => null);
      // 已登入 → 直接進後台
      openDashboardRoute();
      return;
    }
    // redirectUri 必須與 LINE Developers LIFF Endpoint URL（https://care.wedopr.com/app）一致
    liff.login({ redirectUri: getAppUrl() });
  } catch {
    // 初始化失敗 → 也嘗試進 /app，讓 boot() 顯示錯誤訊息
    openDashboardRoute();
  }
}

/** 登出並導回未登入首頁 */
export async function logoutLineIdentity() {
  await resetCareWedoSessionAndReturnHome();
}

export async function openDashboardInExternalBrowserAfterLineCallback(idToken) {
  if (!idToken || !isLineInAppBrowser() || !isLineCallbackSearch(window.location.search || "")) return false;
  const handoffToken = await issueBrowserHandoffToken(idToken).catch(() => null);
  if (!handoffToken) return false;
  window.history.replaceState(null, "", `/app/open?handoff=${encodeURIComponent(handoffToken)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  return true;
}
