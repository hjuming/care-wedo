import { readJsonBody } from "../_shared/request_body";
import {
  AppointmentRow,
  Env,
  getAccessibleProfiles,
  getBearerToken,
  serializeAppointment,
  supabaseFetch,
} from "../_shared/supabase";
import { getRequestUser } from "../_shared/auth_context";
import { requireGroupWriteAccess } from "../_shared/group_permissions";

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

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function parseIdempotencyKey(request: Request): { key: string | null; error?: string } {
  const raw = request.headers.get("Idempotency-Key");
  if (!raw) return { key: null };
  const key = raw.trim();
  if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return { key: null, error: `Idempotency-Key 必須是 ${IDEMPOTENCY_KEY_MAX_LENGTH} 字元內的英數字、點、底線、連字號或波浪號` };
  }
  return { key };
}

function sameAppointmentField(left: unknown, right: unknown): boolean {
  if (typeof left === "boolean" || typeof right === "boolean") return Boolean(left) === Boolean(right);
  return (left ?? null) === (right ?? null);
}

function isSameAppointmentFingerprint(row: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return [
    "group_id",
    "profile_id",
    "type",
    "date",
    "time",
    "title",
    "hospital",
    "department",
    "doctor",
    "number",
    "location",
    "fasting_required",
    "fasting_hours",
    "notes",
    "reminder_text",
  ].every((field) => sameAppointmentField(row[field], payload[field]));
}

async function findExistingAppointment(env: Env, payload: Record<string, unknown>): Promise<AppointmentRow | null> {
  try {
    const rows = await supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?group_id=eq.${payload.group_id}&profile_id=eq.${payload.profile_id}&date=eq.${encodeURIComponent(String(payload.date))}&status=neq.deleted&select=*&order=created_at.asc&limit=50`,
    );
    return rows.find((row) => isSameAppointmentFingerprint(row, payload)) || null;
  } catch (error) {
    console.warn(JSON.stringify({
      event: "appointments.dedupe_lookup_failed",
      message: error instanceof Error ? error.message : "unknown error",
    }));
    throw new Error("行程去重檢查失敗，為避免建立重複資料，請稍後再試。");
  }
}

function isMissingIdempotencyColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /PGRST204|(?:column|field).*idempotency_key.*(?:does not exist|not found)|(?:could not find|does not exist).*idempotency_key/i.test(message);
}

function isIdempotencyConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /23505|duplicate key|appointments_group_idempotency_key_uidx/i.test(message);
}

async function findAppointmentByIdempotencyKey(
  env: Env,
  groupId: number,
  key: string,
): Promise<{ row: AppointmentRow | null; supported: boolean }> {
  try {
    const rows = await supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?group_id=eq.${groupId}&idempotency_key=eq.${encodeURIComponent(key)}&status=neq.deleted&select=*&limit=1`,
    );
    return { row: rows[0] || null, supported: true };
  } catch (error) {
    if (isMissingIdempotencyColumn(error)) return { row: null, supported: false };
    throw error;
  }
}

function deduplicatedResponse(appointment: AppointmentRow): Response {
  return Response.json({
    success: true,
    deduplicated: true,
    appointment: serializeAppointment(appointment),
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  try {
    const idToken = getBearerToken(request);
    if (!idToken) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const { userId } = await getRequestUser(context);
    const idempotency = parseIdempotencyKey(request);
    if (idempotency.error) return Response.json({ error: idempotency.error }, { status: 400 });
    const body = await readJsonBody<any>(request);

    const profileId = Number(body.profile_id);
    if (!Number.isFinite(profileId) || profileId <= 0) {
      return Response.json({ error: "請先選擇照護對象" }, { status: 400 });
    }

    const profiles = await getAccessibleProfiles(env, userId);
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return Response.json({ error: "沒有此照護對象的新增權限" }, { status: 403 });
    }
    if (!profile.group_id) return Response.json({ error: "照護對象尚未加入家庭群組" }, { status: 409 });
    await requireGroupWriteAccess(env, userId, profile.group_id);

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

    let idempotencyColumnSupported = false;
    if (idempotency.key) {
      const existingByKey = await findAppointmentByIdempotencyKey(env, profile.group_id, idempotency.key);
      idempotencyColumnSupported = existingByKey.supported;
      if (existingByKey.row) {
        if (!isSameAppointmentFingerprint(existingByKey.row, payload)) {
          return Response.json({ error: "Idempotency-Key 已用於不同的預約內容" }, { status: 409 });
        }
        return deduplicatedResponse(existingByKey.row);
      }
    }

    const existing = await findExistingAppointment(env, payload);
    if (existing) {
      return deduplicatedResponse(existing);
    }

    const insertPayload = idempotency.key && idempotencyColumnSupported
      ? { ...payload, idempotency_key: idempotency.key }
      : payload;

    let rows: any[];
    try {
      rows = await supabaseFetch<any[]>(env, "appointments?select=*", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(insertPayload),
      });
    } catch (error) {
      if (idempotency.key && idempotencyColumnSupported && isMissingIdempotencyColumn(error)) {
        rows = await supabaseFetch<any[]>(env, "appointments?select=*", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(payload),
        });
      } else if (idempotency.key && idempotencyColumnSupported && isIdempotencyConflict(error)) {
        const raced = await findAppointmentByIdempotencyKey(env, profile.group_id, idempotency.key);
        if (!raced.row) throw error;
        if (!isSameAppointmentFingerprint(raced.row, payload)) {
          return Response.json({ error: "Idempotency-Key 已用於不同的預約內容" }, { status: 409 });
        }
        return deduplicatedResponse(raced.row);
      } else {
        const message = error instanceof Error ? error.message : "";
        if (!/appointments\.title|title.*column|Could not find.*title/i.test(message)) throw error;
        const { title: legacyTitle, ...legacyPayload } = insertPayload;
        rows = await supabaseFetch<any[]>(env, "appointments?select=*", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            ...legacyPayload,
            department: legacyPayload.department || legacyTitle,
          }),
        });
      }
    }

    if (!rows?.[0]) {
      return Response.json({ error: "新增排程失敗" }, { status: 500 });
    }

    return Response.json({ success: true, appointment: serializeAppointment(rows[0]) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "新增排程失敗";
    return Response.json(
      { error: message },
      {
        status: message.includes("請先登入")
          ? 401
          : message.includes("沒有修改權限")
            ? 403
            : message.includes("去重檢查")
              ? 503
              : 500,
      },
    );
  }
};
