const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

const env = process.env;
const supabaseUrl = stripTrailingSlash(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "");
const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const accessToken = env.CARE_WEDO_STORAGE_ACCESS_TOKEN || env.CARE_WEDO_GOOGLE_ACCESS_TOKEN || "";
const bucket = env.CARE_WEDO_STORAGE_BUCKET || "care-documents";
const ownedPath = normalizeObjectPath(env.CARE_WEDO_STORAGE_OWNED_PATH || "");
const foreignPath = normalizeObjectPath(env.CARE_WEDO_STORAGE_FOREIGN_PATH || "");

const report = {
  event: "care_documents_storage_policy_smoke",
  generated_at: new Date().toISOString(),
  mode: DRY_RUN ? "dry_run" : "live",
  bucket,
  expected: {
    owned_object: ownedPath ? "[set]" : "[missing]",
    foreign_object: foreignPath ? "[set]" : "[missing]",
  },
  steps: [],
};

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeObjectPath(value) {
  return String(value || "").replace(/^\/+/, "");
}

function requiredKeys() {
  return [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "CARE_WEDO_STORAGE_ACCESS_TOKEN",
    "CARE_WEDO_STORAGE_OWNED_PATH",
    "CARE_WEDO_STORAGE_FOREIGN_PATH",
  ];
}

function missingKeys() {
  return requiredKeys().filter((key) => {
    if (key === "SUPABASE_URL") return !supabaseUrl;
    if (key === "SUPABASE_PUBLISHABLE_KEY") return !publishableKey;
    if (key === "CARE_WEDO_STORAGE_ACCESS_TOKEN") return !accessToken;
    if (key === "CARE_WEDO_STORAGE_OWNED_PATH") return !ownedPath;
    if (key === "CARE_WEDO_STORAGE_FOREIGN_PATH") return !foreignPath;
    return !env[key];
  });
}

function objectUrl(path) {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function addStep(name, status, details = {}) {
  report.steps.push({ name, status, ...details });
}

function assertNamespacedPath(path, label) {
  const pattern = /^group-[0-9]+\/profile-[0-9]+\/[0-9]{4}-[0-9]{2}\/[0-9a-f-]+\.(pdf|jpg|png|webp)$/i;
  if (!pattern.test(path)) {
    throw new Error(`${label} must match group-{id}/profile-{id}/YYYY-MM/uuid.ext`);
  }
}

async function fetchObject(label, path) {
  const response = await fetch(objectUrl(path), {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return {
    label,
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
  };
}

async function runLive() {
  assertNamespacedPath(ownedPath, "CARE_WEDO_STORAGE_OWNED_PATH");
  assertNamespacedPath(foreignPath, "CARE_WEDO_STORAGE_FOREIGN_PATH");

  const owned = await fetchObject("owned_object", ownedPath);
  if (!owned.ok) {
    throw new Error(`Owned storage object should be readable but returned HTTP ${owned.status}`);
  }
  addStep("owned_object_read", "pass", {
    status: owned.status,
    content_type: owned.contentType || "[unknown]",
  });

  const foreign = await fetchObject("foreign_object", foreignPath);
  if (foreign.ok) {
    throw new Error("Foreign storage object was readable; expected RLS denial");
  }
  addStep("foreign_object_denied", "pass", {
    status: foreign.status,
  });
}

async function main() {
  if (DRY_RUN) {
    report.required_env = requiredKeys();
    report.missing_env = missingKeys();
    report.paths = [
      "GET /storage/v1/object/care-documents/{owned_path}",
      "GET /storage/v1/object/care-documents/{foreign_path}",
    ];
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const missing = missingKeys();
  if (missing.length) {
    report.missing_env = missing;
    throw new Error(`Missing required environment keys: ${missing.join(", ")}`);
  }

  await runLive();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  addStep("smoke", "fail", { error: error instanceof Error ? error.message : String(error) });
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
