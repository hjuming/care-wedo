import { readJsonBody } from "../../../_shared/request_body";
import {
  Env,
  getBearerToken,
  getUserMemberships,
  supabaseFetch,
} from "../../../_shared/supabase";
import { getRequestUser } from "../../../_shared/auth_context";

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
  const { request, env, params } = context;
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: "無效的藥物 ID" }, { status: 400 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const { userId } = await getRequestUser(context);
    const memberships = await getUserMemberships(env, userId);
    const groupIds = memberships.map((membership) => membership.group_id);

    const medications = await supabaseFetch<MedicationScopeRow[]>(
      env,
      `medications?id=eq.${id}&select=id,user_id,group_id,profile_id,time_slot,scheduled_time,frequency&limit=1`,
    );
    const medication = medications[0];
    if (!medication || (medication.user_id !== userId && (!medication.group_id || !groupIds.includes(medication.group_id)))) {
      return Response.json({ error: "找不到藥物或沒有確認權限" }, { status: 403 });
    }

    const body = await readJsonBody<{ taken_date?: string; time_slot?: string }>(request);
    const takenDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.taken_date || ""))
      ? String(body.taken_date)
      : todayInTaipei();
    const timeSlot = inferTimeSlot(medication, body.time_slot);

    let logs: Array<{ id: number }> = [];
    try {
      logs = await supabaseFetch<Array<{ id: number }>>(
        env,
        "medication_logs?select=id",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            medication_id: medication.id,
            group_id: medication.group_id,
            profile_id: medication.profile_id,
            taken_date: takenDate,
            time_slot: timeSlot,
            status: "taken",
            confirmed_by_user_id: userId,
          }),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/medication_logs|PGRST205|Could not find the table/i.test(message)) {
        throw error;
      }
      console.warn(JSON.stringify({
        event: "medications.single_taken_logs_missing",
        medication_id: medication.id,
      }));
    }

    return Response.json({
      success: true,
      log_id: logs[0]?.id,
      medication_id: medication.id,
      taken_date: takenDate,
      time_slot: timeSlot,
      status: "taken",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法記錄吃藥狀態";
    return Response.json(
      { error: message },
      { status: message.includes("請先登入") ? 401 : 500 },
    );
  }
};
