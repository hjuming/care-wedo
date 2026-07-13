import test from "node:test";
import assert from "node:assert/strict";

import {
  FIXTURE,
  STAGING_TARGET,
  buildFixturePlan,
  validateTarget,
} from "./staging-care-fixture.mjs";

test("staging fixture target is locked to the Care WEDO staging project", () => {
  const result = validateTarget({
    supabaseUrl: `https://${STAGING_TARGET.projectRef}.supabase.co`,
    baseUrl: `https://${STAGING_TARGET.host}`,
    projectRef: STAGING_TARGET.projectRef,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("fixture refuses production or unrelated Supabase targets", () => {
  const result = validateTarget({
    supabaseUrl: "https://production.supabase.co",
    baseUrl: "https://care.wedopr.com",
    projectRef: "production",
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /project ref|SUPABASE_URL|staging base URL/);
});

test("dry-run plan exposes no credentials and keeps a stable appointment marker", () => {
  const plan = buildFixturePlan({
    SUPABASE_URL: `https://${STAGING_TARGET.projectRef}.supabase.co`,
    CARE_WEDO_STAGING_BASE_URL: `https://${STAGING_TARGET.host}`,
    CARE_WEDO_FIXTURE_PRIMARY_EMAIL: "primary@example.test",
    CARE_WEDO_FIXTURE_PRIMARY_PASSWORD: "[not printed]",
  });

  assert.equal(plan.fixture.key, FIXTURE.key);
  assert.equal(plan.personas[0].email_configured, true);
  assert.equal(plan.personas[0].password_configured, true);
  assert.equal(plan.fixture.medication.name, FIXTURE.medicationName);
  assert.equal(plan.fixture.medication.time_slot, FIXTURE.medicationTimeSlot);
  assert.equal(JSON.stringify(plan).includes("[not printed]"), false);
  assert.equal(JSON.stringify(plan).includes("[not printed]"), false);
});
