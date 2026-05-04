const LIFF_ID = import.meta.env?.VITE_LINE_LIFF_ID || "";

export async function initLineIdentity() {
  if (!LIFF_ID) {
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
    status: idToken ? "authenticated" : "demo",
    idToken,
    profile,
    message: idToken ? null : "暫時還沒連上 LINE，先顯示範例畫面。",
  };
}
