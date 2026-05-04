import {
  createGroup,
  ensureGroupDefaultProfile,
  getBearerToken,
  getOrCreateDefaultUser,
  getUserGroups,
  getUserMemberships,
  getAccessibleProfiles,
  serializeCareProfile,
  verifyLineIdToken,
} from "../_shared/supabase";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINE_LOGIN_CHANNEL_ID?: string;
};

async function getIdentity(request: Request, env: Env) {
  const token = getBearerToken(request);
  const identity = token ? await verifyLineIdToken(env, token) : null;
  const userId = await getOrCreateDefaultUser(env, identity?.lineUserId);
  return { userId, identity };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { userId, identity } = await getIdentity(request, env);
    const groups = await getUserGroups(env, userId);
    const memberships = await getUserMemberships(env, userId);
    const profiles = await getAccessibleProfiles(env, userId);

    return Response.json({
      user: {
        id: userId,
        line_user_id: identity?.lineUserId,
        name: identity?.name,
      },
      groups,
      care_profiles: profiles.map(serializeCareProfile),
      user_memberships: memberships,
      is_first_time: groups.length === 0,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Me API failed" },
      { status: 500 },
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
      const familyName = body.family_name || `${body.primary_care_name || "親愛的爸爸"} 的家庭`;
      const primaryCareName = body.primary_care_name || "親愛的爸爸 / 媽媽";

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
    return Response.json(
      { error: error instanceof Error ? error.message : "Me API failed" },
      { status: 500 },
    );
  }
};
