import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeJwtPayload, resolveSupabaseAuthProvider } from "./services/supabaseAuth.js";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("Supabase Auth identity columns are added without replacing LINE identity", () => {
  const migration = readProjectFile("supabase/migration_phase58_supabase_auth_identity.sql");
  const schema = readProjectFile("supabase/schema.sql");

  for (const source of [migration, schema]) {
    assert.match(source, /auth_user_id uuid/);
    assert.match(source, /auth_provider text/);
    assert.match(source, /users_auth_user_id_unique/);
    assert.match(source, /where auth_user_id is not null/);
  }

  assert.match(schema, /line_user_id text unique/);
  assert.doesNotMatch(migration, /drop column.*line_user_id/i);
});

test("Backend verifies LINE or Supabase identities through a single fail-closed helper", () => {
  const shared = readProjectFile("functions/_shared/supabase.ts");
  const authIdentity = readProjectFile("functions/_shared/auth_identity.ts");
  const middleware = readProjectFile("functions/api/_middleware.ts");
  const authContext = readProjectFile("functions/_shared/auth_context.ts");
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  const me = readProjectFile("functions/api/me.ts");
  const groups = readProjectFile("functions/api/groups.ts");

  assert.match(authIdentity, /type VerifiedCareIdentity/);
  assert.match(authIdentity, /verifySupabaseAccessToken/);
  assert.match(authIdentity, /\/auth\/v1\/user/);
  assert.match(authIdentity, /verifyCareIdentity/);
  assert.match(shared, /from "\.\/auth_identity"/);
  assert.match(shared, /verifySupabaseAccessToken/);
  assert.match(shared, /getOrCreateUserFromIdentity/);
  assert.match(shared, /auth_user_id:\s*identity\.authUserId/);
  assert.match(shared, /auth_provider:\s*identity\.authProvider/);

  assert.match(middleware, /verifyCareIdentity/);
  assert.doesNotMatch(middleware, /verifyLineIdToken\(env,\s*token\)/);
  assert.match(authContext, /getRequestUser/);
  assert.match(authContext, /context\.data\?\.identity/);
  assert.match(authContext, /verifyCareIdentity/);
  assert.match(authContext, /getOrCreateUserFromIdentity/);

  for (const source of [dashboard, me, groups]) {
    assert.match(source, /getRequestUser/);
    assert.doesNotMatch(source, /getOrCreateDefaultUser\(env,\s*identity\.lineUserId/);
  }
});

test("Frontend exposes Google OAuth login and callback without storing service-role secrets", () => {
  const auth = readProjectFile("care-wedo-app/src/services/supabaseAuth.js");
  const api = readProjectFile("care-wedo-app/src/services/api.js");
  const liff = readProjectFile("care-wedo-app/src/services/liff.js");
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const routing = readProjectFile("care-wedo-app/src/routing.js");
  const envExample = readProjectFile("care-wedo-app/.env.example");

  assert.match(auth, /VITE_SUPABASE_URL/);
  assert.match(auth, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(auth, /\/auth\/v1\/authorize/);
  assert.match(auth, /provider=google/);
  assert.match(auth, /completeSupabaseOAuthCallback/);
  assert.match(auth, /care_wedo_supabase_access_token/);
  assert.doesNotMatch(auth, /SERVICE_ROLE|service_role|SUPABASE_SERVICE_ROLE_KEY/);

  assert.match(api, /identity\.accessToken \|\| identity\.idToken/);
  assert.match(liff, /getStoredSupabaseIdentity/);
  assert.match(liff, /clearSupabaseAuthSession/);
  assert.match(app, /GoogleLoginAction/);
  assert.match(app, /AuthCallbackPage/);
  assert.match(app, /loginWithGoogle/);
  assert.match(routing, /normalized === "\/auth\/callback"/);
  assert.match(envExample, /VITE_SUPABASE_URL=/);
  assert.match(envExample, /VITE_SUPABASE_PUBLISHABLE_KEY=/);
});

test("Production build workflow injects both Supabase public auth values", () => {
  const workflow = readProjectFile(".github/workflows/deploy.yml");

  assert.match(workflow, /VITE_SUPABASE_URL:\s*\$\{\{[^\n]*\.VITE_SUPABASE_URL[^\n]*\}\}/);
  assert.match(workflow, /VITE_SUPABASE_PUBLISHABLE_KEY:\s*\$\{\{[^\n]*\.VITE_SUPABASE_PUBLISHABLE_KEY[^\n]*\}\}/);
  assert.match(workflow, /Validate frontend public auth config/);
});

test("Supabase JWT payload decodes UTF-8 display names without mojibake", () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ user_metadata: { full_name: "林怡君" } }));
  const base64 = globalThis.btoa(String.fromCharCode(...bytes));
  const payload = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const token = `header.${payload}.signature`;

  assert.deepEqual(decodeJwtPayload(token), { user_metadata: { full_name: "林怡君" } });
});

test("Supabase Auth provider label distinguishes email test accounts from Google", () => {
  assert.equal(resolveSupabaseAuthProvider({ app_metadata: { provider: "email" } }), "email");
  assert.equal(resolveSupabaseAuthProvider({ app_metadata: { provider: "google" } }), "google");
  assert.equal(resolveSupabaseAuthProvider({}), "supabase");
});

test("Google protected write staging smoke covers the three P0 write paths without logging tokens", () => {
  const script = readProjectFile("scripts/google-protected-write-smoke.mjs");
  const runbook = readProjectFile("GOOGLE_PROTECTED_WRITE_SMOKE_RUNBOOK.md");
  const packageJson = readProjectFile("package.json");

  assert.match(script, /CARE_WEDO_STAGING_BASE_URL/);
  assert.match(script, /CARE_WEDO_GOOGLE_ACCESS_TOKEN/);
  assert.match(script, /CARE_WEDO_SMOKE_PROFILE_ID/);
  assert.match(script, /CARE_WEDO_SMOKE_GROUP_ID/);
  assert.match(script, /CARE_WEDO_SMOKE_EXPECTED_USER_ID/);
  assert.match(script, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(script, /\/ocr\//);
  assert.match(script, /\/ocr\/confirm/);
  assert.match(script, /\/appointments/);
  assert.match(script, /\/medications\/taken/);
  assert.match(script, /db_appointment_scope/);
  assert.match(script, /db_medication_log_scope/);
  assert.match(script, /missing_env/);
  assert.doesNotMatch(script, /console\.(log|error)\([^)]*token/i);

  assert.match(runbook, /google:protected-write:smoke/);
  assert.match(runbook, /google:protected-write:smoke:dry/);
  assert.match(packageJson, /google:protected-write:smoke/);
});

test("staging smoke readiness gate aggregates Google and Storage prerequisites without logging secrets", () => {
  const script = readProjectFile("scripts/staging-smoke-readiness.mjs");
  const packageJson = readProjectFile("package.json");

  assert.match(script, /google_protected_write_smoke/);
  assert.match(script, /storage_policy_smoke/);
  assert.match(script, /CARE_WEDO_STAGING_BASE_URL/);
  assert.match(script, /CARE_WEDO_GOOGLE_ACCESS_TOKEN/);
  assert.match(script, /CARE_WEDO_SMOKE_PROFILE_ID/);
  assert.match(script, /CARE_WEDO_SMOKE_GROUP_ID/);
  assert.match(script, /CARE_WEDO_SMOKE_EXPECTED_USER_ID/);
  assert.match(script, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(script, /CARE_WEDO_STORAGE_ACCESS_TOKEN/);
  assert.match(script, /CARE_WEDO_STORAGE_OWNED_PATH/);
  assert.match(script, /CARE_WEDO_STORAGE_FOREIGN_PATH/);
  assert.match(script, /process\.exit\(1\)/);
  assert.match(script, /report_only/);
  assert.doesNotMatch(script, /console\.(log|error)\([^)]*(token|accessToken|serviceRole|ownedPath|foreignPath)/i);

  assert.match(packageJson, /staging:smoke:ready/);
  assert.match(packageJson, /staging:smoke:ready:report/);
});
