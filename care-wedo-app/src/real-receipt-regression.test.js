import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(root, "test-fixtures/real-receipt-regression/manifest.json");
const expectedShapesPath = resolve(root, "test-fixtures/real-receipt-regression/expected-shapes.json");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function readManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function readExpectedShapes() {
  return JSON.parse(readFileSync(expectedShapesPath, "utf8"));
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

test("real receipt regression pack commits only de-identified expected shapes", () => {
  const manifest = readManifest();
  const expectedShapes = readExpectedShapes();

  assert.equal(expectedShapes.schema_version, "care-wedo-real-receipt-expected-shapes-v1");
  assert.equal(expectedShapes.source_manifest_schema_version, manifest.schema_version);
  assert.equal(expectedShapes.privacy.contains_raw_medical_text, false);
  assert.equal(expectedShapes.privacy.contains_original_images, false);
  assert.equal(expectedShapes.privacy.contains_patient_identifiers, false);
  assert.equal(expectedShapes.cases.length, manifest.cases.length);

  const shapeById = new Map(expectedShapes.cases.map((item) => [item.case_id, item]));
  for (const item of manifest.cases) {
    const shape = shapeById.get(item.id);
    assert.ok(shape, `missing expected shape for ${item.id}`);
    assert.equal(shape.document_type, item.document_type);
    assert.deepEqual(shape.expected_records.map((record) => record.kind), item.expected.records.map((record) => record.kind));
    assert.equal(shape.safety_expectation.elder_duplicate_warning_visible, false);
    assert.equal(shape.safety_expectation.raw_medical_full_text_visible, false);
  }
});

test("real receipt regression validator and documentation are wired", () => {
  const script = readProjectFile("scripts/validate-real-receipt-pack.mjs");
  const privateHashScript = readProjectFile("scripts/validate-real-receipt-private-images.mjs");
  const smokeRunner = readProjectFile("scripts/real-receipt-smoke-runner.mjs");
  const runbook = readProjectFile("REAL_RECEIPT_REGRESSION_RUNBOOK.md");
  const packageJson = readProjectFile("package.json");

  assert.match(script, /care-wedo-real-receipt-regression-v1/);
  assert.match(script, /raw_medical_images_committed/);
  assert.match(script, /source_manifest_sha256/);
  assert.match(script, /duplicate_upload/);
  assert.match(script, /64-character hex digest/);
  assert.match(script, /pending-private-image-hash/);
  assert.match(privateHashScript, /--write-hashes/);
  assert.match(privateHashScript, /prints_private_paths:\s*false/);
  assert.match(privateHashScript, /prints_sha256_values:\s*false/);
  assert.match(privateHashScript, /missing_private_image/);
  assert.match(privateHashScript, /hash_verified/);
  assert.match(privateHashScript, /sha256 mismatch/);
  assert.match(smokeRunner, /private_image_directory/);
  assert.match(smokeRunner, /sha256/);
  assert.match(smokeRunner, /expected_shape/);
  assert.match(smokeRunner, /--write-shapes/);
  assert.match(smokeRunner, /CARE_WEDO_REAL_RECEIPT_SMOKE_URL/);
  assert.match(smokeRunner, /DRY_RUN/);
  assert.match(runbook, /10 張/);
  assert.match(runbook, /去識別化/);
  assert.match(runbook, /expected-shapes\.json/);
  assert.match(runbook, /LINE WebView/);
  assert.match(runbook, /receipt-pack:smoke/);
  assert.match(runbook, /receipt-pack:private-check/);
  assert.match(runbook, /receipt-pack:hashes/);
  assert.match(packageJson, /receipt-pack:check/);
  assert.match(packageJson, /receipt-pack:private-check/);
  assert.match(packageJson, /receipt-pack:hashes/);
  assert.match(packageJson, /receipt-pack:shapes/);
  assert.match(packageJson, /receipt-pack:smoke/);
});
