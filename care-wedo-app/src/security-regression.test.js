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
