import { supabaseFetch, Env as SupabaseEnv } from "../../_shared/supabase";
import { logError, logEvent } from "../../_shared/logger";
import { sendProductionAlert } from "../../_shared/alerts";
import { recordLinePushLog } from "../../_shared/line_push_logs";

const DEFAULT_RECIPIENT = "照護對象";
const BRAND_SIGNATURE = "Care WEDO\n陪你照顧最重要的人\nhttps://care.wedopr.com/app/open";
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DELAYED_EVENING_GRACE_HOUR = 6;

type Env = SupabaseEnv & {
  CRON_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  REMINDER_TEST_ONLY?: string;
  REMINDER_TEST_TARGET_NAME?: string;
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

type LineRecipient = {
  lineId: string;
  userId: number | null;
  groupId: number | null;
};

function taipeiDateString(date: Date) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().split("T")[0];
}

function taipeiHour(date: Date) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).getUTCHours();
}

function resolveEveningTargetDate(now: Date) {
  const taipeiNow = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const target = new Date(taipeiNow);

  // GitHub scheduled jobs can arrive after midnight in Taiwan. Treat early-morning
  // runs as the delayed previous-evening reminder instead of jumping to the next day.
  if (taipeiHour(now) >= DELAYED_EVENING_GRACE_HOUR) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.toISOString().split("T")[0];
}

function targetDateLabel(targetDate: string, todayDate: string) {
  if (targetDate === todayDate) return "今天";
  return "明天";
}

async function pushText(env: Env, userId: string, text: string) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    return { status: "skipped" as const, errorMessage: "LINE channel access token is not configured." };
  }

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
    await sendProductionAlert(env, "cron.evening_push_failed", {
      line_user_suffix: userId.slice(-4),
      status: response.status,
      detail,
    });
    return { status: "failed" as const, httpStatus: response.status, errorMessage: detail };
  }

  return { status: "sent" as const, httpStatus: response.status };
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

async function fetchNextDayAppointments(env: Env, targetDate: string) {
  const baseSelect =
    "id,type,date,time,hospital,department,fasting_required,fasting_hours,user_id,group_id,profile_id,users!appointments_user_id_fkey(line_user_id)";

  try {
    return await supabaseFetch<AppointmentWithUser[]>(
      env,
      `appointments?date=eq.${targetDate}&status=eq.upcoming&select=${baseSelect}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("appointments.type") && !message.includes("column appointments.type does not exist")) {
      throw error;
    }

    const fallbackSelect = baseSelect.replace("type,", "");
    const rows = await supabaseFetch<AppointmentWithUser[]>(
      env,
      `appointments?date=eq.${targetDate}&status=eq.upcoming&select=${fallbackSelect}`,
    );
    return rows.map((row) => ({ ...row, type: "clinic_visit" }));
  }
}

async function fetchLineIdsByUserName(env: Env, displayName: string) {
  const encodedName = encodeURIComponent(`*${displayName}*`);
  const rows = await supabaseFetch<{ line_user_id: string | null }[]>(
    env,
    `users?select=line_user_id&name=ilike.${encodedName}`,
  );
  return new Set(rows.map((row) => row.line_user_id).filter((lineId): lineId is string => !!lineId && lineId !== "web-mvp"));
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

function appointmentTypeLabel(type?: string | null) {
  if (type === "inspection") return "檢查";
  if (type === "refill_reminder") return "領藥";
  if (type === "medication") return "用藥";
  if (type === "measurement") return "量測";
  if (type === "document") return "文件";
  if (type === "rehab") return "復健";
  if (type === "exercise") return "運動";
  if (type === "other" || type === "reminder") return "提醒";
  return "看診";
}

function buildEveningReminderMessage(
  appointments: AppointmentWithUser[],
  profileMap: Map<number, CareProfile>,
  dateLabel: string,
  scheduleTitle: string,
) {
  const lines = ["晚安", "提醒您接下來的注意事項。", ""];
  lines.push(scheduleTitle.replace(/[【】]/g, ""));

  for (const apt of appointments.slice(0, 8)) {
    const profile = apt.profile_id ? profileMap.get(apt.profile_id) : undefined;
    const name = profileLabel(profile);
    const typeLabel = appointmentTypeLabel(apt.type);
    lines.push(`- ${name} ${dateLabel}${apt.time ? ` ${apt.time}` : ""} ${apt.hospital || "醫院"} ${typeLabel}。`);
    if (apt.fasting_required) {
      const hours = apt.fasting_hours || 8;
      const startTimeText = calculateFastingStart(apt.time, hours);
      lines.push(`  空腹提醒：${startTimeText} 開始禁食。`);
    }
  }

  lines.push(BRAND_SIGNATURE);
  return lines.join("\n").trim();
}

function resolveLineRecipients(
  item: { user_id: number | null; group_id: number | null; profile_id: number | null; users: { line_user_id: string } | null },
  groupRecipients: Map<number, LineRecipient[]>,
  profileMap: Map<number, CareProfile>,
) {
  const profile = item.profile_id ? profileMap.get(item.profile_id) : undefined;
  const groupId = item.group_id ?? profile?.group_id;

  if (groupId && groupRecipients.has(groupId)) {
    return groupRecipients.get(groupId)!;
  }

  const lineId = item.users?.line_user_id;
  if (lineId && lineId !== "web-mvp") {
    return [{ lineId, userId: item.user_id, groupId: groupId ?? null }];
  }

  return [];
}

function uniqueNumbers(values: Array<number | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0)));
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
    const todayDate = taipeiDateString(now);
    const targetDate = resolveEveningTargetDate(now);
    const dateLabel = targetDateLabel(targetDate, todayDate);
    logEvent("cron.evening_started", { target_date: targetDate, taipei_today: todayDate });

    const tomorrowApts = await fetchNextDayAppointments(env, targetDate);
    // Opt-in test mode: only restrict recipients when explicitly set to "1".
    // Default (unset / "0") delivers to all real recipients in production.
    const testOnly = env.REMINDER_TEST_ONLY === "1";
    logEvent("cron.evening_mode", { test_only: testOnly });
    const testTargetName = env.REMINDER_TEST_TARGET_NAME?.trim() || "日月MING";
    const allowedLineIds = testOnly ? await fetchLineIdsByUserName(env, testTargetName) : null;
    if (testOnly && allowedLineIds && allowedLineIds.size === 0) {
      logEvent("cron.evening_test_target_not_found", { target_name: testTargetName });
    }
    const profileIds = new Set<number>();
    const groupIds = new Set<number>();

    for (const apt of tomorrowApts) {
      if (apt.profile_id) profileIds.add(apt.profile_id);
      if (apt.group_id) groupIds.add(apt.group_id);
    }

    const careProfiles = await fetchCareProfiles(env, Array.from(profileIds));
    const profileMap = new Map(careProfiles.map((profile) => [profile.id, profile]));

    for (const profile of careProfiles) {
      if (profile.group_id) groupIds.add(profile.group_id);
    }

    const recipientRows = await loadGroupRecipients(env, Array.from(groupIds), "receive_evening_alert");
    const groupRecipients = new Map<number, Map<string, LineRecipient>>();

    for (const row of recipientRows) {
      const lineId = row.users?.line_user_id;
      if (!lineId || lineId === "web-mvp") continue;
      if (!groupRecipients.has(row.group_id)) {
        groupRecipients.set(row.group_id, new Map());
      }
      groupRecipients.get(row.group_id)!.set(lineId, {
        lineId,
        userId: row.user_id,
        groupId: row.group_id,
      });
    }

    const groupRecipientsById = new Map<number, LineRecipient[]>();
    for (const [groupId, recipients] of groupRecipients.entries()) {
      groupRecipientsById.set(groupId, Array.from(recipients.values()));
    }

    const userAlerts = new Map<string, { recipient: LineRecipient; appointments: AppointmentWithUser[] }>();
    for (const apt of tomorrowApts) {
      const recipients = resolveLineRecipients(apt, groupRecipientsById, profileMap);
      for (const recipient of recipients) {
        if (allowedLineIds && !allowedLineIds.has(recipient.lineId)) continue;
        if (!userAlerts.has(recipient.lineId)) {
          userAlerts.set(recipient.lineId, { recipient, appointments: [] });
        }
        userAlerts.get(recipient.lineId)!.appointments.push(apt);
      }
    }

    let sentCount = 0;

    for (const [lineUserId, alert] of userAlerts.entries()) {
      const { recipient, appointments } = alert;
      if (appointments.length === 0) continue;
      const scheduleTitle = dateLabel === "今天" ? "【今日行程提醒】" : "【明日行程提醒】";
      const msgText = buildEveningReminderMessage(appointments, profileMap, dateLabel, scheduleTitle);
      const pushResult = await pushText(env, lineUserId, msgText);
      const logGroupIds = uniqueNumbers(appointments.map((apt) => apt.group_id ?? (apt.profile_id ? profileMap.get(apt.profile_id)?.group_id : null)));
      const logProfileIds = uniqueNumbers(appointments.map((apt) => apt.profile_id));

      await recordLinePushLog(env, {
        eventType: "evening_appointment_reminder",
        recipientUserId: recipient.userId,
        groupId: logGroupIds.length === 1 ? logGroupIds[0] : recipient.groupId,
        profileId: logProfileIds.length === 1 ? logProfileIds[0] : null,
        targetDate,
        sourceTable: "appointments",
        sourceIds: appointments.map((apt) => apt.id),
        lineUserSuffix: lineUserId.slice(-4),
        status: pushResult.status,
        httpStatus: pushResult.httpStatus,
        errorMessage: pushResult.errorMessage,
        messageLength: msgText.length,
        itemCount: appointments.length,
        metadata: {
          test_only: testOnly,
          date_label: dateLabel,
          group_ids: logGroupIds,
          profile_ids: logProfileIds,
        },
      });

      if (pushResult.status === "sent") {
        sentCount++;
      }
    }

    logEvent("cron.evening_completed", {
      processed_date: targetDate,
      messages_sent: sentCount,
      appointment_count: tomorrowApts.length,
      test_only: testOnly,
      test_target_name: testTargetName,
      duration_ms: Date.now() - startedAt,
    });
    return Response.json({ success: true, processed_date: targetDate, messages_sent: sentCount });
  } catch (error) {
    logError("cron.evening_failed", error, { duration_ms: Date.now() - startedAt });
    await sendProductionAlert(env, "cron.evening_failed", {
      duration_ms: Date.now() - startedAt,
      error,
    });
    return Response.json({ error: String(error) }, { status: 500 });
  }
};
