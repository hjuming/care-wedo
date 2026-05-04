import {
  createCareProfile,
  createGroup,
  getBearerToken,
  getAccessibleProfiles,
  getOrCreateDefaultUser,
  getUserGroups,
  joinGroupByCode,
  serializeCareProfile,
  verifyLineIdToken,
} from "../_shared/supabase";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINE_LOGIN_CHANNEL_ID?: string;
};

// Helper to get identity from request
async function getIdentity(request: Request, env: Env) {
  const token = getBearerToken(request);
  const identity = token ? await verifyLineIdToken(env, token) : null;
  const userId = await getOrCreateDefaultUser(env, identity?.lineUserId);
  return userId;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userId = await getIdentity(request, env);
    const groups = await getUserGroups(env, userId);
    const profiles = await getAccessibleProfiles(env, userId);

    return Response.json({ groups, care_profiles: profiles.map(serializeCareProfile) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Groups API failed" },
      { status: 500 },
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userId = await getIdentity(request, env);
    const body = await request.json<{
      action: string;
      name?: string;
      code?: string;
      group_id?: number;
      display_name?: string;
      relationship?: string;
    }>().catch(() => ({}));

    if (body.action === "create") {
      if (!body.name) return Response.json({ error: "請提供群組名稱" }, { status: 400 });
      const group = await createGroup(env, userId, body.name);
      return Response.json({ success: true, group });
    }

    if (body.action === "join") {
      if (!body.code) return Response.json({ error: "請提供邀請碼" }, { status: 400 });
      const group = await joinGroupByCode(env, userId, body.code);
      return Response.json({ success: true, group });
    }

    if (body.action === "create_profile") {
      if (!body.group_id) return Response.json({ error: "請先選擇家人群組" }, { status: 400 });
      if (!body.display_name) return Response.json({ error: "請輸入稱呼" }, { status: 400 });

      const groups = await getUserGroups(env, userId);
      const canUseGroup = groups.some((group) => group.id === body.group_id);
      if (!canUseGroup) return Response.json({ error: "您還沒有這個群組的權限" }, { status: 403 });

      const profile = await createCareProfile(env, {
        groupId: body.group_id,
        primaryUserId: userId,
        displayName: body.display_name,
        relationship: body.relationship || "family",
        isDefault: false,
      });
      return Response.json({ success: true, care_profile: serializeCareProfile(profile) });
    }

    return Response.json({ error: "不支援的操作" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Groups API failed" },
      { status: 500 },
    );
  }
};
