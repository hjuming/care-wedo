#!/usr/bin/env node

import { pathToFileURL } from "node:url";

/**
 * Care WEDO Phase 0 staging fixture.
 *
 * Safe defaults:
 *   node scripts/staging-care-fixture.mjs              # dry-run only
 *   node scripts/staging-care-fixture.mjs --apply --confirm-staging
 *
 * The apply path is intentionally locked to the current Care WEDO staging
 * project and hostname. It creates or reuses three Supabase Auth users, one
 * family group, one care profile, and one appointment marked by a stable
 * fixture key. It never prints or persists passwords/service keys.
 */

export const STAGING_TARGET = Object.freeze({
  projectRef: "minnckpmjwdfvltagbru",
  host: "care-wedo-staging.pages.dev",
});

export const FIXTURE = Object.freeze({
  key: "care-wedo-phase0-clean-fixture-v1",
  groupName: "Care WEDO staging 乾淨測試家庭",
  profileName: "測試長輩・林安安",
  appointmentTitle: "神經內科回診",
  appointmentDate: "2099-12-20",
  appointmentTime: "09:30",
  hospital: "Care WEDO 測試醫院",
  department: "神經內科",
  medicationName: "測試用藥・安心錠",
  medicationDosage: "1 顆",
  medicationFrequency: "每日一次",
  medicationTimeSlot: "morning",
  medicationScheduledTime: "08:00",
});

export const PERSONAS = Object.freeze([
  { key: "primary", role: "admin", can_manage: true, name: "主要照護者・測試", emailEnv: "CARE_WEDO_FIXTURE_PRIMARY_EMAIL", passwordEnv: "CARE_WEDO_FIXTURE_PRIMARY_PASSWORD" },
  { key: "collaborator", role: "member", can_manage: true, name: "家屬協作者・測試", emailEnv: "CARE_WEDO_FIXTURE_COLLABORATOR_EMAIL", passwordEnv: "CARE_WEDO_FIXTURE_COLLABORATOR_PASSWORD" },
  { key: "elder", role: "member", can_manage: false, name: "長輩查看者・測試", emailEnv: "CARE_WEDO_FIXTURE_ELDER_EMAIL", passwordEnv: "CARE_WEDO_FIXTURE_ELDER_PASSWORD" },
]);

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function urlHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function validateTarget({ supabaseUrl = "", baseUrl = "", projectRef = STAGING_TARGET.projectRef } = {}) {
  const expectedSupabaseHost = `${projectRef}.supabase.co`;
  const actualSupabaseHost = urlHost(supabaseUrl);
  const actualBaseHost = urlHost(baseUrl);
  const errors = [];

  if (projectRef !== STAGING_TARGET.projectRef) {
    errors.push(`project ref 必須是 ${STAGING_TARGET.projectRef}`);
  }
  if (actualSupabaseHost !== expectedSupabaseHost) {
    errors.push(`SUPABASE_URL 必須指向 ${expectedSupabaseHost}`);
  }
  if (actualBaseHost !== STAGING_TARGET.host) {
    errors.push(`staging base URL 必須使用 ${STAGING_TARGET.host}`);
  }

  return { ok: errors.length === 0, errors, expectedSupabaseHost, actualSupabaseHost, actualBaseHost };
}

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildFixturePlan(env = process.env) {
  return {
    target: {
      supabase_url: configured(env.SUPABASE_URL),
      base_url: configured(env.CARE_WEDO_STAGING_BASE_URL),
      project_ref: env.CARE_WEDO_STAGING_PROJECT_REF || STAGING_TARGET.projectRef,
    },
    personas: PERSONAS.map((persona) => ({
      key: persona.key,
      role: persona.role,
      can_manage: persona.can_manage,
      name: persona.name,
      email_configured: configured(env[persona.emailEnv]),
      password_configured: configured(env[persona.passwordEnv]),
    })),
    fixture: {
      key: FIXTURE.key,
      group_name: FIXTURE.groupName,
      profile_name: FIXTURE.profileName,
      appointment: {
        title: FIXTURE.appointmentTitle,
        date: FIXTURE.appointmentDate,
        time: FIXTURE.appointmentTime,
        hospital: FIXTURE.hospital,
        department: FIXTURE.department,
      },
      medication: {
        name: FIXTURE.medicationName,
        dosage: FIXTURE.medicationDosage,
        frequency: FIXTURE.medicationFrequency,
        time_slot: FIXTURE.medicationTimeSlot,
        scheduled_time: FIXTURE.medicationScheduledTime,
      },
    },
  };
}

function redactEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "[missing]";
  return `${local.slice(0, 1)}***@${domain}`;
}

function createRestClient(supabaseUrl, serviceKey, fetchImpl = fetch) {
  const base = `${stripTrailingSlash(supabaseUrl)}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  async function request(path, init = {}) {
    const response = await fetchImpl(`${base}/${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${body.message || body.error || body.raw || "request failed"}`);
    return body;
  }

  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) }),
    patch: (path, body) => request(path, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) }),
  };
}

async function adminAuthRequest(supabaseUrl, serviceKey, path, init = {}) {
  const response = await fetch(`${stripTrailingSlash(supabaseUrl)}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!response.ok) throw new Error(`Supabase Auth ${response.status}: ${body.msg || body.message || body.error_description || body.raw || "request failed"}`);
  return body;
}

async function findOrCreateAuthUser(supabaseUrl, serviceKey, persona, email, password) {
  const listing = await adminAuthRequest(supabaseUrl, serviceKey, "admin/users?page=1&per_page=1000");
  const users = Array.isArray(listing?.users) ? listing.users : [];
  const existing = users.find((user) => String(user.email || "").toLowerCase() === email.toLowerCase());
  if (existing?.id) return { id: existing.id, created: false };
  const created = await adminAuthRequest(supabaseUrl, serviceKey, "admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: persona.name, name: persona.name },
    }),
  });
  return { id: created.id, created: true };
}

async function ensureAppUser(db, authUser, persona, email) {
  const existing = await db.get(`users?auth_user_id=eq.${encodeURIComponent(authUser.id)}&select=id&limit=1`);
  if (existing[0]?.id) {
    await db.patch(`users?id=eq.${existing[0].id}`, {
      auth_provider: "email",
      email,
      name: persona.name,
    });
    return { id: existing[0].id, created: false };
  }
  const created = await db.post("users", {
    auth_user_id: authUser.id,
    auth_provider: "email",
    email,
    name: persona.name,
    plan: "free",
  });
  return { id: created[0]?.id, created: true };
}

async function ensureGroup(db, ownerUserId) {
  const existing = await db.get(`family_groups?name=eq.${encodeURIComponent(FIXTURE.groupName)}&select=id,name,owner_user_id&limit=1`);
  if (existing[0]?.id) return { ...existing[0], created: false };
  const created = await db.post("family_groups", {
    name: FIXTURE.groupName,
    invite_code: `CW${FIXTURE.key.slice(-8).toUpperCase()}`,
    owner_user_id: ownerUserId,
    plan_id: "internal",
  });
  return { ...created[0], created: true };
}

async function ensureMembership(db, userId, groupId, persona) {
  const path = `user_family_groups?user_id=eq.${userId}&group_id=eq.${groupId}&select=user_id,group_id,role,can_manage&limit=1`;
  const existing = await db.get(path);
  const payload = { role: persona.role, can_manage: persona.can_manage, can_pay: persona.key === "primary" };
  if (existing[0]) {
    await db.patch(`user_family_groups?user_id=eq.${userId}&group_id=eq.${groupId}`, payload);
    return { ...existing[0], ...payload, created: false };
  }
  const created = await db.post("user_family_groups", { user_id: userId, group_id: groupId, ...payload });
  return { ...created[0], created: true };
}

async function ensureProfile(db, groupId, primaryUserId) {
  const existing = await db.get(`care_profiles?group_id=eq.${groupId}&display_name=eq.${encodeURIComponent(FIXTURE.profileName)}&select=id,group_id,display_name&limit=1`);
  if (existing[0]?.id) return { ...existing[0], created: false };
  const created = await db.post("care_profiles", {
    group_id: groupId,
    primary_user_id: primaryUserId,
    display_name: FIXTURE.profileName,
    relationship: "parent",
    is_default: true,
  });
  return { ...created[0], created: true };
}

async function ensureAppointment(db, groupId, profileId, primaryUserId) {
  const marker = encodeURIComponent(FIXTURE.key);
  const existing = await db.get(`appointments?group_id=eq.${groupId}&profile_id=eq.${profileId}&notes=eq.${marker}&status=neq.deleted&select=id,group_id,profile_id,title,date,time&limit=1`);
  if (existing[0]?.id) return { ...existing[0], created: false };
  const created = await db.post("appointments", {
    user_id: primaryUserId,
    group_id: groupId,
    profile_id: profileId,
    created_by_user_id: primaryUserId,
    idempotency_key: `${FIXTURE.key}-appointment`,
    type: "clinic_visit",
    title: FIXTURE.appointmentTitle,
    date: FIXTURE.appointmentDate,
    time: FIXTURE.appointmentTime,
    hospital: FIXTURE.hospital,
    department: FIXTURE.department,
    notes: FIXTURE.key,
    status: "upcoming",
  });
  return { ...created[0], created: true };
}

async function ensureMedication(db, groupId, profileId, primaryUserId) {
  const marker = encodeURIComponent(FIXTURE.key);
  const existing = await db.get(`medications?group_id=eq.${groupId}&profile_id=eq.${profileId}&reminder_text=eq.${marker}&select=id,group_id,profile_id,name,dosage,frequency,time_slot,scheduled_time&limit=1`);
  if (existing[0]?.id) return { ...existing[0], created: false };
  const created = await db.post("medications", {
    user_id: primaryUserId,
    group_id: groupId,
    profile_id: profileId,
    created_by_user_id: primaryUserId,
    name: FIXTURE.medicationName,
    dosage: FIXTURE.medicationDosage,
    frequency: FIXTURE.medicationFrequency,
    time_slot: FIXTURE.medicationTimeSlot,
    scheduled_time: FIXTURE.medicationScheduledTime,
    reminder_text: FIXTURE.key,
    active: true,
  });
  return { ...created[0], created: true };
}

export async function applyFixture({ env = process.env } = {}) {
  const supabaseUrl = stripTrailingSlash(env.SUPABASE_URL);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const projectRef = env.CARE_WEDO_STAGING_PROJECT_REF || STAGING_TARGET.projectRef;
  const baseUrl = env.CARE_WEDO_STAGING_BASE_URL;
  const target = validateTarget({ supabaseUrl, baseUrl, projectRef });
  if (!target.ok) throw new Error(`拒絕施工：${target.errors.join("；")}`);
  if (!configured(serviceKey)) throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY（只允許從環境變數提供）");

  const db = createRestClient(supabaseUrl, serviceKey);
  const users = [];
  for (const persona of PERSONAS) {
    const email = String(env[persona.emailEnv] || "").trim();
    const password = String(env[persona.passwordEnv] || "");
    if (!configured(email) || !configured(password)) throw new Error(`缺少 ${persona.emailEnv} 或 ${persona.passwordEnv}`);
    const auth = await findOrCreateAuthUser(supabaseUrl, serviceKey, persona, email, password);
    const appUser = await ensureAppUser(db, auth, persona, email);
    users.push({ ...persona, email: redactEmail(email), auth_user_id: auth.id, user_id: appUser.id, auth_created: auth.created, app_created: appUser.created });
  }

  const primary = users.find((user) => user.key === "primary");
  const group = await ensureGroup(db, primary.user_id);
  const memberships = [];
  for (const user of users) memberships.push(await ensureMembership(db, user.user_id, group.id, user));
  const profile = await ensureProfile(db, group.id, primary.user_id);
  const appointment = await ensureAppointment(db, group.id, profile.id, primary.user_id);
  const medication = await ensureMedication(db, group.id, profile.id, primary.user_id);
  return {
    target: { project_ref: projectRef, base_host: target.actualBaseHost, supabase_host: target.actualSupabaseHost },
    fixture_key: FIXTURE.key,
    users,
    group: { id: group.id, created: group.created },
    memberships: memberships.map(({ user_id, group_id, role, can_manage, created }) => ({ user_id, group_id, role, can_manage, created })),
    profile: { id: profile.id, display_name: profile.display_name, created: profile.created },
    appointment: { id: appointment.id, title: appointment.title, date: appointment.date, time: appointment.time, created: appointment.created },
    medication: {
      id: medication.id,
      name: medication.name,
      dosage: medication.dosage,
      frequency: medication.frequency,
      time_slot: medication.time_slot,
      scheduled_time: medication.scheduled_time,
      created: medication.created,
    },
  };
}

export async function verifyFixture({ env = process.env, fetchImpl = fetch } = {}) {
  const supabaseUrl = stripTrailingSlash(env.SUPABASE_URL);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const projectRef = env.CARE_WEDO_STAGING_PROJECT_REF || STAGING_TARGET.projectRef;
  const baseUrl = env.CARE_WEDO_STAGING_BASE_URL;
  const target = validateTarget({ supabaseUrl, baseUrl, projectRef });
  if (!target.ok) throw new Error(`拒絕驗證：${target.errors.join("；")}`);
  if (!configured(serviceKey)) throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY（只允許從環境變數提供）");

  const db = createRestClient(supabaseUrl, serviceKey, fetchImpl);
  const groups = await db.get(`family_groups?name=eq.${encodeURIComponent(FIXTURE.groupName)}&select=id,name,owner_user_id&limit=2`);
  const group = groups.length === 1 ? groups[0] : null;
  if (!group?.id) {
    return {
      target: { project_ref: projectRef, base_host: target.actualBaseHost, supabase_host: target.actualSupabaseHost },
      fixture_key: FIXTURE.key,
      ready: false,
      reason: groups.length === 0 ? "group_missing" : "duplicate_groups",
      counts: { groups: groups.length, profiles: 0, appointments: 0, medications: 0, memberships: 0 },
    };
  }

  const [profiles, appointments, medications, memberships] = await Promise.all([
    db.get(`care_profiles?group_id=eq.${group.id}&display_name=eq.${encodeURIComponent(FIXTURE.profileName)}&select=id,display_name&limit=2`),
    db.get(`appointments?group_id=eq.${group.id}&notes=eq.${encodeURIComponent(FIXTURE.key)}&status=neq.deleted&select=id,profile_id,title,date,time&limit=10`),
    db.get(`medications?group_id=eq.${group.id}&reminder_text=eq.${encodeURIComponent(FIXTURE.key)}&active=eq.true&select=id,profile_id,name,time_slot,scheduled_time&limit=10`),
    db.get(`user_family_groups?group_id=eq.${group.id}&select=user_id,role,can_manage&limit=10`),
  ]);
  const roles = new Map(memberships.map((membership) => [String(membership.role) + ":" + String(membership.can_manage), true]));
  const expectedRoles = ["admin:true", "member:true", "member:false"];
  const roleShapeMatches = expectedRoles.every((role) => roles.has(role)) && memberships.length === 3;
  return {
    target: { project_ref: projectRef, base_host: target.actualBaseHost, supabase_host: target.actualSupabaseHost },
    fixture_key: FIXTURE.key,
    ready: groups.length === 1 && profiles.length === 1 && appointments.length === 1 && medications.length === 1 && roleShapeMatches,
    group: { id: group.id, name: group.name },
    profile: profiles[0] ? { id: profiles[0].id, display_name: profiles[0].display_name } : null,
    appointment: appointments[0] ? { id: appointments[0].id, profile_id: appointments[0].profile_id } : null,
    medication: medications[0] ? { id: medications[0].id, profile_id: medications[0].profile_id } : null,
    counts: { groups: groups.length, profiles: profiles.length, appointments: appointments.length, medications: medications.length, memberships: memberships.length },
    membership_roles: memberships.map(({ role, can_manage }) => ({ role, can_manage })),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const verify = args.has("--verify");
  const confirmed = args.has("--confirm-staging");
  const plan = buildFixturePlan(process.env);
  const target = validateTarget({
    supabaseUrl: process.env.SUPABASE_URL,
    baseUrl: process.env.CARE_WEDO_STAGING_BASE_URL,
    projectRef: process.env.CARE_WEDO_STAGING_PROJECT_REF || STAGING_TARGET.projectRef,
  });

  if (!apply) {
    if (verify) {
      console.log(JSON.stringify({ event: "care_wedo_staging_fixture_verify", mode: "verify", result: await verifyFixture() }, null, 2));
      return;
    }
    console.log(JSON.stringify({ event: "care_wedo_staging_fixture_plan", mode: "dry_run", target, plan }, null, 2));
    return;
  }
  if (!confirmed) throw new Error("apply 前必須同時提供 --confirm-staging");
  console.log(JSON.stringify({ event: "care_wedo_staging_fixture_apply", mode: "apply", result: await applyFixture() }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
