import test from "node:test";
import assert from "node:assert/strict";

import * as roleE2E from "./staging-role-e2e.mjs";
import { FIXTURE, STAGING_TARGET } from "./staging-care-fixture.mjs";

const { buildRoleE2EPlan, checkCanonicalFixtureText, buildFreshContextReadback } = roleE2E;

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
  assert.doesNotMatch(JSON.stringify(plan), /Idempotency-Key|care-wedo-role-medication/);
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

test("role e2e source keeps the 412px large-text gate", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./staging-role-e2e.mjs", import.meta.url), "utf8"));
  assert.match(source, /\[130, 150, 200\]/);
  assert.match(source, /webkitTextSizeAdjust/);
  assert.match(source, /textSizeAdjust/);
  assert.match(source, /horizontal_overflow/);
  assert.match(source, /offscreen_control/);
  assert.match(source, /bottom_nav_content_overlap/);
  assert.match(source, /bottom_nav_clearance/);
  assert.match(source, /lastElementChild/);
  assert.match(source, /font_scale/);
  assert.match(source, /login_font_scale/);
});

test("elder mutation-control gate covers billing and collaboration entry points", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./staging-role-e2e.mjs", import.meta.url), "utf8"));
  assert.match(source, /照護圈升級/);
  assert.match(source, /手動新增提醒/);
  assert.match(source, /新增照護對象/);
  assert.match(source, /邀請協作者/);
  assert.match(source, /刪除照護資料/);
});

test("role e2e accepts the current staging review alias", () => {
  const plan = buildRoleE2EPlan({
    ...targetEnv,
    CARE_WEDO_STAGING_BASE_URL: "https://reviewer-e2e.care-wedo-staging.pages.dev",
  });
  assert.equal(plan.target.ok, true);
});

test("canonical fixture name check requires both Chinese labels and returns redacted evidence", () => {
  const dashboardText = `Care WEDO staging ${FIXTURE.groupName} ${FIXTURE.profileName}`;
  const evidence = checkCanonicalFixtureText(dashboardText, FIXTURE);
  assert.deepEqual(evidence, { group_name_visible: true, profile_name_visible: true });
  assert.equal(JSON.stringify(evidence).includes(FIXTURE.groupName), false);
  assert.equal(JSON.stringify(evidence).includes(FIXTURE.profileName), false);
  assert.deepEqual(checkCanonicalFixtureText(FIXTURE.groupName, FIXTURE), {
    group_name_visible: true,
    profile_name_visible: false,
  });
});

test("fresh-context readback plan closes the writer context before relogin", () => {
  const plan = buildFreshContextReadback({ writer: "collaborator" });
  assert.deepEqual(plan, {
    writer: "collaborator",
    reader: "collaborator",
    close_writer_context: true,
    relogin_reader: true,
  });
});

test("role screenshots are captured after canonical dashboard hydration", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./staging-role-e2e.mjs", import.meta.url), "utf8"));
  assert.ok(source.indexOf("const canonicalFixture = await readCanonicalFixtureText") < source.indexOf("screenshot({ path: `${artifactDir}/${persona.key}-dashboard.png`"));
});

test("role e2e medication smoke reuses one valid key and verifies the exact retry response", () => {
  assert.equal(typeof roleE2E.buildMedicationSmokeRequest, "function");
  assert.equal(typeof roleE2E.verifyMedicationSmokeRetry, "function");

  const first = roleE2E.buildMedicationSmokeRequest({ medicationId: 300, operationId: "fixture-100-300", takenDate: "2026-07-19" });
  const retry = roleE2E.buildMedicationSmokeRequest({ medicationId: 300, operationId: "fixture-100-300", takenDate: "2026-07-19" });
  const other = roleE2E.buildMedicationSmokeRequest({ medicationId: 301, operationId: "fixture-100-301", takenDate: "2026-07-19" });
  const nextDay = roleE2E.buildMedicationSmokeRequest({ medicationId: 300, operationId: "fixture-100-300", takenDate: "2026-07-20" });

  assert.match(first.headers["Idempotency-Key"], /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/);
  assert.equal(retry.headers["Idempotency-Key"], first.headers["Idempotency-Key"]);
  assert.notEqual(other.headers["Idempotency-Key"], first.headers["Idempotency-Key"]);
  assert.notEqual(nextDay.headers["Idempotency-Key"], first.headers["Idempotency-Key"]);
  assert.deepEqual(roleE2E.verifyMedicationSmokeRetry(
    { status: 200, body: { success: true, log_ids: [901], medication_ids: [300], deduplicated: false } },
    { status: 200, body: { success: true, log_ids: [901], medication_ids: [300], deduplicated: true } },
    300,
  ), { logIds: [901], deduplicated: true });
  assert.throws(() => roleE2E.verifyMedicationSmokeRetry(
    { status: 200, body: { success: true, log_ids: [901], medication_ids: [300], deduplicated: false } },
    { status: 200, body: { success: true, log_ids: [902], medication_ids: [300], deduplicated: true } },
    300,
  ), /log ids/);
});
