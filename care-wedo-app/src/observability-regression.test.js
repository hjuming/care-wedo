import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("frontend has a telemetry helper and ErrorBoundary records render errors", () => {
  const telemetry = readProjectFile("care-wedo-app/src/services/telemetry.js");
  const boundary = readProjectFile("care-wedo-app/src/components/ErrorBoundary.jsx");
  assert.match(telemetry, /trackEvent/);
  assert.match(telemetry, /trackError/);
  assert.match(boundary, /trackError\("frontend\.render"/);
});

test("dashboard records beta-critical frontend failures", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  assert.match(app, /trackError\("frontend\.dashboard"/);
  assert.match(app, /trackError\("frontend\.ocr"/);
  assert.match(app, /trackEvent\("frontend\.profile_switch"/);
});

test("Cloudflare Functions use structured beta logging without raw token logging", () => {
  const logger = readProjectFile("functions/_shared/logger.ts");
  assert.match(logger, /logEvent/);
  assert.match(logger, /logError/);
  assert.match(logger, /redact/);
  assert.doesNotMatch(logger, /Authorization/);
});

test("OCR, LINE callback, and cron paths emit structured logs", () => {
  for (const file of [
    "functions/api/ocr/[[path]].ts",
    "functions/callback.ts",
    "functions/api/cron/reminders.ts",
    "functions/api/cron/evening.ts",
  ]) {
    const source = readProjectFile(file);
    assert.match(source, /logEvent|logError/, `${file} should emit structured logs`);
  }
});
