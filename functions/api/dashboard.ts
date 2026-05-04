import {
  AppointmentRow,
  CareProfileRow,
  FREE_OCR_MONTHLY_LIMIT,
  MedicationRow,
  getBearerToken,
  getAccessibleProfiles,
  getMonthlyOcrUsage,
  getOrCreateDefaultUser,
  getUserPlan,
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

function buildAppointmentPath(userId: number, groupIds: number[], profileId?: number | null) {
  if (profileId) {
    return `appointments?profile_id=eq.${profileId}&status=eq.upcoming&select=*&order=date.asc.nullslast,created_at.desc`;
  }

  const userFilter = `user_id=eq.${userId}`;
  const groupFilter = groupIds.length > 0 ? `,group_id=in.(${groupIds.join(",")})` : "";
  const filter = `or=(${userFilter}${groupFilter})&status=eq.upcoming&select=*&order=date.asc.nullslast,created_at.desc`;
  return `appointments?${filter}`;
}

function buildMedicationPath(userId: number, groupIds: number[], profileId?: number | null) {
  if (profileId) {
    return `medications?profile_id=eq.${profileId}&active=eq.true&select=*&order=created_at.desc`;
  }

  const userFilter = `user_id=eq.${userId}`;
  const groupFilter = groupIds.length > 0 ? `,group_id=in.(${groupIds.join(",")})` : "";
  const filter = `or=(${userFilter}${groupFilter})&active=eq.true&select=*&order=created_at.desc`;
  return `medications?${filter}`;
}

function parseProfileId(request: Request) {
  const value = new URL(request.url).searchParams.get("profile_id");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function chooseProfile(profiles: CareProfileRow[], requestedProfileId: number | null) {
  if (requestedProfileId) {
    const found = profiles.find((profile) => profile.id === requestedProfileId);
    if (found) return found;
  }
  return profiles[0] || null;
}

async function fetchAppointments(env: Env, userId: number, groupIds: number[], profileId: number | null) {
  try {
    return await supabaseFetch<AppointmentRow[]>(
      env,
      buildAppointmentPath(userId, groupIds, profileId),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!profileId || !message.includes("appointments.profile_id")) throw error;
    return supabaseFetch<AppointmentRow[]>(env, buildAppointmentPath(userId, groupIds, null));
  }
}

async function fetchMedications(env: Env, userId: number, groupIds: number[], profileId: number | null) {
  try {
    return await supabaseFetch<MedicationRow[]>(
      env,
      buildMedicationPath(userId, groupIds, profileId),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!profileId || !message.includes("medications.profile_id")) throw error;
    return supabaseFetch<MedicationRow[]>(env, buildMedicationPath(userId, groupIds, null));
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const token = getBearerToken(request);
    const identity = token ? await verifyLineIdToken(env, token) : null;
    const userId = await getOrCreateDefaultUser(env, identity?.lineUserId);
    const requestedProfileId = parseProfileId(request);

    // Fetch groups for the user
    const memberships = await supabaseFetch<Array<{ group_id: number }>>(
      env,
      `user_family_groups?user_id=eq.${userId}&select=group_id`,
    );
    const groupIds = memberships.map((m) => m.group_id);
    const profiles = identity ? await getAccessibleProfiles(env, userId) : [];
    const selectedProfile = chooseProfile(profiles, requestedProfileId);
    const activeProfileId = selectedProfile?.id || null;

    const appointments = await fetchAppointments(env, userId, groupIds, activeProfileId);
    const medications = await fetchMedications(env, userId, groupIds, activeProfileId);

    const checklist = appointments.slice(0, 3).map((apt) => {
      const label = `${apt.date || ""} ${apt.department || apt.hospital || "回診"}`.trim();
      if (apt.fasting_required) return `${label}：需空腹 ${apt.fasting_hours || 8} 小時`;
      return label;
    });

    // Fetch plan info for authenticated users
    let plan = "free";
    let ocrUsed = 0;
    const ocrLimit = FREE_OCR_MONTHLY_LIMIT;
    if (identity) {
      const [planInfo, usage] = await Promise.all([
        getUserPlan(env, userId),
        getMonthlyOcrUsage(env, userId),
      ]);
      plan = planInfo.plan;
      ocrUsed = usage;
    }

    return Response.json({
      patient: {
        name: selectedProfile?.display_name || identity?.name || "家人",
        age: "",
        dept: selectedProfile?.main_department || appointments[0]?.department || "醫療照護",
        diagnoses: [],
      },
      mode: identity ? "personal" : "demo",
      plan,
      ocr_used: ocrUsed,
      ocr_limit: plan === "paid" ? null : ocrLimit,
      active_profile_id: activeProfileId,
      care_profiles: profiles.map(serializeCareProfile),
      appointments: appointments.map(serializeAppointment),
      medications: medications.map(serializeMedication),
      checklist,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Dashboard API failed" },
      { status: 500 },
    );
  }
};
