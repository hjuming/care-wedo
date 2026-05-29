import {
  Env,
  buildCareWedoSessionCookie,
  createCareWedoHandoffToken,
  createCareWedoSessionToken,
  getAuthorizationBearerToken,
  verifyCareWedoHandoffToken,
  verifyLineIdToken,
} from "../../_shared/supabase";

function handoffResponse(body: Record<string, unknown>, init: ResponseInit = {}) {
  return Response.json(body, init);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const token = getAuthorizationBearerToken(request);
    if (!token) {
      return handoffResponse({ error: "請先登入 LINE" }, { status: 401 });
    }

    if (token.startsWith("cw_handoff.")) {
      const identity = await verifyCareWedoHandoffToken(env, token);
      const sessionToken = await createCareWedoSessionToken(env, identity);
      return handoffResponse(
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
    }

    const identity = await verifyLineIdToken(env, token);
    const handoffToken = await createCareWedoHandoffToken(env, identity);
    return handoffResponse({ success: true, handoffToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "瀏覽器接手登入失敗";
    return handoffResponse({ error: message }, { status: 401 });
  }
};
