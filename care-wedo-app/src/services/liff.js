const LIFF_ID = import.meta.env?.VITE_LINE_LIFF_ID || "";

export async function initLineIdentity() {
  if (!LIFF_ID) {
    // 正式環境沒有 LIFF_ID 代表設定不完整，不允許進入後台
    if (import.meta.env.PROD) {
      return {
        status: "unauthenticated",
        idToken: null,
        profile: null,
        message: "請從 LINE 開啟此頁面，或先加入 Care WEDO LINE 小管家。",
      };
    }
    // 本機開發環境允許 demo 模式便於測試
    return {
      status: "demo",
      idToken: null,
      profile: null,
      message: "現在先用範例畫面給您看。之後從 LINE 打開，就會看到自己的資料。",
    };
  }

  const { default: liff } = await import("@line/liff");
  await liff.init({ liffId: LIFF_ID });

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
}
