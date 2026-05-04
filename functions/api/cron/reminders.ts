import { supabaseFetch, Env as SupabaseEnv } from "../../_shared/supabase";

type Env = SupabaseEnv & {
  CRON_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
};

type AppointmentWithUser = {
  id: number;
  type: string;
  date: string;
  time: string | null;
  hospital: string | null;
  department: string | null;
  doctor: string | null;
  number: string | null;
  location: string | null;
  fasting_required: boolean;
  fasting_hours: number | null;
  notes: string | null;
  reminder_text: string | null;
  status: string;
  user_id: number;
  users: { line_user_id: string } | null;
};

type MedicationWithUser = {
  id: number;
  name: string;
  dosage: string | null;
  frequency: string | null;
  purpose: string | null;
  warnings: string | null;
  reminder_text: string | null;
  user_id: number;
  users: { line_user_id: string } | null;
};

async function pushText(env: Env, userId: string, text: string) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return;

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(`LINE push failed (${response.status}): ${detail}`);
  }
}

async function markAsNotified(env: Env, id: number) {
  await supabaseFetch(env, `appointments?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "notified" }),
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const authHeader = request.headers.get("Authorization");
  if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const twTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    twTime.setDate(twTime.getDate() + 1); // 抓明天的日期
    const targetDate = twTime.toISOString().split("T")[0];

    // 1. 撈取明天需要推播的行程
    const aptPath = `appointments?date=eq.${targetDate}&status=eq.upcoming&select=id,type,date,time,hospital,department,doctor,number,location,fasting_required,fasting_hours,notes,reminder_text,user_id,users(line_user_id)`;
    const reminders = await supabaseFetch<AppointmentWithUser[]>(env, aptPath);

    // 2. 撈取目前正在服用的藥物
    const medPath = `medications?active=eq.true&select=id,name,dosage,frequency,purpose,warnings,reminder_text,user_id,users(line_user_id)`;
    const activeMeds = await supabaseFetch<MedicationWithUser[]>(env, medPath);

    // 3. 依照使用者 ID 分組 (以確保同一個使用者只會收到一則長訊息)
    const userBriefings = new Map<string, { apts: AppointmentWithUser[]; meds: MedicationWithUser[] }>();

    for (const apt of reminders) {
      const lineId = apt.users?.line_user_id;
      if (!lineId || lineId === "web-mvp") continue;
      if (!userBriefings.has(lineId)) userBriefings.set(lineId, { apts: [], meds: [] });
      userBriefings.get(lineId)!.apts.push(apt);
    }

    for (const med of activeMeds) {
      const lineId = med.users?.line_user_id;
      if (!lineId || lineId === "web-mvp") continue;
      if (!userBriefings.has(lineId)) userBriefings.set(lineId, { apts: [], meds: [] });
      userBriefings.get(lineId)!.meds.push(med);
    }

    let sentCount = 0;

    // 4. 針對每位使用者發送專屬的「早安健康簡報」
    for (const [lineUserId, data] of userBriefings.entries()) {
      let msgText = "☀️ 早安！這裡是 Care WEDO 健康小管家：\n\n";

      // 附加用藥提醒
      if (data.meds.length > 0) {
        msgText += "💊 【今日用藥提醒】\n請記得按時服用以下藥物：\n";
        for (const med of data.meds) {
          msgText += `• ${med.name} (${med.dosage || "適量"})\n`;
          if (med.frequency) msgText += `  時機：${med.frequency}\n`;
          if (med.reminder_text) msgText += `  💡 ${med.reminder_text}\n`;
        }
        msgText += "\n";
      }

      // 附加明日行程提醒
      if (data.apts.length > 0) {
        msgText += "🏥 【明日行程預告】\n";
        for (const apt of data.apts) {
          if (apt.type === "refill_reminder") {
            msgText += `[慢箋領藥] 明天開始可領藥！\n地點：${apt.hospital || "醫院/社區藥局"}\n`;
          } else {
            msgText += `[回診] ${apt.time || ""} ${apt.hospital || ""} ${apt.department || ""}\n`;
            if (apt.fasting_required) msgText += `⚠️ 需空腹 ${apt.fasting_hours || 8} 小時\n`;
            if (apt.notes) msgText += `💡 ${apt.notes}\n`;
          }
        }
      }

      if (data.apts.length === 0 && data.meds.length === 0) {
        continue; // 沒事不吵長輩
      }

      msgText += "\n👉 點此查看完整清單：https://care.wedopr.com";

      await pushText(env, lineUserId, msgText);
      sentCount++;

      // 標記行程為已通知
      for (const apt of data.apts) {
        await markAsNotified(env, apt.id);
      }
    }

    // 5. 處理已過期的預約
    const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
    await supabaseFetch(env, `appointments?date=lt.${today}&status=eq.upcoming`, {
      method: "PATCH",
      body: JSON.stringify({ status: "expired" }),
    });

    return Response.json({ success: true, processed_date: targetDate, users_notified: sentCount });
  } catch (error) {
    console.error("Cron Worker Error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
};
