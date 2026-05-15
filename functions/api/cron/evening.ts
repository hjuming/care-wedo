import { supabaseFetch, Env as SupabaseEnv } from "../../_shared/supabase";
import { logError, logEvent } from "../../_shared/logger";

const DEFAULT_RECIPIENT = "親愛的家人";
const BRAND_SIGNATURE = "Care WEDO\n陪你照顧最重要的人\nhttps://care.wedopr.com";

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
  group_id: number | null;
  profile_id: number | null;
  users: { line_user_id: string } | null;
};

type CareProfile = {
  id: number;
  group_id: number | null;
  display_name: string | null;
};

type RecipientRow = {
  group_id: number;
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
    logError("cron.evening_push_failed", new Error(`LINE push failed (${response.status})`), {
      line_user_suffix: userId.slice(-4),
      status: response.status,
      detail,
    });
  }
}

function calculateFastingStart(apptTime: string | null, hours: number | null): string {
  if (!apptTime || !hours) {
    return `看診或檢查前 ${hours || 8} 小時`;
  }

  const [hh, mm] = apptTime.split(":");
  let apptHour = parseInt(hh, 10);
  const apptMin = parseInt(mm, 10);

  if (isNaN(apptHour) || isNaN(apptMin)) {
    return `看診或檢查前 ${hours} 小時`;
  }

  apptHour -= hours;
  let dayPrefix = "今天";

  if (apptHour < 0) {
    apptHour += 24;
    dayPrefix = "今晚/凌晨";
  } else {
    dayPrefix = "明天早上";
  }

  const formattedHour = apptHour.toString().padStart(2, "0");
  const formattedMin = apptMin.toString().padStart(2, "0");

  return `${dayPrefix} ${formattedHour}:${formattedMin}`;
}

async function fetchFastingAppointments(env: Env, targetDate: string) {
  const baseSelect =
    "id,type,date,time,hospital,department,fasting_required,fasting_hours,user_id,group_id,profile_id,users(line_user_id)";

  try {
    return await supabaseFetch<AppointmentWithUser[]>(
      env,
      `appointments?date=eq.${targetDate}&fasting_required=eq.true&status=in.(upcoming,notified)&select=${baseSelect}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("appointments.type") && !message.includes("column appointments.type does not exist")) {
      throw error;
    }

    const fallbackSelect = baseSelect.replace("type,", "");
    const rows = await supabaseFetch<AppointmentWithUser[]>(
      env,
      `appointments?date=eq.${targetDate}&fasting_required=eq.true&status=in.(upcoming,notified)&select=${fallbackSelect}`,
    );
    return rows.map((row) => ({ ...row, type: "clinic_visit" }));
  }
}

async function fetchCareProfiles(env: Env, profileIds: number[]) {
  if (profileIds.length === 0) return [] as CareProfile[];

  return supabaseFetch<CareProfile[]>(
    env,
    `care_profiles?id=in.(${profileIds.join(",")})&select=id,group_id,display_name`,
  );
}

async function loadGroupRecipients(env: Env, groupIds: number[], alertField: string) {
  if (groupIds.length === 0) return [] as RecipientRow[];

  return supabaseFetch<RecipientRow[]>(
    env,
    `user_family_groups?group_id=in.(${groupIds.join(",")})&${alertField}=eq.true&select=group_id,user_id,users(line_user_id)`,
  );
}

function profileLabel(profile: CareProfile | undefined | null) {
  return profile?.display_name?.trim() || DEFAULT_RECIPIENT;
}

function resolveLineRecipients(
  item: { group_id: number | null; profile_id: number | null; users: { line_user_id: string } | null },
  groupRecipients: Map<number, string[]>,
  profileMap: Map<number, CareProfile>,
) {
  const profile = item.profile_id ? profileMap.get(item.profile_id) : undefined;
  const groupId = item.group_id ?? profile?.group_id;

  if (groupId && groupRecipients.has(groupId)) {
    return groupRecipients.get(groupId)!;
  }

  const lineId = item.users?.line_user_id;
  if (lineId && lineId !== "web-mvp") {
    return [lineId];
  }

  return [];
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get("Authorization");
  if (!env.CRON_SECRET) {
    logEvent("cron.evening_missing_secret");
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
    logEvent("cron.evening_unauthorized");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const now = new Date();
    const twTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    twTime.setDate(twTime.getDate() + 1);
    const targetDate = twTime.toISOString().split("T")[0];
    logEvent("cron.evening_started", { target_date: targetDate });

    const fastingApts = await fetchFastingAppointments(env, targetDate);
    const profileIds = new Set<number>();
    const groupIds = new Set<number>();

    for (const apt of fastingApts) {
      if (apt.profile_id) profileIds.add(apt.profile_id);
      if (apt.group_id) groupIds.add(apt.group_id);
    }

    const careProfiles = await fetchCareProfiles(env, Array.from(profileIds));
    const profileMap = new Map(careProfiles.map((profile) => [profile.id, profile]));

    for (const profile of careProfiles) {
      if (profile.group_id) groupIds.add(profile.group_id);
    }

    const recipientRows = await loadGroupRecipients(env, Array.from(groupIds), "receive_evening_alert");
    const groupRecipients = new Map<number, Set<string>>();

    for (const row of recipientRows) {
      const lineId = row.users?.line_user_id;
      if (!lineId || lineId === "web-mvp") continue;
      if (!groupRecipients.has(row.group_id)) {
        groupRecipients.set(row.group_id, new Set());
      }
      groupRecipients.get(row.group_id)!.add(lineId);
    }

    const groupRecipientsById = new Map<number, string[]>();
    for (const [groupId, lineIds] of groupRecipients.entries()) {
      groupRecipientsById.set(groupId, Array.from(lineIds));
    }

    const userAlerts = new Map<string, AppointmentWithUser[]>();
    for (const apt of fastingApts) {
      const lineIds = resolveLineRecipients(apt, groupRecipientsById, profileMap);
      for (const lineId of lineIds) {
        if (!userAlerts.has(lineId)) userAlerts.set(lineId, []);
        userAlerts.get(lineId)!.push(apt);
      }
    }

    let sentCount = 0;

    for (const [lineUserId, appointments] of userAlerts.entries()) {
      if (appointments.length === 0) continue;

      const lines = ["晚安", "提醒您接下來的注意事項。", ""];

      for (const apt of appointments) {
        const profile = apt.profile_id ? profileMap.get(apt.profile_id) : undefined;
        const name = profileLabel(profile);
        const typeLabel =
          apt.type === "inspection" ? "檢查" :
          apt.type === "refill_reminder" ? "領藥" :
          apt.type === "medication" ? "用藥" :
          apt.type === "measurement" ? "量測" :
          apt.type === "document" ? "文件" :
          apt.type === "rehab" ? "復健" :
          apt.type === "exercise" ? "運動" :
          apt.type === "other" || apt.type === "reminder" ? "提醒" :
          "看診";
        lines.push(`${name} 明天${apt.time ? ` ${apt.time}` : ""} 要去 ${apt.hospital || "醫院"} ${typeLabel}。`);
        const hours = apt.fasting_hours || 8;
        const startTimeText = calculateFastingStart(apt.time, hours);
        lines.push(`${startTimeText} 開始，先不要吃東西。水能不能喝，要看單子上的說明。`);
        lines.push("健保卡和單子也先放好，明天比較不會急。");
        lines.push("");
      }

      lines.push(BRAND_SIGNATURE);

      await pushText(env, lineUserId, lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").trim());
      sentCount++;
    }

    logEvent("cron.evening_completed", {
      processed_date: targetDate,
      sent_count: sentCount,
      fasting_appointment_count: fastingApts.length,
      duration_ms: Date.now() - startedAt,
    });
    return Response.json({ success: true, processed_date: targetDate, sent_count: sentCount });
  } catch (error) {
    logError("cron.evening_failed", error, { duration_ms: Date.now() - startedAt });
    return Response.json({ error: String(error) }, { status: 500 });
  }
};
