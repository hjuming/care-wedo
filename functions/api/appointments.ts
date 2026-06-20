import {
  Env,
  getAccessibleProfiles,
  getAuthenticatedUser,
  getBearerToken,
  serializeAppointment,
  supabaseFetch,
} from "../_shared/supabase";

const ALLOWED_TYPES = new Set([
  "reminder",
  "clinic_visit",
  "inspection",
  "refill_reminder",
  "medication",
  "measurement",
  "document",
  "rehab",
  "exercise",
  "other",
]);

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const idToken = getBearerToken(request);
    if (!idToken) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const { userId } = await getAuthenticatedUser(env, request);
    const body = await request.json<any>().catch(() => ({}));

    const profileId = Number(body.profile_id);
    if (!Number.isFinite(profileId) || profileId <= 0) {
      return Response.json({ error: "請先選擇照護對象" }, { status: 400 });
    }

    const profiles = await getAccessibleProfiles(env, userId);
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return Response.json({ error: "沒有此照護對象的新增權限" }, { status: 403 });
    }

    const type = ALLOWED_TYPES.has(body.type) ? body.type : "reminder";
    const date = cleanString(body.date);
    const title = cleanString(body.title || body.department || body.hospital);

    if (!date) {
      return Response.json({ error: "請選擇提醒日期" }, { status: 400 });
    }
    if (!title) {
      return Response.json({ error: "請輸入提醒名稱" }, { status: 400 });
    }

    const payload = {
      user_id: userId,
      group_id: profile.group_id,
      profile_id: profile.id,
      created_by_user_id: userId,
      type,
      date,
      time: cleanString(body.time) || null,
      title,
      hospital: cleanString(body.hospital) || (type === "reminder" ? "家庭提醒" : null),
      department: cleanString(body.department) || null,
      doctor: cleanString(body.doctor) || null,
      number: cleanString(body.number) || null,
      location: cleanString(body.location) || null,
      fasting_required: Boolean(body.fasting_required),
      fasting_hours: body.fasting_hours ? Number(body.fasting_hours) : null,
      notes: cleanString(body.notes) || null,
      reminder_text: cleanString(body.reminder_text || body.notes) || null,
      status: "upcoming",
    };

    let rows: any[];
    try {
      rows = await supabaseFetch<any[]>(env, "appointments?select=*", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/appointments\.title|title.*column|Could not find.*title/i.test(message)) throw error;
      const { title: legacyTitle, ...legacyPayload } = payload;
      rows = await supabaseFetch<any[]>(env, "appointments?select=*", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...legacyPayload,
          department: legacyPayload.department || legacyTitle,
        }),
      });
    }

    if (!rows?.[0]) {
      return Response.json({ error: "新增排程失敗" }, { status: 500 });
    }

    return Response.json({ success: true, appointment: serializeAppointment(rows[0]) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "新增排程失敗" },
      { status: 500 },
    );
  }
};
