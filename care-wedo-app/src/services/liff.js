const LIFF_ID = import.meta.env?.VITE_LINE_LIFF_ID || "";

export async function initLineIdentity() {
  if (!LIFF_ID) {
    if (import.meta.env.PROD) {
      return {
        status: "unauthenticated",
        idToken: null,
        profile: null,
        message: "請從 LINE 開啟此頁面，或先加入 Care WEDO LINE 照護小管家。",
      };
    }
    // 本機開發環境允許 demo 模式
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

    // 若不在 LINE App 內開啟，不嘗試 OAuth，直接提示從 LINE 開啟
    if (!liff.isInClient() && !liff.isLoggedIn()) {
      return {
        status: "unauthenticated",
        idToken: null,
        profile: null,
        message: "請從 LINE App 開啟此頁面，才能登入照護後台。",
      };
    }

    if (!liff.isLoggedIn()) {
      liff.login();
      return {
        status: "redirecting",
        idToken: null,
        profile: null,
        message: "正在幫您打開 LINE 登入。",
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
      message: idToken ? null : "無法取得 LINE 身分，請重新從 LINE 開啟頁面。",
    };
  } catch {
    return {
      status: "unauthenticated",
      idToken: null,
      profile: null,
      message: "請從 LINE App 開啟此頁面，才能登入照護後台。",
    };
  }
}

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
      return; // liff.logout() triggers page reload
    }
  } catch {
    // ignore
  }
  window.location.replace("/login");
}
