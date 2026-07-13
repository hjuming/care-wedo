import { readJsonBody } from "../../_shared/request_body";
import {
  Env,
  MedicationUpdateFields,
  getBearerToken,
  getUserMemberships,
  patchMedication,
  serializeMedication,
} from "../../_shared/supabase";
import { getRequestUser } from "../../_shared/auth_context";
import { manageableGroupIds } from "../../_shared/group_permissions";

async function getIdentityAndGroups(context: { request: Request; env: Env; data?: any }) {
  const { env } = context;
  const { userId } = await getRequestUser(context);
  const memberships = await getUserMemberships(env, userId);
  const groupIds = manageableGroupIds(memberships);
  return { userId, groupIds };
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: "無效的 ID" }, { status: 400 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const { userId, groupIds } = await getIdentityAndGroups(context);

    const body = await readJsonBody<MedicationUpdateFields>(request);

    // Only allow safe update fields
    const allowed: MedicationUpdateFields = {};
    if (body.active !== undefined) allowed.active = body.active;
    if (body.name !== undefined) allowed.name = body.name;
    if (body.dosage !== undefined) allowed.dosage = body.dosage;
    if (body.frequency !== undefined) allowed.frequency = body.frequency;
    if (body.time_slot !== undefined) allowed.time_slot = body.time_slot;
    if (body.meal_timing !== undefined) allowed.meal_timing = body.meal_timing;
    if (body.scheduled_time !== undefined) allowed.scheduled_time = body.scheduled_time;
    if (body.taken_status !== undefined) allowed.taken_status = body.taken_status;
    if (body.purpose !== undefined) allowed.purpose = body.purpose;
    if (body.warnings !== undefined) allowed.warnings = body.warnings;
    if (body.reminder_text !== undefined) allowed.reminder_text = body.reminder_text;

    if (Object.keys(allowed).length === 0) {
      return Response.json({ error: "未提供任何更新欄位" }, { status: 400 });
    }

    const updated = await patchMedication(env, id, userId, groupIds, allowed);
    return Response.json({ success: true, medication: serializeMedication(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新藥物失敗";
    const status = message.includes("請先登入") ? 401 : message.includes("沒有修改權限") ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
};
