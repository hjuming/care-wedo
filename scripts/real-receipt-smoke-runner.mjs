import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "test-fixtures/real-receipt-regression/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const privateImageDirectory = manifest.privacy?.private_image_directory || "test-fixtures/real-receipt-regression/private-images";
const DRY_RUN = !process.argv.includes("--send") && process.env.CARE_WEDO_REAL_RECEIPT_DRY_RUN !== "false";
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

for (const item of manifest.cases || []) {
  const path = fixturePath(item);
  if (!existsSync(path)) {
    results.push({ id: item.id, status: "missing_private_image", path });
    continue;
  }

  const hash = sha256(path);
  const expectedHash = item.fixture?.sha256_placeholder;
  if (!isPendingHash(expectedHash) && expectedHash !== hash) {
    errors.push(`${item.id} sha256 mismatch. expected=${expectedHash} actual=${hash}`);
    results.push({ id: item.id, status: "hash_mismatch", hash });
    continue;
  }

  if (DRY_RUN) {
    results.push({ id: item.id, status: "ready", hash });
    continue;
  }

  try {
    const response = await sendSmokeCase(item, path, hash);
    results.push({ id: item.id, status: "sent", hash, response });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    results.push({ id: item.id, status: "send_failed", hash });
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
  })),
}, null, 2));

if (errors.length) {
  console.error(errors.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
