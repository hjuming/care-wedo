import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardRequest } from "./api.js";

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
