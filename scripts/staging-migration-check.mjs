#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { STAGING_TARGET, validateTarget } from "./staging-care-fixture.mjs";

const PHASE = "phase61_appointment_idempotency";
const UNIQUE_INDEX = "appointments_group_idempotency_key_uidx";
const SQL_VERIFICATION_PATH = "supabase/verify_phase61_appointment_idempotency.sql";

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

export async function checkPhase61({ env = process.env, fetchImpl = fetch } = {}) {
  const supabaseUrl = stripTrailingSlash(env.SUPABASE_URL);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const baseUrl = env.CARE_WEDO_STAGING_BASE_URL;
  const projectRef = env.CARE_WEDO_STAGING_PROJECT_REF || STAGING_TARGET.projectRef;
  const target = validateTarget({ supabaseUrl, baseUrl, projectRef });
  const result = {
    event: "care_wedo_staging_migration_check",
    phase: PHASE,
    target,
    service_key_configured: configured(serviceKey),
    column_present: false,
    ready_for_appointment_idempotency: false,
    unique_index_name: UNIQUE_INDEX,
    unique_index_verification: "manual_sql_required",
    read_only_sql_path: SQL_VERIFICATION_PATH,
    action: "migration_required",
  };

  if (!target.ok || !configured(serviceKey)) return result;

  const response = await fetchImpl(`${supabaseUrl}/rest/v1/appointments?select=idempotency_key&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  const body = await readJson(response);
  if (response.ok) {
    result.column_present = true;
    result.ready_for_appointment_idempotency = true;
    result.action = "verify_unique_index_and_run_clean_fixture";
    return result;
  }

  result.error_code = body.code || body.error || "supabase_query_failed";
  result.error_message = body.message || body.raw || `HTTP ${response.status}`;
  return result;
}

async function main() {
  console.log(JSON.stringify(await checkPhase61(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
