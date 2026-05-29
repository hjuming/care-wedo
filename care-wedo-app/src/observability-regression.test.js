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
  const telemetryApi = readProjectFile("functions/api/telemetry.ts");
  const middleware = readProjectFile("functions/api/_middleware.ts");
  assert.match(telemetry, /trackEvent/);
  assert.match(telemetry, /trackError/);
  assert.match(telemetry, /OBSERVABILITY_EVENT_CATEGORIES/);
  assert.match(telemetry, /sendBeacon/);
  assert.match(telemetry, /\/api\/telemetry/);
  assert.match(boundary, /trackError\("frontend\.render"/);
  assert.match(telemetryApi, /frontend\.telemetry_error/);
  assert.match(telemetryApi, /sanitizeClientDetails/);
  assert.match(middleware, /pathname === "\/api\/telemetry"/);
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
  assert.match(logger, /classifyLogEvent/);
  assert.match(logger, /OBSERVABILITY_EVENT_CATEGORIES/);
  assert.doesNotMatch(logger, /Authorization/);
});

test("production alert webhook is wired for beta-critical failures", () => {
  const alerts = readProjectFile("functions/_shared/alerts.ts");
  const telemetryApi = readProjectFile("functions/api/telemetry.ts");
  const middleware = readProjectFile("functions/api/_middleware.ts");
  const ocrApi = readProjectFile("functions/api/ocr/[[path]].ts");
  const callback = readProjectFile("functions/callback.ts");
  const remindersCron = readProjectFile("functions/api/cron/reminders.ts");
  const eveningCron = readProjectFile("functions/api/cron/evening.ts");
  const runbook = readProjectFile("PRODUCTION_OBSERVABILITY_RUNBOOK.md");

  assert.match(alerts, /CARE_WEDO_ALERT_WEBHOOK_URL/);
  assert.match(alerts, /CARE_WEDO_ALERT_WEBHOOK_SECRET/);
  assert.match(alerts, /X-Care-WEDO-Alert-Secret/);
  assert.match(alerts, /redact/);
  assert.match(telemetryApi, /sendProductionAlert/);
  assert.match(middleware, /sendProductionAlert/);
  assert.match(ocrApi, /ocr\.request_failed/);
  assert.match(callback, /line\.ocr_failed/);
  assert.match(remindersCron, /cron\.reminders_failed/);
  assert.match(eveningCron, /cron\.evening_failed/);
  assert.match(runbook, /CARE_WEDO_ALERT_WEBHOOK_URL/);
  assert.match(runbook, /不記錄醫療全文/);
});

test("Observability taxonomy covers beta alert categories", () => {
  const telemetry = readProjectFile("care-wedo-app/src/services/telemetry.js");
  const logger = readProjectFile("functions/_shared/logger.ts");
  const runbook = readProjectFile("PRODUCTION_OBSERVABILITY_RUNBOOK.md");

  for (const category of [
    "ocr_failed",
    "line_push_failed",
    "quota_exceeded",
    "auth_failed",
    "cron_failed",
  ]) {
    assert.match(telemetry, new RegExp(category));
    assert.match(logger, new RegExp(category));
    assert.match(runbook, new RegExp(category));
  }

  assert.match(runbook, /wrangler pages deployment tail/);
  assert.match(runbook, /15 分鐘/);
  assert.match(runbook, /不記錄醫療全文/);
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
