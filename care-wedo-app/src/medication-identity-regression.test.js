import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("medication identity columns are available for duplicate-safe OCR saves", () => {
  const schema = readProjectFile("supabase/schema.sql");
  const migration = readProjectFile("supabase/migration_phase54_medication_identity.sql");

  for (const source of [schema, migration]) {
    assert.match(source, /normalized_name text/);
    assert.match(source, /brand_name text/);
    assert.match(source, /generic_name text/);
    assert.match(source, /drug_code text/);
    assert.match(source, /dosage_text text/);
    assert.match(source, /identity_confidence numeric/);
    assert.match(source, /duplicate_candidate_ids jsonb/);
  }
});

test("LINE OCR medication saves normalize exact duplicates before creating a new row", () => {
  const sharedOcr = readProjectFile("functions/_shared/medical_ocr.ts");

  assert.match(sharedOcr, /export function buildMedicationIdentity/);
  assert.match(sharedOcr, /normalizedName/);
  assert.match(sharedOcr, /duplicateCandidateIds/);
  assert.match(sharedOcr, /findMedicationIdentityMatch/);
  assert.match(sharedOcr, /existingMeds\.find\(\(existing\) => findMedicationIdentityMatch\(identity, existing\) === "exact"/);
  assert.match(sharedOcr, /duplicate_candidate_ids:\s*identity\.duplicateCandidateIds/);
});

test("web OCR pending medications store identity metadata for family review", () => {
  const ocrApi = readProjectFile("functions/api/ocr/[[path]].ts");

  assert.match(ocrApi, /buildMedicationIdentity/);
  assert.match(ocrApi, /findMedicationIdentityMatch/);
  assert.match(ocrApi, /existingMeds/);
  assert.match(ocrApi, /normalized_name:\s*identity\.normalizedName/);
  assert.match(ocrApi, /identity_confidence:\s*identity\.confidence/);
  assert.match(ocrApi, /duplicate_candidate_ids:\s*identity\.duplicateCandidateIds/);
  assert.match(ocrApi, /med\.duplicate_candidate_ids\s*=\s*identity\.duplicateCandidateIds/);
  assert.doesNotMatch(ocrApi, /findMedicationIdentityMatch\(identity, existing\) === "fuzzy"[\s\S]{0,120}duplicate = existing/);
});

test("OCR review warns family when a medication may already exist", () => {
  const ocrResult = readProjectFile("care-wedo-app/src/components/OcrResult.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(ocrResult, /duplicate_candidate_ids/);
  assert.match(ocrResult, /identity_confidence/);
  assert.match(ocrResult, /可能已存在/);
  assert.match(ocrResult, /請確認是不是同一顆藥/);
  assert.match(ocrResult, /家人人工確認藥名、劑量和用途後再存/);
  assert.match(ocrResult, /lowConfidenceMedicationCount/);
  assert.match(ocrResult, /MedicationReviewNotice/);
  assert.match(css, /\.ocr-save-note\.warning/);
});

test("OCR confirm merges only high-confidence duplicate medications", () => {
  const confirmApi = readProjectFile("functions/api/ocr/confirm.ts");

  assert.match(confirmApi, /confirmMedications/);
  assert.match(confirmApi, /duplicate_candidate_ids/);
  assert.match(confirmApi, /identity_confidence/);
  assert.match(confirmApi, /identityConfidence >= 0\.99/);
  assert.match(confirmApi, /regularMedicationIds/);
  assert.match(confirmApi, /mergedMedicationIds/);
  assert.doesNotMatch(confirmApi, /identityConfidence < 0\.99[\s\S]{0,180}active:\s*true/);
});
