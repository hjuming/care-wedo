export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINE_LOGIN_CHANNEL_ID?: string;
};

export type VerifiedLineIdentity = {
  lineUserId: string;
  name?: string;
};

const DEFAULT_USER = {
  line_user_id: "web-mvp",
  name: "Care WEDO MVP",
};

export type AppointmentRow = {
  id: number;
  user_id: number;
  group_id: number | null;
  profile_id?: number | null;
  type?: string | null; // e.g. clinic_visit, inspection, refill_reminder
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
  group_id: number | null;
  profile_id?: number | null;
  name: string | null;
  dosage: string | null;
  frequency: string | null;
  purpose: string | null;
  warnings: string | null;
  reminder_text: string | null;
  active: boolean | null;
};

export type GroupRow = {
  id: number;
  name: string;
  invite_code: string;
  created_at: string;
};

export type UserFamilyGroupRow = {
  user_id: number;
  group_id: number;
  role: string;
  can_manage?: boolean;
  can_pay?: boolean;
  receive_daily_brief?: boolean;
  receive_upload_summary?: boolean;
  receive_evening_alert?: boolean;
};

export type CareProfileRow = {
  id: number;
  group_id: number | null;
  primary_user_id: number | null;
  display_name: string;
  relationship: string | null;
  avatar_url: string | null;
  birth_year: number | null;
  main_hospital: string | null;
  main_department: string | null;
  notes: string | null;
  is_default: boolean;
  created_at: string;
};

export type CareContext = {
  groupId: number | null;
  profileId: number | null;
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

export function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export async function verifyLineIdToken(env: Env, token: string): Promise<VerifiedLineIdentity> {
  if (!env.LINE_LOGIN_CHANNEL_ID) {
    throw new Error("LINE_LOGIN_CHANNEL_ID is not configured.");
  }

  const body = new URLSearchParams({
    id_token: token,
    client_id: env.LINE_LOGIN_CHANNEL_ID,
  });

  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const result = await response.json<Record<string, unknown>>().catch(() => ({}));
  if (!response.ok || typeof result.sub !== "string") {
    const detail = typeof result.error_description === "string" ? result.error_description : "LINE token verify failed.";
    throw new Error(detail);
  }

  return {
    lineUserId: result.sub,
    name: typeof result.name === "string" ? result.name : undefined,
  };
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

export async function getUserGroups(env: Env, userId: number): Promise<GroupRow[]> {
  const memberships = await supabaseFetch<UserFamilyGroupRow[]>(
    env,
    `user_family_groups?user_id=eq.${userId}&select=group_id`,
  );

  if (memberships.length === 0) return [];

  const groupIds = memberships.map((m) => m.group_id);
  const groups = await supabaseFetch<GroupRow[]>(
    env,
    `family_groups?id=in.(${groupIds.join(",")})&select=*`,
  );

  return groups;
}

export async function getUserMemberships(env: Env, userId: number): Promise<UserFamilyGroupRow[]> {
  return supabaseFetch<UserFamilyGroupRow[]>(
    env,
    `user_family_groups?user_id=eq.${userId}&select=*`,
  );
}

export async function getAccessibleProfiles(env: Env, userId: number): Promise<CareProfileRow[]> {
  const memberships = await getUserMemberships(env, userId);
  if (memberships.length === 0) return [];

  const groupIds = memberships.map((membership) => membership.group_id);
  return supabaseFetch<CareProfileRow[]>(
    env,
    `care_profiles?group_id=in.(${groupIds.join(",")})&select=*&order=is_default.desc,created_at.asc`,
  );
}

export async function createCareProfile(
  env: Env,
  input: {
    groupId: number;
    primaryUserId?: number | null;
    displayName: string;
    relationship?: string;
    isDefault?: boolean;
  },
): Promise<CareProfileRow> {
  const created = await supabaseFetch<CareProfileRow[]>(env, "care_profiles?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      group_id: input.groupId,
      primary_user_id: input.primaryUserId || null,
      display_name: input.displayName,
      relationship: input.relationship || "family",
      is_default: Boolean(input.isDefault),
    }),
  });

  if (!created || created.length === 0) throw new Error("無法建立照護對象");
  return created[0];
}

export async function ensureGroupDefaultProfile(
  env: Env,
  groupId: number,
  userId: number,
  displayName = "親愛的爸爸 / 媽媽",
): Promise<CareProfileRow> {
  const existing = await supabaseFetch<CareProfileRow[]>(
    env,
    `care_profiles?group_id=eq.${groupId}&select=*&order=is_default.desc,created_at.asc&limit=1`,
  );

  if (existing[0]) return existing[0];

  return createCareProfile(env, {
    groupId,
    primaryUserId: userId,
    displayName,
    relationship: "family",
    isDefault: true,
  });
}

export async function resolveDefaultCareContext(env: Env, userId: number): Promise<{ groupId: number | null; profileId: number | null; profileName?: string }> {
  const memberships = await getUserMemberships(env, userId);
  const primaryGroupId = memberships[0]?.group_id || null;

  if (!primaryGroupId) {
    return { groupId: null, profileId: null };
  }

  const profile = await ensureGroupDefaultProfile(env, primaryGroupId, userId);
  return { groupId: primaryGroupId, profileId: profile.id, profileName: profile.display_name };
}

export async function createGroup(env: Env, userId: number, name: string): Promise<GroupRow> {
  // Generate a random 6-character invite code
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  const created = await supabaseFetch<GroupRow[]>(env, "family_groups?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name, invite_code: inviteCode }),
  });

  if (!created || created.length === 0) throw new Error("無法建立群組");

  const group = created[0];

  // Add creator as admin
  await supabaseFetch(env, "user_family_groups", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      group_id: group.id,
      role: "admin",
      can_manage: true,
      can_pay: true,
    }),
  });

  await ensureGroupDefaultProfile(env, group.id, userId);

  return group;
}

export async function joinGroupByCode(env: Env, userId: number, code: string): Promise<GroupRow> {
  const groups = await supabaseFetch<GroupRow[]>(
    env,
    `family_groups?invite_code=eq.${encodeURIComponent(code.toUpperCase())}&select=*&limit=1`,
  );

  if (groups.length === 0) throw new Error("找不到該邀請碼對應的群組");

  const group = groups[0];

  // Check if already a member
  const existing = await supabaseFetch<UserFamilyGroupRow[]>(
    env,
    `user_family_groups?user_id=eq.${userId}&group_id=eq.${group.id}&select=*`,
  );

  if (existing.length > 0) return group;

  await supabaseFetch(env, "user_family_groups", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      group_id: group.id,
      role: "member",
    }),
  });

  return group;
}

export async function updateUserFamilyGroupMembership(
  env: Env,
  userId: number,
  groupId: number,
  updates: Partial<Pick<UserFamilyGroupRow, "receive_daily_brief" | "receive_upload_summary" | "receive_evening_alert">>,
): Promise<UserFamilyGroupRow> {
  const rows = await supabaseFetch<UserFamilyGroupRow[]>(env, `user_family_groups?user_id=eq.${userId}&group_id=eq.${groupId}&select=*&limit=1`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });

  if (!rows || rows.length === 0) {
    throw new Error("無法更新會員設定");
  }

  return rows[0];
}

export type AppointmentUpdateFields = Partial<Pick<AppointmentRow,
  "status" | "type" | "date" | "time" | "hospital" | "department" |
  "doctor" | "number" | "location" | "fasting_required" | "fasting_hours" | "notes" | "reminder_text"
>>;

export type MedicationUpdateFields = Partial<Pick<MedicationRow,
  "active" | "name" | "dosage" | "frequency" | "purpose" | "warnings" | "reminder_text"
>>;

export async function patchAppointment(
  env: Env,
  id: number,
  userId: number,
  groupIds: number[],
  updates: AppointmentUpdateFields,
): Promise<AppointmentRow> {
  // Verify ownership: appointment must belong to this user or one of their groups
  const filters = [`user_id.eq.${userId}`];
  if (groupIds.length > 0) filters.push(`group_id.in.(${groupIds.join(",")})`);
  const owned = await supabaseFetch<AppointmentRow[]>(
    env,
    `appointments?id=eq.${id}&or=(${filters.join(",")})&select=id&limit=1`,
  );
  if (owned.length === 0) throw new Error("找不到該預約或您沒有修改權限");

  const rows = await supabaseFetch<AppointmentRow[]>(
    env,
    `appointments?id=eq.${id}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(updates),
    },
  );
  if (!rows || rows.length === 0) throw new Error("更新預約失敗");
  return rows[0];
}

export async function patchMedication(
  env: Env,
  id: number,
  userId: number,
  groupIds: number[],
  updates: MedicationUpdateFields,
): Promise<MedicationRow> {
  // Verify ownership
  const filters = [`user_id.eq.${userId}`];
  if (groupIds.length > 0) filters.push(`group_id.in.(${groupIds.join(",")})`);
  const owned = await supabaseFetch<MedicationRow[]>(
    env,
    `medications?id=eq.${id}&or=(${filters.join(",")})&select=id&limit=1`,
  );
  if (owned.length === 0) throw new Error("找不到該藥物或您沒有修改權限");

  const rows = await supabaseFetch<MedicationRow[]>(
    env,
    `medications?id=eq.${id}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(updates),
    },
  );
  if (!rows || rows.length === 0) throw new Error("更新藥物失敗");
  return rows[0];
}

export function serializeAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    profile_id: row.profile_id || null,
    type: row.type || "clinic_visit",
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
    profile_id: row.profile_id || null,
    name: row.name,
    dosage: row.dosage,
    frequency: row.frequency,
    purpose: row.purpose,
    warnings: row.warnings,
    reminder_text: row.reminder_text,
    active: row.active !== false,
  };
}

export function serializeCareProfile(row: CareProfileRow) {
  return {
    id: row.id,
    group_id: row.group_id,
    display_name: row.display_name,
    relationship: row.relationship || "family",
    avatar_url: row.avatar_url,
    birth_year: row.birth_year,
    main_hospital: row.main_hospital,
    main_department: row.main_department,
    notes: row.notes,
    is_default: row.is_default,
  };
}

// ─── Plan / Quota ────────────────────────────────────────────────────────────

export const FREE_OCR_MONTHLY_LIMIT = 10;

type UserPlanRow = { plan: string; plan_expires_at: string | null };

export async function getUserPlan(env: Env, userId: number): Promise<{ plan: string; planExpiresAt: string | null }> {
  const rows = await supabaseFetch<UserPlanRow[]>(
    env,
    `users?id=eq.${userId}&select=plan,plan_expires_at&limit=1`,
  );
  const row = rows[0];
  if (!row) return { plan: "free", planExpiresAt: null };

  // If plan has expired, treat as free
  if (row.plan === "paid" && row.plan_expires_at) {
    const expires = new Date(row.plan_expires_at);
    if (expires < new Date()) return { plan: "free", planExpiresAt: row.plan_expires_at };
  }
  return { plan: row.plan || "free", planExpiresAt: row.plan_expires_at };
}

export async function getMonthlyOcrUsage(env: Env, userId: number): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Count appointments created this month via OCR (those with a reminder_text set by OCR)
  // We use created_at as proxy — OCR-created records share the same timestamp window
  const apts = await supabaseFetch<Array<{ id: number }>>(
    env,
    `appointments?user_id=eq.${userId}&created_at=gte.${startOfMonth}&select=id`,
  );
  const meds = await supabaseFetch<Array<{ id: number }>>(
    env,
    `medications?user_id=eq.${userId}&created_at=gte.${startOfMonth}&select=id`,
  );
  // Each OCR call typically creates 1-3 records; we count total records as usage proxy
  // A more precise approach would require a dedicated ocr_usage table (Sprint 2+)
  return apts.length + meds.length;
}

export async function checkOcrQuota(env: Env, userId: number): Promise<void> {
  const { plan } = await getUserPlan(env, userId);
  if (plan === "paid") return; // paid users have unlimited OCR

  const used = await getMonthlyOcrUsage(env, userId);
  if (used >= FREE_OCR_MONTHLY_LIMIT) {
    throw new Error(`本月免費次數已用完（${FREE_OCR_MONTHLY_LIMIT} 次），升級付費方案可無限使用。`);
  }
}
