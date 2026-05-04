type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const DEFAULT_USER = {
  line_user_id: "web-mvp",
  name: "Care WEDO MVP",
};

export type AppointmentRow = {
  id: number;
  user_id: number;
  date: string | null;
  time: string | null;
  hospital: string | null;
  department: string | null;
  doctor: string | null;
  number: string | null;
  location: string | null;
  fasting_required: boolean | null;
  fasting_hours: number | null;
  notes: string | null;
  reminder_text: string | null;
  status: string | null;
};

export type MedicationRow = {
  id: number;
  user_id: number;
  name: string | null;
  dosage: string | null;
  frequency: string | null;
  purpose: string | null;
  warnings: string | null;
  reminder_text: string | null;
  active: boolean | null;
};

function assertSupabaseEnv(env: Partial<Env>) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment variables are not configured.");
  }
}

export async function supabaseFetch<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  assertSupabaseEnv(env);

  const url = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`;
  const headers = new Headers(init.headers);
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set("Authorization", `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(url, { ...init, headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }

  return text ? (JSON.parse(text) as T) : ([] as T);
}

export async function getOrCreateDefaultUser(env: Env, lineUserId?: string): Promise<number> {
  const targetLineId = lineUserId || DEFAULT_USER.line_user_id;
  const targetName = lineUserId ? `LINE User (${lineUserId.slice(-4)})` : DEFAULT_USER.name;

  const existing = await supabaseFetch<Array<{ id: number }>>(
    env,
    `users?line_user_id=eq.${encodeURIComponent(targetLineId)}&select=id&limit=1`,
  );

  if (existing[0]?.id) return existing[0].id;

  const created = await supabaseFetch<Array<{ id: number }>>(env, "users?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      line_user_id: targetLineId,
      name: targetName,
    }),
  });

  if (!created || created.length === 0) throw new Error("無法建立使用者");
  return created[0].id;
}

export function serializeAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    hospital: row.hospital,
    department: row.department,
    doctor: row.doctor,
    number: row.number,
    location: row.location,
    fasting_required: Boolean(row.fasting_required),
    fasting_hours: row.fasting_hours,
    notes: row.notes,
    reminder_text: row.reminder_text,
    status: row.status || "upcoming",
  };
}

export function serializeMedication(row: MedicationRow) {
  return {
    id: row.id,
    name: row.name,
    dosage: row.dosage,
    frequency: row.frequency,
    purpose: row.purpose,
    warnings: row.warnings,
    reminder_text: row.reminder_text,
    active: row.active !== false,
  };
}
