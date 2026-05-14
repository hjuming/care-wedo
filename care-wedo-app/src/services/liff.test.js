import test from "node:test";
import assert from "node:assert/strict";
import { buildLiffEntryUrl, clearCareWedoLocalSession, shouldOpenLiffEntryUrl } from "./liff.js";

test("buildLiffEntryUrl creates the LINE LIFF universal link", () => {
  assert.equal(buildLiffEntryUrl("2009972224-fQcfBXw5"), "https://liff.line.me/2009972224-fQcfBXw5");
});

test("buildLiffEntryUrl uses the production LIFF ID fallback when build env is missing", () => {
  assert.equal(buildLiffEntryUrl(), "https://liff.line.me/2009972224-fQcfBXw5");
});

test("shouldOpenLiffEntryUrl detects browsers that should use the direct LIFF anchor", () => {
  assert.equal(shouldOpenLiffEntryUrl("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(shouldOpenLiffEntryUrl("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), true);
});

test("shouldOpenLiffEntryUrl keeps desktop browsers on regular LIFF login", () => {
  assert.equal(shouldOpenLiffEntryUrl("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), false);
  assert.equal(shouldOpenLiffEntryUrl("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
});

test("clearCareWedoLocalSession removes stale app and LIFF login state only", () => {
  const originalWindow = globalThis.window;
  const local = {
    care_wedo_active_profile_id: "1",
    LIFF_STORE: "stale",
    unrelated: "keep",
    removeItem(key) {
      delete this[key];
    },
  };
  const session = {
    care_wedo_pending_invite_code: "ABC123",
    line_oauth_state: "stale",
    unrelated_session: "keep",
    removeItem(key) {
      delete this[key];
    },
  };

  globalThis.window = {
    localStorage: local,
    sessionStorage: session,
  };

  try {
    clearCareWedoLocalSession();
    assert.equal(local.care_wedo_active_profile_id, undefined);
    assert.equal(local.LIFF_STORE, undefined);
    assert.equal(local.unrelated, "keep");
    assert.equal(session.care_wedo_pending_invite_code, undefined);
    assert.equal(session.line_oauth_state, undefined);
    assert.equal(session.unrelated_session, "keep");
  } finally {
    globalThis.window = originalWindow;
  }
});
