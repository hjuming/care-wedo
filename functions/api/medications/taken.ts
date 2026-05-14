import {
  Env,
  getBearerToken,
  getOrCreateDefaultUser,
  getUserMemberships,
  supabaseFetch,
  verifyLineIdToken,
} from "../../_shared/supabase";

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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const identity = await verifyLineIdToken(env, token);
    const userId = await getOrCreateDefaultUser(env, identity.lineUserId);
    const memberships = await getUserMemberships(env, userId);
    const groupIds = memberships.map((membership) => membership.group_id);

    const body = await request.json<{
      medication_ids?: unknown;
      status?: string;
      taken_date?: string;
      time_slot?: string;
    }>().catch(() => ({}));
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
      || medications.some((medication) => medication.user_id !== userId && (!medication.group_id || !groupIds.includes(medication.group_id)))
    ) {
      return Response.json({ error: "找不到藥物或沒有確認權限" }, { status: 403 });
    }

    let logs: Array<{ id: number }> = [];
    try {
      logs = await supabaseFetch<Array<{ id: number }>>(
        env,
        "medication_logs?select=id",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(medications.map((medication) => ({
            medication_id: medication.id,
            group_id: medication.group_id,
            profile_id: medication.profile_id,
            taken_date: takenDate,
            time_slot: inferTimeSlot(medication, body.time_slot),
            status: status,
            confirmed_by_user_id: userId,
          }))),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/medication_logs|PGRST205|Could not find the table/i.test(message)) {
        throw error;
      }
      console.warn(JSON.stringify({
        event: "medications.taken_logs_missing",
        medication_count: medicationIds.length,
      }));
    }

    return Response.json({
      success: true,
      log_ids: logs.map((log) => log.id),
      medication_ids: medicationIds,
      taken_date: takenDate,
      status,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法記錄吃藥狀態" },
      { status: 500 },
    );
  }
};
