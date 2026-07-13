#!/usr/bin/env node

/**
 * Care WEDO Phase 5 staging fresh-context verification.
 *
 * Safe default: prints a redacted readiness plan and performs no writes.
 * Writes/API mutations require both --confirm-staging and a target locked to
 * the known Care WEDO staging Supabase/Pages pair.
 *
 * Required apply variables are supplied through the same private environment
 * used by staging-care-fixture.mjs. No access token, password, or response
 * body containing care data is written to the report.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PERSONAS, STAGING_TARGET, validateTarget } from "./staging-care-fixture.mjs";

const DEFAULT_ARTIFACT_DIR = "/private/tmp/care-wedo-staging-role-e2e";
const APPOINTMENT_KEY = "care-wedo-phase5-role-e2e-v1";
const FAMILY_NOTE = "Care WEDO Phase 5 跨帳號 read-back 測試提醒";

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function buildRoleE2EPlan(env = process.env) {
  const baseUrl = stripTrailingSlash(env.CARE_WEDO_STAGING_BASE_URL);
  const target = validateTarget({
    supabaseUrl: env.SUPABASE_URL,
    baseUrl,
    projectRef: env.CARE_WEDO_STAGING_PROJECT_REF || STAGING_TARGET.projectRef,
  });
  const personas = PERSONAS.map((persona) => ({
    key: persona.key,
    email_configured: configured(env[persona.emailEnv]),
    password_configured: configured(env[persona.passwordEnv]),
  }));
  return {
    event: "care_wedo_staging_role_e2e_plan",
    target,
    base_url_configured: configured(baseUrl),
    group_id_configured: positiveInteger(env.CARE_WEDO_FIXTURE_GROUP_ID),
    profile_id_configured: positiveInteger(env.CARE_WEDO_FIXTURE_PROFILE_ID),
    medication_id_configured: positiveInteger(env.CARE_WEDO_FIXTURE_MEDICATION_ID),
    personas,
    artifact_dir: env.CARE_WEDO_E2E_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
    writes_enabled: false,
  };
}

function requiredApplyEnv(env) {
  const missing = [];
  if (!validateTarget({
    supabaseUrl: env.SUPABASE_URL,
    baseUrl: env.CARE_WEDO_STAGING_BASE_URL,
    projectRef: env.CARE_WEDO_STAGING_PROJECT_REF || STAGING_TARGET.projectRef,
  }).ok) missing.push("staging target (SUPABASE_URL/CARE_WEDO_STAGING_BASE_URL)");
  for (const persona of PERSONAS) {
    if (!configured(env[persona.emailEnv])) missing.push(persona.emailEnv);
    if (!configured(env[persona.passwordEnv])) missing.push(persona.passwordEnv);
  }
  if (!positiveInteger(env.CARE_WEDO_FIXTURE_GROUP_ID)) missing.push("CARE_WEDO_FIXTURE_GROUP_ID");
  if (!positiveInteger(env.CARE_WEDO_FIXTURE_PROFILE_ID)) missing.push("CARE_WEDO_FIXTURE_PROFILE_ID");
  if (!positiveInteger(env.CARE_WEDO_FIXTURE_MEDICATION_ID)) missing.push("CARE_WEDO_FIXTURE_MEDICATION_ID");
  return missing;
}

async function loginRole(context, baseUrl, persona, artifactDir, env) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const form = page.locator('form[aria-label="安全測試登入"]');
  await form.waitFor({ state: "visible", timeout: 15000 });
  await form.locator('input[type="email"]').fill(String(env[persona.emailEnv]));
  await form.locator('input[type="password"]').fill(String(env[persona.passwordEnv]));
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app(?:$|[?#])/, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const accessTokenPresent = await page.evaluate(() => Boolean(localStorage.getItem("care_wedo_supabase_access_token")));
  if (!accessTokenPresent) throw new Error(`${persona.key} 登入後沒有建立 Supabase session`);
  await page.screenshot({ path: `${artifactDir}/${persona.key}-dashboard.png`, fullPage: true });
  return page;
}

async function callApi(page, path, init = {}) {
  return page.evaluate(async ({ path: requestPath, init: requestInit }) => {
    const token = localStorage.getItem("care_wedo_supabase_access_token");
    const headers = {
      ...(requestInit.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const response = await fetch(requestPath, { ...requestInit, headers });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: response.status, body };
  }, { path, init });
}

function jsonInit(method, body, extraHeaders = {}) {
  return {
    method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

async function dashboardContains(page, groupId, profileId, predicate) {
  const result = await callApi(page, `/api/dashboard?group_id=${groupId}&profile_id=${profileId}`);
  if (result.status !== 200) return { result, matched: false };
  return { result, matched: Boolean(predicate(result.body || {})) };
}

export async function runRoleE2E({ env = process.env, browserType = chromium } = {}) {
  const missing = requiredApplyEnv(env);
  if (missing.length) throw new Error(`staging fresh-context 缺少設定：${missing.join(", ")}`);
  const baseUrl = stripTrailingSlash(env.CARE_WEDO_STAGING_BASE_URL);
  const groupId = Number(env.CARE_WEDO_FIXTURE_GROUP_ID);
  const profileId = Number(env.CARE_WEDO_FIXTURE_PROFILE_ID);
  const medicationId = Number(env.CARE_WEDO_FIXTURE_MEDICATION_ID);
  const artifactDir = env.CARE_WEDO_E2E_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR;
  await mkdir(artifactDir, { recursive: true });

  const browser = await browserType.launch({ headless: true });
  const contexts = new Map();
  const pages = new Map();
  const result = {
    event: "care_wedo_staging_role_e2e",
    target_host: new URL(baseUrl).hostname,
    personas: {},
    appointment: { first_status: null, retry_status: null, deduplicated: false, same_id: false },
    collaborator: { medication_status: null, medication_already_recorded: false, primary_readback_status: null, primary_readback_match: false },
    family_notes: { save_status: null, readback_status: null, readback_match: false },
    elder: { appointment_status: null, medication_status: null, management_controls_visible: null },
    artifact_dir: artifactDir,
  };

  try {
    for (const persona of PERSONAS) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
      contexts.set(persona.key, context);
      pages.set(persona.key, await loginRole(context, baseUrl, persona, artifactDir, env));
      result.personas[persona.key] = { logged_in: true, fresh_context: true };
    }

    const primary = pages.get("primary");
    const collaborator = pages.get("collaborator");
    const elder = pages.get("elder");
    const appointmentPayload = {
      profile_id: profileId,
      type: "clinic_visit",
      date: "2099-12-21",
      time: "10:00",
      title: "Phase 5 唯一回診",
      hospital: "Care WEDO 測試醫院",
      department: "神經內科",
      notes: APPOINTMENT_KEY,
      reminder_text: APPOINTMENT_KEY,
    };
    const first = await callApi(primary, "/api/appointments", jsonInit("POST", appointmentPayload, { "Idempotency-Key": APPOINTMENT_KEY }));
    const retry = await callApi(primary, "/api/appointments", jsonInit("POST", appointmentPayload, { "Idempotency-Key": APPOINTMENT_KEY }));
    result.appointment.first_status = first.status;
    result.appointment.retry_status = retry.status;
    const firstId = Number(first.body?.appointment?.id);
    const retryId = Number(retry.body?.appointment?.id);
    result.appointment.deduplicated = retry.body?.deduplicated === true;
    result.appointment.same_id = positiveInteger(firstId) && firstId === retryId;
    if (first.status !== 200 || retry.status !== 200 || !result.appointment.same_id) {
      throw new Error("primary 行程建立／重試未通過冪等驗收");
    }

    const collaboratorDashboard = await dashboardContains(
      collaborator,
      groupId,
      profileId,
      (body) => (body.appointments || []).some((item) => Number(item.id) === firstId),
    );
    if (collaboratorDashboard.result.status !== 200 || !collaboratorDashboard.matched) {
      throw new Error("collaborator 未讀到 primary 建立的行程");
    }

    const collaboratorMedicationDashboard = await dashboardContains(
      collaborator,
      groupId,
      profileId,
      (body) => (body.medications || []).some((item) => Number(item.id) === medicationId && item.taken_status === "taken"),
    );
    let medicationResult = { status: 200, alreadyRecorded: collaboratorMedicationDashboard.matched };
    if (!collaboratorMedicationDashboard.matched) {
      const recordedMedication = await callApi(
        collaborator,
        "/api/medications/taken",
        jsonInit("POST", { medication_ids: [medicationId], status: "taken" }),
      );
      medicationResult = { status: recordedMedication.status, alreadyRecorded: false };
    }
    result.collaborator.medication_status = medicationResult.status;
    result.collaborator.medication_already_recorded = medicationResult.alreadyRecorded;
    if (medicationResult.status !== 200) {
      throw new Error("collaborator 記錄服藥未通過");
    }
    const primaryMedicationReadback = await dashboardContains(
      primary,
      groupId,
      profileId,
      (body) => (body.medications || []).some((item) => Number(item.id) === medicationId && item.taken_status === "taken"),
    );
    result.collaborator.primary_readback_status = primaryMedicationReadback.result.status;
    result.collaborator.primary_readback_match = primaryMedicationReadback.matched;
    if (primaryMedicationReadback.result.status !== 200 || !primaryMedicationReadback.matched) {
      throw new Error("primary 未讀回 collaborator 的服藥紀錄");
    }

    const savedNotes = await callApi(collaborator, "/api/groups", jsonInit("POST", {
      action: "update_family_notes",
      group_id: groupId,
      notes: [FAMILY_NOTE],
    }));
    result.family_notes.save_status = savedNotes.status;
    if (savedNotes.status !== 200 || savedNotes.body?.notes?.[0] !== FAMILY_NOTE) {
      throw new Error("collaborator 家庭提醒儲存未通過 read-back");
    }
    const primaryReadback = await dashboardContains(primary, groupId, profileId, (body) => (body.family_notes || []).includes(FAMILY_NOTE));
    result.family_notes.readback_status = primaryReadback.result.status;
    result.family_notes.readback_match = primaryReadback.matched;
    if (primaryReadback.result.status !== 200 || !primaryReadback.matched) {
      throw new Error("primary 重新讀取未看到 collaborator 家庭提醒");
    }

    const elderAppointment = await callApi(elder, `/api/appointments/${firstId}`, jsonInit("PATCH", { status: "completed" }));
    const elderMedication = await callApi(elder, "/api/medications/taken", jsonInit("POST", { medication_ids: [medicationId], status: "taken" }));
    result.elder.appointment_status = elderAppointment.status;
    result.elder.medication_status = elderMedication.status;
    result.elder.management_controls_visible = await elder.evaluate(() => {
      const text = document.body.innerText || "";
      return /編輯|新增照護對象|邀請協作者|刪除照護資料|付款/.test(text);
    });
    await elder.screenshot({ path: `${artifactDir}/elder-final.png`, fullPage: true });
    if (elderAppointment.status !== 403 || elderMedication.status !== 403 || result.elder.management_controls_visible) {
      throw new Error("elder 唯讀／403 驗收未通過");
    }
    return result;
  } finally {
    await Promise.all([...contexts.values()].map((context) => context.close().catch(() => undefined)));
    await browser.close();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const plan = buildRoleE2EPlan(process.env);
  if (!args.has("--confirm-staging")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const result = await runRoleE2E({ env: process.env });
  await writeFile(
    `${result.artifact_dir}/role-e2e-result.json`,
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
