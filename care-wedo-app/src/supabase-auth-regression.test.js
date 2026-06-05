import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  const middleware = readProjectFile("functions/api/_middleware.ts");
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  const me = readProjectFile("functions/api/me.ts");
  const groups = readProjectFile("functions/api/groups.ts");

  assert.match(shared, /type VerifiedCareIdentity/);
  assert.match(shared, /verifySupabaseAccessToken/);
  assert.match(shared, /\/auth\/v1\/user/);
  assert.match(shared, /verifyCareIdentity/);
  assert.match(shared, /getOrCreateUserFromIdentity/);
  assert.match(shared, /auth_user_id:\s*identity\.authUserId/);
  assert.match(shared, /auth_provider:\s*identity\.authProvider/);

  assert.match(middleware, /verifyCareIdentity/);
  assert.doesNotMatch(middleware, /verifyLineIdToken\(env,\s*token\)/);

  for (const source of [dashboard, me, groups]) {
    assert.match(source, /getAuthenticatedUser/);
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
