import { Env, getAccessibleProfiles, getAuthenticatedUser, getBearerToken, supabaseFetch } from "../../_shared/supabase";

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const profileId = params.id;

  if (!profileId) {
    return new Response("Missing profile ID", { status: 400 });
  }

  try {
    const idToken = getBearerToken(request);
    if (!idToken) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }
    const { userId } = await getAuthenticatedUser(env, request);

    const accessibleProfiles = await getAccessibleProfiles(env, userId);
    const canManageProfile = accessibleProfiles.some((profile) => String(profile.id) === String(profileId));
    if (!canManageProfile) {
      return Response.json({ error: "請先使用 LINE 登入並建立照護對象後再儲存。" }, { status: 403 });
    }

    const updates = await request.json<any>();
    
    // We only allow updating specific fields
    const allowedFields = [
      "display_name",
      "avatar_url",
      "birth_date",
      "emergency_phone",
      "email",
      "notes",
      "main_hospital",
      "main_department",
    ];
    const filteredUpdates: any = {};
    
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return new Response("No valid fields to update", { status: 400 });
    }

    // Update in Supabase
    const result = await supabaseFetch<any[]>(env, `care_profiles?id=eq.${profileId}&select=*`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(filteredUpdates),
    });

    if (!result || result.length === 0) {
      return new Response("Profile not found or access denied", { status: 404 });
    }

    return new Response(JSON.stringify(result[0]), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
