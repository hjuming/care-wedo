import {
  Env,
  VerifiedCareIdentity,
  createGroup,
  ensureGroupDefaultProfile,
  getAuthenticatedUser,
  getUserGroups,
  getUserMemberships,
  getAccessibleProfiles,
  serializeCareProfile,
  supabaseFetch,
} from "../_shared/supabase";


async function getIdentity(request: Request, env: Env) {
  return getAuthenticatedUser(env, request);
}

function serializeAuthenticatedUser(userId: number, identity: VerifiedCareIdentity) {
  return {
    id: userId,
    provider: identity.provider,
    line_user_id: identity.provider === "line" ? identity.lineUserId : null,
    auth_user_id: identity.provider === "supabase" ? identity.authUserId : null,
    auth_provider: identity.provider === "supabase" ? identity.authProvider : null,
    email: identity.provider === "supabase" ? identity.email || null : null,
    name: identity.name,
    picture_url: identity.pictureUrl,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { userId, identity } = await getIdentity(request, env);
    const groups = await getUserGroups(env, userId);
    const memberships = await getUserMemberships(env, userId);
    const profiles = await getAccessibleProfiles(env, userId);

    return Response.json({
      user: serializeAuthenticatedUser(userId, identity),
      groups,
      care_profiles: profiles.map(serializeCareProfile),
      user_memberships: memberships,
      is_first_time: groups.length === 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Me API failed";
    const status = message.includes("請先登入") ? 401 : 500;
    return Response.json(
      { error: message },
      { status },
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { userId } = await getIdentity(request, env);
    const body = await request.json<{
      action?: string;
      family_name?: string;
      primary_care_name?: string;
    }>().catch(() => ({}));

    if (body.action === "init_family") {
      // Create the primary family group and default care profile
      const familyName = body.family_name || `${body.primary_care_name || "主要照護對象"} 的家庭`;
      const primaryCareName = body.primary_care_name || "親愛的家人";

      const group = await createGroup(env, userId, familyName);
      const profile = await ensureGroupDefaultProfile(env, group.id, userId, primaryCareName);

      return Response.json({
        success: true,
        group,
        care_profile: serializeCareProfile(profile),
      });
    }

    return Response.json({ error: "不支援的操作" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Me API failed";
    const status = message.includes("請先登入") ? 401 : 500;
    return Response.json(
      { error: message },
      { status },
    );
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { userId } = await getAuthenticatedUser(env, request);

    // Delete in dependency order: appointments → medications → care_profiles → user_family_groups → users
    await supabaseFetch(env, `appointments?user_id=eq.${userId}`, { method: "DELETE" });
    await supabaseFetch(env, `medications?user_id=eq.${userId}`, { method: "DELETE" });

    // Delete care profiles where this user is the primary user
    await supabaseFetch(env, `care_profiles?primary_user_id=eq.${userId}`, { method: "DELETE" });

    // Remove from all groups (membership)
    const memberships = await getUserMemberships(env, userId);
    for (const m of memberships) {
      // If user is the only admin, delete the group entirely
      const groupMembers = await supabaseFetch<Array<{ user_id: number; role: string }>>(
        env,
        `user_family_groups?group_id=eq.${m.group_id}&select=user_id,role`,
      );
      const otherAdmins = groupMembers.filter((gm) => gm.user_id !== userId && gm.role === "admin");
      if (otherAdmins.length === 0 && groupMembers.length === 1) {
        // Only member in the group — delete the group (cascades care_profiles)
        await supabaseFetch(env, `family_groups?id=eq.${m.group_id}`, { method: "DELETE" });
      }
    }

    await supabaseFetch(env, `user_family_groups?user_id=eq.${userId}`, { method: "DELETE" });
    await supabaseFetch(env, `users?id=eq.${userId}`, { method: "DELETE" });

    return Response.json({ success: true, message: "帳號與所有相關資料已刪除。" });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "刪除帳號失敗" },
      { status: 500 },
    );
  }
};
