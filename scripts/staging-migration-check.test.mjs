import test from "node:test";
import assert from "node:assert/strict";

import { checkPhase61 } from "./staging-migration-check.mjs";
import { STAGING_TARGET } from "./staging-care-fixture.mjs";

const targetEnv = {
  SUPABASE_URL: `https://${STAGING_TARGET.projectRef}.supabase.co`,
  CARE_WEDO_STAGING_BASE_URL: `https://${STAGING_TARGET.host}`,
  SUPABASE_SERVICE_ROLE_KEY: "test-only-key",
};

test("migration check refuses unrelated targets without a network call", async () => {
  let called = false;
  const result = await checkPhase61({
    env: { ...targetEnv, SUPABASE_URL: "https://production.supabase.co" },
    fetchImpl: async () => {
      called = true;
      return new Response("[]", { status: 200 });
    },
  });

  assert.equal(result.ready_for_appointment_idempotency, false);
  assert.equal(called, false);
});

test("migration check reports a missing column without exposing credentials", async () => {
  const result = await checkPhase61({
    env: targetEnv,
    fetchImpl: async () => new Response(JSON.stringify({ code: "PGRST204", message: "column does not exist" }), { status: 400 }),
  });

  assert.equal(result.column_present, false);
  assert.equal(result.action, "migration_required");
  assert.equal(JSON.stringify(result).includes("test-only-key"), false);
});

test("migration check marks the column ready but leaves unique-index verification explicit", async () => {
  const result = await checkPhase61({
    env: targetEnv,
    fetchImpl: async () => new Response(JSON.stringify([{ idempotency_key: null }]), { status: 200 }),
  });

  assert.equal(result.column_present, true);
  assert.equal(result.ready_for_appointment_idempotency, true);
  assert.equal(result.action, "verify_unique_index_and_run_clean_fixture");
});
