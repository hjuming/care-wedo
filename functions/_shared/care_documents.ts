import type { AppointmentRow, CareDocumentRow, CareProfileRow, Env, MedicationRow } from "./supabase";
import {
  getAccessibleProfiles,
  getBearerToken,
  getOrCreateDefaultUser,
  getUserMemberships,
  serializeAppointment,
  serializeCareDocument,
  serializeMedication,
  supabaseFetch,
  verifyLineIdToken,
} from "./supabase";
import type { ParsedMedicalData } from "./medical_ocr";

export const CARE_DOCUMENTS_BUCKET = "care-documents";
export const CARE_DOCUMENT_SIGNED_URL_SECONDS = 5 * 60;
export const CARE_DOCUMENT_MAX_FILE_SIZE = 25 * 1024 * 1024;

export const CARE_DOCUMENT_TYPES = new Set([
  "medical_record",
  "medication_record",
  "lab_report",
  "imaging_report",
  "prescription",
  "appointment_slip",
  "other",
]);

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ALLOWED_MIME_TYPES = new Set(Object.keys(MIME_EXTENSION));

export type DoctorBriefing = {
  major_history?: string[];
  recent_symptoms?: string[];
  current_treatment?: string[];
  current_medications?: string[];
  recent_exams?: string[];
  upcoming_plan?: string[];
  questions_for_doctor?: string[];
  source_warning?: string;
};

export type ParsedCareDocumentData = ParsedMedicalData & {
  document_type?: string;
  document_title?: string;
  source_hospital?: string;
  document_date?: string;
  doctor_briefing?: DoctorBriefing;
};

export type CareDocumentDetail = ReturnType<typeof serializeCareDocument> & {
  linked_appointments: ReturnType<typeof serializeAppointment>[];
  linked_medications: ReturnType<typeof serializeMedication>[];
};

export type CurrentUserDocumentContext = {
  userId: number;
  groupIds: number[];
  profiles: CareProfileRow[];
};

export function cleanDocumentString(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeDocumentType(value: unknown) {
  const type = cleanDocumentString(value, 64);
  return CARE_DOCUMENT_TYPES.has(type) ? type : "other";
}

export function normalizeDocumentDate(value: unknown) {
  const text = cleanDocumentString(value, 32);
  if (!text) return "";
  const iso = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const roc = text.match(/(?:民國)?(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (roc) {
    const [, year, month, day] = roc;
    return `${Number(year) + 1911}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return "";
}

function sanitizeFilename(value: string) {
  return (value || "care-document")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`~\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "care-document";
}

export function safeOriginalFilename(file: File) {
  const name = sanitizeFilename(file.name || "care-document");
  return name.includes(".") ? name : `${name}.${MIME_EXTENSION[file.type] || "bin"}`;
}

export function inferPageCount(file: File, bytes: Uint8Array) {
  if (file.type !== "application/pdf") return 1;
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return Math.max(matches?.length || 1, 1);
}

export function validateCareDocumentFile(file: File, bytes: Uint8Array) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("目前只支援 PDF、JPG、PNG 或 WebP 文件。");
  }
  if (file.size > CARE_DOCUMENT_MAX_FILE_SIZE) {
    throw new Error("單一文件不可超過 25MB。");
  }

  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

  if (
    (file.type === "application/pdf" && !isPdf)
    || (file.type === "image/jpeg" && !isJpeg)
    || (file.type === "image/png" && !isPng)
    || (file.type === "image/webp" && !isWebp)
  ) {
    throw new Error("檔案內容與格式不符，請重新匯出或拍照後再上傳。");
  }
}

export function buildStoragePath(groupId: number, profileId: number, file: File) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const extension = MIME_EXTENSION[file.type] || "bin";
  return `group-${groupId}/profile-${profileId}/${year}-${month}/${crypto.randomUUID()}.${extension}`;
}

function storageObjectUrl(env: Env, bucket: string, path: string) {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

export async function uploadCareDocumentObject(env: Env, bucket: string, path: string, file: File) {
  const response = await fetch(storageObjectUrl(env, bucket, path), {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": file.type,
      "x-upsert": "false",
    },
    body: file,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase Storage upload failed (${response.status}): ${text}`);
  }
}

export async function deleteCareDocumentObject(env: Env, bucket: string, path: string) {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: [path] }),
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    console.warn(JSON.stringify({ event: "documents.storage_delete_failed", status: response.status, message: text.slice(0, 200) }));
  }
}

export async function createCareDocumentSignedUrl(env: Env, bucket: string, path: string) {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: CARE_DOCUMENT_SIGNED_URL_SECONDS }),
    },
  );

  const result = await response.json<any>().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || result?.message || "無法產生文件連結");
  }

  const signedUrl = result.signedURL || result.signedUrl || result.signed_url;
  if (!signedUrl || typeof signedUrl !== "string") throw new Error("無法產生文件連結");
  return signedUrl.startsWith("http")
    ? signedUrl
    : `${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1${signedUrl}`;
}

export async function getCurrentUserDocumentContext(request: Request, env: Env): Promise<CurrentUserDocumentContext> {
  const token = getBearerToken(request);
  if (!token) throw new Error("請先登入");

  const identity = await verifyLineIdToken(env, token);
  const userId = await getOrCreateDefaultUser(env, identity.lineUserId, identity);
  const memberships = await getUserMemberships(env, userId);
  const groupIds = memberships.map((membership) => membership.group_id);
  const profiles = await getAccessibleProfiles(env, userId);
  return { userId, groupIds, profiles };
}

export function resolveAccessibleProfile(context: CurrentUserDocumentContext, profileId: number | null) {
  if (!profileId) return context.profiles[0] || null;
  return context.profiles.find((profile) => profile.id === profileId) || null;
}

export async function fetchAccessibleDocument(env: Env, id: number, groupIds: number[]) {
  if (groupIds.length === 0) return null;
  const rows = await supabaseFetch<CareDocumentRow[]>(
    env,
    `care_documents?id=eq.${id}&group_id=in.(${groupIds.join(",")})&status=neq.deleted&select=*&limit=1`,
  );
  const document = rows[0];
  if (!document?.deleted_at) return document || null;
  return null;
}

export async function buildCareDocumentDetail(env: Env, document: CareDocumentRow): Promise<CareDocumentDetail> {
  const [appointments, medications] = await Promise.all([
    supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?source_document_id=eq.${document.id}&status=neq.deleted&select=*&order=date.asc.nullslast,created_at.desc`,
    ),
    supabaseFetch<MedicationRow[]>(
      env,
      `medications?source_document_id=eq.${document.id}&select=*&order=created_at.desc`,
    ),
  ]);

  return {
    ...serializeCareDocument(document),
    linked_appointments: appointments.map(serializeAppointment),
    linked_medications: medications.map(serializeMedication),
  };
}

export function documentMatchesQuery(document: ReturnType<typeof serializeCareDocument>, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    document.document_title,
    document.source_hospital,
    document.original_file_name,
    document.document_type,
    JSON.stringify(document.ai_summary || {}),
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

