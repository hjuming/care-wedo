export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINE_LOGIN_CHANNEL_ID?: string;
};

export type VerifiedLineIdentity = {
  lineUserId: string;
  name?: string;
  pictureUrl?: string;
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
  source_document_id?: number | null;
  created_by_user_id?: number | null;
  type?: string | null; // e.g. clinic_visit, inspection, refill_reminder
  date: string | null;
  time: string | null;
  title?: string | null;
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
  created_at?: string | null;
};

export type MedicationRow = {
  id: number;
  user_id: number;
  group_id: number | null;
  profile_id?: number | null;
  source_document_id?: number | null;
  created_by_user_id?: number | null;
  name: string | null;
  dosage: string | null;
  frequency: string | null;
  time_slot?: string | null;
  meal_timing?: string | null;
  scheduled_time?: string | null;
  taken_status?: string | null;
  purpose: string | null;
  warnings: string | null;
  reminder_text: string | null;
  active: boolean | null;
};

export type PlanRow = {
  id: string;
  name: string;
  monthly_ocr_limit: number;
  max_members: number;
  max_recipients: number;
  family_group_enabled: boolean;
  price_monthly_usd: number;
  is_active: boolean;
  sort_order: number;
};

export type GroupRow = {
  id: number;
  name: string;
  invite_code: string;
  owner_user_id?: number | null;
  plan_id?: string;
  plan_started_at?: string | null;
  plan_expires_at?: string | null;
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

export type UserFeatureFlagRow = {
  id: number;
  user_id: number;
  feature_key: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

const ACTIVE_PROFILE_FLAG_PREFIX = "active_profile:";
const PROFILE_ORDER_FLAG_PREFIX = "profile_order:";

function parseNumericFlagSuffix(featureKey: string, prefix: string): number | null {
  if (!featureKey.startsWith(prefix)) return null;
  const value = Number(featureKey.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseProfileOrderFlag(featureKey: string): { profileId: number; order: number } | null {
  if (!featureKey.startsWith(PROFILE_ORDER_FLAG_PREFIX)) return null;
  const [, groupId, order, profileId] = featureKey.split(":");
  const parsedGroupId = Number(groupId);
  const parsedOrder = Number(order);
  const parsedProfileId = Number(profileId);
  if (!Number.isFinite(parsedGroupId) || !Number.isFinite(parsedOrder) || !Number.isFinite(parsedProfileId)) return null;
  return { profileId: parsedProfileId, order: parsedOrder };
}

async function getActiveProfileIdFromFlags(env: Env, userId: number): Promise<number | null> {
  const rows = await supabaseFetch<Array<{ feature_key: string }>>(
    env,
    `user_feature_flags?user_id=eq.${userId}&feature_key=like.${ACTIVE_PROFILE_FLAG_PREFIX}*&enabled=eq.true&select=feature_key,created_at&order=created_at.desc&limit=1`,
  );
  return rows[0]?.feature_key ? parseNumericFlagSuffix(rows[0].feature_key, ACTIVE_PROFILE_FLAG_PREFIX) : null;
}

async function setActiveProfileIdInFlags(env: Env, userId: number, profileId: number): Promise<void> {
  await supabaseFetch(env, `user_feature_flags?user_id=eq.${userId}&feature_key=like.${ACTIVE_PROFILE_FLAG_PREFIX}*`, {
    method: "DELETE",
  });
  await supabaseFetch(env, "user_feature_flags", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: userId,
      feature_key: `${ACTIVE_PROFILE_FLAG_PREFIX}${profileId}`,
      enabled: true,
    }),
  });
}

async function getProfileOrderMapFromFlags(env: Env, userId: number): Promise<Map<number, number>> {
  const rows = await supabaseFetch<Array<{ feature_key: string }>>(
    env,
    `user_feature_flags?user_id=eq.${userId}&feature_key=like.${PROFILE_ORDER_FLAG_PREFIX}*&enabled=eq.true&select=feature_key`,
  );
  const orderMap = new Map<number, number>();
  rows.forEach((row) => {
    const parsed = parseProfileOrderFlag(row.feature_key);
    if (parsed) orderMap.set(parsed.profileId, parsed.order);
  });
  return orderMap;
}

function sortProfilesWithOrderMap(profiles: CareProfileRow[], orderMap: Map<number, number>): CareProfileRow[] {
  if (orderMap.size === 0) return profiles;
  return [...profiles].sort((a, b) => (
    Number(a.group_id || 0) - Number(b.group_id || 0)
    || (orderMap.get(a.id) ?? a.sort_order ?? 0) - (orderMap.get(b.id) ?? b.sort_order ?? 0)
    || Number(b.is_default === true) - Number(a.is_default === true)
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
  ));
}

export type CareProfileRow = {
  id: number;
  group_id: number | null;
  primary_user_id: number | null;
  display_name: string;
  relationship: string | null;
  avatar_url: string | null;
  birth_year: number | null;
  birth_date?: string | null;
  emergency_phone?: string | null;
  email?: string | null;
  gender?: string | null;
  main_hospital: string | null;
  main_department: string | null;
  notes: string | null;
  is_default: boolean;
  sort_order?: number | null;
  created_at: string;
};

// Phase 1 新增：care_documents（上傳文件主表）
export type CareDocumentRow = {
  id: number;
  group_id: number;
  profile_id: number | null;
  uploaded_by_user_id: number | null;
  document_type: string;
  // appointment_slip / prescription / lab_order / imaging_order / medication_bag / other
  source_file_url: string | null;
  ocr_text: string | null;
  ai_summary: Record<string, unknown> | null;
  status: string;
  // uploaded / processing / draft / confirmed / failed
  captured_at: string | null;
  created_at: string;
};

// Phase 1 新增：usage_quotas（以 group_id 為單位的額度）
export type UsageQuotaRow = {
  id: number;
  group_id: number;
  period: string;   // 'YYYY-MM'
  feature: string;  // 'ocr_upload'
  used_count: number;
  limit_count: number;
  plan_snapshot: string;
  updated_at: string;
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
    pictureUrl: typeof result.picture === "string" ? result.picture : undefined,
  };
}

export async function getOrCreateDefaultUser(
  env: Env,
  lineUserId?: string,
  profile: Pick<VerifiedLineIdentity, "name" | "pictureUrl"> = {},
): Promise<number> {
  const targetLineId = lineUserId || DEFAULT_USER.line_user_id;
  const targetName = profile.name || (lineUserId ? `LINE User (${lineUserId.slice(-4)})` : DEFAULT_USER.name);
  const targetPictureUrl = profile.pictureUrl || null;

  const existing = await supabaseFetch<Array<{ id: number; name: string | null; picture_url: string | null }>>(
    env,
    `users?line_user_id=eq.${encodeURIComponent(targetLineId)}&select=id,name,picture_url&limit=1`,
  );

  if (existing[0]?.id) {
    const updates: Record<string, string> = {};
    if (profile.name && existing[0].name !== profile.name) updates.name = profile.name;
    if (targetPictureUrl && existing[0].picture_url !== targetPictureUrl) updates.picture_url = targetPictureUrl;
    if (Object.keys(updates).length) {
      await supabaseFetch(env, `users?id=eq.${existing[0].id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
    }
    return existing[0].id;
  }

  const created = await supabaseFetch<Array<{ id: number }>>(env, "users?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      line_user_id: targetLineId,
      name: targetName,
      picture_url: targetPictureUrl,
    }),
  });

  if (!created || created.length === 0) throw new Error("無法建立使用者");
  return created[0].id;
}

export async function getUserActiveProfileId(env: Env, userId: number): Promise<number | null> {
  try {
    const rows = await supabaseFetch<Array<{ active_profile_id: number | null }>>(
      env,
      `users?id=eq.${userId}&select=active_profile_id&limit=1`,
    );
    return rows[0]?.active_profile_id || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/users\.active_profile_id|active_profile_id.*column|Could not find.*active_profile_id/i.test(message)) {
      throw error;
    }
    return getActiveProfileIdFromFlags(env, userId);
  }
}

export async function setUserActiveProfileId(env: Env, userId: number, profileId: number | null): Promise<boolean> {
  try {
    await supabaseFetch(env, `users?id=eq.${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ active_profile_id: profileId }),
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/users\.active_profile_id|active_profile_id.*column|Could not find.*active_profile_id/i.test(message)) {
      throw error;
    }
    if (profileId) {
      await setActiveProfileIdInFlags(env, userId, profileId);
      return true;
    }
    return false;
  }
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
  const path = `care_profiles?group_id=in.(${groupIds.join(",")})&select=*&order=group_id.asc,sort_order.asc,is_default.desc,created_at.asc`;
  try {
    const profiles = await supabaseFetch<CareProfileRow[]>(env, path);
    return sortProfilesWithOrderMap(profiles, await getProfileOrderMapFromFlags(env, userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/care_profiles\.sort_order|sort_order.*column|Could not find.*sort_order/i.test(message)) throw error;
    const profiles = await supabaseFetch<CareProfileRow[]>(
      env,
      `care_profiles?group_id=in.(${groupIds.join(",")})&select=*&order=group_id.asc,is_default.desc,created_at.asc`,
    );
    return sortProfilesWithOrderMap(profiles, await getProfileOrderMapFromFlags(env, userId));
  }
}

export async function setProfileOrderInFlags(
  env: Env,
  userId: number,
  groupId: number | null,
  profileIds: number[],
): Promise<void> {
  if (!groupId) return;
  await supabaseFetch(env, `user_feature_flags?user_id=eq.${userId}&feature_key=like.${PROFILE_ORDER_FLAG_PREFIX}${groupId}:*`, {
    method: "DELETE",
  });
  if (profileIds.length === 0) return;
  await supabaseFetch(env, "user_feature_flags", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(profileIds.map((profileId, index) => ({
      user_id: userId,
      feature_key: `${PROFILE_ORDER_FLAG_PREFIX}${groupId}:${(index + 1) * 10}:${profileId}`,
      enabled: true,
    }))),
  });
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
  displayName = "親愛的家人",
): Promise<CareProfileRow> {
  let existing: CareProfileRow[];
  try {
    existing = await supabaseFetch<CareProfileRow[]>(
      env,
      `care_profiles?group_id=eq.${groupId}&select=*&order=sort_order.asc,is_default.desc,created_at.asc&limit=1`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/care_profiles\.sort_order|sort_order.*column|Could not find.*sort_order/i.test(message)) throw error;
    existing = await supabaseFetch<CareProfileRow[]>(
      env,
      `care_profiles?group_id=eq.${groupId}&select=*&order=is_default.desc,created_at.asc&limit=1`,
    );
  }

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
    body: JSON.stringify({
      name,
      invite_code: inviteCode,
      owner_user_id: userId,
      plan_id: "pro",
    }),
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
  "status" | "type" | "date" | "time" | "title" | "hospital" | "department" |
  "doctor" | "number" | "location" | "fasting_required" | "fasting_hours" | "notes" | "reminder_text"
>>;

export type MedicationUpdateFields = Partial<Pick<MedicationRow,
  "active" | "name" | "dosage" | "frequency" | "time_slot" | "meal_timing" | "scheduled_time" | "taken_status" | "purpose" | "warnings" | "reminder_text"
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

  let rows: AppointmentRow[];
  try {
    rows = await supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?id=eq.${id}&select=*`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(updates),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!updates.title || !/appointments\.title|title.*column|Could not find.*title/i.test(message)) {
      throw error;
    }
    const { title, ...legacyUpdates } = updates;
    rows = await supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?id=eq.${id}&select=*`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...legacyUpdates,
          department: legacyUpdates.department || title,
        }),
      },
    );
  }
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
    group_id: row.group_id || null,
    profile_id: row.profile_id || null,
    type: row.type || "clinic_visit",
    date: row.date,
    time: row.time,
    title: row.title || null,
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
    group_id: row.group_id || null,
    profile_id: row.profile_id || null,
    name: row.name,
    dosage: row.dosage,
    frequency: row.frequency,
    time_slot: row.time_slot,
    meal_timing: row.meal_timing,
    scheduled_time: row.scheduled_time,
    taken_status: row.taken_status,
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
    birth_date: row.birth_date || null,
    emergency_phone: row.emergency_phone || null,
    email: row.email || null,
    main_hospital: row.main_hospital,
    main_department: row.main_department,
    notes: row.notes,
    is_default: row.is_default,
    sort_order: row.sort_order || 0,
  };
}

// ─── Plan / Quota ────────────────────────────────────────────────────────────

export const FREE_OCR_MONTHLY_LIMIT = 10;
export const MULTIPLE_FAMILY_GROUPS_FEATURE = "multiple_family_groups";

// Fallback plan definition — used when DB lookup fails or group has no plan_id.
const FREE_PLAN_FALLBACK: PlanRow = {
  id: "free",
  name: "Free",
  monthly_ocr_limit: 10,
  max_members: 1,
  max_recipients: 1,
  family_group_enabled: false,
  price_monthly_usd: 0,
  is_active: true,
  sort_order: 10,
};

/**
 * Fetch the plan for a group.
 * Reads family_groups.plan_id → joins plans table.
 * Falls back to the free plan if the group or plan row is not found.
 */
export async function getGroupPlan(env: Env, groupId: number | null): Promise<PlanRow> {
  if (!groupId) return FREE_PLAN_FALLBACK;

  const groups = await supabaseFetch<Array<{ plan_id: string | null }>>(
    env,
    `family_groups?id=eq.${groupId}&select=plan_id&limit=1`,
  );
  const planId = groups[0]?.plan_id || "free";

  const plans = await supabaseFetch<PlanRow[]>(
    env,
    `plans?id=eq.${encodeURIComponent(planId)}&select=*&limit=1`,
  );
  return plans[0] ?? FREE_PLAN_FALLBACK;
}

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

// ─── Group-based quota (Phase 2) ─────────────────────────────────────────────
// Replaces per-user appointment/medication count with a dedicated usage_quotas row.
// One OCR job = 1 deduction, regardless of how many records it creates.

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

export async function getGroupOcrUsage(env: Env, groupId: number | null): Promise<number> {
  if (!groupId) return 0;
  const rows = await supabaseFetch<Array<{ used_count: number }>>(
    env,
    `usage_quotas?group_id=eq.${groupId}&period=eq.${currentPeriod()}&feature=eq.ocr_upload&select=used_count&limit=1`,
  );
  return rows[0]?.used_count ?? 0;
}

/**
 * Check whether the group has remaining OCR quota this month.
 * Reads the group's plan to determine the limit.
 * Throws with a user-facing message if the quota is exhausted.
 * Returns the PlanRow so callers can pass it to incrementGroupOcrQuota.
 */
export async function checkGroupOcrQuota(env: Env, groupId: number | null): Promise<PlanRow> {
  if (!groupId) return FREE_PLAN_FALLBACK;

  const plan = await getGroupPlan(env, groupId);
  const used = await getGroupOcrUsage(env, groupId);

  if (used >= plan.monthly_ocr_limit) {
    throw new Error(
      `本月 AI 文件整理次數已用完（${plan.monthly_ocr_limit} 次）。` +
      (plan.id === "free" ? "升級家庭方案可獲得更多次數。" : ""),
    );
  }
  return plan;
}

/**
 * Increment the group's OCR usage counter by 1.
 * Pass the PlanRow returned from checkGroupOcrQuota to avoid an extra DB fetch.
 */
export async function incrementGroupOcrQuota(
  env: Env,
  groupId: number | null,
  plan: PlanRow = FREE_PLAN_FALLBACK,
): Promise<void> {
  if (!groupId) return;
  const period = currentPeriod();
  const now = new Date().toISOString();

  // Read current row first, then write — PostgREST doesn't support column += 1
  const rows = await supabaseFetch<Array<{ id: number; used_count: number }>>(
    env,
    `usage_quotas?group_id=eq.${groupId}&period=eq.${period}&feature=eq.ocr_upload&select=id,used_count&limit=1`,
  );

  if (rows.length === 0) {
    await supabaseFetch(env, "usage_quotas", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        group_id: groupId,
        period,
        feature: "ocr_upload",
        used_count: 1,
        limit_count: plan.monthly_ocr_limit,
        plan_snapshot: plan.id,
        updated_at: now,
      }),
    });
  } else {
    await supabaseFetch(env, `usage_quotas?id=eq.${rows[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ used_count: rows[0].used_count + 1, updated_at: now }),
    });
  }
}

// ─── Plan feature-limit checks ────────────────────────────────────────────────

type LimitCheckResult = {
  ok: boolean;
  error?: string;
  message?: string;
  plan?: PlanRow;
};

export async function hasUserFeatureFlag(
  env: Env,
  userId: number,
  featureKey: string,
): Promise<boolean> {
  const rows = await supabaseFetch<Array<{ enabled: boolean }>>(
    env,
    `user_feature_flags?user_id=eq.${userId}&feature_key=eq.${encodeURIComponent(featureKey)}&select=enabled&limit=1`,
  );
  return rows[0]?.enabled === true;
}

export async function canCreateFamilyGroup(
  env: Env,
  userId: number,
): Promise<LimitCheckResult> {
  const [memberships, ownedGroups] = await Promise.all([
    supabaseFetch<Array<{ group_id: number }>>(
      env,
      `user_family_groups?user_id=eq.${userId}&select=group_id`,
    ),
    supabaseFetch<Array<{ id: number }>>(
      env,
      `family_groups?owner_user_id=eq.${userId}&select=id`,
    ),
  ]);

  const groupIds = new Set<number>([
    ...memberships.map((membership) => membership.group_id),
    ...ownedGroups.map((group) => group.id),
  ]);

  if (groupIds.size === 0) return { ok: true };

  const canCreateMultiple = await hasUserFeatureFlag(env, userId, MULTIPLE_FAMILY_GROUPS_FEATURE);
  if (canCreateMultiple) return { ok: true };

  return {
    ok: false,
    error: "GROUP_LIMIT_REACHED",
    message: "目前每個帳號可建立 1 個照護空間。你可以在同一個照護空間中管理多位照護對象。",
  };
}

/**
 * Check whether a new member can join the group.
 * Only used for invite/join flows — NOT called when the owner auto-joins on creation.
 */
export async function checkGroupMemberLimit(
  env: Env,
  groupId: number,
): Promise<LimitCheckResult> {
  const plan = await getGroupPlan(env, groupId);

  if (!plan.family_group_enabled) {
    return {
      ok: false,
      error: "FAMILY_GROUP_REQUIRES_PAID_PLAN",
      message:
        "家庭共享是付費版功能。升級 Family Basic 後，即可邀請家人共同管理照護資訊。",
      plan,
    };
  }

  const members = await supabaseFetch<Array<{ user_id: number }>>(
    env,
    `user_family_groups?group_id=eq.${groupId}&select=user_id`,
  );

  if (members.length >= plan.max_members) {
    return {
      ok: false,
      error: "MEMBER_LIMIT_REACHED",
      message: `目前方案最多可加入 ${plan.max_members} 位成員。`,
      plan,
    };
  }

  return { ok: true, plan };
}

/**
 * Check whether a new care recipient (profile) can be added to the group.
 */
export async function checkGroupRecipientLimit(
  env: Env,
  groupId: number,
): Promise<LimitCheckResult> {
  const plan = await getGroupPlan(env, groupId);

  const profiles = await supabaseFetch<Array<{ id: number }>>(
    env,
    `care_profiles?group_id=eq.${groupId}&select=id`,
  );

  if (profiles.length >= plan.max_recipients) {
    return {
      ok: false,
      error: "RECIPIENT_LIMIT_REACHED",
      message: `目前方案最多可建立 ${plan.max_recipients} 位照護對象。`,
      plan,
    };
  }

  return { ok: true, plan };
}
