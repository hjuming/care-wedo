import { test } from "node:test";
import assert from "node:assert/strict";

import { getRequestUser } from "../_shared/auth_context";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LINE_LOGIN_CHANNEL_ID: "1234567890",
} as any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function withMockedFetch(run: (state: { verifyCalls: number; userLookups: number }) => Promise<void>) {
  const original = globalThis.fetch;
  const state = { verifyCalls: 0, userLookups: 0 };
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("api.line.me/oauth2/v2.1/verify")) {
      state.verifyCalls += 1;
      return json({ sub: "Uverified", name: "Verified User" });
    }
    if (url.includes("/rest/v1/users?line_user_id=")) {
      state.userLookups += 1;
      return json([{ id: 123, name: "Care User", picture_url: null }]);
    }
    if (url.includes("/rest/v1/users?id=eq.123")) {
      return json([{ id: 123 }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return run(state).finally(() => {
    globalThis.fetch = original;
  });
}

test("getRequestUser reuses middleware identity and caches the request user", async () => {
  await withMockedFetch(async (state) => {
    const context = {
      request: new Request("https://care.example/api/me", {
        headers: { Authorization: "Bearer already-verified-line-token" },
      }),
      env: ENV,
      data: {
        identity: {
          provider: "line",
          lineUserId: "Umiddleware",
          name: "Middleware User",
        },
      },
    } as any;

    const first = await getRequestUser(context);
    const second = await getRequestUser(context);

    assert.equal(first.userId, 123);
    assert.equal(second, first, "second call should reuse cached request user");
    assert.equal(state.verifyCalls, 0, "handler must not verify token again after middleware");
    assert.equal(state.userLookups, 1, "user lookup should be cached on the same context");
  });
});

test("getRequestUser falls back to token verification when middleware data is absent", async () => {
  await withMockedFetch(async (state) => {
    const context = {
      request: new Request("https://care.example/api/me", {
        headers: { Authorization: "Bearer line-token" },
      }),
      env: ENV,
    } as any;

    const user = await getRequestUser(context);

    assert.equal(user.userId, 123);
    assert.equal(user.identity.provider, "line");
    assert.equal(state.verifyCalls, 1);
    assert.equal(state.userLookups, 1);
  });
});
