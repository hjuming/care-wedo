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
  fasting_required: boolean;
  fasting_hours: number | null;
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
    console.error(`LINE push failed: ${await response.text()}`);
  }
}

/** 計算空腹起始時間字串 */
function calculateFastingStart(apptTime: string | null, hours: number | null): string {
  if (!apptTime || !hours) {
    return `看診或檢查前 ${hours || 8} 小時`;
  }
  // apptTime 格式預期為 HH:MM
  const [hh, mm] = apptTime.split(":");
  let apptHour = parseInt(hh, 10);
  const apptMin = parseInt(mm, 10);

  if (isNaN(apptHour) || isNaN(apptMin)) {
    return `看診或檢查前 ${hours} 小時`;
  }

  // 減去空腹小時
  apptHour -= hours;
  
  let dayPrefix = "今天";
  if (apptHour < 0) {
    apptHour += 24;
    dayPrefix = "昨晚/凌晨"; 
    // 若晚上 8 點推播，此處的「昨天」其實是指推播當天的深夜
    dayPrefix = "今晚/凌晨"; 
  } else {
    dayPrefix = "明天早上";
  }

  const formattedHour = apptHour.toString().padStart(2, "0");
  const formattedMin = apptMin.toString().padStart(2, "0");

  return `${dayPrefix} ${formattedHour}:${formattedMin}`;
}

async function fetchFastingAppointments(env: Env, targetDate: string) {
  const baseSelect = "id,date,time,hospital,department,fasting_required,fasting_hours,user_id,users(line_user_id)";
  try {
    return await supabaseFetch<AppointmentWithUser[]>(
      env,
      `appointments?date=eq.${targetDate}&fasting_required=eq.true&status=in.(upcoming,notified)&select=id,type,date,time,hospital,department,fasting_required,fasting_hours,user_id,users(line_user_id)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("appointments.type") && !message.includes("column appointments.type does not exist")) {
      throw error;
    }
    const rows = await supabaseFetch<AppointmentWithUser[]>(
      env,
      `appointments?date=eq.${targetDate}&fasting_required=eq.true&status=in.(upcoming,notified)&select=${baseSelect}`,
    );
    return rows.map((row) => ({ ...row, type: "clinic_visit" }));
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get("Authorization");
  if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const twTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    twTime.setDate(twTime.getDate() + 1); // 抓明天的日期
    const targetDate = twTime.toISOString().split("T")[0];

    // 抓取明天需要空腹的行程 (狀態可能是 upcoming 或早上發過的 notified)
    const fastingApts = await fetchFastingAppointments(env, targetDate);

    let sentCount = 0;

    for (const apt of fastingApts) {
      const lineUserId = apt.users?.line_user_id;
      if (!lineUserId || lineUserId === "web-mvp") continue;

      const typeLabel = apt.type === "inspection" ? "檢查" : "看診";
      const hours = apt.fasting_hours || 8;
      const startTimeText = calculateFastingStart(apt.time, hours);

      const msgText = `${DEFAULT_RECIPIENT}，晚安。\n\n提醒您一下：明天 ${apt.time || ""} 要去 ${apt.hospital || "醫院"} ${typeLabel}。\n\n${startTimeText} 開始，先不要吃東西。水能不能喝，要看單子上的說明。\n\n健保卡和單子也先放好，明天比較不會急。`;

      await pushText(env, lineUserId, msgText);
      sentCount++;
    }

    return Response.json({ success: true, processed_date: targetDate, sent_count: sentCount });
  } catch (error) {
    console.error("Evening Cron Error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
};
