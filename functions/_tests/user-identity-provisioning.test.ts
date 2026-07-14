import { test } from "node:test";
import assert from "node:assert/strict";

import { ensureGroupDefaultProfile, getOrCreateUserFromIdentity } from "../_shared/supabase";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
} as any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test("Google identity provisioning recovers when another request wins the unique insert race", async () => {
  const originalFetch = globalThis.fetch;
  let lookupCount = 0;
  let insertCount = 0;

  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/rest/v1/users?auth_user_id=eq.")) {
      lookupCount += 1;
      return lookupCount === 1 ? json([]) : json([{ id: 42 }]);
    }
    if (url.includes("/rest/v1/users?select=id")) {
      insertCount += 1;
      return json({ code: "23505", message: "duplicate key value violates unique constraint users_auth_user_id_unique" }, 409);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const userId = await getOrCreateUserFromIdentity(ENV, {
      provider: "supabase",
      authUserId: "c8722b8b-841f-4982-879f-cdceae4adfe7",
      authProvider: "google",
      email: "reviewer@example.test",
      name: "Reviewer",
      pictureUrl: "https://example.test/reviewer.png",
    });

    assert.equal(userId, 42);
    assert.equal(insertCount, 1);
    assert.equal(lookupCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy default care profile adopts the owner's identity name and avatar", async () => {
  const originalFetch = globalThis.fetch;
  let patchBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/rest/v1/care_profiles?group_id=eq.7")) {
      return json([{
        id: 77,
        group_id: 7,
        primary_user_id: 15,
        display_name: "親愛的家人",
        avatar_url: null,
        relationship: "family",
        is_default: true,
      }]);
    }
    if (url.includes("/rest/v1/users?id=eq.15")) {
      return json([{ name: "鮪魚肚WEDO", picture_url: "https://example.test/avatar.png" }]);
    }
    if (url.includes("/rest/v1/care_profiles?id=eq.77")) {
      patchBody = JSON.parse(String(init?.body || "{}"));
      return json([{ id: 77, group_id: 7, primary_user_id: 15, ...patchBody, is_default: true }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const profile = await ensureGroupDefaultProfile(ENV, 7, 15);
    assert.equal(profile.display_name, "鮪魚肚WEDO");
    assert.equal(profile.avatar_url, "https://example.test/avatar.png");
    assert.deepEqual(patchBody, {
      display_name: "鮪魚肚WEDO",
      avatar_url: "https://example.test/avatar.png",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
