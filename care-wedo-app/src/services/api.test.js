import test from "node:test";
import assert from "node:assert/strict";
import { buildAppointmentCalendarRequest, buildDashboardRequest, buildGoogleCalendarEventUrl, buildLocalAppointmentCalendarFile, buildSessionHandoffRequest, buildSessionRequest, isAuthFailureMessage, markMedicationSlotStatus, updateActiveProfilePreference, updateFamilyNotes } from "./api.js";

test("buildDashboardRequest returns the dashboard endpoint without identity data in demo mode", () => {
  assert.deepEqual(buildDashboardRequest("/api"), {
    url: "/api/dashboard",
    init: {},
  });
});

test("buildDashboardRequest sends a LIFF id token in the Authorization header", () => {
  assert.deepEqual(buildDashboardRequest("/api", { idToken: "token.123" }), {
    url: "/api/dashboard",
    init: {
      headers: {
        Authorization: "Bearer token.123",
      },
    },
  });
});

test("buildDashboardRequest can scope dashboard data to one care profile", () => {
  assert.deepEqual(buildDashboardRequest("/api", { idToken: "token.123", profileId: 42 }), {
    url: "/api/dashboard?profile_id=42",
    init: {
      headers: {
        Authorization: "Bearer token.123",
      },
    },
  });
});

test("buildDashboardRequest can scope dashboard data to one family group", () => {
  assert.deepEqual(buildDashboardRequest("/api", { idToken: "token.123", profileId: 42, groupId: 7 }), {
    url: "/api/dashboard?profile_id=42&group_id=7",
    init: {
      headers: {
        Authorization: "Bearer token.123",
      },
    },
  });
});

test("buildAppointmentCalendarRequest targets an authenticated ICS download", () => {
  assert.deepEqual(buildAppointmentCalendarRequest("/api", 42, { idToken: "token.123" }), {
    url: "/api/appointments/42/calendar.ics",
    init: {
      headers: {
        Authorization: "Bearer token.123",
      },
    },
  });
});

test("buildSessionRequest creates same-origin session requests", () => {
  assert.deepEqual(buildSessionRequest("/api", "GET"), {
    url: "/api/session",
    init: {
      method: "GET",
      credentials: "same-origin",
    },
  });
  assert.deepEqual(buildSessionRequest("/api", "POST", { idToken: "token.123" }), {
    url: "/api/session",
    init: {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Authorization: "Bearer token.123",
      },
    },
  });
});

test("buildSessionHandoffRequest creates same-origin browser handoff requests", () => {
  assert.deepEqual(buildSessionHandoffRequest("/api", "handoff-token-123"), {
    url: "/api/session/handoff",
    init: {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Authorization: "Bearer handoff-token-123",
      },
    },
  });
});

test("buildLocalAppointmentCalendarFile creates an ICS file from visible appointment data", () => {
  const ics = buildLocalAppointmentCalendarFile({
    id: "demo-1",
    date: "2026-05-29",
    time: "09:30",
    title: "復健門診",
    hospital: "牛牛優動-板橋分院",
    doctor: "林煌院長",
    location: "新北市板橋區文化路一段142號",
    notes: "記得帶健保卡。",
  }, { profileName: "示範長輩" });

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:care-wedo-appointment-demo-1@care.wedopr.com/);
  assert.match(ics, /SUMMARY:Care WEDO：示範長輩 復健門診/);
  assert.match(ics, /DTSTART:20260529T013000Z/);
  assert.match(ics, /LOCATION:新北市板橋區文化路一段142號/);
});

test("buildGoogleCalendarEventUrl creates a prefilled Google Calendar link", () => {
  const url = new URL(buildGoogleCalendarEventUrl({
    id: "demo-1",
    date: "2026-05-29",
    time: "09:30",
    title: "復健門診",
    hospital: "牛牛優動-板橋分院",
    location: "新北市板橋區文化路一段142號",
    notes: "記得帶健保卡。",
  }, { profileName: "示範長輩" }));

  assert.equal(url.origin, "https://calendar.google.com");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Care WEDO：示範長輩 復健門診");
  assert.equal(url.searchParams.get("dates"), "20260529T013000Z/20260529T023000Z");
  assert.equal(url.searchParams.get("location"), "新北市板橋區文化路一段142號");
});

test("isAuthFailureMessage detects stale login and token failures", () => {
  assert.equal(isAuthFailureMessage("LINE token verify failed."), true);
  assert.equal(isAuthFailureMessage("idToken expired"), true);
  assert.equal(isAuthFailureMessage("請先登入"), true);
  assert.equal(isAuthFailureMessage("Supabase request failed"), false);
});

test("family reminder save aborts a hanging request with an actionable timeout", async () => {
  await assert.rejects(
    updateFamilyNotes({
      groupId: 7,
      notes: ["回診前帶健保卡"],
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    }),
    /家庭提醒儲存逾時/,
  );
});

test("family reminder save returns server read-back metadata", async () => {
  const result = await updateFamilyNotes({
    groupId: 7,
    notes: ["回診前帶健保卡"],
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      notes: ["回診前帶健保卡"],
      saved_at: "2026-07-14T00:00:00.000Z",
      saved_by_user_id: 12,
    }), { status: 200 }),
  });

  assert.deepEqual(result.notes, ["回診前帶健保卡"]);
  assert.equal(result.saved_by_user_id, 12);
});

test("medication status save aborts a hanging request with an actionable timeout", async () => {
  await assert.rejects(
    markMedicationSlotStatus({
      medicationIds: [11],
      status: "taken",
      timeSlot: "morning",
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    }),
    /用藥紀錄儲存逾時/,
  );
});

test("medication status save forwards the retry-stable idempotency key", async () => {
  let requestInit;
  await markMedicationSlotStatus({
    medicationIds: [11],
    status: "taken",
    timeSlot: "morning",
    idempotencyKey: "medication-operation-123",
    fetchImpl: async (_url, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  });

  assert.equal(requestInit.headers["Idempotency-Key"], "medication-operation-123");
});

test("active profile preference hides an untrusted plain-text upstream error without reading the response twice", async () => {
  await assert.rejects(
    updateActiveProfilePreference(81, {
      idToken: "token.123",
      fetchImpl: async () => new Response("上游服務暫時無法使用", { status: 502 }),
    }),
    (error) => {
      assert.equal(error.message, "無法更新目前照護對象");
      assert.doesNotMatch(error.message, /上游服務/);
      assert.equal(error.status, 502);
      return true;
    },
  );
});
