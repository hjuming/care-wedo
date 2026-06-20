import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const WRITE_HASHES = args.has("--write-hashes");

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "test-fixtures/real-receipt-regression/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fixtureRoot = resolve(root, "test-fixtures/real-receipt-regression");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixturePath(item) {
  const localPath = item.fixture?.local_private_path || "";
  return resolve(fixtureRoot, localPath);
}

function isPendingHash(value) {
  return !value || value === "pending-private-image-hash";
}

function safeCaseResult(item, status, details = {}) {
  return {
    id: item.id,
    status,
    document_type: item.document_type,
    scenarios: item.scenarios || [],
    ...details,
  };
}

const results = [];
const errors = [];
let writableChanges = 0;

for (const item of manifest.cases || []) {
  const path = fixturePath(item);
  if (!existsSync(path)) {
    const result = safeCaseResult(item, "missing_private_image");
    results.push(result);
    if (!DRY_RUN) errors.push(`${item.id} missing private image`);
    continue;
  }

  const stat = statSync(path);
  if (!stat.isFile()) {
    results.push(safeCaseResult(item, "invalid_private_image"));
    if (!DRY_RUN) errors.push(`${item.id} private image path is not a file`);
    continue;
  }

  const hash = sha256(path);
  const currentHash = item.fixture?.sha256 || "";
  if (isPendingHash(currentHash)) {
    if (WRITE_HASHES) {
      item.fixture.sha256 = hash;
      writableChanges += 1;
      results.push(safeCaseResult(item, "hash_written", { size_bytes: stat.size }));
    } else {
      results.push(safeCaseResult(item, "hash_pending", { size_bytes: stat.size }));
      if (!DRY_RUN) errors.push(`${item.id} sha256 is still pending`);
    }
    continue;
  }

  if (currentHash !== hash) {
    results.push(safeCaseResult(item, "hash_mismatch", { size_bytes: stat.size }));
    errors.push(`${item.id} sha256 mismatch`);
    continue;
  }

  results.push(safeCaseResult(item, "hash_verified", { size_bytes: stat.size }));
}

if (WRITE_HASHES && writableChanges > 0) {
  manifest.updated_at = new Date().toISOString().slice(0, 10);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const summary = results.reduce((counts, item) => {
  counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({
  event: "real_receipt_private_image_hash_check",
  mode: WRITE_HASHES ? "write_hashes" : DRY_RUN ? "dry_run" : "check",
  total_cases: manifest.cases?.length || 0,
  summary,
  writable_changes: writableChanges,
  privacy: {
    raw_medical_images_committed: false,
    prints_private_paths: false,
    prints_sha256_values: false,
  },
  results,
}, null, 2));

if (errors.length) {
  console.error(errors.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
