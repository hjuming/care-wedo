import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildGoogleMedicationSmokeRequest,
  verifyGoogleMedicationSmokeRetry,
} from "./google-protected-write-smoke.mjs";

test("Google medication smoke reuses one valid key but scopes other fixture operations", () => {
  const operation = buildGoogleMedicationSmokeRequest({ medicationId: 300, groupId: 100, profileId: 200, takenDate: "2026-07-19" });
  const retry = buildGoogleMedicationSmokeRequest({ medicationId: 300, groupId: 100, profileId: 200, takenDate: "2026-07-19" });
  const otherFixture = buildGoogleMedicationSmokeRequest({ medicationId: 301, groupId: 100, profileId: 201, takenDate: "2026-07-19" });

  assert.match(operation.headers["Idempotency-Key"], /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/);
  assert.equal(retry.headers["Idempotency-Key"], operation.headers["Idempotency-Key"]);
  assert.notEqual(otherFixture.headers["Idempotency-Key"], operation.headers["Idempotency-Key"]);
  assert.deepEqual(operation.body.medication_ids, [300]);
});

test("Google medication smoke accepts only a deduplicated retry with identical log ids", () => {
  const first = { success: true, log_ids: [901], medication_ids: [300], deduplicated: false };
  const retry = { success: true, log_ids: [901], medication_ids: [300], deduplicated: true };

  assert.deepEqual(verifyGoogleMedicationSmokeRetry(first, retry, 300), { logIds: [901], deduplicated: true });
  assert.throws(
    () => verifyGoogleMedicationSmokeRetry(first, { ...retry, log_ids: [902] }, 300),
    /log ids/,
  );
  assert.throws(
    () => verifyGoogleMedicationSmokeRetry(first, { ...retry, deduplicated: false }, 300),
    /not deduplicated/,
  );
});

test("Google medication dry-run reports prerequisites without exposing an operation key", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./google-protected-write-smoke.mjs", import.meta.url)), "--dry-run"], {
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"mode": "dry_run"/);
  assert.doesNotMatch(result.stdout, /Idempotency-Key|care-wedo-google-medication/);
});
