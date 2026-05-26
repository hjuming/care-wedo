import {
  Env,
  buildCareWedoSessionCookie,
  buildExpiredCareWedoSessionCookie,
  createCareWedoSessionToken,
  getAuthorizationBearerToken,
  getBearerToken,
  verifyLineIdToken,
} from "../_shared/supabase";

function sessionResponse(body: Record<string, unknown>, init: ResponseInit = {}) {
  return Response.json(body, init);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return sessionResponse({ authenticated: false }, { status: 401 });
    }

    const identity = await verifyLineIdToken(env, token);
    return sessionResponse({
      authenticated: true,
      profile: {
        lineUserId: identity.lineUserId,
        displayName: identity.name || "LINE 帳號",
        pictureUrl: identity.pictureUrl || null,
      },
    });
  } catch {
    return sessionResponse(
      { authenticated: false },
      { status: 401, headers: { "Set-Cookie": buildExpiredCareWedoSessionCookie() } },
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const token = getAuthorizationBearerToken(request);
    if (!token) {
      return sessionResponse({ error: "請先登入 LINE" }, { status: 401 });
    }

    const identity = await verifyLineIdToken(env, token);
    const sessionToken = await createCareWedoSessionToken(env, identity);

    return sessionResponse(
      {
        authenticated: true,
        profile: {
          lineUserId: identity.lineUserId,
          displayName: identity.name || "LINE 帳號",
          pictureUrl: identity.pictureUrl || null,
        },
      },
      { headers: { "Set-Cookie": buildCareWedoSessionCookie(sessionToken) } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "建立登入狀態失敗";
    return sessionResponse({ error: message }, { status: 401 });
  }
};

export const onRequestDelete: PagesFunction<Env> = async () => (
  sessionResponse(
    { success: true },
    { headers: { "Set-Cookie": buildExpiredCareWedoSessionCookie() } },
  )
);
