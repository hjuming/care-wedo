import {
  AppointmentRow,
  CareDocumentRow,
  CareProfileRow,
  MedicationRow,
  getAccessibleProfiles,
  getBearerToken,
  getUserActiveProfileId,
  getUserGroups,
  UserFamilyGroupRow,
  serializeCareProfile,
  serializeAppointment,
  serializeCareDocument,
  serializeMedication,
  supabaseFetch,
  VerifiedCareIdentity,
} from "../_shared/supabase";
import {
  FREE_OCR_MONTHLY_LIMIT,
  MULTIPLE_FAMILY_GROUPS_FEATURE,
  PlanRow,
  getGroupOcrUsage,
  getGroupPlan,
  hasUserFeatureFlag,
  CARE_WEDO_PRICING,
} from "../_shared/billing";
import { getRequestUser } from "../_shared/auth_context";
import { canManageMembership } from "../_shared/group_permissions";
import { buildActivityAudit } from "../_shared/activity_audit";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINE_LOGIN_CHANNEL_ID?: string;
};

const FREE_HISTORY_RETENTION_DAYS = 30;
const PAYMENT_PROVIDER_PRIORITY = ["ECPay", "NewebPay", "LINE Pay", "Stripe"];

function canPlanViewHistory(plan: PlanRow, hasUnlimitedAccess = false) {
  return hasUnlimitedAccess || plan.id !== "free";
}

function effectiveMonthlyOcrLimit(plan: PlanRow, recipientCount = 1) {
  if (plan.id === "free") return plan.monthly_ocr_limit;
  return plan.monthly_ocr_limit * Math.max(recipientCount, 1);
}

function buildPlanPermissions(plan: PlanRow, hasUnlimitedAccess = false) {
  return {
    can_view_history: canPlanViewHistory(plan, hasUnlimitedAccess),
    free_history_retention_days: FREE_HISTORY_RETENTION_DAYS,
    ocr_limit_per_recipient: plan.monthly_ocr_limit,
    payment_provider_priority: PAYMENT_PROVIDER_PRIORITY,
  };
}

function buildPlanUsage(plan: PlanRow, ocrUsed: number, recipientCount = 1, hasUnlimitedAccess = false) {
  const monthlyLimit = effectiveMonthlyOcrLimit(plan, recipientCount);
  const remaining = Math.max(monthlyLimit - ocrUsed, 0);
  return {
    plan: {
      id: plan.id,
      name: plan.name,
      monthly_ocr_limit: plan.monthly_ocr_limit,
      monthly_ocr_limit_per_recipient: plan.monthly_ocr_limit,
      effective_monthly_ocr_limit: monthlyLimit,
      max_members: plan.max_members,
      max_recipients: plan.max_recipients,
      family_group_enabled: plan.family_group_enabled,
      price_monthly_usd: plan.price_monthly_usd,
    },
    plan_permissions: buildPlanPermissions(plan, hasUnlimitedAccess),
    usage: {
      ocr_upload: { used_count: ocrUsed, limit_count: monthlyLimit, remaining_count: remaining },
    },
    pricing: CARE_WEDO_PRICING,
    // backward-compat aliases
    ocr_used: ocrUsed,
    ocr_limit: monthlyLimit,
  };
}

function buildPermissionVersion(plan: PlanRow, hasUnlimitedAccess = false) {
  if (hasUnlimitedAccess) {
    return {
      id: plan.id,
      label: plan.name,
      description: `成員 ${plan.max_members} 位・照護對象 ${plan.max_recipients} 位`,
      capabilities: buildPlanPermissions(plan, hasUnlimitedAccess),
    };
  }

  return {
    id: plan.id,
    label: plan.name,
    description: `成員 ${plan.max_members} 位・照護對象 ${plan.max_recipients} 位`,
    capabilities: buildPlanPermissions(plan, hasUnlimitedAccess),
  };
}

const FREE_PLAN_DEMO: PlanRow = {
  id: "free", name: "Free", monthly_ocr_limit: FREE_OCR_MONTHLY_LIMIT,
  max_members: 1, max_recipients: 1, family_group_enabled: false,
  price_monthly_usd: 0, is_active: true, sort_order: 10,
};

// Static demo payload — no DB queries involved.
// Shown when the request has no valid JWT.
const STATIC_DEMO_DASHBOARD = {
  patient: { name: "示範長輩", age: "", dept: "醫療照護", diagnoses: [] },
  mode: "demo" as const,
  ...buildPlanUsage(FREE_PLAN_DEMO, 0),
  active_profile_id: null,
  care_profiles: [],
  appointments: [
    {
      id: 0,
      profile_id: null,
      type: "clinic_visit",
      date: "2026-05-14",
      time: "11:00",
      hospital: "示範醫院",
      department: "家醫科",
      doctor: "示範醫師",
      number: null,
      location: "門診一樓",
      fasting_required: false,
      fasting_hours: null,
      notes: null,
      reminder_text: "帶健保卡、藥袋",
      status: "upcoming",
    },
  ],
  documents: [],
  medications: [
    {
      id: 0,
      profile_id: null,
      name: "示範藥物（慢性病用藥）",
      dosage: "0.5 顆",
      frequency: "每日一次",
      purpose: "心血管保護",
      warnings: null,
      reminder_text: "早餐後服用",
      active: true,
    },
  ],
  checklist: ["2026-05-14 家醫科：示範回診"],
  groups: [],
  active_group_id: null,
  active_group_name: null,
  family_notes: [],
  line_push_audit: [],
  activity_audit: [],
  needs_setup: false,
  needs_profile_setup: false,
};

type DashboardMembership = {
  user_id: number;
  group_id: number;
  role: string;
  can_manage: boolean;
  can_pay: boolean;
};

function buildActiveMembership(
  memberships: UserFamilyGroupRow[],
  userId: number,
  groupId: number | null,
): DashboardMembership | null {
  if (!groupId) return null;
  const membership = memberships.find((row) => row.group_id === groupId);
  if (!membership) return null;
  return {
    user_id: userId,
    group_id: groupId,
    role: membership.role || "member",
    can_manage: membership.can_manage === true,
    can_pay: membership.can_pay === true,
  };
}

function buildDashboardCapabilities(membership: DashboardMembership | null) {
  const canManageCare = membership
    ? canManageMembership(membership)
    : false;
  return {
    can_manage_care: canManageCare,
    can_complete_medication: canManageCare,
  };
}

function parseProfileId(request: Request): number | null {
  const value = new URL(request.url).searchParams.get("profile_id");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseGroupId(request: Request): number | null {
  const value = new URL(request.url).searchParams.get("group_id");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function identityDisplayName(identity: VerifiedCareIdentity | null): string {
  if (!identity) return "我";
  return identity.name || (identity.provider === "supabase" ? identity.email : "") || "我";
}

// requestedProfileId must belong to the accessible profiles list.
function chooseProfile(
  profiles: CareProfileRow[],
  requestedProfileId: number | null,
  requestedGroupId: number | null,
  preferredProfileId: number | null,
): CareProfileRow | null {
  if (requestedProfileId) {
    const found = profiles.find((p) => p.id === requestedProfileId);
    if (found) return found;
  }
  if (requestedGroupId) {
    return profiles.find((p) => p.group_id === requestedGroupId) || null;
  }
  if (preferredProfileId) {
    const found = profiles.find((p) => p.id === preferredProfileId);
    if (found) return found;
  }
  return profiles[0] || null;
}

type DashboardMemberRow = {
  user_id: number;
  role: string | null;
  can_manage: boolean | null;
  receive_daily_brief: boolean | null;
  receive_evening_alert: boolean | null;
  receive_upload_summary: boolean | null;
  users: { name: string | null; line_user_id: string | null; picture_url: string | null } | null;
};

type LinePushAuditRow = {
  id: number;
  event_type: string;
  target_date: string | null;
  item_count: number | null;
  status: string;
  http_status: number | null;
  line_user_suffix: string | null;
  created_at: string;
};

async function fetchDashboardMembers(env: Env, groupId: number | null, currentUserId: number) {
  if (!groupId) return [];

  const rows = await supabaseFetch<DashboardMemberRow[]>(
    env,
    `user_family_groups?group_id=eq.${groupId}&select=user_id,role,can_manage,receive_daily_brief,receive_evening_alert,receive_upload_summary,users(name,line_user_id,picture_url)`,
  );

  return rows
    .filter((row) => row.user_id !== currentUserId)
    .map((row) => ({
      id: row.user_id,
      user_id: row.user_id,
      display_name: row.users?.name || "家人",
      avatar_url: row.users?.picture_url || "",
      role: row.role || "member",
      can_manage: row.can_manage === true,
      can_contact: Boolean(row.users?.line_user_id),
      receive_daily_brief: row.receive_daily_brief !== false,
      receive_evening_alert: row.receive_evening_alert !== false,
      receive_upload_summary: row.receive_upload_summary !== false,
    }));
}

async function fetchLinePushAuditLogs(env: Env, groupId: number | null): Promise<LinePushAuditRow[]> {
  if (!groupId) return [];
  try {
    return await supabaseFetch<LinePushAuditRow[]>(
      env,
      `line_push_logs?group_id=eq.${groupId}&select=id,event_type,target_date,item_count,status,http_status,line_user_suffix,created_at&order=created_at.desc&limit=8`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/line_push_logs|PGRST205|Could not find the table/i.test(message)) {
      console.warn(JSON.stringify({
        event: "dashboard.line_push_logs_missing",
        message: "line_push_logs table is not available; continuing without reminder audit summaries.",
      }));
      return [];
    }
    throw error;
  }
}

function filterAppointmentsByHistoryAccess(appointments: AppointmentRow[], canViewHistory: boolean): AppointmentRow[] {
  if (canViewHistory) return appointments;
  const today = todayInTaipei();
  return appointments.filter((appointment) => {
    if (appointment.type === "family_note") return true;
    return appointment.status !== "completed" && (!appointment.date || appointment.date >= today);
  });
}

async function fetchAppointments(
  env: Env,
  groupId: number | null,
  profileId: number | null,
  options: { canViewHistory?: boolean } = {},
): Promise<AppointmentRow[]> {
  if (!groupId) return [];
  const canViewHistory = options.canViewHistory !== false;
  if (!profileId) {
    const appointments = await supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?group_id=eq.${groupId}&status=neq.deleted&select=*&order=date.asc.nullslast,created_at.desc`,
    );
    return filterAppointmentsByHistoryAccess(appointments, canViewHistory);
  }

  const [profileAppointments, groupFamilyNotes] = await Promise.all([
    supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?group_id=eq.${groupId}&profile_id=eq.${profileId}&status=neq.deleted&select=*&order=date.asc.nullslast,created_at.desc`,
    ),
    supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?group_id=eq.${groupId}&profile_id=is.null&type=eq.family_note&status=neq.deleted&select=*&order=created_at.desc`,
    ),
  ]);

  return filterAppointmentsByHistoryAccess([...profileAppointments, ...groupFamilyNotes], canViewHistory).sort((a, b) => {
    const aDate = a.date || "9999-12-31";
    const bDate = b.date || "9999-12-31";
    const byDate = aDate.localeCompare(bDate);
    if (byDate !== 0) return byDate;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}

async function fetchMedications(env: Env, groupId: number | null, profileId: number | null): Promise<MedicationRow[]> {
  if (!profileId && !groupId) return [];
  const path = profileId && groupId
    ? `medications?group_id=eq.${groupId}&profile_id=eq.${profileId}&active=eq.true&select=*&order=created_at.desc`
    : profileId
      ? `medications?profile_id=eq.${profileId}&active=eq.true&select=*&order=created_at.desc`
      : `medications?group_id=eq.${groupId}&active=eq.true&select=*&order=created_at.desc`;
  return supabaseFetch<MedicationRow[]>(env, path);
}

function filterDocumentsByHistoryAccess(documents: CareDocumentRow[], canViewHistory: boolean): CareDocumentRow[] {
  if (canViewHistory) return documents;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FREE_HISTORY_RETENTION_DAYS);
  return documents.filter((document) => {
    const createdAt = document.created_at ? new Date(document.created_at) : null;
    return createdAt && !Number.isNaN(createdAt.getTime()) && createdAt >= cutoff;
  });
}

async function fetchDocuments(
  env: Env,
  groupId: number | null,
  profileId: number | null,
  options: { canViewHistory?: boolean } = {},
): Promise<CareDocumentRow[]> {
  if (!groupId) return [];
  const canViewHistory = options.canViewHistory !== false;
  const path = profileId
    ? `care_documents?group_id=eq.${groupId}&profile_id=eq.${profileId}&status=neq.deleted&deleted_at=is.null&select=*&order=document_date.desc.nullslast,captured_at.desc.nullslast,created_at.desc&limit=50`
    : `care_documents?group_id=eq.${groupId}&status=neq.deleted&deleted_at=is.null&select=*&order=document_date.desc.nullslast,captured_at.desc.nullslast,created_at.desc&limit=50`;
  try {
    const documents = await supabaseFetch<CareDocumentRow[]>(env, path);
    return filterDocumentsByHistoryAccess(documents, canViewHistory);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/care_documents\.deleted_at|deleted_at.*column|Could not find.*deleted_at/i.test(message)) throw error;
    const fallbackPath = profileId
      ? `care_documents?group_id=eq.${groupId}&profile_id=eq.${profileId}&status=neq.deleted&select=*&order=captured_at.desc.nullslast,created_at.desc&limit=50`
      : `care_documents?group_id=eq.${groupId}&status=neq.deleted&select=*&order=captured_at.desc.nullslast,created_at.desc&limit=50`;
    const documents = await supabaseFetch<CareDocumentRow[]>(env, fallbackPath);
    return filterDocumentsByHistoryAccess(documents, canViewHistory);
  }
}

function todayInTaipei() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

type MedicationLogRow = {
  id?: number;
  medication_id: number;
  medication_name?: string | null;
  status: string | null;
  taken_date: string | null;
  time_slot: string | null;
  confirmed_by_user_id?: number | null;
  created_at?: string | null;
};

async function fetchTodayMedicationLogs(env: Env, medications: MedicationRow[]): Promise<Map<number, MedicationLogRow[]>> {
  const medicationIds = medications.map((medication) => medication.id).filter(Boolean);
  if (medicationIds.length === 0) return new Map();
  const groupIds = Array.from(new Set(medications.map((medication) => medication.group_id).filter(Boolean)));
  const groupFilter = groupIds.length ? `&group_id=in.(${groupIds.join(",")})` : "";

  let rows: MedicationLogRow[] = [];
  try {
    rows = await supabaseFetch<MedicationLogRow[]>(
      env,
      `medication_logs?medication_id=in.(${medicationIds.join(",")})${groupFilter}&taken_date=eq.${todayInTaipei()}&select=medication_id,status,taken_date,time_slot,confirmed_by_user_id,created_at&order=created_at.desc`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/medication_logs|PGRST205|Could not find the table/i.test(message)) {
      console.warn(JSON.stringify({
        event: "dashboard.medication_logs_missing",
        message: "medication_logs table is not available; continuing without daily medication status.",
      }));
      return new Map();
    }
    throw error;
  }

  return rows.reduce((map, row) => {
    const current = map.get(row.medication_id) || [];
    current.push(row);
    map.set(row.medication_id, current);
    return map;
  }, new Map<number, MedicationLogRow[]>());
}

async function fetchMedicationAuditLogs(env: Env, medications: MedicationRow[]): Promise<MedicationLogRow[]> {
  const medicationIds = medications.map((medication) => medication.id).filter(Boolean);
  if (medicationIds.length === 0) return [];
  const groupIds = Array.from(new Set(medications.map((medication) => medication.group_id).filter(Boolean)));
  const groupFilter = groupIds.length ? `&group_id=in.(${groupIds.join(",")})` : "";
  try {
    return await supabaseFetch<MedicationLogRow[]>(
      env,
      `medication_logs?medication_id=in.(${medicationIds.join(",")})${groupFilter}&select=id,medication_id,status,taken_date,time_slot,confirmed_by_user_id,created_at&order=created_at.desc&limit=24`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/medication_logs|PGRST205|Could not find the table/i.test(message)) return [];
    throw error;
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  try {
    // ── Unauthenticated: return static demo, zero DB queries ──────────────────
    const token = getBearerToken(request);
    if (!token) {
      return Response.json(STATIC_DEMO_DASHBOARD);
    }

    // ── Authenticated path ────────────────────────────────────────────────────
    const { userId, identity } = await getRequestUser(context);
    const userDisplayName = identityDisplayName(identity);
    const requestedProfileId = parseProfileId(request);
    const requestedGroupId = parseGroupId(request);

    // Step 1: Resolve groups
    const memberships = await supabaseFetch<UserFamilyGroupRow[]>(
      env,
      `user_family_groups?user_id=eq.${userId}&select=group_id,role,can_manage,can_pay`,
    );

    if (memberships.length === 0) {
      // User has no family group yet → prompt setup
      return Response.json({
        ...STATIC_DEMO_DASHBOARD,
        mode: "personal",
        ...buildPlanUsage(FREE_PLAN_DEMO, 0),
        patient: { name: userDisplayName, age: "", dept: "", diagnoses: [] },
        appointments: [],
        documents: [],
        medications: [],
        checklist: [],
        groups: [],
        active_group_id: null,
        active_group_name: null,
        active_membership: null,
        capabilities: buildDashboardCapabilities(null),
        family_notes: [],
        line_push_audit: [],
        activity_audit: [],
        care_profiles: [],
        active_profile_id: null,
        permission_version: buildPermissionVersion(FREE_PLAN_DEMO, false),
        needs_setup: true,
        needs_profile_setup: false,
      });
    }

    // Step 2: Resolve profiles
    const groups = await getUserGroups(env, userId);
    const fallbackGroupId = memberships[0]?.group_id ?? null;
    const requestedGroupIsValid = groups.some((group) => group.id === requestedGroupId);
    const activeRequestedGroupId = requestedGroupIsValid ? requestedGroupId : fallbackGroupId;
    const profiles = await getAccessibleProfiles(env, userId);
    const preferredProfileId = await getUserActiveProfileId(env, userId);
    const selectedProfile = chooseProfile(
      profiles,
      requestedProfileId,
      requestedProfileId ? null : requestedGroupIsValid ? requestedGroupId : null,
      preferredProfileId,
    );

    if (!selectedProfile) {
      // User has a group but no care recipient yet — still read group plan for accurate limits
      const groupId = activeRequestedGroupId;
      const activeGroup = groups.find((group) => group.id === groupId) || null;
      const [groupPlan, ocrUsed, hasUnlimitedAccess] = await Promise.all([
        getGroupPlan(env, groupId),
        getGroupOcrUsage(env, groupId),
        hasUserFeatureFlag(env, userId, MULTIPLE_FAMILY_GROUPS_FEATURE),
      ]);
      const recipientCount = profiles.filter((profile) => profile.group_id === groupId).length || 1;
      const activeMembership = buildActiveMembership(memberships, userId, groupId);
      return Response.json({
        ...STATIC_DEMO_DASHBOARD,
        mode: "personal",
        ...buildPlanUsage(groupPlan, ocrUsed, recipientCount, hasUnlimitedAccess),
        patient: { name: userDisplayName, age: "", dept: "", diagnoses: [] },
        appointments: [],
        documents: [],
        medications: [],
        checklist: [],
        groups,
        active_group_id: groupId,
        active_group_name: activeGroup?.name || "家庭群組",
        active_membership: activeMembership,
        capabilities: buildDashboardCapabilities(activeMembership),
        family_notes: [],
        line_push_audit: await fetchLinePushAuditLogs(env, groupId),
        activity_audit: [],
        care_profiles: profiles.map(serializeCareProfile),
        active_profile_id: null,
        permission_version: buildPermissionVersion(groupPlan, hasUnlimitedAccess),
        needs_setup: false,
        needs_profile_setup: true,
      });
    }

    const activeGroupId = selectedProfile.group_id;
    const activeProfileId = selectedProfile.id;
    const activeGroup = groups.find((group) => group.id === activeGroupId) || null;
    const activeMembership = buildActiveMembership(memberships, userId, activeGroupId);
    const activeGroupProfileCount = profiles.filter((profile) => profile.group_id === activeGroupId).length || 1;

    // Step 3: Fetch group plan first so free accounts never receive hidden history in the client payload.
    const [groupPlan, ocrUsed, hasUnlimitedAccess] = await Promise.all([
      getGroupPlan(env, activeGroupId),
      getGroupOcrUsage(env, activeGroupId),
      hasUserFeatureFlag(env, userId, MULTIPLE_FAMILY_GROUPS_FEATURE),
    ]);
    const canViewHistory = canPlanViewHistory(groupPlan, hasUnlimitedAccess);

    // Step 4: Fetch care data scoped to group + profile
    const [appointments, medications, documents, members, linePushAuditLogs] = await Promise.all([
      fetchAppointments(env, activeGroupId, activeProfileId, { canViewHistory }),
      fetchMedications(env, activeGroupId, activeProfileId),
      fetchDocuments(env, activeGroupId, activeProfileId, { canViewHistory }),
      fetchDashboardMembers(env, activeGroupId, userId),
      fetchLinePushAuditLogs(env, activeGroupId),
    ]);
    const [todayMedicationLogs, medicationAuditLogs] = await Promise.all([
      fetchTodayMedicationLogs(env, medications),
      fetchMedicationAuditLogs(env, medications),
    ]);
    const userNames = new Map<number, string>([[userId, userDisplayName]]);
    members.forEach((member) => {
      if (member.id && member.display_name) userNames.set(member.id, member.display_name);
    });
    const medicationNames = new Map(medications.map((medication) => [medication.id, medication.name || "用藥"]));
    const activityAudit = buildActivityAudit({
      appointments,
      medicationLogs: medicationAuditLogs.map((log) => ({
        ...log,
        medication_name: medicationNames.get(log.medication_id) || "用藥",
      })),
      userNames,
    });
    const familyNotes = appointments
      .filter((appointment) => appointment.type === "family_note" && !appointment.profile_id)
      .map((appointment) => appointment.reminder_text || appointment.notes || appointment.department || "")
      .filter(Boolean);

    const checklist = appointments.slice(0, 3).map((apt) => {
      const label = `${apt.date || ""} ${apt.title || apt.department || apt.hospital || "回診"}`.trim();
      if (apt.fasting_required) return `${label}：需空腹 ${apt.fasting_hours || 8} 小時`;
      return label;
    });

    return Response.json({
      patient: {
        name: selectedProfile.display_name || userDisplayName || "家人",
        age: "",
        dept: selectedProfile.main_department || appointments[0]?.department || "醫療照護",
        diagnoses: [],
      },
      mode: "personal",
      ...buildPlanUsage(groupPlan, ocrUsed, activeGroupProfileCount, hasUnlimitedAccess),
      groups,
      active_group_id: activeGroupId,
      active_group_name: activeGroup?.name || "家庭群組",
      active_membership: activeMembership,
      capabilities: buildDashboardCapabilities(activeMembership),
      family_notes: familyNotes,
      line_push_audit: linePushAuditLogs,
      activity_audit: activityAudit,
      active_profile_id: activeProfileId,
      permission_version: buildPermissionVersion(groupPlan, hasUnlimitedAccess),
      care_profiles: profiles.map(serializeCareProfile),
      appointments: appointments.map(serializeAppointment),
      documents: documents.map(serializeCareDocument),
      medications: medications.map((medication) => {
        const logs = todayMedicationLogs.get(medication.id) || [];
        const takenLog = logs.find((log) => log.status === "taken");
        return {
          ...serializeMedication(medication),
          taken_status: takenLog?.status || "",
          taken_date: takenLog?.taken_date || null,
          taken_at: takenLog?.created_at || null,
          taken_by_user_id: takenLog?.confirmed_by_user_id || null,
          taken_by_name: takenLog?.confirmed_by_user_id ? userNames.get(takenLog.confirmed_by_user_id) || "家庭協作者" : null,
          taken_slots: logs.filter((log) => log.status === "taken").map((log) => log.time_slot).filter(Boolean),
        };
      }),
      members,
      collaborators: members,
      checklist,
      needs_setup: false,
      needs_profile_setup: false,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Dashboard API failed" },
      { status: 500 },
    );
  }
};
