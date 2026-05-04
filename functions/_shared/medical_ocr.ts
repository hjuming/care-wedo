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

export const medicalDocParsePrompt = `你是 Care WEDO 的醫療單據解析助手，專門協助台灣銀髮族理解醫院文件（如台大醫院等）。

請仔細辨識單據是「檢驗及預約單」還是「慢性病連續處方箋」。
提取所有醫療相關資訊，並以純 JSON 格式回傳（不可包含 Markdown 區塊）。

回傳格式：
{
  "appointments": [
    {
      "type": "clinic_visit", // 可為: clinic_visit (回診), inspection (檢驗), refill_reminder (領藥提醒)
      "date": "YYYY-MM-DD", // 領藥提醒請填入「建議領藥期間」的第一天
      "time": "HH:MM", // 若有「預計來診時間」請轉為 HH:MM 格式，領藥提醒免填
      "hospital": "醫院名稱",
      "department": "科別",
      "doctor": "醫師姓名",
      "number": "看診號碼",
      "location": "報到地點 (如: 西址-2樓)",
      "fasting_required": true,
      "fasting_hours": 8,
      "notes": "重要補充或前置作業（例如：看診前請先量血壓、限頭頸部腫瘤外科等）",
      "reminder_text": "像家人一樣溫暖、口語化的叮嚀"
    }
  ],
  "medications": [
    {
      "name": "藥品名稱（含商品名與學名）",
      "dosage": "每次劑量",
      "frequency": "使用頻率",
      "purpose": "用途",
      "warnings": "警告或副作用",
      "reminder_text": "口語化用藥提醒"
    }
  ]
}

重要規則：
1. 只輸出 JSON。將民國年或口語日期轉成 YYYY-MM-DD。
2. 若單據為「慢性病連續處方箋」，且上方有「第2次建議領藥期間」或「第3次」，請為【每一次】的領藥期間建立一筆 type="refill_reminder" 的 appointment，date 設為該期間的第一天，並在 reminder_text 寫上溫馨提醒（例如：媽媽，明天開始可以去領第二次的慢箋藥物了）。
3. 若為「檢驗及預約單」，請特別留意「附註」或「醫師提醒事項」中有無看診前置作業（如：先量血壓再插卡），並務必放進 notes 或 reminder_text 中提醒。`;

export async function parseMedicalImages(env: Env, images: Array<{ data: string; media_type: string }>) {
  if (!env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY 未設定");
  }

  const model = env.GEMINI_MODEL_NAME || "gemini-2.5-flash";
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
    // 1. 取得該使用者現有的行程，用以比對防呆
    const existingApts = await supabaseFetch<Array<{ id: number; date: string; department: string; type: string }>>(
      env,
      `appointments?user_id=eq.${userId}&select=id,date,department,type`
    );

    for (const apt of parsed.appointments) {
      const type = apt.type || "clinic_visit";
      const date = apt.date || null;
      const dept = apt.department || null;

      // 防呆：尋找是否有同一天、同一科別、同一種類的行程
      const duplicate = existingApts.find(e => e.date === date && e.department === dept && e.type === type);

      const payload = {
        user_id: userId,
        type: type,
        date: date,
        time: apt.time || null,
        hospital: apt.hospital || null,
        department: dept,
        doctor: apt.doctor || null,
        number: apt.number || null,
        location: apt.location || null,
        fasting_required: Boolean(apt.fasting_required),
        fasting_hours: apt.fasting_hours || null,
        notes: apt.notes || null,
        reminder_text: apt.reminder_text || null,
        status: "upcoming"
      };

      if (duplicate) {
        // 更新現有資料 (覆蓋)
        await supabaseFetch(env, `appointments?id=eq.${duplicate.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        // 新增資料
        await supabaseFetch(env, "appointments", {
          method: "POST",
          body: JSON.stringify([payload])
        });
      }
    }
  }

  if (parsed.medications?.length) {
    // 1. 取得該使用者現有的藥物清單
    const existingMeds = await supabaseFetch<Array<{ id: number; name: string }>>(
      env,
      `medications?user_id=eq.${userId}&select=id,name`
    );

    for (const med of parsed.medications) {
      const name = med.name || null;
      // 防呆：尋找是否已經有同名的藥物
      const duplicate = existingMeds.find(e => e.name === name);

      const payload = {
        user_id: userId,
        name: name,
        dosage: med.dosage || null,
        frequency: med.frequency || med.freq || null,
        purpose: med.purpose || med.use || null,
        warnings: med.warnings || null,
        reminder_text: med.reminder_text || null,
        active: true
      };

      if (duplicate) {
        await supabaseFetch(env, `medications?id=eq.${duplicate.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        await supabaseFetch(env, "medications", {
          method: "POST",
          body: JSON.stringify([payload])
        });
      }
    }
  }
}
