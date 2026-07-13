import test from "node:test";
import assert from "node:assert/strict";

import { buildRoleE2EPlan } from "./staging-role-e2e.mjs";
import { STAGING_TARGET } from "./staging-care-fixture.mjs";

const targetEnv = {
  SUPABASE_URL: `https://${STAGING_TARGET.projectRef}.supabase.co`,
  CARE_WEDO_STAGING_BASE_URL: `https://${STAGING_TARGET.host}`,
  CARE_WEDO_FIXTURE_PRIMARY_EMAIL: "primary@example.test",
  CARE_WEDO_FIXTURE_PRIMARY_PASSWORD: "[secret]",
  CARE_WEDO_FIXTURE_COLLABORATOR_EMAIL: "collaborator@example.test",
  CARE_WEDO_FIXTURE_COLLABORATOR_PASSWORD: "[secret]",
  CARE_WEDO_FIXTURE_ELDER_EMAIL: "elder@example.test",
  CARE_WEDO_FIXTURE_ELDER_PASSWORD: "[secret]",
  CARE_WEDO_FIXTURE_GROUP_ID: "100",
  CARE_WEDO_FIXTURE_PROFILE_ID: "200",
  CARE_WEDO_FIXTURE_MEDICATION_ID: "300",
};

test("role e2e plan locks the staging target and redacts credential values", () => {
  const plan = buildRoleE2EPlan(targetEnv);
  assert.equal(plan.target.ok, true);
  assert.equal(plan.group_id_configured, true);
  assert.equal(plan.profile_id_configured, true);
  assert.equal(plan.medication_id_configured, true);
  assert.equal(plan.writes_enabled, false);
  assert.equal(JSON.stringify(plan).includes("[secret]"), false);
});

test("role e2e plan refuses production and reports missing credentials without network calls", () => {
  const plan = buildRoleE2EPlan({
    SUPABASE_URL: "https://production.supabase.co",
    CARE_WEDO_STAGING_BASE_URL: "https://care.wedopr.com",
  });
  assert.equal(plan.target.ok, false);
  assert.equal(plan.base_url_configured, true);
  assert.equal(plan.personas.every((persona) => !persona.email_configured && !persona.password_configured), true);
});
