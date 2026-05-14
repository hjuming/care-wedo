import {
  AppointmentRow,
  CareProfileRow,
  FREE_OCR_MONTHLY_LIMIT,
  MedicationRow,
  PlanRow,
  getBearerToken,
  getAccessibleProfiles,
  getGroupOcrUsage,
  getGroupPlan,
  getOrCreateDefaultUser,
  getUserGroups,
  serializeCareProfile,
  serializeAppointment,
  serializeMedication,
  supabaseFetch,
  verifyLineIdToken,
} from "../_shared/supabase";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINE_LOGIN_CHANNEL_ID?: string;
};

function buildPlanUsage(plan: PlanRow, ocrUsed: number) {
  const remaining = Math.max(plan.monthly_ocr_limit - ocrUsed, 0);
  return {
    plan: {
      id: plan.id,
      name: plan.name,
      monthly_ocr_limit: plan.monthly_ocr_limit,
      max_members: plan.max_members,
      max_recipients: plan.max_recipients,
      family_group_enabled: plan.family_group_enabled,
      price_monthly_usd: plan.price_monthly_usd,
    },
    usage: {
      ocr_upload: { used_count: ocrUsed, limit_count: plan.monthly_ocr_limit, remaining_count: remaining },
    },
    // backward-compat aliases
    ocr_used: ocrUsed,
    ocr_limit: plan.monthly_ocr_limit,
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
  needs_setup: false,
  needs_profile_setup: false,
};

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

// Prefer is_default first (getAccessibleProfiles already sorts this way).
// requestedProfileId must belong to the accessible profiles list.
function chooseProfile(profiles: CareProfileRow[], requestedProfileId: number | null, requestedGroupId: number | null): CareProfileRow | null {
  if (requestedProfileId) {
    const found = profiles.find((p) => p.id === requestedProfileId);
    if (found) return found;
  }
  if (requestedGroupId) {
    return profiles.find((p) => p.group_id === requestedGroupId) || null;
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

async function fetchAppointments(env: Env, groupId: number | null, profileId: number | null): Promise<AppointmentRow[]> {
  if (!groupId) return [];
  const profileScope = profileId ? `&or=(profile_id.eq.${profileId},profile_id.is.null)` : "";
  const path = `appointments?group_id=eq.${groupId}&status=eq.upcoming${profileScope}&select=*&order=date.asc.nullslast,created_at.desc`;
  return supabaseFetch<AppointmentRow[]>(env, path);
}

async function fetchMedications(env: Env, groupId: number | null, profileId: number | null): Promise<MedicationRow[]> {
  if (!profileId && !groupId) return [];
  const path = profileId
    ? `medications?profile_id=eq.${profileId}&active=eq.true&select=*&order=created_at.desc`
    : `medications?group_id=eq.${groupId}&active=eq.true&select=*&order=created_at.desc`;
  return supabaseFetch<MedicationRow[]>(env, path);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // ── Unauthenticated: return static demo, zero DB queries ──────────────────
    const token = getBearerToken(request);
    const identity = token ? await verifyLineIdToken(env, token) : null;

    if (!identity) {
      return Response.json(STATIC_DEMO_DASHBOARD);
    }

    // ── Authenticated path ────────────────────────────────────────────────────
    const userId = await getOrCreateDefaultUser(env, identity.lineUserId, identity);
    const requestedProfileId = parseProfileId(request);
    const requestedGroupId = parseGroupId(request);

    // Step 1: Resolve groups
    const memberships = await supabaseFetch<Array<{ group_id: number }>>(
      env,
      `user_family_groups?user_id=eq.${userId}&select=group_id`,
    );

    if (memberships.length === 0) {
      // User has no family group yet → prompt setup
      return Response.json({
        ...STATIC_DEMO_DASHBOARD,
        mode: "personal",
        ...buildPlanUsage(FREE_PLAN_DEMO, 0),
        patient: { name: identity.name || "我", age: "", dept: "", diagnoses: [] },
        appointments: [],
        medications: [],
        checklist: [],
        groups: [],
        active_group_id: null,
        active_group_name: null,
        family_notes: [],
        care_profiles: [],
        active_profile_id: null,
        needs_setup: true,
        needs_profile_setup: false,
      });
    }

    // Step 2: Resolve profiles
    const groups = await getUserGroups(env, userId);
    const fallbackGroupId = memberships[0]?.group_id ?? null;
    const activeRequestedGroupId = groups.some((group) => group.id === requestedGroupId) ? requestedGroupId : fallbackGroupId;
    const profiles = await getAccessibleProfiles(env, userId);
    const selectedProfile = chooseProfile(profiles, requestedProfileId, activeRequestedGroupId);

    if (!selectedProfile) {
      // User has a group but no care recipient yet — still read group plan for accurate limits
      const groupId = activeRequestedGroupId;
      const activeGroup = groups.find((group) => group.id === groupId) || null;
      const groupPlan = await getGroupPlan(env, groupId);
      const ocrUsed = await getGroupOcrUsage(env, groupId);
      return Response.json({
        ...STATIC_DEMO_DASHBOARD,
        mode: "personal",
        ...buildPlanUsage(groupPlan, ocrUsed),
        patient: { name: identity.name || "我", age: "", dept: "", diagnoses: [] },
        appointments: [],
        medications: [],
        checklist: [],
        groups,
        active_group_id: groupId,
        active_group_name: activeGroup?.name || "家庭群組",
        family_notes: [],
        care_profiles: profiles.map(serializeCareProfile),
        active_profile_id: null,
        needs_setup: false,
        needs_profile_setup: true,
      });
    }

    const activeGroupId = selectedProfile.group_id;
    const activeProfileId = selectedProfile.id;
    const activeGroup = groups.find((group) => group.id === activeGroupId) || null;

    // Step 3: Fetch care data scoped to group + profile
    const [appointments, medications, members] = await Promise.all([
      fetchAppointments(env, activeGroupId, activeProfileId),
      fetchMedications(env, activeGroupId, activeProfileId),
      fetchDashboardMembers(env, activeGroupId, userId),
    ]);
    const familyNotes = appointments
      .filter((appointment) => appointment.type === "family_note" && !appointment.profile_id)
      .map((appointment) => appointment.reminder_text || appointment.notes || appointment.department || "")
      .filter(Boolean);

    const checklist = appointments.slice(0, 3).map((apt) => {
      const label = `${apt.date || ""} ${apt.department || apt.hospital || "回診"}`.trim();
      if (apt.fasting_required) return `${label}：需空腹 ${apt.fasting_hours || 8} 小時`;
      return label;
    });

    // Step 4: Fetch group plan and OCR usage
    const [groupPlan, ocrUsed] = await Promise.all([
      getGroupPlan(env, activeGroupId),
      getGroupOcrUsage(env, activeGroupId),
    ]);

    return Response.json({
      patient: {
        name: selectedProfile.display_name || identity.name || "家人",
        age: "",
        dept: selectedProfile.main_department || appointments[0]?.department || "醫療照護",
        diagnoses: [],
      },
      mode: "personal",
      ...buildPlanUsage(groupPlan, ocrUsed),
      groups,
      active_group_id: activeGroupId,
      active_group_name: activeGroup?.name || "家庭群組",
      family_notes: familyNotes,
      active_profile_id: activeProfileId,
      care_profiles: profiles.map(serializeCareProfile),
      appointments: appointments.map(serializeAppointment),
      medications: medications.map(serializeMedication),
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
