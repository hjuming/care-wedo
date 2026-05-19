import test from "node:test";
import assert from "node:assert/strict";
import { buildAppointmentCalendarRequest, buildDashboardRequest, buildLocalAppointmentCalendarFile, isAuthFailureMessage } from "./api.js";

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

test("isAuthFailureMessage detects stale login and token failures", () => {
  assert.equal(isAuthFailureMessage("LINE token verify failed."), true);
  assert.equal(isAuthFailureMessage("idToken expired"), true);
  assert.equal(isAuthFailureMessage("請先登入"), true);
  assert.equal(isAuthFailureMessage("Supabase request failed"), false);
});
