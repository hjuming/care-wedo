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
  users: { line_user_id: string } | null;
};

/** 用 Push API 主動推送訊息給使用者 */
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

/** 標記行程為已完成或已通知 */
async function markAsNotified(env: Env, id: number) {
  await supabaseFetch(env, `appointments?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "notified" }),
  });
}

/**
 * 處理自動推播：每天固定時間呼叫這支 API
 * 範例呼叫： POST /api/cron/reminders
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // 1. 安全驗證：確認有加上正確的 Header，防止惡意觸發
  const authHeader = request.headers.get("Authorization");
  if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. 計算目標日期（例如：抓取「明天」的行程來提醒）
    // 在 UTC+8 時區計算明天的日期
    const now = new Date();
    // 轉為台灣時間 UTC+8
    const twTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    twTime.setDate(twTime.getDate() + 1); // 抓明天的日期
    
    const targetDate = twTime.toISOString().split("T")[0]; // YYYY-MM-DD

    // 3. 撈取資料庫中，明天需要推播且狀態為 upcoming 的行程
    // 使用 users(line_user_id) 進行關聯查詢
    const path = `appointments?date=eq.${targetDate}&status=eq.upcoming&select=id,type,date,time,hospital,department,doctor,number,location,fasting_required,fasting_hours,notes,reminder_text,user_id,users(line_user_id)`;
    const reminders = await supabaseFetch<AppointmentWithUser[]>(env, path);

    let sentCount = 0;

    // 4. 針對每筆資料，發送 LINE Push 並更新狀態
    for (const apt of reminders) {
      const lineUserId = apt.users?.line_user_id;
      // 如果沒有綁定 LINE ID，就跳過（例如 Web MVP 的預設使用者）
      if (!lineUserId || lineUserId === "web-mvp") continue;

      let msgText = "";

      if (apt.type === "refill_reminder") {
        msgText = `💊 【慢箋領藥提醒】\n${apt.reminder_text || "您有慢性病連續處方箋明天開始可以領藥囉！請記得攜帶健保卡與處方箋。"} \n\n地點：${apt.hospital || "醫院/社區藥局"}`;
      } else {
        msgText = `🏥 【明日回診提醒】\n您明天有一筆行程：\n\n📅 日期：${apt.date} ${apt.time || ""}\n🏥 地點：${apt.hospital || ""} ${apt.department || ""} ${apt.location || ""}`;
        if (apt.doctor) msgText += `\n👨‍⚕️ 醫師：${apt.doctor}`;
        if (apt.number) msgText += `\n🔢 診號：${apt.number}`;
        
        if (apt.fasting_required) {
          msgText += `\n\n⚠️ 【重要：需空腹】\n請於看診/抽血前空腹 ${apt.fasting_hours || 8} 小時。`;
        }
        if (apt.notes) {
          msgText += `\n\n🔔 【前置作業】\n${apt.notes}`;
        }
        if (apt.reminder_text && apt.reminder_text !== apt.notes) {
          msgText += `\n\n💬 ${apt.reminder_text}`;
        }
      }

      msgText += "\n\n👉 點此查看：https://care.wedopr.com";

      // 傳送推播
      await pushText(env, lineUserId, msgText);
      // 標記為已通知
      await markAsNotified(env, apt.id);
      sentCount++;
    }

    // 5. 處理已過期的預約（把今天以前且狀態還是 upcoming 的改為 expired）
    // 這樣資料會保留在資料庫供查詢，但不會再被視為待辦事項
    const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
    await supabaseFetch(env, `appointments?date=lt.${today}&status=eq.upcoming`, {
      method: "PATCH",
      body: JSON.stringify({ status: "expired" }), // expired 代表過期保留
    });

    return Response.json({ success: true, processed_date: targetDate, sent_count: sentCount });
  } catch (error) {
    console.error("Cron Worker Error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
};
