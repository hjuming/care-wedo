import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

/**
 * Auth-unification guard.
 *
 * Protected data APIs must use the request-scoped entry `getRequestUser()`.
 * The middleware verifies LINE/Supabase identity once and stores it on
 * context.data; handlers should reuse that identity instead of directly calling
 * LINE-only `verifyLineIdToken()` or the older `getAuthenticatedUser()`.
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
    `These protected routes still call verifyLineIdToken directly; route them through getRequestUser():\n${offenders.join("\n")}`,
  );
});

test("protected APIs do not use the old getAuthenticatedUser entry directly", () => {
  const offenders = [];
  for (const file of [...listTsFiles("functions/api"), "functions/_shared/care_documents.ts"]) {
    if (LINE_LOGIN_ALLOWLIST.has(file)) continue;
    const source = readFileSync(resolve(root, file), "utf8");
    if (/getAuthenticatedUser\s*\(/.test(source) || /getAuthenticatedUser\s*,/.test(source)) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `These routes still use getAuthenticatedUser directly; use getRequestUser(context):\n${offenders.join("\n")}`,
  );
});

test("shared care_documents context uses the request-scoped auth entry", () => {
  const source = readFileSync(resolve(root, "functions/_shared/care_documents.ts"), "utf8");
  assert.doesNotMatch(source, /verifyLineIdToken\s*\(/);
  assert.doesNotMatch(source, /getAuthenticatedUser\s*\(/);
  assert.match(source, /getRequestUser\s*\(/);
});

test("known protected endpoints use request-scoped auth or document context", () => {
  // Guards against the scan silently passing because the path moved.
  const mustUseRequestUser = [
    "functions/api/appointments.ts",
    "functions/api/appointments/[id].ts",
    "functions/api/medications/[id].ts",
    "functions/api/ocr/confirm.ts",
    "functions/api/profiles/[id].ts",
    "functions/api/profiles/order.ts",
    "functions/api/me/active-profile.ts",
  ];
  for (const file of mustUseRequestUser) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.match(source, /getRequestUser/, `${file} should use getRequestUser`);
  }

  for (const file of [
    "functions/api/documents.ts",
    "functions/api/documents/[id].ts",
    "functions/api/documents/[id]/file-url.ts",
    "functions/api/documents/upload.ts",
  ]) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.match(source, /getCurrentUserDocumentContext\s*\(context\)/, `${file} should pass full context to document auth`);
  }
});

test("API middleware public allowlist stays narrow and excludes protected data APIs", () => {
  const source = readFileSync(resolve(root, "functions/api/_middleware.ts"), "utf8");

  for (const expected of [
    /pathname\s*===\s*"\/api\/health"/,
    /pathname\s*===\s*"\/api\/feedback"\s*&&\s*method\s*===\s*"POST"/,
    /pathname\s*===\s*"\/api\/telemetry"\s*&&\s*method\s*===\s*"POST"/,
    /pathname\s*===\s*"\/api\/session"/,
    /pathname\s*===\s*"\/api\/session\/handoff"\s*&&\s*method\s*===\s*"POST"/,
    /pathname\.startsWith\("\/api\/cron\/"\)/,
    /pathname\s*===\s*"\/api\/dashboard"\s*&&\s*method\s*===\s*"GET"/,
  ]) {
    assert.match(source, expected);
  }

  for (const protectedPath of [
    "/api/appointments",
    "/api/documents",
    "/api/groups",
    "/api/me",
    "/api/medications",
    "/api/ocr",
    "/api/profiles",
  ]) {
    assert.doesNotMatch(source, new RegExp(`pathname\\s*===\\s*["']${protectedPath}["']`));
    assert.doesNotMatch(source, new RegExp(`pathname\\.startsWith\\(["']${protectedPath}`));
  }
});

test("cron endpoints are only public at middleware level because they enforce CRON_SECRET", () => {
  for (const file of ["functions/api/cron/reminders.ts", "functions/api/cron/evening.ts"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.match(source, /env\.CRON_SECRET/, `${file} must require CRON_SECRET`);
    assert.match(source, /request\.headers\.get\("Authorization"\)/, `${file} must read Authorization header`);
    assert.match(source, /Bearer \$\{env\.CRON_SECRET\}/, `${file} must compare bearer token to CRON_SECRET`);
    assert.match(source, /status:\s*401/, `${file} must reject unauthorized calls`);
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
