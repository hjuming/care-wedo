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

export const medicalDocParsePrompt = `你是 Care WEDO 的醫療單據解析助手，專門協助台灣銀髮族理解醫院文件。
請從圖片中提取所有醫療資訊，並以純 JSON 格式回傳。
將民國年轉為 YYYY-MM-DD。reminder_text 必須像子女一樣溫暖叮嚀。`;

export async function parseMedicalImages(env: Env, images: Array<{ data: string; media_type: string }>) {
  const model = env.GEMINI_MODEL_NAME || "gemini-2.0-flash";
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
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 解析失敗");
  return JSON.parse(text) as ParsedMedicalData;
}

export async function saveParsedData(env: Env, parsed: ParsedMedicalData, lineUserId?: string) {
  const userId = await getOrCreateDefaultUser(env, lineUserId);
  
  if (parsed.appointments?.length) {
    await supabaseFetch(env, "appointments", {
      method: "POST",
      body: JSON.stringify(parsed.appointments.map(apt => ({
        user_id: userId,
        date: apt.date || null,
        hospital: apt.hospital || null,
        department: apt.department || null,
        doctor: apt.doctor || null,
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
        frequency: med.frequency || null,
        reminder_text: med.reminder_text || null,
        active: true
      })))
    });
  }
}
