import {
  Env,
  getAccessibleProfiles,
  getBearerToken,
  getOrCreateDefaultUser,
  setUserActiveProfileId,
  verifyLineIdToken,
} from "../../_shared/supabase";

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const idToken = getBearerToken(request);
    if (!idToken) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const identity = await verifyLineIdToken(env, idToken);
    const userId = await getOrCreateDefaultUser(env, identity.lineUserId, identity);
    const body = await request.json<{ profile_id?: unknown }>().catch(() => ({}));
    const profileId = Number(body.profile_id);

    if (!Number.isFinite(profileId) || profileId <= 0) {
      return Response.json({ error: "沒有可更新的照護對象" }, { status: 400 });
    }

    const accessibleProfiles = await getAccessibleProfiles(env, userId);
    if (!accessibleProfiles.some((profile) => profile.id === profileId)) {
      return Response.json({ error: "沒有這個照護對象的存取權限" }, { status: 403 });
    }

    const persisted = await setUserActiveProfileId(env, userId, profileId);
    if (!persisted) {
      return Response.json({ error: "目前照護對象欄位尚未啟用，請先套用最新資料庫 migration。" }, { status: 409 });
    }

    return Response.json({ success: true, active_profile_id: profileId });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法更新目前照護對象" },
      { status: 500 },
    );
  }
};
