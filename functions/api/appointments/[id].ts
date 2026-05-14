import {
  AppointmentUpdateFields,
  Env,
  getBearerToken,
  getOrCreateDefaultUser,
  getUserMemberships,
  patchAppointment,
  serializeAppointment,
  verifyLineIdToken,
} from "../../_shared/supabase";

async function getIdentityAndGroups(request: Request, env: Env) {
  const token = getBearerToken(request);
  const identity = token ? await verifyLineIdToken(env, token) : null;
  const userId = await getOrCreateDefaultUser(env, identity?.lineUserId);
  const memberships = await getUserMemberships(env, userId);
  const groupIds = memberships.map((m) => m.group_id);
  return { userId, groupIds };
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: "無效的 ID" }, { status: 400 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const { userId, groupIds } = await getIdentityAndGroups(request, env);

    const body = await request.json<AppointmentUpdateFields>().catch(() => ({}));

    // Only allow safe update fields
    const allowed: AppointmentUpdateFields = {};
    if (body.status !== undefined) allowed.status = body.status;
    if (body.type !== undefined) allowed.type = body.type;
    if (body.date !== undefined) allowed.date = body.date;
    if (body.time !== undefined) allowed.time = body.time;
    if (body.title !== undefined) allowed.title = body.title;
    if (body.hospital !== undefined) allowed.hospital = body.hospital;
    if (body.department !== undefined) allowed.department = body.department;
    if (body.doctor !== undefined) allowed.doctor = body.doctor;
    if (body.number !== undefined) allowed.number = body.number;
    if (body.location !== undefined) allowed.location = body.location;
    if (body.fasting_required !== undefined) allowed.fasting_required = body.fasting_required;
    if (body.fasting_hours !== undefined) allowed.fasting_hours = body.fasting_hours;
    if (body.notes !== undefined) allowed.notes = body.notes;
    if (body.reminder_text !== undefined) allowed.reminder_text = body.reminder_text;

    if (Object.keys(allowed).length === 0) {
      return Response.json({ error: "未提供任何更新欄位" }, { status: 400 });
    }

    const updated = await patchAppointment(env, id, userId, groupIds, allowed);
    return Response.json({ success: true, appointment: serializeAppointment(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新預約失敗";
    const status = message.includes("沒有修改權限") ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
};
