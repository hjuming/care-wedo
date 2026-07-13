import test from "node:test";
import assert from "node:assert/strict";

import { isSafeReviewLoginEnabled } from "./services/safeReviewLogin.js";
import { signInWithSupabasePassword } from "./services/supabaseAuth.js";

test("review login requires the explicit flag and exact staging host", () => {
  assert.equal(isSafeReviewLoginEnabled({ flag: "1", configuredHost: "review.care.example", hostname: "review.care.example" }), true);
  assert.equal(isSafeReviewLoginEnabled({ flag: "", configuredHost: "review.care.example", hostname: "review.care.example" }), false);
  assert.equal(isSafeReviewLoginEnabled({ flag: "1", configuredHost: "review.care.example", hostname: "care.example" }), false);
  assert.equal(isSafeReviewLoginEnabled({ flag: "1", configuredHost: "care.wedopr.com", hostname: "care.wedopr.com" }), false);
});

test("password login uses Supabase token endpoint and stores the returned session", async () => {
  const calls = [];
  const stored = [];
  const identity = await signInWithSupabasePassword({
    email: "reviewer@example.test",
    password: "not-a-real-secret",
    supabaseUrl: "https://project.supabase.co/",
    publishableKey: "public-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }) };
    },
    storeSession: (session) => { stored.push(session); return { status: "authenticated" }; },
  });

  assert.equal(identity.status, "authenticated");
  assert.equal(calls[0].url, "https://project.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(calls[0].options.headers.apikey, "public-key");
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: "reviewer@example.test", password: "not-a-real-secret" });
  assert.deepEqual(stored, [{ accessToken: "access", refreshToken: "refresh", expiresIn: 3600 }]);
});
