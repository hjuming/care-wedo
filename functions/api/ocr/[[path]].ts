import {
  checkOcrQuota,
  getAccessibleProfiles,
  getBearerToken,
  getOrCreateDefaultUser,
  resolveDefaultCareContext,
  supabaseFetch,
  verifyLineIdToken,
} from "../../_shared/supabase";
import { logError, logEvent } from "../../_shared/logger";

type Env = {
  GOOGLE_API_KEY: string;
  GEMINI_MODEL_NAME?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LINE_LOGIN_CHANNEL_ID?: string;
};

type ParsedMedicalData = {
  type?: string;
  appointments?: Array<Record<string, unknown>>;
  medications?: Array<Record<string, unknown>>;
};

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

const medicalDocParsePrompt = `你是 Care WEDO 的 LINE 健康小管家。
你的任務是幫子女把爸媽的醫院單子整理成「看得懂、做得到」的提醒。

請從以下圖片中提取所有醫療相關資訊，並以純 JSON 格式回傳，不要包含 Markdown 區塊。

提醒文字語氣：
- 像子女提醒自家長輩，不像醫院公告。
- 預設稱謂用「親愛的爸爸 / 媽媽」。使用者之後可在後台改稱謂。
- reminder_text 每則最多 45 個中文字。
- 用短句。不要說教，不要嚇人。
- 少用專業醫學名詞。若一定要保留，請用白話補一句。
- 優先提醒：哪一天、幾點、去哪裡、要帶什麼、能不能吃東西。

回傳格式：
{
  "type": "appointment|medication|exam|report",
  "appointments": [
    {
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "hospital": "醫院名稱",
      "department": "科別",
      "doctor": "醫師姓名",
      "number": "看診號碼",
      "location": "報到地點",
      "fasting_required": true,
      "fasting_hours": 8,
      "notes": "重要補充，例如先量血壓、記得帶健保卡",
      "reminder_text": "親愛的爸爸 / 媽媽，明天要去醫院，記得帶健保卡。"
    }
  ],
  "medications": [
    {
      "name": "藥名",
      "dosage": "劑量",
      "frequency": "頻率",
      "purpose": "用途",
      "warnings": "注意事項，請改成白話",
      "reminder_text": "親愛的爸爸 / 媽媽，這顆藥照單子時間吃就好。"
    }
  ]
}

重要規則：
1. 只輸出 JSON。
2. 將民國年或口語日期轉成 YYYY-MM-DD。
3. 特別留意台大醫院東址、西址與報到地點。
4. reminder_text 必須溫暖、清楚、像子女叮嚀。
5. 不要在 reminder_text 裡堆太多醫學名稱。時間、地點、要帶什麼最重要。`;

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function parseMedicalImages(env: Env, images: Array<{ data: string; media_type: string }>) {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not configured.");
  }

  const model = env.GEMINI_MODEL_NAME || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_API_KEY}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: medicalDocParsePrompt },
            ...images.map((image) => ({
              inline_data: {
                mime_type: image.media_type,
                data: image.data,
              },
            })),
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  const geminiResult = await response.json<Record<string, unknown>>();
  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}).`);
  }

  const text = (geminiResult.candidates as Array<any> | undefined)?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== "string") {
    throw new Error("Gemini did not return parsable text.");
  }

  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}") + 1;
  const jsonText = jsonStart >= 0 ? text.slice(jsonStart, jsonEnd) : text;
  return JSON.parse(jsonText) as ParsedMedicalData;
}

async function resolveRequestedProfile(env: Env, userId: number, requestedProfileId: number | null) {
  if (!requestedProfileId) return null;
  const profiles = await getAccessibleProfiles(env, userId);
  return profiles.find((profile) => profile.id === requestedProfileId) || null;
}

async function saveParsedData(env: Env, parsed: ParsedMedicalData, userId: number, requestedProfileId: number | null) {
  const defaultContext = await resolveDefaultCareContext(env, userId);
  const requestedProfile = await resolveRequestedProfile(env, userId, requestedProfileId);
  const profileId = requestedProfile?.id || defaultContext.profileId;
  const groupId = requestedProfile?.group_id || defaultContext.groupId;

  const saved = { appointment_ids: [] as number[], medication_ids: [] as number[] };

  const appointments = (parsed.appointments || []).map((apt) => ({
    user_id: userId,
    group_id: groupId,
    profile_id: profileId,
    type: apt.type || "clinic_visit",
    date: apt.date || null,
    time: apt.time || null,
    hospital: apt.hospital || null,
    department: apt.department || null,
    doctor: apt.doctor || null,
    number: apt.number || null,
    location: apt.location || null,
    fasting_required: Boolean(apt.fasting_required),
    fasting_hours: apt.fasting_hours || null,
    notes: apt.notes || null,
    reminder_text: apt.reminder_text || null,
    status: "upcoming",
  }));

  if (appointments.length) {
    const inserted = await supabaseFetch<Array<{ id: number }>>(env, "appointments?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(appointments),
    });
    saved.appointment_ids = inserted.map((row) => row.id);
  }

  const medications = (parsed.medications || []).map((med) => ({
    user_id: userId,
    group_id: groupId,
    profile_id: profileId,
    name: med.name || null,
    dosage: med.dosage || null,
    frequency: med.frequency || med.freq || null,
    purpose: med.purpose || med.use || null,
    warnings: med.warnings || null,
    reminder_text: med.reminder_text || null,
    active: true,
  }));

  if (medications.length) {
    const inserted = await supabaseFetch<Array<{ id: number }>>(env, "medications?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(medications),
    });
    saved.medication_ids = inserted.map((row) => row.id);
  }

  return saved;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const requestStartedAt = Date.now();
  try {
    const contentType = request.headers.get("content-type") || "";
    const images: Array<{ data: string; media_type: string }> = [];
    let requestedProfileId: number | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const profileIdValue = formData.get("profile_id");
      requestedProfileId = typeof profileIdValue === "string" && profileIdValue
        ? Number(profileIdValue)
        : null;
      if (!Number.isFinite(requestedProfileId)) requestedProfileId = null;
      const files = formData.getAll("images").filter((item): item is File => item instanceof File);

      if (!files.length) {
        logEvent("ocr.validation_failed", { reason: "missing_files" });
        return Response.json({ error: "請上傳至少一張圖片" }, { status: 400 });
      }
      if (files.length > MAX_FILES) {
        logEvent("ocr.validation_failed", { reason: "too_many_files", file_count: files.length });
        return Response.json({ error: `最多上傳 ${MAX_FILES} 張圖片` }, { status: 400 });
      }

      for (const file of files) {
        if (!ALLOWED_TYPES.has(file.type)) {
          logEvent("ocr.validation_failed", { reason: "unsupported_type", file_type: file.type });
          return Response.json({ error: `不支援的檔案格式: ${file.type}` }, { status: 400 });
        }
        if (file.size > MAX_FILE_SIZE) {
          logEvent("ocr.validation_failed", { reason: "file_too_large", file_size: file.size });
          return Response.json({ error: "單張圖片不可超過 10MB" }, { status: 400 });
        }
        images.push({ data: await fileToBase64(file), media_type: file.type });
      }
    } else {
      logEvent("ocr.validation_failed", { reason: "unsupported_content_type" });
      return Response.json({ error: "不支援的 Content-Type" }, { status: 400 });
    }

    const token = getBearerToken(request);
    if (!token) {
      logEvent("ocr.unauthenticated", { file_count: images.length });
      return Response.json({ error: "請先登入後再使用 OCR。" }, { status: 401 });
    }

    const identity = await verifyLineIdToken(env, token);
    const userId = await getOrCreateDefaultUser(env, identity.lineUserId);
    logEvent("ocr.request_started", {
      user_id: userId,
      profile_id: requestedProfileId,
      file_count: images.length,
      line_user_suffix: identity.lineUserId.slice(-4),
    });

    // Check OCR quota for free plan users
    try {
      await checkOcrQuota(env, userId);
    } catch (quotaError) {
      logError("ocr.quota_exceeded", quotaError, { user_id: userId });
      return Response.json(
        { error: quotaError instanceof Error ? quotaError.message : "超過使用次數限制" },
        { status: 429 },
      );
    }

    const data = await parseMedicalImages(env, images);
    const saved = await saveParsedData(env, data, userId, requestedProfileId);
    logEvent("ocr.request_completed", {
      user_id: userId,
      profile_id: requestedProfileId,
      appointment_count: data.appointments?.length || 0,
      medication_count: data.medications?.length || 0,
      saved_appointment_count: saved.appointment_ids.length,
      saved_medication_count: saved.medication_ids.length,
      duration_ms: Date.now() - requestStartedAt,
    });
    return Response.json({ success: true, data, saved });
  } catch (error) {
    logError("ocr.request_failed", error, { duration_ms: Date.now() - requestStartedAt });
    return Response.json(
      { error: error instanceof Error ? error.message : "OCR API failed" },
      { status: 500 },
    );
  }
};
