import test from "node:test";
import assert from "node:assert/strict";

import {
  FIXTURE,
  STAGING_TARGET,
  buildFixturePlan,
  validateTarget,
  verifyFixture,
} from "./staging-care-fixture.mjs";

const targetEnv = {
  SUPABASE_URL: `https://${STAGING_TARGET.projectRef}.supabase.co`,
  CARE_WEDO_STAGING_BASE_URL: `https://${STAGING_TARGET.host}`,
};

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

test("fixture verify is read-only and detects the exact clean fixture shape", async () => {
  const env = {
    ...targetEnv,
    SUPABASE_SERVICE_ROLE_KEY: "test-only-key",
  };
  const result = await verifyFixture({
    env,
    fetchImpl: async (url) => {
      if (url.includes("user_family_groups?")) return new Response(JSON.stringify([
        { user_id: 1, role: "admin", can_manage: true },
        { user_id: 2, role: "member", can_manage: true },
        { user_id: 3, role: "member", can_manage: false },
      ]), { status: 200 });
      if (url.includes("family_groups?")) return new Response(JSON.stringify([{ id: 100, name: FIXTURE.groupName }]), { status: 200 });
      if (url.includes("care_profiles?")) return new Response(JSON.stringify([{ id: 200, display_name: FIXTURE.profileName }]), { status: 200 });
      if (url.includes("appointments?")) return new Response(JSON.stringify([{ id: 300, profile_id: 200 }]), { status: 200 });
      if (url.includes("medications?")) return new Response(JSON.stringify([{ id: 400, profile_id: 200 }]), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.counts, { groups: 1, profiles: 1, appointments: 1, medications: 1, memberships: 3 });
  assert.equal(JSON.stringify(result).includes("test-only-key"), false);
});
