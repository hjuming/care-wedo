import { readJsonBody } from "../_shared/request_body";
import {
  Env,
  VerifiedCareIdentity,
  createGroup,
  ensureGroupDefaultProfile,
  getUserGroups,
  getUserMemberships,
  getAccessibleProfiles,
  serializeCareProfile,
  supabaseFetch,
} from "../_shared/supabase";
import { getRequestUser } from "../_shared/auth_context";

async function getIdentity(context: { request: Request; env: Env; data?: any }) {
  return getRequestUser(context);
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

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  try {
    const { userId, identity } = await getIdentity(context);
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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  try {
    const { userId, identity } = await getIdentity(context);
    const body = await readJsonBody<{
      action?: string;
      family_name?: string;
      primary_care_name?: string;
    }>(request);

    if (body.action === "init_family") {
      // Create the primary family group and default care profile
      const identityEmail = identity.provider === "supabase" ? identity.email : "";
      const identityName = String(identity.name || identityEmail || "").trim() || "照護對象";
      const primaryCareName = String(body.primary_care_name || identityName).trim() || identityName;
      const requestedFamilyName = String(body.family_name || "").trim();
      const familyName = requestedFamilyName || `${primaryCareName} 的家庭`;

      const group = await createGroup(env, userId, familyName, {
        displayName: primaryCareName,
        avatarUrl: identity.pictureUrl || null,
      });
      const profile = await ensureGroupDefaultProfile(env, group.id, userId, primaryCareName, identity.pictureUrl || null);

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

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env } = context;
  try {
    const { userId } = await getRequestUser(context);
    // Account self-deletion is identity-only. Family care records are shared data
    // and must never be selected for deletion by historical user_id ownership.
    await supabaseFetch(env, `user_family_groups?user_id=eq.${userId}`, { method: "DELETE" });
    await supabaseFetch(env, `users?id=eq.${userId}`, { method: "DELETE" });

    return Response.json({ success: true, message: "個人帳號資料已刪除；家庭照護資料會保留。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "刪除帳號失敗";
    return Response.json(
      { error: message },
      { status: message.includes("請先登入") ? 401 : 500 },
    );
  }
};
