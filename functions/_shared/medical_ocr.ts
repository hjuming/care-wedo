import { getOrCreateDefaultUser, supabaseFetch } from "./supabase";

export type Env = {
  GOOGLE_API_KEY: string;
  GEMINI_MODEL_NAME?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export type ParsedMedicalData = {
  type?: string;
  appointments?: Array<Record<string, any>>;
  medications?: Array<Record<string, any>>;
};

export const medicalDocParsePrompt = `你是 Care WEDO 的醫療單據解析助手，專門協助台灣銀髮族理解醫院文件（如台大醫院、長庚醫院等）。

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

export async function parseMedicalImages(env: Env, images: Array<{ data: string; media_type: string }>) {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY 未設定");
  }

  const model = env.GEMINI_MODEL_NAME || "gemini-3.0-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_API_KEY}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: medicalDocParsePrompt },
          ...images.map(img => ({ inline_data: { mime_type: img.media_type, data: img.data } }))
        ]
      }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  const result = await response.json<any>();

  // ---- 錯誤檢查：API 層級 ----
  if (!response.ok) {
    const errMsg = result?.error?.message || JSON.stringify(result).slice(0, 200);
    throw new Error(`Gemini API 錯誤 (${response.status}): ${errMsg}`);
  }

  // ---- 錯誤檢查：安全過濾或無內容 ----
  const candidate = result.candidates?.[0];
  if (!candidate) {
    const blockReason = result.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini 拒絕處理：${blockReason}` : "Gemini 未回傳任何結果");
  }

  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini 中斷：${candidate.finishReason}`);
  }

  const text = candidate.content?.parts?.[0]?.text;
  if (!text || typeof text !== "string") {
    throw new Error("Gemini 未回傳可解析的文字");
  }

  // ---- 解析 JSON（容錯處理） ----
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}") + 1;
  const jsonText = jsonStart >= 0 ? text.slice(jsonStart, jsonEnd) : text;
  return JSON.parse(jsonText) as ParsedMedicalData;
}

export async function saveParsedData(env: Env, parsed: ParsedMedicalData, lineUserId?: string) {
  const userId = await getOrCreateDefaultUser(env, lineUserId);

  if (parsed.appointments?.length) {
    await supabaseFetch(env, "appointments", {
      method: "POST",
      body: JSON.stringify(parsed.appointments.map(apt => ({
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
        status: "upcoming"
      })))
    });
  }

  if (parsed.medications?.length) {
    await supabaseFetch(env, "medications", {
      method: "POST",
      body: JSON.stringify(parsed.medications.map(med => ({
        user_id: userId,
        name: med.name || null,
        dosage: med.dosage || null,
        frequency: med.frequency || med.freq || null,
        purpose: med.purpose || med.use || null,
        warnings: med.warnings || null,
        reminder_text: med.reminder_text || null,
        active: true
      })))
    });
  }
}
