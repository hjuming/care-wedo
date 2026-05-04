import { getOrCreateDefaultUser, resolveDefaultCareContext, supabaseFetch } from "./supabase";

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

export const medicalDocParsePrompt = `你是 Care WEDO 的 LINE 健康小管家。
你的任務是幫子女把爸媽的醫院單子整理成「看得懂、做得到」的提醒。

請仔細辨識單據是「檢驗及預約單」還是「慢性病連續處方箋」。
提取所有醫療相關資訊，並以純 JSON 格式回傳（不可包含 Markdown 區塊）。

提醒文字語氣：
- 像子女提醒自家長輩，不像醫院公告。
- 預設稱謂用「親愛的爸爸 / 媽媽」。使用者之後可在後台改稱謂。
- reminder_text 每則最多 45 個中文字。
- 用短句。不要說教，不要嚇人。
- 少用專業醫學名詞。若一定要保留，請用白話補一句。
- 不要寫「請遵醫囑」「建議諮詢醫師」這種制式句。
- 優先提醒：哪一天、幾點、去哪裡、要帶什麼、能不能吃東西。

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
      "notes": "重要補充或前置作業（例如：看診前先量血壓、記得帶健保卡）",
      "reminder_text": "親愛的爸爸 / 媽媽，明天要去台大看診，記得帶健保卡。"
    }
  ],
  "medications": [
    {
      "name": "藥品名稱（含商品名與學名）",
      "dosage": "每次劑量",
      "frequency": "使用頻率",
      "purpose": "用途",
      "warnings": "注意事項，請改成白話",
      "reminder_text": "親愛的爸爸 / 媽媽，這顆藥照單子時間吃就好。"
    }
  ]
}

重要規則：
1. 只輸出 JSON。將民國年或口語日期轉成 YYYY-MM-DD。
2. 若單據為「慢性病連續處方箋」，且上方有「第2次建議領藥期間」或「第3次」，請為【每一次】的領藥期間建立一筆 type="refill_reminder" 的 appointment，date 設為該期間的第一天。
3. 領藥 reminder_text 範例：「親愛的爸爸 / 媽媽，明天開始可以領下一次藥了，記得帶健保卡。」
4. 若為「檢驗及預約單」，請特別留意附註中有無看診前要做的事，如先量血壓、空腹、帶健保卡，務必放進 notes 或 reminder_text。
5. 藥名可照單子保留，但 purpose、warnings、reminder_text 要盡量白話。`;

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
  const careContext = await resolveDefaultCareContext(env, userId);

  if (parsed.appointments?.length) {
    // 1. 取得該使用者現有的行程，用以比對防呆。
    // 部分已上線 Supabase 專案可能尚未補上 appointments.type，先降級避免 OCR 儲存失敗。
    let supportsAppointmentType = true;
    let existingApts: Array<{ id: number; date: string | null; department: string | null; type?: string | null }>;
    try {
      existingApts = await supabaseFetch(env, `appointments?user_id=eq.${userId}&select=id,date,department,type`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("appointments.type") && !message.includes("column appointments.type does not exist")) {
        throw error;
      }
      supportsAppointmentType = false;
      existingApts = await supabaseFetch(env, `appointments?user_id=eq.${userId}&select=id,date,department`);
    }

    for (const apt of parsed.appointments) {
      const type = apt.type || "clinic_visit";
      const date = apt.date || null;
      const dept = apt.department || null;

      // 防呆：尋找是否有同一天、同一科別、同一種類的行程
      const duplicate = existingApts.find((e) => {
        const sameDateAndDept = e.date === date && e.department === dept;
        if (!sameDateAndDept) return false;
        return supportsAppointmentType ? e.type === type : true;
      });

      const payload: Record<string, unknown> = {
        user_id: userId,
        group_id: careContext.groupId,
        profile_id: careContext.profileId,
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
      if (supportsAppointmentType) payload.type = type;

      if (duplicate) {
        // 更新現有資料 (覆蓋)
        try {
          await supabaseFetch(env, `appointments?id=eq.${duplicate.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("appointments.profile_id") && !message.includes("appointments.group_id")) {
            throw error;
          }
          delete payload.profile_id;
          delete payload.group_id;
          await supabaseFetch(env, `appointments?id=eq.${duplicate.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
        }
      } else {
        // 新增資料
        try {
          await supabaseFetch(env, "appointments", {
            method: "POST",
            body: JSON.stringify([payload])
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("appointments.profile_id") && !message.includes("appointments.group_id")) {
            throw error;
          }
          delete payload.profile_id;
          delete payload.group_id;
          await supabaseFetch(env, "appointments", {
            method: "POST",
            body: JSON.stringify([payload])
          });
        }
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

      const payload: Record<string, unknown> = {
        user_id: userId,
        group_id: careContext.groupId,
        profile_id: careContext.profileId,
        name: name,
        dosage: med.dosage || null,
        frequency: med.frequency || med.freq || null,
        purpose: med.purpose || med.use || null,
        warnings: med.warnings || null,
        reminder_text: med.reminder_text || null,
        active: true
      };

      if (duplicate) {
        try {
          await supabaseFetch(env, `medications?id=eq.${duplicate.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("medications.profile_id") && !message.includes("medications.group_id")) {
            throw error;
          }
          delete payload.profile_id;
          delete payload.group_id;
          await supabaseFetch(env, `medications?id=eq.${duplicate.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
        }
      } else {
        try {
          await supabaseFetch(env, "medications", {
            method: "POST",
            body: JSON.stringify([payload])
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("medications.profile_id") && !message.includes("medications.group_id")) {
            throw error;
          }
          delete payload.profile_id;
          delete payload.group_id;
          await supabaseFetch(env, "medications", {
            method: "POST",
            body: JSON.stringify([payload])
          });
        }
      }
    }
  }
}
