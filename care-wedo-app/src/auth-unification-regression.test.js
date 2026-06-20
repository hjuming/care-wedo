import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

/**
 * Auth-unification guard.
 *
 * Protected data APIs must resolve identity through the single unified entry
 * `getAuthenticatedUser()` (LINE + Supabase), never the LINE-only
 * `verifyLineIdToken()`. Calling the LINE verifier directly is what broke
 * Google/Supabase logins on write endpoints and risked the shared web-mvp
 * fallback. This test fails if any protected route reintroduces that pattern.
 *
 * Only the LINE login/session establishment endpoints may call the LINE
 * verifier directly.
 */

// Endpoints whose job IS to verify a LINE login token (allowed to call it).
const LINE_LOGIN_ALLOWLIST = new Set([
  "functions/api/session.ts",
  "functions/api/session/handoff.ts",
]);

function listTsFiles(dirRel) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(resolve(root, rel), { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.name.endsWith(".ts")) out.push(childRel);
    }
  };
  walk(dirRel);
  return out;
}

test("no protected data API calls verifyLineIdToken directly", () => {
  const offenders = [];
  for (const file of listTsFiles("functions/api")) {
    if (LINE_LOGIN_ALLOWLIST.has(file)) continue;
    const source = readFileSync(resolve(root, file), "utf8");
    if (/verifyLineIdToken\s*\(/.test(source)) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `These protected routes still call verifyLineIdToken directly; route them through getAuthenticatedUser():\n${offenders.join("\n")}`,
  );
});

test("shared care_documents context uses the unified auth entry", () => {
  const source = readFileSync(resolve(root, "functions/_shared/care_documents.ts"), "utf8");
  assert.doesNotMatch(source, /verifyLineIdToken\s*\(/);
  assert.match(source, /getAuthenticatedUser\s*\(/);
});

test("known write endpoints import getAuthenticatedUser (scan path sanity)", () => {
  // Guards against the scan silently passing because the path moved.
  const mustUseUnifiedAuth = [
    "functions/api/appointments.ts",
    "functions/api/appointments/[id].ts",
    "functions/api/medications/[id].ts",
    "functions/api/ocr/confirm.ts",
    "functions/api/profiles/[id].ts",
    "functions/api/profiles/order.ts",
    "functions/api/me/active-profile.ts",
  ];
  for (const file of mustUseUnifiedAuth) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.match(source, /getAuthenticatedUser/, `${file} should use getAuthenticatedUser`);
  }
});

test("reminder cron defaults to live delivery (test mode is opt-in)", () => {
  for (const file of ["functions/api/cron/reminders.ts", "functions/api/cron/evening.ts"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    // Opt-in: test mode only when explicitly "1". The old `!== "0"` default
    // silently restricted production delivery to a single test account.
    assert.match(source, /REMINDER_TEST_ONLY\s*===\s*"1"/, `${file} must opt in to test mode`);
    assert.doesNotMatch(source, /REMINDER_TEST_ONLY\s*!==\s*"0"/, `${file} must not default to test mode`);
  }
});
