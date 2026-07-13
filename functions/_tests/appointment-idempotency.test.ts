import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as createAppointment } from "../api/appointments";

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LINE_LOGIN_CHANNEL_ID: "1234567890",
} as any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function request(body: Record<string, unknown>, idempotencyKey?: string): Request {
  const headers = new Headers({
    Authorization: "Bearer line-token",
    "Content-Type": "application/json",
  });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return new Request("https://care.example/api/appointments", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("idempotency keys deduplicate retries, reject conflicting payloads, and preserve legal variations", async () => {
  const inserted: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("api.line.me/oauth2/v2.1/verify")) return json({ sub: "Umanager", name: "照護者" });
    if (url.includes("/rest/v1/users?line_user_id=")) return json([{ id: 1, name: "照護者", picture_url: null }]);
    if (url.includes("/rest/v1/user_family_groups?user_id=eq.1")) {
      return json([{ user_id: 1, group_id: 100, role: "member", can_manage: true, can_pay: false }]);
    }
    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) {
      return json([{ id: 501, group_id: 100, display_name: "林清河伯伯", is_default: true, created_at: "2026-07-14T00:00:00Z" }]);
    }
    if (url.includes("/rest/v1/user_feature_flags?user_id=eq.1&feature_key=like.profile_order:")) return json([]);
    if (url.includes("/rest/v1/appointments") && init?.method === "POST") {
      const payload = JSON.parse(String(init.body || "{}"));
      const row = {
        id: inserted.length + 1,
        ...payload,
        created_at: "2026-07-14T00:00:00Z",
      };
      inserted.push(row);
      return json([row]);
    }
    if (url.includes("/rest/v1/appointments") && (!init?.method || init.method === "GET")) {
      if (url.includes("idempotency_key=eq.")) {
        const key = decodeURIComponent(url.split("idempotency_key=eq.")[1].split("&")[0]);
        return json(inserted.filter((row) => row.idempotency_key === key));
      }
      return json(inserted.filter((row) => row.date === "2026-08-18"));
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const baseBody = {
    profile_id: 501,
    type: "clinic_visit",
    date: "2026-08-18",
    time: "09:30",
    title: "神經內科回診",
    department: "神經內科",
    hospital: "測試醫院",
  };

  try {
    const first = await createAppointment({ request: request(baseBody, "appointment-test-1"), env: ENV } as any);
    const duplicate = await createAppointment({ request: request(baseBody, "appointment-test-1"), env: ENV } as any);
    const conflictingKey = await createAppointment({
      request: request({ ...baseBody, time: "10:30" }, "appointment-test-1"),
      env: ENV,
    } as any);
    const sameContentDifferentKey = await createAppointment({
      request: request(baseBody, "appointment-test-2"),
      env: ENV,
    } as any);
    const differentTime = await createAppointment({
      request: request({ ...baseBody, time: "10:30" }, "appointment-test-2"),
      env: ENV,
    } as any);

    assert.equal(first.status, 200);
    assert.equal(duplicate.status, 200);
    assert.equal(conflictingKey.status, 409);
    assert.equal(sameContentDifferentKey.status, 200);
    assert.equal(differentTime.status, 200);
    assert.equal(inserted.length, 2, "same request must not insert a second row");
    assert.equal((await duplicate.json() as any).deduplicated, true);
    assert.match((await conflictingKey.json() as any).error, /Idempotency-Key/);
    assert.equal((await sameContentDifferentKey.json() as any).deduplicated, true);
    assert.equal((await differentTime.json() as any).appointment.time, "10:30");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an idempotency key outside the bounded allowlist", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("api.line.me/oauth2/v2.1/verify")) return json({ sub: "Umanager", name: "照護者" });
    if (url.includes("/rest/v1/users?line_user_id=")) return json([{ id: 1, name: "照護者", picture_url: null }]);
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await createAppointment({
      request: request({ profile_id: 501, date: "2026-08-18", title: "測試" }, "invalid key with spaces"),
      env: ENV,
    } as any);
    assert.equal(response.status, 400);
    assert.match((await response.json() as any).error, /Idempotency-Key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to fingerprint dedupe when the legacy appointments schema lacks idempotency_key", async () => {
  let insertPayload: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("api.line.me/oauth2/v2.1/verify")) return json({ sub: "Umanager", name: "照護者" });
    if (url.includes("/rest/v1/users?line_user_id=")) return json([{ id: 1, name: "照護者", picture_url: null }]);
    if (url.includes("/rest/v1/user_family_groups?user_id=eq.1")) return json([{ user_id: 1, group_id: 100, role: "admin", can_manage: true }]);
    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) return json([{ id: 501, group_id: 100, display_name: "林清河伯伯", created_at: "2026-07-14T00:00:00Z" }]);
    if (url.includes("/rest/v1/user_feature_flags?user_id=eq.1&feature_key=like.profile_order:")) return json([]);
    if (url.includes("idempotency_key=eq.")) return json({ code: "PGRST204", message: "column appointments.idempotency_key does not exist" }, 400);
    if (url.includes("/rest/v1/appointments") && (!init?.method || init.method === "GET")) return json([]);
    if (url.includes("/rest/v1/appointments?select=*") && init?.method === "POST") {
      insertPayload = JSON.parse(String(init.body || "{}"));
      return json([{ id: 10, ...insertPayload, created_at: "2026-07-14T00:00:00Z" }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await createAppointment({
      request: request({ profile_id: 501, type: "clinic_visit", date: "2026-08-18", title: "測試回診" }, "legacy-key"),
      env: ENV,
    } as any);
    assert.equal(response.status, 200);
    assert.equal((insertPayload as Record<string, unknown> | null)?.["idempotency_key"], undefined, "legacy fallback must not send an unknown column");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refuses to create an appointment when the duplicate check is unavailable", async () => {
  let insertAttempted = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("api.line.me/oauth2/v2.1/verify")) return json({ sub: "Umanager", name: "照護者" });
    if (url.includes("/rest/v1/users?line_user_id=")) return json([{ id: 1, name: "照護者" }]);
    if (url.includes("/rest/v1/user_family_groups?user_id=eq.1")) return json([{ user_id: 1, group_id: 100, role: "admin", can_manage: true }]);
    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) return json([{ id: 501, group_id: 100, display_name: "測試長輩" }]);
    if (url.includes("/rest/v1/user_feature_flags?user_id=eq.1&feature_key=like.profile_order:")) return json([]);
    if (url.includes("/rest/v1/appointments") && init?.method === "POST") {
      insertAttempted = true;
      return json([{ id: 1 }]);
    }
    if (url.includes("/rest/v1/appointments") && (!init?.method || init.method === "GET")) {
      return json({ message: "temporary database outage" }, 503);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await createAppointment({
      request: request({ profile_id: 501, type: "clinic_visit", date: "2026-08-18", title: "測試回診" }),
      env: ENV,
    } as any);
    assert.equal(response.status, 503);
    assert.match((await response.json() as any).error, /去重檢查/);
    assert.equal(insertAttempted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
