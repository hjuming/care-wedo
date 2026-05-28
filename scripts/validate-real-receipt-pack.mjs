import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "test-fixtures/real-receipt-regression/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const requiredTypes = new Set(["clinic_visit", "inspection", "refill_reminder", "medication_bag", "prescription"]);
const requiredScenarios = new Set(["multi_upload", "wrong_profile_then_reassign", "duplicate_upload", "low_confidence_review"]);
const errors = [];

function fail(message) {
  errors.push(message);
}

if (manifest.schema_version !== "care-wedo-real-receipt-regression-v1") {
  fail("schema_version must be care-wedo-real-receipt-regression-v1");
}
if (manifest.privacy?.raw_medical_images_committed !== false) {
  fail("raw_medical_images_committed must be false");
}
if (manifest.privacy?.redaction_required !== true) {
  fail("redaction_required must be true");
}
if (!Array.isArray(manifest.cases) || manifest.cases.length < 10) {
  fail("manifest must include at least 10 cases");
}

const types = new Set();
const scenarios = new Set();
const ids = new Set();

for (const item of manifest.cases || []) {
  if (ids.has(item.id)) fail(`duplicate case id: ${item.id}`);
  ids.add(item.id);
  if (!/^tw-[a-z0-9-]+-\d{2}$/.test(item.id || "")) fail(`invalid case id: ${item.id}`);
  if (item.country !== "TW") fail(`${item.id} country must be TW`);
  if (item.redaction_status !== "verified") fail(`${item.id} must be redaction verified before regression use`);
  if (!item.fixture?.local_private_path) fail(`${item.id} missing local_private_path`);
  if (!item.fixture?.sha256_placeholder) fail(`${item.id} missing sha256_placeholder`);
  if (!item.expected?.care_profile_label) fail(`${item.id} missing expected care profile label`);
  if (!Array.isArray(item.expected?.records) || item.expected.records.length < 1) fail(`${item.id} needs expected records`);
  if (item.line_expectation?.elder_duplicate_warning_visible !== false) fail(`${item.id} must keep duplicate warning hidden from elders`);
  if (item.line_expectation?.raw_medical_full_text_visible !== false) fail(`${item.id} must not expose raw medical full text in LINE`);

  types.add(item.document_type);
  for (const scenario of item.scenarios || []) scenarios.add(scenario);
}

for (const type of requiredTypes) {
  if (!types.has(type)) fail(`missing document type: ${type}`);
}
for (const scenario of requiredScenarios) {
  if (!scenarios.has(scenario)) fail(`missing scenario: ${scenario}`);
}

if (errors.length) {
  console.error(errors.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Real receipt regression manifest OK: ${manifest.cases.length} cases, ${types.size} document types, ${scenarios.size} scenarios.`);
