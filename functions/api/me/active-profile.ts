import { readJsonBody } from "../../_shared/request_body";
import {
  Env,
  getAccessibleProfiles,
  getBearerToken,
  setUserActiveProfileId,
} from "../../_shared/supabase";
import { getRequestUser } from "../../_shared/auth_context";

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  try {
    const idToken = getBearerToken(request);
    if (!idToken) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const { userId } = await getRequestUser(context);
    const body = await readJsonBody<{ profile_id?: unknown }>(request);
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
    const message = error instanceof Error ? error.message : "無法更新目前照護對象";
    return Response.json(
      { error: message },
      { status: message.includes("請先登入") ? 401 : 500 },
    );
  }
};
