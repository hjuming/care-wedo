import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "test-fixtures/real-receipt-regression/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const privateImageDirectory = manifest.privacy?.private_image_directory || "test-fixtures/real-receipt-regression/private-images";
const DRY_RUN = !process.argv.includes("--send") && process.env.CARE_WEDO_REAL_RECEIPT_DRY_RUN !== "false";
const WRITE_SHAPES = process.argv.includes("--write-shapes");
const smokeUrl = process.env.CARE_WEDO_REAL_RECEIPT_SMOKE_URL || "";
const idToken = process.env.CARE_WEDO_REAL_RECEIPT_ID_TOKEN || "";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixturePath(item) {
  const localPath = item.fixture?.local_private_path || "";
  return resolve(root, "test-fixtures/real-receipt-regression", localPath);
}

function isPendingHash(value) {
  return !value || value === "pending-private-image-hash";
}

function expectedHash(item) {
  return item.fixture?.sha256 || item.fixture?.sha256_placeholder;
}

function expectedShape(item) {
  return {
    case_id: item.id,
    country: item.country,
    document_type: item.document_type,
    scenarios: item.scenarios || [],
    expected_records: (item.expected?.records || []).map((record) => ({
      kind: record.kind,
      type: record.type,
      required_fields: record.required_fields || [],
    })),
    safety_expectation: {
      elder_duplicate_warning_visible: item.line_expectation?.elder_duplicate_warning_visible === true,
      raw_medical_full_text_visible: item.line_expectation?.raw_medical_full_text_visible === true,
    },
  };
}

function responseShape(response) {
  const data = response?.data || response || {};
  const saved = response?.saved || {};
  return {
    success: response?.success === true || response?.ok === true,
    top_level_keys: Object.keys(response || {}).sort(),
    parsed_keys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).sort() : [],
    saved_counts: {
      appointment_ids: Array.isArray(saved.appointment_ids) ? saved.appointment_ids.length : 0,
      medication_ids: Array.isArray(saved.medication_ids) ? saved.medication_ids.length : 0,
      document_id_present: Boolean(saved.document_id),
    },
  };
}

async function sendSmokeCase(item, filePath, hash) {
  if (!smokeUrl) throw new Error("CARE_WEDO_REAL_RECEIPT_SMOKE_URL is required when using --send.");
  if (!idToken) throw new Error("CARE_WEDO_REAL_RECEIPT_ID_TOKEN is required when using --send.");

  const form = new FormData();
  const bytes = readFileSync(filePath);
  form.append("file", new Blob([bytes]), basename(filePath));
  form.append("case_id", item.id);
  form.append("document_type", item.document_type);
  form.append("fixture_sha256", hash);

  const response = await fetch(smokeUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Smoke case ${item.id} failed (${response.status}): ${text.slice(0, 160)}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

const results = [];
const errors = [];
const expectedShapes = {
  schema_version: "care-wedo-real-receipt-expected-shapes-v1",
  source_manifest_schema_version: manifest.schema_version,
  source_manifest_sha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  generated_at: manifest.updated_at,
  privacy: {
    contains_raw_medical_text: false,
    contains_original_images: false,
    contains_patient_identifiers: false,
  },
  cases: (manifest.cases || []).map(expectedShape),
};

if (WRITE_SHAPES) {
  const outputPath = resolve(root, "test-fixtures/real-receipt-regression/expected-shapes.json");
  writeFileSync(outputPath, `${JSON.stringify(expectedShapes, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

for (const item of manifest.cases || []) {
  const path = fixturePath(item);
  if (!existsSync(path)) {
    results.push({ id: item.id, status: "missing_private_image", path, expected_shape: expectedShape(item) });
    continue;
  }

  const hash = sha256(path);
  const expectedFixtureHash = expectedHash(item);
  if (!isPendingHash(expectedFixtureHash) && expectedFixtureHash !== hash) {
    errors.push(`${item.id} sha256 mismatch. expected=${expectedFixtureHash} actual=${hash}`);
    results.push({ id: item.id, status: "hash_mismatch", hash, expected_shape: expectedShape(item) });
    continue;
  }

  if (DRY_RUN) {
    results.push({ id: item.id, status: "ready", hash, expected_shape: expectedShape(item) });
    continue;
  }

  try {
    const response = await sendSmokeCase(item, path, hash);
    results.push({ id: item.id, status: "sent", hash, expected_shape: expectedShape(item), actual_shape: responseShape(response) });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    results.push({ id: item.id, status: "send_failed", hash, expected_shape: expectedShape(item) });
  }
}

const summary = results.reduce((counts, item) => {
  counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({
  event: "real_receipt_smoke_runner",
  mode: DRY_RUN ? "dry_run" : "send",
  private_image_directory: privateImageDirectory,
  total_cases: manifest.cases?.length || 0,
  summary,
  results: results.map((item) => ({
    id: item.id,
    status: item.status,
    sha256: item.hash ? `${item.hash.slice(0, 12)}...` : undefined,
    expected_shape: item.expected_shape,
    actual_shape: item.actual_shape,
  })),
}, null, 2));

if (errors.length) {
  console.error(errors.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
