#!/usr/bin/env node
const args = new Set(process.argv.slice(2));
const REPORT_ONLY = args.has("--report-only") || args.has("--dry-run");
const env = process.env;

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeBaseUrl(value) {
  return stripTrailingSlash(value).replace(/\/api$/i, "");
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function present(key, predicate = (value) => Boolean(value)) {
  return predicate(env[key]);
}

function anyPresent(keys, predicate) {
  return keys.some((key) => present(key, predicate));
}

function missingLabel(primary, aliases = [], predicate) {
  return anyPresent([primary, ...aliases], predicate) ? null : aliases.length ? `${primary} (or ${aliases.join(" / ")})` : primary;
}

function compact(values) {
  return values.filter(Boolean);
}

const googleMissing = compact([
  missingLabel("CARE_WEDO_STAGING_BASE_URL", ["CARE_WEDO_SMOKE_BASE_URL"], (value) => Boolean(normalizeBaseUrl(value))),
  missingLabel("CARE_WEDO_GOOGLE_ACCESS_TOKEN", ["CARE_WEDO_SMOKE_GOOGLE_TOKEN"]),
  missingLabel("CARE_WEDO_SMOKE_PROFILE_ID", [], positiveNumber),
  missingLabel("CARE_WEDO_SMOKE_GROUP_ID", [], positiveNumber),
  missingLabel("CARE_WEDO_SMOKE_EXPECTED_USER_ID", [], positiveNumber),
  missingLabel("SUPABASE_URL", [], (value) => Boolean(stripTrailingSlash(value))),
  missingLabel("SUPABASE_SERVICE_ROLE_KEY"),
]);

const storageMissing = compact([
  missingLabel("SUPABASE_URL", [], (value) => Boolean(stripTrailingSlash(value))),
  missingLabel("SUPABASE_PUBLISHABLE_KEY", ["SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]),
  missingLabel("CARE_WEDO_STORAGE_ACCESS_TOKEN", ["CARE_WEDO_GOOGLE_ACCESS_TOKEN"]),
  missingLabel("CARE_WEDO_STORAGE_OWNED_PATH"),
  missingLabel("CARE_WEDO_STORAGE_FOREIGN_PATH"),
]);

const checks = [
  {
    name: "google_protected_write_smoke",
    command: "npm run google:protected-write:smoke",
    ready: googleMissing.length === 0,
    missing_env: googleMissing,
    paths: [
      "POST /api/ocr/",
      "POST /api/ocr/confirm",
      "POST /api/appointments",
      "POST /api/medications/taken",
      "GET /rest/v1/care_documents",
      "GET /rest/v1/appointments",
      "GET /rest/v1/medication_logs",
    ],
  },
  {
    name: "storage_policy_smoke",
    command: "npm run storage:policy:smoke",
    ready: storageMissing.length === 0,
    missing_env: storageMissing,
    paths: [
      "GET /storage/v1/object/care-documents/{owned_path}",
      "GET /storage/v1/object/care-documents/{foreign_path}",
    ],
  },
];

const report = {
  event: "care_wedo_staging_smoke_readiness",
  generated_at: new Date().toISOString(),
  mode: REPORT_ONLY ? "report_only" : "strict",
  ready: checks.every((check) => check.ready),
  checks,
};

const output = JSON.stringify(report, null, 2);
if (report.ready || REPORT_ONLY) {
  console.log(output);
  process.exit(0);
}

console.error(output);
process.exit(1);
