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

export async function resolveDefaultCareContext(env: Env, userId: number): Promise<CareContext> {
  const memberships = await getUserMemberships(env, userId);
  const primaryGroupId = memberships[0]?.group_id || null;

  if (!primaryGroupId) {
    return { groupId: null, profileId: null };
  }

  const profile = await ensureGroupDefaultProfile(env, primaryGroupId, userId);
  return { groupId: primaryGroupId, profileId: profile.id };
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
