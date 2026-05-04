const LIFF_ID = import.meta.env?.VITE_LINE_LIFF_ID || "";

// LINE Developers Console 的 LIFF Endpoint URL 必須設為此值：
// https://care.wedopr.com/app
// redirectUri 需與 Endpoint URL 完全相符（或為其子路徑）
const APP_URL = `${window.location.origin}/app`;

/** 初始化 LIFF 並取得身分。在 DashboardApp boot() 中呼叫。 */
export async function initLineIdentity() {
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
      liff.login({ redirectUri: APP_URL });
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
  if (!LIFF_ID) {
    // 開發環境：直接進 /app（demo 模式）
    window.history.pushState(null, "", "/app");
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  try {
    const { default: liff } = await import("@line/liff");
    await liff.init({ liffId: LIFF_ID });
    if (liff.isLoggedIn()) {
      // 已登入 → 直接進後台
      window.history.pushState(null, "", "/app");
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    // redirectUri 必須與 LINE Developers LIFF Endpoint URL（https://care.wedopr.com/app）一致
    liff.login({ redirectUri: APP_URL });
  } catch {
    // 初始化失敗 → 也嘗試進 /app，讓 boot() 顯示錯誤訊息
    window.history.pushState(null, "", "/app");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

/** 登出並導回 /login */
export async function logoutLineIdentity() {
  if (!LIFF_ID) {
    window.location.replace("/login");
    return;
  }
  try {
    const { default: liff } = await import("@line/liff");
    await liff.init({ liffId: LIFF_ID });
    if (liff.isLoggedIn()) {
      liff.logout();
      return; // liff.logout() 會自動 reload
    }
  } catch {
    // ignore
  }
  window.location.replace("/login");
}
