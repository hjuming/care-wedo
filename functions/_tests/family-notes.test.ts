import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as updateGroups } from "../api/groups";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LINE_LOGIN_CHANNEL_ID: "1234567890",
} as any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function request(body: Record<string, unknown>): Request {
  return new Request("https://care.example/api/groups", {
    method: "POST",
    headers: {
      Authorization: "Bearer line-id-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function withFetch(handler: (url: string, init?: RequestInit) => Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

function identityRoutes(url: string): Response | null {
  if (url.includes("api.line.me/oauth2/v2.1/verify")) return json({ sub: "Uprimary", name: "主要照護者・測試" });
  if (url.includes("/rest/v1/users?line_user_id=")) return json([{ id: 1, name: "主要照護者・測試" }]);
  if (url.includes("/rest/v1/user_family_groups?user_id=eq.1")) {
    return json([{ user_id: 1, group_id: 100, role: "admin", can_manage: true }]);
  }
  return null;
}

test("family notes writes first, archives old rows, and proves read-back", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  await withFetch((url, init) => {
    const base = identityRoutes(url);
    if (base) return base;
    const method = init?.method || "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.includes("appointments?group_id=eq.100") && url.includes("select=id")) return json([{ id: 10 }]);
    if (method === "POST" && url.endsWith("/rest/v1/appointments?select=id,reminder_text")) {
      return json([{ id: 11, reminder_text: "回診前帶健保卡" }, { id: 12, reminder_text: "記得帶藥單" }]);
    }
    if (method === "PATCH" && url.includes("appointments?id=in.(10)")) return json([]);
    if (url.includes("appointments?group_id=eq.100") && url.includes("select=reminder_text")) {
      return json([{ reminder_text: "回診前帶健保卡" }, { reminder_text: "記得帶藥單" }]);
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }, async () => {
    const response = await updateGroups({ request: request({ action: "update_family_notes", group_id: 100, notes: ["回診前帶健保卡", "記得帶藥單"] }), env: ENV, params: {} } as any);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.notes, ["回診前帶健保卡", "記得帶藥單"]);
    assert.equal(body.success, true);
    const insertIndex = calls.findIndex((call) => call.method === "POST");
    const archiveIndex = calls.findIndex((call) => call.method === "PATCH" && call.url.includes("id=in.(10)"));
    assert.ok(insertIndex >= 0);
    assert.ok(archiveIndex > insertIndex, "old notes must be archived after new rows are written");
  });
});

test("family notes insert failure never archives the existing reminder", async () => {
  let archiveAttempted = false;
  await withFetch((url, init) => {
    const base = identityRoutes(url);
    if (base) return base;
    if (url.includes("appointments?group_id=eq.100") && url.includes("select=id")) return json([{ id: 10 }]);
    if (init?.method === "POST" && url.includes("/rest/v1/appointments")) return json({ message: "insert failed" }, 500);
    if (init?.method === "PATCH") {
      archiveAttempted = true;
      return json([]);
    }
    throw new Error(`unexpected fetch: ${init?.method || "GET"} ${url}`);
  }, async () => {
    const response = await updateGroups({ request: request({ action: "update_family_notes", group_id: 100, notes: ["新的提醒"] }), env: ENV, params: {} } as any);
    assert.equal(response.status, 500);
    assert.equal(archiveAttempted, false);
  });
});

test("family notes read-back mismatch rolls back the newly inserted rows", async () => {
  const patches: string[] = [];
  await withFetch((url, init) => {
    const base = identityRoutes(url);
    if (base) return base;
    if (url.includes("appointments?group_id=eq.100") && url.includes("select=id")) return json([{ id: 10 }]);
    if (init?.method === "POST" && url.includes("/rest/v1/appointments")) return json([{ id: 11, reminder_text: "新提醒" }]);
    if (init?.method === "PATCH") {
      patches.push(url);
      return json([]);
    }
    if (url.includes("appointments?group_id=eq.100") && url.includes("select=reminder_text")) return json([]);
    throw new Error(`unexpected fetch: ${init?.method || "GET"} ${url}`);
  }, async () => {
    const response = await updateGroups({ request: request({ action: "update_family_notes", group_id: 100, notes: ["新提醒"] }), env: ENV, params: {} } as any);
    assert.equal(response.status, 500);
    assert.ok(patches.some((url) => url.includes("id=in.(10)")), "old notes are archived after insert");
    assert.ok(patches.some((url) => url.includes("id=in.(11)")), "mismatched insert is rolled back");
  });
});

test("family notes reject non-numeric group IDs before membership or writes", async () => {
  let restCalls = 0;
  await withFetch((url) => {
    const base = identityRoutes(url);
    if (base) return base;
    restCalls += 1;
    return json([]);
  }, async () => {
    const response = await updateGroups({ request: request({ action: "update_family_notes", group_id: "100 OR 1=1", notes: ["不可寫入"] }), env: ENV, params: {} } as any);
    assert.equal(response.status, 400);
    assert.equal(restCalls, 0);
  });
});
