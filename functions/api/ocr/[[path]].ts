import { getOrCreateDefaultUser, supabaseFetch } from "../../_shared/supabase";

type Env = {
  GOOGLE_API_KEY: string;
  GEMINI_MODEL_NAME?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

type ParsedMedicalData = {
  type?: string;
  appointments?: Array<Record<string, unknown>>;
  medications?: Array<Record<string, unknown>>;
};

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

const medicalDocParsePrompt = `你是 Care WEDO 的醫療單據解析助手，專門協助台灣銀髮族理解醫院文件（如台大醫院、長庚醫院等）。

請從以下圖片中提取所有醫療相關資訊，並以純 JSON 格式回傳，不要包含 Markdown 區塊。

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
      "notes": "重要補充",
      "reminder_text": "像家人一樣溫暖提醒"
    }
  ],
  "medications": [
    {
      "name": "藥名",
      "dosage": "劑量",
      "frequency": "頻率",
      "purpose": "用途",
      "warnings": "警告",
      "reminder_text": "口語化提醒"
    }
  ]
}

重要規則：
1. 只輸出 JSON。
2. 將民國年或口語日期轉成 YYYY-MM-DD。
3. 特別留意台大醫院東址、西址與報到地點。
4. reminder_text 必須溫暖、清楚、像子女叮嚀。`;

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

  const model = env.GEMINI_MODEL_NAME || "gemini-2.0-flash";
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

async function saveParsedData(env: Env, parsed: ParsedMedicalData) {
  const userId = await getOrCreateDefaultUser(env);
  const saved = { appointment_ids: [] as number[], medication_ids: [] as number[] };

  const appointments = (parsed.appointments || []).map((apt) => ({
    user_id: userId,
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
  try {
    const contentType = request.headers.get("content-type") || "";
    const images: Array<{ data: string; media_type: string }> = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const files = formData.getAll("images").filter((item): item is File => item instanceof File);

      if (!files.length) {
        return Response.json({ error: "請上傳至少一張圖片" }, { status: 400 });
      }
      if (files.length > MAX_FILES) {
        return Response.json({ error: `最多上傳 ${MAX_FILES} 張圖片` }, { status: 400 });
      }

      for (const file of files) {
        if (!ALLOWED_TYPES.has(file.type)) {
          return Response.json({ error: `不支援的檔案格式: ${file.type}` }, { status: 400 });
        }
        if (file.size > MAX_FILE_SIZE) {
          return Response.json({ error: "單張圖片不可超過 10MB" }, { status: 400 });
        }
        images.push({ data: await fileToBase64(file), media_type: file.type });
      }
    } else {
      return Response.json({ error: "不支援的 Content-Type" }, { status: 400 });
    }

    const data = await parseMedicalImages(env, images);
    const saved = await saveParsedData(env, data);
    return Response.json({ success: true, data, saved });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "OCR API failed" },
      { status: 500 },
    );
  }
};
