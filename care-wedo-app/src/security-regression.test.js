import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("API middleware rejects protected requests without a bearer token", () => {
  const source = readProjectFile("functions/api/_middleware.ts");
  assert.match(source, /if \(!token\) \{/);
  assert.match(source, /status:\s*401/);
});

test("API middleware rejects invalid bearer tokens before reaching handlers", () => {
  const source = readProjectFile("functions/api/_middleware.ts");
  assert.match(source, /catch\s*\([^)]*\)\s*\{/);
  assert.match(source, /登入已失效|Invalid token|Unauthorized/);
});

test("OCR API requires a valid authenticated LINE identity", () => {
  const source = readProjectFile("functions/api/ocr/[[path]].ts");
  assert.match(source, /if \(!token\) \{/);
  assert.doesNotMatch(source, /getOrCreateDefaultUser\(env,\s*identity\?\.lineUserId\)/);
});

test("Groups API requires a bearer token before resolving a user", () => {
  const source = readProjectFile("functions/api/groups.ts");
  assert.match(source, /if \(!token\) \{/);
  assert.match(source, /請先登入/);
});

test("Groups API keeps invite join idempotent for existing members before plan limits", () => {
  const source = readProjectFile("functions/api/groups.ts");
  const joinAction = source.slice(source.indexOf('if (body.action === "join")'));
  const existingMembershipIndex = joinAction.indexOf("const existingMembership");
  const limitCheckIndex = joinAction.indexOf("checkGroupMemberLimit");
  assert.notEqual(existingMembershipIndex, -1);
  assert.notEqual(limitCheckIndex, -1);
  assert.ok(existingMembershipIndex < limitCheckIndex);
  assert.match(source, /if \(existingMembership\.length === 0\) \{/);
});

test("Dashboard API returns family members for the global care contact dock", () => {
  const source = readProjectFile("functions/api/dashboard.ts");
  assert.match(source, /getDashboardMembers|fetchDashboardMembers/);
  assert.match(source, /users\(name,line_user_id,picture_url\)/);
  assert.match(source, /members:/);
  assert.match(source, /collaborators:/);
});

test("Global care contact sheets support keyboard close and focus return", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const dock = source.slice(source.indexOf("function GlobalCareContactDock"));
  assert.match(dock, /lastContactTriggerRef/);
  assert.match(dock, /contactSheetPrimaryRef/);
  assert.match(dock, /event\.key === "Escape"/);
  assert.match(dock, /\.focus\(\)/);
});

test("Medication view groups medicines by time and keeps one calm taken action", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const medicationView = source.slice(source.indexOf("function MedicationView"));
  assert.match(medicationView, /groupMedicationsBySchedule/);
  assert.match(medicationView, /medicine-time-group/);
  assert.match(medicationView, /medicine-slot-actions/);
  assert.match(medicationView, /medicine-chip-button/);
  assert.match(medicationView, /getMedicationShortName/);
  assert.match(medicationView, /"吃了"/);
  assert.doesNotMatch(medicationView, />\s*忘了\s*</);
  assert.doesNotMatch(medicationView, /我忘記有沒有吃/);
  assert.match(source, /markMedicationSlotStatus/);
  assert.match(medicationView, /尚未記錄/);
});

test("Medication records expose schedule fields for elder-friendly medicine instructions", () => {
  const schema = readProjectFile("supabase/schema.sql");
  const shared = readProjectFile("functions/_shared/supabase.ts");
  assert.match(schema, /time_slot text/);
  assert.match(schema, /meal_timing text/);
  assert.match(schema, /scheduled_time text/);
  assert.match(schema, /taken_status text/);
  assert.match(shared, /time_slot:\s*row\.time_slot/);
  assert.match(shared, /meal_timing:\s*row\.meal_timing/);
  assert.match(shared, /scheduled_time:\s*row\.scheduled_time/);
  assert.match(shared, /taken_status:\s*row\.taken_status/);
});

test("Medication slot status API records dated logs with ownership checks", () => {
  const schema = readProjectFile("supabase/schema.sql");
  const api = readProjectFile("functions/api/medications/taken.ts");
  assert.match(schema, /create table if not exists public\.medication_logs/);
  assert.match(schema, /taken_date date not null/);
  assert.match(schema, /confirmed_by_user_id bigint/);
  assert.match(api, /getBearerToken/);
  assert.match(api, /getUserMemberships/);
  assert.match(api, /medication_ids/);
  assert.match(api, /medications\?id=in\.\(\$\{medicationIds\.join\(","\)\}\)/);
  assert.match(api, /medication_logs\?select=/);
  assert.match(api, /status:\s*status/);
});

test("Global care contact dock uses a circular icon-only app avatar on mobile", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const dock = app.slice(app.indexOf("function GlobalCareContactDock"));
  assert.match(app, /CARE_WEDO_APP_ICON/);
  assert.match(app, /android-chrome-512x512\.png/);
  assert.doesNotMatch(dock, /care-contact-main-button with-label/);
  assert.match(css, /\.care-contact-main-button\s*\{[^}]*width:\s*64px/s);
  assert.match(css, /\.global-care-contact-dock\s*\{[^}]*right:\s*16px/s);
  assert.doesNotMatch(css, /calc\(\(100vw - min\(100vw, 430px\)\) \/ 2 \+ 72px\)/);
});

test("Family group creation uses a user feature flag, not group plans", () => {
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const supabase = readProjectFile("functions/_shared/supabase.ts");
  const migration = readProjectFile("supabase/migration_phase46_user_feature_flags.sql");
  const createAction = groupsApi.slice(groupsApi.indexOf('if (body.action === "create")'));
  const canCreateStart = supabase.indexOf("export async function canCreateFamilyGroup");
  const canCreateEnd = supabase.indexOf("/**\n * Check whether a new member", canCreateStart);
  const canCreate = supabase.slice(canCreateStart, canCreateEnd);

  assert.match(migration, /create table if not exists public\.user_feature_flags/i);
  assert.match(migration, /multiple_family_groups/);
  assert.match(createAction, /canCreateFamilyGroup\(env,\s*userId\)/);
  assert.match(canCreate, /hasUserFeatureFlag\(env,\s*userId,\s*MULTIPLE_FAMILY_GROUPS_FEATURE\)/);
  assert.doesNotMatch(canCreate, /getGroupPlan|plan_id|internal/);
});

test("Cron endpoints fail closed when CRON_SECRET is not configured", () => {
  for (const file of ["functions/api/cron/reminders.ts", "functions/api/cron/evening.ts"]) {
    const source = readProjectFile(file);
    assert.match(source, /if \(!env\.CRON_SECRET\) \{/);
    assert.match(source, /CRON_SECRET is not configured/);
  }
});

test("LINE postback reassignment validates source user access before updating records", () => {
  const source = readProjectFile("functions/callback.ts");
  assert.match(source, /getUserMemberships/);
  assert.match(source, /getAccessibleProfiles/);
  assert.match(source, /targetProfile/);
  assert.match(source, /group_id\.in|group_id=in/);
});
