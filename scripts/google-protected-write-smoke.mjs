const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const API_ONLY = args.has("--api-only");

const env = process.env;
const baseUrl = normalizeBaseUrl(env.CARE_WEDO_STAGING_BASE_URL || env.CARE_WEDO_SMOKE_BASE_URL || "");
const token = env.CARE_WEDO_GOOGLE_ACCESS_TOKEN || env.CARE_WEDO_SMOKE_GOOGLE_TOKEN || "";
const profileId = positiveNumber(env.CARE_WEDO_SMOKE_PROFILE_ID);
const groupId = positiveNumber(env.CARE_WEDO_SMOKE_GROUP_ID);
const expectedUserId = positiveNumber(env.CARE_WEDO_SMOKE_EXPECTED_USER_ID);
const medicationIdFromEnv = positiveNumber(env.CARE_WEDO_SMOKE_MEDICATION_ID);
const supabaseUrl = stripTrailingSlash(env.SUPABASE_URL || "");
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });

const defaultMedicalText = [
  "Care WEDO staging smoke test.",
  "測試照護對象預計 2099-12-20 上午 09:30 到 Care WEDO 測試醫院家醫科回診。",
  "測試用藥 SmokeMed 1 顆，早餐後使用。這是去識別化測試文字。",
].join("\n");

const report = {
  event: "google_protected_write_smoke",
  generated_at: new Date().toISOString(),
  mode: DRY_RUN ? "dry_run" : API_ONLY ? "api_only" : "full",
  base_url: baseUrl || "[missing]",
  expected: {
    user_id: expectedUserId || "[missing]",
    group_id: groupId || "[missing]",
    profile_id: profileId || "[missing]",
  },
  steps: [],
};

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

function requiredKeys() {
  const keys = [
    "CARE_WEDO_STAGING_BASE_URL",
    "CARE_WEDO_GOOGLE_ACCESS_TOKEN",
    "CARE_WEDO_SMOKE_PROFILE_ID",
    "CARE_WEDO_SMOKE_GROUP_ID",
  ];
  if (!API_ONLY) {
    keys.push("CARE_WEDO_SMOKE_EXPECTED_USER_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  }
  return keys;
}

function missingKeys() {
  return requiredKeys().filter((key) => {
    if (key === "CARE_WEDO_STAGING_BASE_URL") return !baseUrl;
    if (key === "CARE_WEDO_GOOGLE_ACCESS_TOKEN") return !token;
    if (key === "CARE_WEDO_SMOKE_PROFILE_ID") return !profileId;
    if (key === "CARE_WEDO_SMOKE_GROUP_ID") return !groupId;
    if (key === "CARE_WEDO_SMOKE_EXPECTED_USER_ID") return !expectedUserId;
    if (key === "SUPABASE_URL") return !supabaseUrl;
    if (key === "SUPABASE_SERVICE_ROLE_KEY") return !supabaseKey;
    return !env[key];
  });
}

function addStep(name, status, details = {}) {
  report.steps.push({ name, status, ...details });
}

function smokeUrl(path) {
  return `${baseUrl}/api${path.startsWith("/") ? path : `/${path}`}`;
}

function supabaseRestUrl(path) {
  return `${supabaseUrl}/rest/v1/${path}`;
}

function assertEquals(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function assertScope(row, label, { requireUser = true } = {}) {
  assertEquals(row.group_id, groupId, `${label}.group_id`);
  assertEquals(row.profile_id, profileId, `${label}.profile_id`);
  if (requireUser) assertEquals(row.user_id ?? row.uploaded_by_user_id ?? row.confirmed_by_user_id, expectedUserId, `${label}.user_id`);
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!response.ok) {
    const message = data.error || data.message || data.raw || `${label} failed`;
    throw new Error(`${label} HTTP ${response.status}: ${message}`);
  }
  return data;
}

async function apiFetch(label, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(smokeUrl(path), { ...init, headers });
  return parseJsonResponse(response, label);
}

async function apiJson(label, path, body) {
  return apiFetch(label, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function supabaseGet(label, path) {
  const response = await fetch(supabaseRestUrl(path), {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
  const data = await parseJsonResponse(response, label);
  if (!Array.isArray(data) || !data[0]) throw new Error(`${label} returned no rows`);
  return data[0];
}

function futureAppointmentDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

async function runOcrText() {
  const form = new FormData();
  form.set("medical_text", env.CARE_WEDO_SMOKE_MEDICAL_TEXT || defaultMedicalText);
  form.set("profile_id", String(profileId));

  const result = await apiFetch("ocr_text", "/ocr/", { method: "POST", body: form });
  const saved = result.saved || {};
  if (!saved.document_id) throw new Error("OCR text did not return saved.document_id");

  addStep("ocr_text", "pass", {
    document_id: saved.document_id,
    appointment_ids: saved.appointment_ids || [],
    medication_ids: saved.medication_ids || [],
  });

  if (!API_ONLY) {
    const document = await supabaseGet(
      "db_ocr_document",
      `care_documents?id=eq.${saved.document_id}&select=id,group_id,profile_id,uploaded_by_user_id,status&limit=1`,
    );
    assertScope(document, "care_documents", { requireUser: true });
    addStep("db_ocr_document_scope", "pass", { document_id: document.id });
  }

  const confirmed = await apiJson("ocr_confirm", "/ocr/confirm", { document_id: saved.document_id });
  addStep("ocr_confirm", "pass", {
    document_id: confirmed.document_id,
    appointment_ids: confirmed.appointment_ids || [],
    medication_ids: confirmed.medication_ids || [],
  });

  return {
    documentId: saved.document_id,
    medicationIds: [
      ...(Array.isArray(saved.medication_ids) ? saved.medication_ids : []),
      ...(Array.isArray(confirmed.medication_ids) ? confirmed.medication_ids : []),
    ],
  };
}

async function runAppointmentPost() {
  const payload = {
    profile_id: profileId,
    type: "clinic_visit",
    date: futureAppointmentDate(),
    time: "09:30",
    title: `Google auth smoke ${today}`,
    hospital: "Care WEDO 測試醫院",
    department: "測試科",
    doctor: "Smoke",
    notes: "去識別化 staging smoke 測試資料",
  };
  const result = await apiJson("appointment_post", "/appointments", payload);
  const appointment = result.appointment || {};
  if (!appointment.id) throw new Error("Appointment POST did not return appointment.id");
  assertEquals(appointment.group_id, groupId, "appointment response group_id");
  assertEquals(appointment.profile_id, profileId, "appointment response profile_id");
  addStep("appointment_post", "pass", { appointment_id: appointment.id });

  if (!API_ONLY) {
    const row = await supabaseGet(
      "db_appointment_scope",
      `appointments?id=eq.${appointment.id}&select=id,user_id,group_id,profile_id,status,title,date&limit=1`,
    );
    assertScope(row, "appointments");
    addStep("db_appointment_scope", "pass", { appointment_id: row.id });
  }
}

async function runMedicationTaken(candidateMedicationIds) {
  const medicationId = medicationIdFromEnv || positiveNumber(candidateMedicationIds.find(Boolean));
  if (!medicationId) {
    throw new Error("No medication id available. Set CARE_WEDO_SMOKE_MEDICATION_ID or use OCR text that creates a medication.");
  }

  const result = await apiJson("medication_taken", "/medications/taken", {
    medication_ids: [medicationId],
    status: "taken",
    taken_date: today,
    time_slot: "morning",
  });
  if (!Array.isArray(result.medication_ids) || !result.medication_ids.map(Number).includes(Number(medicationId))) {
    throw new Error("Medication taken response did not include the target medication id");
  }
  addStep("medication_taken", "pass", {
    medication_id: medicationId,
    log_ids: result.log_ids || [],
  });

  if (!API_ONLY) {
    const logId = Array.isArray(result.log_ids) ? positiveNumber(result.log_ids[0]) : null;
    if (!logId) throw new Error("Medication taken did not return a medication_logs id for DB verification");
    const row = await supabaseGet(
      "db_medication_log_scope",
      `medication_logs?id=eq.${logId}&select=id,medication_id,group_id,profile_id,confirmed_by_user_id,taken_date,status&limit=1`,
    );
    assertEquals(row.medication_id, medicationId, "medication_logs.medication_id");
    assertScope(row, "medication_logs");
    addStep("db_medication_log_scope", "pass", { log_id: row.id });
  }
}

async function main() {
  if (DRY_RUN) {
    report.required_env = requiredKeys();
    report.missing_env = missingKeys();
    report.paths = [
      "POST /api/ocr/",
      "POST /api/ocr/confirm",
      "POST /api/appointments",
      "POST /api/medications/taken",
    ];
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const missing = missingKeys();
  if (missing.length) {
    report.missing_env = missing;
    throw new Error(`Missing required environment keys: ${missing.join(", ")}`);
  }

  const { medicationIds } = await runOcrText();
  await runAppointmentPost();
  await runMedicationTaken(medicationIds);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  addStep("smoke", "fail", { error: error instanceof Error ? error.message : String(error) });
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
