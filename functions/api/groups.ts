import {
  createCareProfile,
  createGroup,
  getBearerToken,
  getAccessibleProfiles,
  getOrCreateDefaultUser,
  getUserGroups,
  getUserMemberships,
  joinGroupByCode,
  serializeCareProfile,
  updateUserFamilyGroupMembership,
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
    const memberships = await getUserMemberships(env, userId);
    const profiles = await getAccessibleProfiles(env, userId);

    return Response.json({ groups, care_profiles: profiles.map(serializeCareProfile), user_memberships: memberships });
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

    if (body.action === "update_membership") {
      if (!body.group_id) return Response.json({ error: "請提供群組 ID" }, { status: 400 });
      const updates: Record<string, boolean> = {};
      if (typeof body.receive_daily_brief === "boolean") updates.receive_daily_brief = body.receive_daily_brief;
      if (typeof body.receive_evening_alert === "boolean") updates.receive_evening_alert = body.receive_evening_alert;
      if (typeof body.receive_upload_summary === "boolean") updates.receive_upload_summary = body.receive_upload_summary;

      if (Object.keys(updates).length === 0) {
        return Response.json({ error: "沒有可更新的欄位" }, { status: 400 });
      }

      const membership = await updateUserFamilyGroupMembership(env, userId, body.group_id, updates);
      return Response.json({ success: true, membership });
    }

    return Response.json({ error: "不支援的操作" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Groups API failed" },
      { status: 500 },
    );
  }
};
