import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardRequest, isAuthFailureMessage } from "./api.js";

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

test("isAuthFailureMessage detects stale login and token failures", () => {
  assert.equal(isAuthFailureMessage("LINE token verify failed."), true);
  assert.equal(isAuthFailureMessage("idToken expired"), true);
  assert.equal(isAuthFailureMessage("請先登入"), true);
  assert.equal(isAuthFailureMessage("Supabase request failed"), false);
});
