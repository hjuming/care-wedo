import { readJsonBody } from "../../_shared/request_body";
import {
  Env,
  getBearerToken,
  getUserMemberships,
  supabaseFetch,
} from "../../_shared/supabase";
import { getRequestUser } from "../../_shared/auth_context";
import { manageableGroupIds } from "../../_shared/group_permissions";
import {
  parseMedicationIdempotencyKey,
  writeMedicationLogsIdempotently,
} from "../../_shared/medication_idempotency";

type MedicationScopeRow = {
  id: number;
  user_id: number | null;
  group_id: number | null;
  profile_id: number | null;
  time_slot: string | null;
  scheduled_time: string | null;
  frequency: string | null;
};

function todayInTaipei() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function inferTimeSlot(medication: MedicationScopeRow, fallback = "") {
  const text = String(fallback || medication.time_slot || medication.scheduled_time || medication.frequency || "").toLowerCase();
  if (text.includes("bedtime") || text.includes("睡前")) return "bedtime";
  if (text.includes("evening") || text.includes("night") || text.includes("晚上") || text.includes("晚餐")) return "evening";
  if (text.includes("noon") || text.includes("lunch") || text.includes("中午") || text.includes("午餐")) return "noon";
  if (text.includes("morning") || text.includes("breakfast") || text.includes("早上") || text.includes("早餐") || text.includes("上午")) return "morning";
  return "unspecified";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  try {
    const token = getBearerToken(request);
    if (!token) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const { userId } = await getRequestUser(context);
    const memberships = await getUserMemberships(env, userId);
    const groupIds = manageableGroupIds(memberships);

    const body = await readJsonBody<{
      medication_ids?: unknown;
      status?: string;
      taken_date?: string;
      time_slot?: string;
    }>(request);
    const medicationIds = Array.from(new Set(
      Array.isArray(body.medication_ids)
        ? body.medication_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
        : [],
    ));
    if (medicationIds.length === 0) {
      return Response.json({ error: "請提供要記錄的藥物" }, { status: 400 });
    }

    const status = body.status === "forgotten" ? "forgotten" : "taken";
    const takenDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.taken_date || ""))
      ? String(body.taken_date)
      : todayInTaipei();

    const medications = await supabaseFetch<MedicationScopeRow[]>(
      env,
      `medications?id=in.(${medicationIds.join(",")})&select=id,user_id,group_id,profile_id,time_slot,scheduled_time,frequency`,
    );
    if (
      medications.length !== medicationIds.length
      || medications.some((medication) => !medication.group_id || !groupIds.includes(medication.group_id))
    ) {
      return Response.json({ error: "找不到藥物或沒有確認權限" }, { status: 403 });
    }

    const idempotency = parseMedicationIdempotencyKey(request);
    if (!idempotency.key) {
      return Response.json({ error: idempotency.error }, { status: 400 });
    }

    const writes = medications.map((medication) => ({
      medication_id: medication.id,
      group_id: medication.group_id,
      profile_id: medication.profile_id,
      taken_date: takenDate,
      time_slot: inferTimeSlot(medication, body.time_slot),
      status,
      confirmed_by_user_id: userId,
    }));
    const { logs, deduplicated } = await writeMedicationLogsIdempotently(
      env,
      writes,
      idempotency.key,
    );

    return Response.json({
      success: true,
      deduplicated,
      log_ids: logs.map((log) => log.id),
      medication_ids: medicationIds,
      taken_date: takenDate,
      status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法記錄吃藥狀態";
    const idempotencyConflict = /Idempotency-Key 已用於不同的用藥紀錄/.test(message);
    const dependencyUnavailable = /medication_logs|idempotency_key|PGRST20[45]|Could not find the table|Supabase request failed \((?:5\d\d|404)\)/i.test(message);
    return Response.json(
      { error: idempotencyConflict ? "這次操作內容與先前紀錄不一致，請重新整理後再試一次" : dependencyUnavailable ? "服藥紀錄暫時無法儲存，請稍後重試" : "無法記錄吃藥狀態" },
      { status: idempotencyConflict ? 409 : dependencyUnavailable ? 503 : 500 },
    );
  }
};
