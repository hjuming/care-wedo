import { getRequestUser } from "../../_shared/auth_context";
import { Env, getAccessibleProfiles, getBearerToken, supabaseFetch } from "../../_shared/supabase";
import { requireGroupWriteAccess } from "../../_shared/group_permissions";

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
    const { userId } = await getRequestUser(context);

    const accessibleProfiles = await getAccessibleProfiles(env, userId);
    const profile = accessibleProfiles.find((item) => String(item.id) === String(profileId));
    if (!profile) {
      return Response.json({ error: "請先使用 LINE 登入並建立照護對象後再儲存。" }, { status: 403 });
    }
    if (!profile.group_id) return Response.json({ error: "照護對象尚未加入家庭群組" }, { status: 409 });
    await requireGroupWriteAccess(env, userId, profile.group_id);

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
    const message = String(err?.message || "");
    const status = message.includes("請先登入") ? 401 : message.includes("沒有修改權限") ? 403 : 500;
    return new Response(JSON.stringify({ error: err.message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
};
