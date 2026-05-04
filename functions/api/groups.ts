import {
  UserFamilyGroupRow,
  createCareProfile,
  createGroup,
  getBearerToken,
  getAccessibleProfiles,
  getOrCreateDefaultUser,
  getUserGroups,
  getUserMemberships,
  joinGroupByCode,
  serializeCareProfile,
  supabaseFetch,
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

async function assertAdmin(env: Env, userId: number, groupId: number): Promise<void> {
  const memberships = await supabaseFetch<UserFamilyGroupRow[]>(
    env,
    `user_family_groups?user_id=eq.${userId}&group_id=eq.${groupId}&select=role&limit=1`,
  );
  if (!memberships[0] || memberships[0].role !== "admin") {
    throw new Error("只有群組管理者才能執行此操作");
  }
}

type GroupMember = {
  user_id: number;
  role: string;
  can_manage: boolean;
  receive_daily_brief: boolean;
  receive_evening_alert: boolean;
  receive_upload_summary: boolean;
  user: { name: string | null; line_user_id: string | null } | null;
};

async function getGroupMembers(env: Env, groupId: number): Promise<GroupMember[]> {
  return supabaseFetch<GroupMember[]>(
    env,
    `user_family_groups?group_id=eq.${groupId}&select=user_id,role,can_manage,receive_daily_brief,receive_evening_alert,receive_upload_summary,users(name,line_user_id)`,
  );
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const userId = await getIdentity(request, env);
    const groups = await getUserGroups(env, userId);
    const memberships = await getUserMemberships(env, userId);
    const profiles = await getAccessibleProfiles(env, userId);

    // Enrich each group with member list
    const groupsWithMembers = await Promise.all(
      groups.map(async (group) => ({
        ...group,
        members: await getGroupMembers(env, group.id),
      }))
    );

    return Response.json({ groups: groupsWithMembers, care_profiles: profiles.map(serializeCareProfile), user_memberships: memberships });
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
      target_user_id?: number;
      receive_daily_brief?: boolean;
      receive_evening_alert?: boolean;
      receive_upload_summary?: boolean;
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

    if (body.action === "get_members") {
      if (!body.group_id) return Response.json({ error: "請提供群組 ID" }, { status: 400 });
      const memberships = await getUserMemberships(env, userId);
      const isMember = memberships.some((m) => m.group_id === body.group_id);
      if (!isMember) return Response.json({ error: "您不是此群組成員" }, { status: 403 });

      const members = await getGroupMembers(env, body.group_id);
      return Response.json({ success: true, members });
    }

    if (body.action === "remove_member") {
      if (!body.group_id) return Response.json({ error: "請提供群組 ID" }, { status: 400 });
      if (!body.target_user_id) return Response.json({ error: "請提供要移除的成員 ID" }, { status: 400 });
      if (body.target_user_id === userId) return Response.json({ error: "不能移除自己" }, { status: 400 });

      await assertAdmin(env, userId, body.group_id);
      await supabaseFetch(
        env,
        `user_family_groups?user_id=eq.${body.target_user_id}&group_id=eq.${body.group_id}`,
        { method: "DELETE" },
      );
      return Response.json({ success: true });
    }

    if (body.action === "regenerate_invite") {
      if (!body.group_id) return Response.json({ error: "請提供群組 ID" }, { status: 400 });
      await assertAdmin(env, userId, body.group_id);

      const newCode = Math.random().toString(36).substring(2, 8).toUpperCase()
        + Math.random().toString(36).substring(2, 4).toUpperCase();

      const updated = await supabaseFetch<Array<{ id: number; invite_code: string }>>(
        env,
        `family_groups?id=eq.${body.group_id}&select=id,invite_code`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ invite_code: newCode }),
        },
      );
      return Response.json({ success: true, invite_code: updated[0]?.invite_code });
    }

    return Response.json({ error: "不支援的操作" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Groups API failed";
    const status = message.includes("管理者") ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
};
