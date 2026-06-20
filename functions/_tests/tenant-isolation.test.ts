import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPatch } from "../api/medications/[id]";

/**
 * Behavioral tenant-isolation regression (drives the REAL handler).
 *
 * Unlike source-grep regressions, this test invokes onRequestPatch end to end
 * with a mocked network layer (LINE verify + Supabase REST). It proves that:
 *   1. A user can only PATCH a medication their own user_id / group owns (200).
 *   2. A medication belonging to another tenant's group is rejected (403),
 *      because patchMedication's ownership filter returns no rows.
 *
 * If a future change drops the ownership filter or the unified auth path, the
 * cross-tenant case would start returning 200 and this test fails.
 */

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LINE_LOGIN_CHANNEL_ID: "1234567890",
} as any;

const ATTACKER_LINE_ID = "Uattacker";
const ATTACKER_USER_ID = 1;
const ATTACKER_GROUP_ID = 100; // the only group the attacker belongs to

type FetchHandler = (url: string, init: RequestInit | undefined) => Response;

function withMockedFetch(handler: FetchHandler, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    return handler(url, init);
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Shared mock: LINE verify + user lookup + memberships are always the attacker. */
function baseRoutes(url: string): Response | null {
  if (url.includes("api.line.me/oauth2/v2.1/verify")) {
    return json({ sub: ATTACKER_LINE_ID, name: "Attacker" });
  }
  if (url.includes("/rest/v1/users?line_user_id=")) {
    return json([{ id: ATTACKER_USER_ID, name: "Attacker", picture_url: null }]);
  }
  if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${ATTACKER_USER_ID}`)) {
    return json([{ id: 10, user_id: ATTACKER_USER_ID, group_id: ATTACKER_GROUP_ID, role: "owner" }]);
  }
  return null;
}

function makeRequest(id: number): Request {
  return new Request(`https://care.example/api/medications/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer line-attacker-id-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ active: false }),
  });
}

test("rejects PATCH on a medication owned by another tenant's group (403)", async () => {
  const VICTIM_MED_ID = 999; // belongs to group 200, which attacker is NOT in
  let patchAttempted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    // Ownership check: PostgREST or-filter is scoped to the attacker's
    // user_id / group_ids, so a victim-owned row matches nothing.
    if (url.includes(`/rest/v1/medications?id=eq.${VICTIM_MED_ID}`) && url.includes("or=(")) {
      return json([]); // not owned -> patchMedication throws -> 403
    }
    // Any actual PATCH write must never be reached for a foreign record.
    if (url.includes(`/rest/v1/medications?id=eq.${VICTIM_MED_ID}`) && init?.method === "PATCH") {
      patchAttempted = true;
      return json([{ id: VICTIM_MED_ID }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await onRequestPatch({
      request: makeRequest(VICTIM_MED_ID),
      env: ENV,
      params: { id: String(VICTIM_MED_ID) },
    } as any);

    assert.equal(res.status, 403, "cross-tenant PATCH must be forbidden");
    assert.equal(patchAttempted, false, "must not issue a write for a foreign record");
  });
});

test("allows PATCH on a medication the user's group owns (200)", async () => {
  const OWNED_MED_ID = 888; // belongs to attacker's own group 100
  let patched = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/medications?id=eq.${OWNED_MED_ID}`) && url.includes("or=(")) {
      return json([{ id: OWNED_MED_ID }]); // owned
    }
    if (url.includes(`/rest/v1/medications?id=eq.${OWNED_MED_ID}`) && init?.method === "PATCH") {
      patched = true;
      return json([{ id: OWNED_MED_ID, user_id: ATTACKER_USER_ID, group_id: ATTACKER_GROUP_ID, active: false }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await onRequestPatch({
      request: makeRequest(OWNED_MED_ID),
      env: ENV,
      params: { id: String(OWNED_MED_ID) },
    } as any);

    assert.equal(res.status, 200, "owner PATCH must succeed");
    assert.equal(patched, true, "owner PATCH must reach the write");
  });
});
