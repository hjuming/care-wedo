import { supabaseFetch, Env as SupabaseEnv } from "../../_shared/supabase";

const DEFAULT_RECIPIENT = "親愛的爸爸 / 媽媽";

type Env = SupabaseEnv & {
  CRON_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
};

type AppointmentWithUser = {
  id: number;
  type?: string | null;
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

async function fetchReminderAppointments(env: Env, targetDate: string) {
  const baseSelect = "id,date,time,hospital,department,doctor,number,location,fasting_required,fasting_hours,notes,reminder_text,user_id,users(line_user_id)";
  try {
    return await supabaseFetch<AppointmentWithUser[]>(
      env,
      `appointments?date=eq.${targetDate}&status=eq.upcoming&select=id,type,date,time,hospital,department,doctor,number,location,fasting_required,fasting_hours,notes,reminder_text,user_id,users(line_user_id)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("appointments.type") && !message.includes("column appointments.type does not exist")) {
      throw error;
    }
    const rows = await supabaseFetch<AppointmentWithUser[]>(
      env,
      `appointments?date=eq.${targetDate}&status=eq.upcoming&select=${baseSelect}`,
    );
    return rows.map((row) => ({ ...row, type: "clinic_visit" }));
  }
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
    const reminders = await fetchReminderAppointments(env, targetDate);

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

    // 4. 針對每位使用者發送早安提醒
    for (const [lineUserId, data] of userBriefings.entries()) {
      let msgText = `${DEFAULT_RECIPIENT}，早安。\n今天先看這幾件事就好。\n\n`;

      // 附加用藥提醒
      if (data.meds.length > 0) {
        msgText += "今天要吃的藥：\n";
        for (const med of data.meds) {
          msgText += `• ${med.name} (${med.dosage || "照單子份量"})\n`;
          if (med.frequency) msgText += `  時間：${med.frequency}\n`;
          if (med.reminder_text) msgText += `  ${med.reminder_text}\n`;
        }
        msgText += "\n";
      }

      // 附加明日行程提醒
      if (data.apts.length > 0) {
        msgText += "明天要記得：\n";
        for (const apt of data.apts) {
          if (apt.type === "refill_reminder") {
            msgText += `• 可以去領下一次藥了。\n  地點：${apt.hospital || "醫院或藥局"}\n`;
          } else if (apt.type === "inspection") {
            msgText += `• ${apt.time || ""} ${apt.hospital || ""} ${apt.department || "要去檢查"}\n`;
            if (apt.fasting_required) msgText += `  記得：前 ${apt.fasting_hours || 8} 小時先不要吃東西。\n`;
            if (apt.notes) msgText += `  ${apt.notes}\n`;
          } else {
            msgText += `• ${apt.time || ""} ${apt.hospital || ""} ${apt.department || "要去看診"}\n`;
            if (apt.fasting_required) msgText += `  記得：前 ${apt.fasting_hours || 8} 小時先不要吃東西。\n`;
            if (apt.notes) msgText += `  ${apt.notes}\n`;
          }
        }
      }

      if (data.apts.length === 0 && data.meds.length === 0) {
        continue; // 沒事不吵長輩
      }

      msgText += "\n完整清單在這裡：https://care.wedopr.com";

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
