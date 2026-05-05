import test from "node:test";
import assert from "node:assert/strict";
import { buildLiffEntryUrl, shouldOpenLiffEntryUrl } from "./liff.js";

test("buildLiffEntryUrl creates the LINE LIFF universal link", () => {
  assert.equal(buildLiffEntryUrl("2009972224-fQcfBXw5"), "https://liff.line.me/2009972224-fQcfBXw5");
});

test("buildLiffEntryUrl uses the production LIFF ID fallback when build env is missing", () => {
  assert.equal(buildLiffEntryUrl(), "https://liff.line.me/2009972224-fQcfBXw5");
});

test("shouldOpenLiffEntryUrl detects iOS and Android browsers", () => {
  assert.equal(shouldOpenLiffEntryUrl("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(shouldOpenLiffEntryUrl("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), true);
});

test("shouldOpenLiffEntryUrl keeps desktop browsers on regular LIFF login", () => {
  assert.equal(shouldOpenLiffEntryUrl("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), false);
  assert.equal(shouldOpenLiffEntryUrl("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
});
