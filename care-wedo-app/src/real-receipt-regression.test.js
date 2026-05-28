import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(root, "test-fixtures/real-receipt-regression/manifest.json");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function readManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

test("real receipt regression pack defines ten de-identified Taiwan document cases", () => {
  const manifest = readManifest();
  const requiredTypes = new Set(["clinic_visit", "inspection", "refill_reminder", "medication_bag", "prescription"]);

  assert.equal(manifest.schema_version, "care-wedo-real-receipt-regression-v1");
  assert.equal(manifest.privacy.raw_medical_images_committed, false);
  assert.equal(manifest.privacy.redaction_required, true);
  assert.equal(manifest.cases.length, 10);

  for (const type of requiredTypes) {
    assert.ok(manifest.cases.some((item) => item.document_type === type), `missing ${type}`);
  }

  for (const item of manifest.cases) {
    assert.match(item.id, /^tw-[a-z0-9-]+-\d{2}$/);
    assert.equal(item.country, "TW");
    assert.equal(item.redaction_status, "verified");
    assert.ok(item.fixture.local_private_path);
    assert.ok(item.fixture.sha256_placeholder);
    assert.ok(item.expected.care_profile_label);
    assert.ok(item.expected.records.length >= 1);
    assert.equal(item.line_expectation.elder_duplicate_warning_visible, false);
    assert.equal(item.line_expectation.raw_medical_full_text_visible, false);
  }
});

test("real receipt regression pack covers beta-critical OCR scenarios", () => {
  const manifest = readManifest();
  const scenarios = new Set(manifest.cases.flatMap((item) => item.scenarios));

  for (const scenario of [
    "multi_upload",
    "wrong_profile_then_reassign",
    "duplicate_upload",
    "low_confidence_review",
  ]) {
    assert.ok(scenarios.has(scenario), `missing scenario ${scenario}`);
  }
});

test("real receipt regression validator and documentation are wired", () => {
  const script = readProjectFile("scripts/validate-real-receipt-pack.mjs");
  const runbook = readProjectFile("REAL_RECEIPT_REGRESSION_RUNBOOK.md");
  const packageJson = readProjectFile("package.json");

  assert.match(script, /care-wedo-real-receipt-regression-v1/);
  assert.match(script, /raw_medical_images_committed/);
  assert.match(script, /duplicate_upload/);
  assert.match(runbook, /10 張/);
  assert.match(runbook, /去識別化/);
  assert.match(runbook, /LINE WebView/);
  assert.match(packageJson, /receipt-pack:check/);
});
