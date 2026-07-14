import {
  buildStoragePath,
  CARE_DOCUMENTS_BUCKET,
  cleanDocumentString,
  inferPageCount,
  normalizeDocumentDate,
  normalizeDocumentType,
  ParsedCareDocumentData,
  resolveAccessibleProfile,
  safeOriginalFilename,
  uploadCareDocumentObject,
  validateCareDocumentFile,
  getCurrentUserDocumentContext,
} from "../../_shared/care_documents";
import {
  Env as SupabaseEnv,
  serializeCareDocument,
  supabaseFetch,
} from "../../_shared/supabase";
import {
  checkGroupOcrQuota,
  incrementGroupOcrQuota,
} from "../../_shared/billing";
import { saveParsedDataToProfile } from "../../_shared/medical_ocr";
import { logError, logEvent } from "../../_shared/logger";
import { sendProductionAlert } from "../../_shared/alerts";
import { requireGroupWriteAccess } from "../../_shared/group_permissions";

type Env = SupabaseEnv & {
  GOOGLE_API_KEY: string;
  GEMINI_MODEL_NAME?: string;
};

const careDocumentPrompt = `你是 Care WEDO 的醫療文件整理助理。
請把使用者上傳的醫院病歷、用藥紀錄、檢查報告或處方文件，整理成家人能在門診出示給醫師快速閱讀的結構化資料。

重要限制：
- 只整理來源文件內容，不提供診斷、不判斷治療方向、不新增醫療建議。
- 如果文件看不清楚，欄位請留空或在 source_warning 說明，不要猜。
- 只輸出純 JSON，不要包含 Markdown。

回傳格式：
{
  "document_type": "medical_record|medication_record|lab_report|imaging_report|prescription|appointment_slip|other",
  "document_title": "給家人看的短標題",
  "source_hospital": "醫院或診所名稱，無法辨識留空字串",
  "document_date": "YYYY-MM-DD，優先使用文件列印/就診/開立日期",
  "patient_name": "病患姓名，無法辨識留空字串",
  "birth_date": "YYYY-MM-DD，無法辨識留空字串",
  "doctor_briefing": {
    "major_history": ["重大病史或診斷摘要，逐點列出"],
    "recent_symptoms": ["近期症狀或主訴"],
    "current_treatment": ["目前治療或處置"],
    "current_medications": ["目前文件列出的用藥重點"],
    "recent_exams": ["最近檢查、影像或檢驗摘要"],
    "upcoming_plan": ["下次回診、檢查、領藥或追蹤安排"],
    "questions_for_doctor": ["家人門診時可確認的事項，只能來自文件中不確定或需確認的內容"],
    "source_warning": "若 OCR 或文件頁面不清楚，請用一句話說明"
  },
  "appointments": [
    {
      "type": "clinic_visit|inspection|refill_reminder|other",
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "title": "提醒標題",
      "hospital": "醫院名稱",
      "department": "科別",
      "doctor": "醫師姓名",
      "number": "號碼",
      "location": "地點",
      "fasting_required": false,
      "fasting_hours": null,
      "notes": "重要注意事項",
      "reminder_text": "給家人的短提醒"
    }
  ],
  "medications": [
    {
      "name": "藥品名稱",
      "dosage": "每次劑量",
      "frequency": "使用頻率",
      "time_slot": "早|中|晚|睡前|其他，可留空",
      "meal_timing": "飯前|飯後|可留空",
      "purpose": "文件中的用途或用藥原因",
      "warnings": "文件列出的注意事項",
      "reminder_text": "給家人的短提醒"
    }
  ]
}`;

function documentUploadStatus(message: string) {
  if (message.includes("請先登入")) return 401;
  if (message.includes("權限")) return 403;
  if (message.includes("次數") || message.includes("額度")) return 429;
  if (
    message.includes("請使用表單")
    || message.includes("請選擇")
    || message.includes("目前只支援")
    || message.includes("單一文件不可超過")
    || message.includes("檔案內容與格式不符")
    || message.includes("照護對象")
  ) {
    return 400;
  }
  return 500;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function parseCareDocument(env: Env, file: File, bytes: Uint8Array): Promise<ParsedCareDocumentData> {
  if (!env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY is not configured.");
  const model = env.GEMINI_MODEL_NAME || "gemini-3.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_API_KEY}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: careDocumentPrompt },
          { inline_data: { mime_type: file.type, data: bytesToBase64(bytes) } },
        ],
      }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  const result = await response.json<any>().catch(() => ({}));
  if (!response.ok) {
    const detail = result?.error?.message || "Gemini request failed.";
    throw new Error(`文件解析失敗：${detail}`);
  }

  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== "string") throw new Error("文件解析沒有回傳可讀結果");
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}") + 1;
  return JSON.parse(jsonStart >= 0 ? text.slice(jsonStart, jsonEnd) : text) as ParsedCareDocumentData;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const startedAt = Date.now();
  let documentId: number | null = null;

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return Response.json({ error: "請使用表單上傳文件" }, { status: 400 });
    }

    const documentContext = await getCurrentUserDocumentContext(context);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "請選擇要上傳的 PDF 或圖片" }, { status: 400 });
    }

    const requestedProfileId = Number(formData.get("profile_id"));
    const profile = resolveAccessibleProfile(
      documentContext,
      Number.isFinite(requestedProfileId) && requestedProfileId > 0 ? requestedProfileId : null,
    );
    if (!profile?.group_id) {
      return Response.json({ error: "請先選擇照護對象" }, { status: 400 });
    }
    await requireGroupWriteAccess(env, documentContext.userId, profile.group_id);

    const bytes = new Uint8Array(await file.arrayBuffer());
    validateCareDocumentFile(file, bytes);
    const pageCount = inferPageCount(file, bytes);
    const preserveOriginalFile = String(formData.get("preserve_original_file") ?? "true") !== "false";
    const originalFileName = safeOriginalFilename(file);
    const storagePath = preserveOriginalFile ? buildStoragePath(profile.group_id, profile.id, file) : null;
    const storageBucket = preserveOriginalFile ? CARE_DOCUMENTS_BUCKET : null;

    const groupPlan = await checkGroupOcrQuota(env, profile.group_id);

    if (preserveOriginalFile && storagePath) {
      await uploadCareDocumentObject(env, CARE_DOCUMENTS_BUCKET, storagePath, file);
    }

    const initialRows = await supabaseFetch<Array<{ id: number }>>(env, "care_documents?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        group_id: profile.group_id,
        profile_id: profile.id,
        uploaded_by_user_id: documentContext.userId,
        document_type: normalizeDocumentType(formData.get("document_type")),
        storage_bucket: storageBucket,
        storage_path: storagePath,
        original_file_name: originalFileName,
        mime_type: file.type,
        file_size_bytes: file.size,
        page_count: pageCount,
        summary_status: "processing",
        preserve_original_file: preserveOriginalFile,
        status: "processing",
        captured_at: new Date().toISOString(),
      }),
    });
    documentId = initialRows[0]?.id || null;
    if (!documentId) throw new Error("無法建立文件紀錄");

    const parsed = await parseCareDocument(env, file, bytes);
    const documentType = normalizeDocumentType(parsed.document_type || formData.get("document_type"));
    const updatedRows = await supabaseFetch<any[]>(env, `care_documents?id=eq.${documentId}&select=*`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        document_type: documentType,
        document_title: cleanDocumentString(parsed.document_title, 120) || originalFileName,
        source_hospital: cleanDocumentString(parsed.source_hospital, 120) || null,
        document_date: normalizeDocumentDate(parsed.document_date) || null,
        ocr_text: JSON.stringify(parsed),
        ai_summary: parsed,
        summary_status: "ready",
        status: "confirmed",
      }),
    });

    const saved = await saveParsedDataToProfile(env, parsed, documentContext.userId, profile, documentId);
    await incrementGroupOcrQuota(env, profile.group_id, groupPlan);

    logEvent("documents.upload_completed", {
      user_id: documentContext.userId,
      group_id: profile.group_id,
      profile_id: profile.id,
      document_id: documentId,
      document_type: documentType,
      preserve_original_file: preserveOriginalFile,
      duration_ms: Date.now() - startedAt,
    });

    return Response.json({
      success: true,
      document: serializeCareDocument(updatedRows[0]),
      saved,
    });
  } catch (error) {
    if (documentId) {
      await supabaseFetch(env, `care_documents?id=eq.${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          summary_status: "failed",
          ai_summary: { error: error instanceof Error ? error.message : "文件解析失敗" },
        }),
      }).catch(() => null);
    }
    logError("documents.upload_failed", error, { document_id: documentId, duration_ms: Date.now() - startedAt });
    await sendProductionAlert(env, "documents.upload_failed", { document_id: documentId, error });
    const message = error instanceof Error ? error.message : "文件上傳失敗";
    return Response.json({ error: message, document_id: documentId }, { status: documentUploadStatus(message) });
  }
};
