import type { Env, VerifiedCareIdentity, VerifiedLineIdentity } from "./auth_identity";
import {
  getBearerToken,
  verifyCareIdentity,
} from "./auth_identity";

export type {
  Env,
  VerifiedCareIdentity,
  VerifiedLineIdentity,
  VerifiedSupabaseIdentity,
} from "./auth_identity";

export {
  CARE_WEDO_SESSION_COOKIE,
  CARE_WEDO_SESSION_MAX_AGE_SECONDS,
  buildCareWedoSessionCookie,
  buildExpiredCareWedoSessionCookie,
  createCareWedoHandoffToken,
  createCareWedoSessionToken,
  getAuthorizationBearerToken,
  getBearerToken,
  getCookieValue,
  verifyCareIdentity,
  verifyCareWedoHandoffToken,
  verifyCareWedoSessionToken,
  verifyLineIdToken,
  verifySupabaseAccessToken,
} from "./auth_identity";

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
  // medical_record / medication_record / lab_report / imaging_report / prescription / appointment_slip / other
  source_file_url: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  original_file_name?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  page_count?: number | null;
  document_title?: string | null;
  source_hospital?: string | null;
  document_date?: string | null;
  summary_status?: string | null;
  preserve_original_file?: boolean | null;
  ocr_text: string | null;
  ai_summary: Record<string, unknown> | null;
  status: string;
  // uploaded / processing / pending_review / confirmed / failed / deleted
  captured_at: string | null;
  deleted_at?: string | null;
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

export async function getOrCreateUserFromIdentity(env: Env, identity: VerifiedCareIdentity): Promise<number> {
  if (identity.provider === "line") {
    return getOrCreateDefaultUser(env, identity.lineUserId, identity);
  }

  const existing = await supabaseFetch<Array<{
    id: number;
    auth_provider: string | null;
    email: string | null;
    name: string | null;
    picture_url: string | null;
  }>>(
    env,
    `users?auth_user_id=eq.${encodeURIComponent(identity.authUserId)}&select=id,auth_provider,email,name,picture_url&limit=1`,
  );

  if (existing[0]?.id) {
    const updates: Record<string, string> = {};
    if (identity.authProvider && existing[0].auth_provider !== identity.authProvider) updates.auth_provider = identity.authProvider;
    if (identity.email && existing[0].email !== identity.email) updates.email = identity.email;
    if (identity.name && existing[0].name !== identity.name) updates.name = identity.name;
    if (identity.pictureUrl && existing[0].picture_url !== identity.pictureUrl) updates.picture_url = identity.pictureUrl;
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
      auth_user_id: identity.authUserId,
      auth_provider: identity.authProvider,
      email: identity.email || null,
      name: identity.name || identity.email || "Google 帳號",
      picture_url: identity.pictureUrl || null,
      plan: "free",
    }),
  });

  if (!created || created.length === 0) throw new Error("無法建立使用者");
  return created[0].id;
}

export async function getAuthenticatedUser(env: Env, request: Request): Promise<{ userId: number; identity: VerifiedCareIdentity }> {
  const token = getBearerToken(request);
  if (!token) throw new Error("請先登入");
  const identity = await verifyCareIdentity(env, token);
  const userId = await getOrCreateUserFromIdentity(env, identity);
  return { userId, identity };
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
    avatarUrl?: string | null;
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
      avatar_url: input.avatarUrl || null,
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
  displayName?: string,
  avatarUrl?: string | null,
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

  let resolvedDisplayName = displayName?.trim() || "";
  let resolvedAvatarUrl = avatarUrl || null;
  if (!resolvedDisplayName || !resolvedAvatarUrl) {
    const users = await supabaseFetch<Array<{ name: string | null; picture_url: string | null }>>(
      env,
      `users?id=eq.${userId}&select=name,picture_url&limit=1`,
    );
    const user = users[0];
    if (!resolvedDisplayName) resolvedDisplayName = user?.name?.trim() || "";
    if (!resolvedAvatarUrl) resolvedAvatarUrl = user?.picture_url || null;
  }

  return createCareProfile(env, {
    groupId,
    primaryUserId: userId,
    displayName: resolvedDisplayName || "照護對象",
    avatarUrl: resolvedAvatarUrl,
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

export async function createGroup(
  env: Env,
  userId: number,
  name: string,
  defaultProfile: { displayName?: string; avatarUrl?: string | null } = {},
): Promise<GroupRow> {
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

  await ensureGroupDefaultProfile(env, group.id, userId, defaultProfile.displayName, defaultProfile.avatarUrl);

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
  _userId: number,
  groupIds: number[],
  updates: AppointmentUpdateFields,
): Promise<AppointmentRow> {
  if (groupIds.length === 0) throw new Error("找不到該預約或您沒有修改權限");
  const owned = await supabaseFetch<AppointmentRow[]>(
    env,
    `appointments?id=eq.${id}&group_id=in.(${groupIds.join(",")})&select=id&limit=1`,
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
  _userId: number,
  groupIds: number[],
  updates: MedicationUpdateFields,
): Promise<MedicationRow> {
  if (groupIds.length === 0) throw new Error("找不到該藥物或您沒有修改權限");
  const owned = await supabaseFetch<MedicationRow[]>(
    env,
    `medications?id=eq.${id}&group_id=in.(${groupIds.join(",")})&select=id&limit=1`,
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

export function serializeCareDocument(row: CareDocumentRow) {
  return {
    id: row.id,
    group_id: row.group_id,
    profile_id: row.profile_id || null,
    uploaded_by_user_id: row.uploaded_by_user_id || null,
    document_type: row.document_type || "other",
    document_title: row.document_title || null,
    source_hospital: row.source_hospital || null,
    document_date: row.document_date || null,
    original_file_name: row.original_file_name || null,
    mime_type: row.mime_type || null,
    file_size_bytes: row.file_size_bytes || null,
    page_count: row.page_count || null,
    summary_status: row.summary_status || row.status || "pending",
    preserve_original_file: row.preserve_original_file !== false,
    has_original_file: Boolean(row.preserve_original_file !== false && row.storage_path),
    ai_summary: row.ai_summary || null,
    status: row.status || "uploaded",
    captured_at: row.captured_at || null,
    created_at: row.created_at,
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
