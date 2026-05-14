import {
  Env,
  getAccessibleProfiles,
  getBearerToken,
  getOrCreateDefaultUser,
  serializeCareProfile,
  setProfileOrderInFlags,
  supabaseFetch,
  verifyLineIdToken,
} from "../../_shared/supabase";

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const idToken = getBearerToken(request);
    if (!idToken) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const identity = await verifyLineIdToken(env, idToken);
    const userId = await getOrCreateDefaultUser(env, identity.lineUserId);
    const body = await request.json<{ profile_ids?: unknown[] }>().catch(() => ({}));
    const profileIds = (body.profile_ids || [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (profileIds.length === 0) {
      return Response.json({ error: "沒有可更新的排序" }, { status: 400 });
    }

    const accessibleProfiles = await getAccessibleProfiles(env, userId);
    const profileById = new Map(accessibleProfiles.map((profile) => [profile.id, profile]));
    const targetProfiles = profileIds.map((id) => profileById.get(id));

    if (targetProfiles.some((profile) => !profile)) {
      return Response.json({ error: "沒有這些照護對象的排序權限" }, { status: 403 });
    }

    const groupId = targetProfiles[0]?.group_id || null;
    if (targetProfiles.some((profile) => profile?.group_id !== groupId)) {
      return Response.json({ error: "一次只能調整同一個家庭群組內的排序" }, { status: 400 });
    }

    let updatedProfiles: any[];
    try {
      updatedProfiles = await Promise.all(profileIds.map((profileId, index) => (
        supabaseFetch<any[]>(env, `care_profiles?id=eq.${profileId}&select=*`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ sort_order: (index + 1) * 10 }),
        }).then((rows) => rows[0])
      )));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/care_profiles\.sort_order|sort_order.*column|Could not find.*sort_order/i.test(message)) throw error;
      await setProfileOrderInFlags(env, userId, groupId, profileIds);
      updatedProfiles = (await getAccessibleProfiles(env, userId))
        .filter((profile) => profile.group_id === groupId);
    }

    return Response.json({
      success: true,
      care_profiles: updatedProfiles.filter(Boolean).map(serializeCareProfile),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法更新照護對象排序";
    const missingSortOrder = /care_profiles\.sort_order|sort_order.*column|Could not find.*sort_order/i.test(message);
    return Response.json(
      { error: missingSortOrder ? "排序欄位尚未啟用，請先套用最新資料庫 migration。" : message },
      { status: missingSortOrder ? 409 : 500 },
    );
  }
};
