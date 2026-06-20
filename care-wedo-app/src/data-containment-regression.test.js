import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assertSelectPolicy(source, table, policyName, scopeExpression) {
  const pattern = new RegExp(
    [
      `create\\s+policy\\s+${policyName}`,
      `on\\s+public\\.${table}`,
      "for\\s+select",
      "to\\s+authenticated",
      "using\\s*\\(",
      scopeExpression,
    ].join("[\\s\\S]*"),
    "i",
  );
  assert.match(source, pattern, `${table} should define authenticated select policy ${policyName}`);
}

test("protected Care WEDO tables have defensive authenticated read RLS policies", () => {
  const migration = readProjectFile("supabase/migration_phase59_rls_read_policies.sql");
  const schema = readProjectFile("supabase/schema.sql");
  const combined = `${schema}\n${migration}`;

  assert.match(combined, /create or replace function public\.care_wedo_current_user_id\(\)/i);
  assert.match(combined, /create or replace function public\.care_wedo_has_group_access\(target_group_id bigint\)/i);
  assert.match(combined, /create or replace function public\.care_wedo_can_access_storage_object\(target_bucket_id text, object_name text\)/i);
  assert.match(combined, /security definer/i);
  assert.match(combined, /set search_path = ''/i);
  assert.match(combined, /where u\.auth_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(combined, /join public\.users u on u\.id = ufg\.user_id/i);
  assert.match(combined, /target_bucket_id = 'care-documents'/i);
  assert.match(combined, /\^group-\[0-9\]\+\/profile-\[0-9\]\+/i);

  for (const table of [
    "users",
    "user_feature_flags",
    "family_groups",
    "care_profiles",
    "user_family_groups",
    "appointments",
    "medications",
    "medication_logs",
    "care_documents",
    "usage_quotas",
    "billing_subscriptions",
    "billing_events",
    "invoices",
    "line_push_logs",
  ]) {
    assert.match(combined, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }

  assertSelectPolicy(combined, "users", "care_wedo_users_self_select", "care_wedo_current_user_id\\(\\)");
  assertSelectPolicy(combined, "user_feature_flags", "care_wedo_user_feature_flags_self_select", "care_wedo_current_user_id\\(\\)");
  assertSelectPolicy(combined, "family_groups", "care_wedo_family_groups_member_select", "care_wedo_has_group_access\\(id\\)");
  assertSelectPolicy(combined, "user_family_groups", "care_wedo_user_family_groups_member_select", "care_wedo_has_group_access\\(group_id\\)");
  assertSelectPolicy(combined, "care_profiles", "care_wedo_care_profiles_group_select", "care_wedo_has_group_access\\(group_id\\)");
  assertSelectPolicy(combined, "appointments", "care_wedo_appointments_group_select", "care_wedo_has_group_access\\(group_id\\)");
  assertSelectPolicy(combined, "medications", "care_wedo_medications_group_select", "care_wedo_has_group_access\\(group_id\\)");
  assertSelectPolicy(combined, "medication_logs", "care_wedo_medication_logs_group_select", "care_wedo_has_group_access\\(group_id\\)");
  assertSelectPolicy(combined, "care_documents", "care_wedo_care_documents_group_select", "care_wedo_has_group_access\\(group_id\\)");
  assertSelectPolicy(combined, "usage_quotas", "care_wedo_usage_quotas_group_select", "care_wedo_has_group_access\\(group_id\\)");
  assertSelectPolicy(combined, "billing_subscriptions", "care_wedo_billing_subscriptions_group_select", "care_wedo_has_group_access\\(family_group_id\\)");
  assertSelectPolicy(combined, "billing_events", "care_wedo_billing_events_group_select", "care_wedo_has_group_access\\(family_group_id\\)");
  assertSelectPolicy(combined, "invoices", "care_wedo_invoices_group_select", "care_wedo_has_group_access\\(family_group_id\\)");
  assertSelectPolicy(combined, "line_push_logs", "care_wedo_line_push_logs_group_or_recipient_select", "care_wedo_has_group_access\\(group_id\\)");
  assert.match(combined, /alter table storage\.objects enable row level security/i);
  assert.match(combined, /create policy care_wedo_storage_objects_read_care_documents[\s\S]*on storage\.objects[\s\S]*for select[\s\S]*to authenticated[\s\S]*care_wedo_can_access_storage_object\(bucket_id, name\)/i);
});

test("protected Care WEDO tables do not grant direct writes to anon or authenticated roles", () => {
  const migration = readProjectFile("supabase/migration_phase59_rls_read_policies.sql");
  const schema = readProjectFile("supabase/schema.sql");
  const combined = `${schema}\n${migration}`;
  const protectedTables = [
    "users",
    "user_feature_flags",
    "family_groups",
    "care_profiles",
    "user_family_groups",
    "appointments",
    "medications",
    "medication_logs",
    "care_documents",
    "usage_quotas",
    "billing_subscriptions",
    "billing_events",
    "invoices",
    "line_push_logs",
  ].join("|");

  const directWriteGrant = new RegExp(
    `grant\\s+[^;\\n]*(insert|update|delete)[^;\\n]*on\\s+public\\.(${protectedTables})\\s+to\\s+(anon|authenticated)`,
    "i",
  );

  assert.doesNotMatch(combined, directWriteGrant);
  assert.doesNotMatch(combined, /grant\s+[^;\n]*(insert|update|delete)[^;\n]*on\s+storage\.objects\s+to\s+(anon|authenticated)/i);
  assert.match(combined, /revoke insert, update, delete on public\.appointments from anon, authenticated/i);
  assert.match(combined, /revoke insert, update, delete on public\.medication_logs from anon, authenticated/i);
  assert.match(combined, /revoke insert, update, delete on public\.care_documents from anon, authenticated/i);
  assert.match(combined, /revoke insert, update, delete on storage\.objects from anon, authenticated/i);
});

test("care document storage policy smoke uses authenticated user access without logging secrets", () => {
  const script = readProjectFile("scripts/storage-policy-smoke.mjs");
  const packageJson = readProjectFile("package.json");

  assert.match(script, /CARE_WEDO_STORAGE_ACCESS_TOKEN/);
  assert.match(script, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(script, /SUPABASE_ANON_KEY/);
  assert.match(script, /CARE_WEDO_STORAGE_OWNED_PATH/);
  assert.match(script, /CARE_WEDO_STORAGE_FOREIGN_PATH/);
  assert.match(script, /\/storage\/v1\/object/);
  assert.match(script, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(script, /apikey:\s*publishableKey/);
  assert.match(script, /foreign_object_denied/);
  assert.match(script, /missing_env/);
  assert.doesNotMatch(script, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(script, /console\.(log|error)\([^)]*(accessToken|token|ownedPath|foreignPath)/i);

  assert.match(packageJson, /storage:policy:smoke/);
  assert.match(packageJson, /storage:policy:smoke:dry/);
});
