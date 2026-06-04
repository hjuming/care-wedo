import { supabaseFetch, Env as SupabaseEnv } from "../../_shared/supabase";
import { logError, logEvent } from "../../_shared/logger";
import { sendProductionAlert } from "../../_shared/alerts";
import { recordLinePushLog } from "../../_shared/line_push_logs";

const DEFAULT_RECIPIENT = "親愛的家人";
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const BRAND_SIGNATURE = "Care WEDO\n陪你照顧最重要的人\nhttps://care.wedopr.com/app/open";

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
  doctor: string | null;
  number: string | null;
  location: string | null;
  fasting_required: boolean;
  fasting_hours: number | null;
  notes: string | null;
  reminder_text: string | null;
  status: string;
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
    logError("cron.reminders_push_failed", new Error(`LINE push failed (${response.status})`), {
      line_user_suffix: userId.slice(-4),
      status: response.status,
      detail,
    });
    await sendProductionAlert(env, "cron.reminders_push_failed", {
      line_user_suffix: userId.slice(-4),
      status: response.status,
      detail,
    });
    return { status: "failed" as const, httpStatus: response.status, errorMessage: detail };
  }

  return { status: "sent" as const, httpStatus: response.status };
}

async function markAsNotified(env: Env, id: number) {
  await supabaseFetch(env, `appointments?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "notified" }),
  });
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

function formatDateLabel(dateStr: string) {
  const [year, month, day] = dateStr.split("-");
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (!year || !month || !day || Number.isNaN(date.getTime())) return dateStr;
  return `${monthNumber}/${dayNumber}（${WEEKDAY_LABELS[date.getUTCDay()]}）`;
}

function formatTimeLabel(time?: string | null) {
  const raw = (time || "").trim();
  if (!raw) return "";

  const match = raw.match(/^(上午|下午|晚上|早上)?\s*(\d{1,2}):(\d{2})$/);
  if (!match) return raw.replace(/(上午|下午|晚上|早上)(\d)/, "$1 $2");

  const meridiem = match[1] || "";
  let hour = Number(match[2]);
  const minute = match[3];
  if ((meridiem === "下午" || meridiem === "晚上") && hour > 12) hour -= 12;
  return `${meridiem ? `${meridiem} ` : ""}${hour}:${minute}`;
}

function relativeDateLabel(dateStr: string, todayStr: string) {
  const date = new Date(`${dateStr}T00:00:00+08:00`);
  const today = new Date(`${todayStr}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime()) || Number.isNaN(today.getTime())) return formatDateLabel(dateStr);

  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "明天";
  return formatDateLabel(dateStr);
}

function appointmentActionLabel(apt: AppointmentWithUser) {
  if (apt.type === "refill_reminder") return "可以去領下一次藥";
  if (apt.type === "inspection") return apt.department ? `要去做${apt.department}` : "要去做檢查";
  if (apt.department) return `要去${apt.department}`;
  return `有一個${appointmentTypeLabel(apt.type)}提醒`;
}

function appointmentPlaceLine(apt: AppointmentWithUser) {
  const place = apt.hospital?.trim();
  const doctor = apt.doctor?.trim();
  if (place && doctor && !place.includes(doctor)) return `在${place}，${doctor}醫師。`;
  if (place) return `地點在${place}。`;
  if (doctor) return `醫師是${doctor}。`;
  return "";
}

function buildAppointmentReminderLine(apt: AppointmentWithUser, profile: CareProfile | undefined, todayStr: string) {
  const name = profileLabel(profile);
  const dateLabel = relativeDateLabel(apt.date, todayStr);
  const timeLabel = formatTimeLabel(apt.time);
  const when = [dateLabel, timeLabel].filter(Boolean).join("");
  return `${name} ${when}${when ? " " : ""}${appointmentActionLabel(apt)}。`;
}

function buildDailyReminderMessage(
  appointments: AppointmentWithUser[],
  profileMap: Map<number, CareProfile>,
  todayStr: string,
) {
  const lines = ["早安", "提醒您接下來的注意事項。", ""];

  if (appointments.length === 0) {
    lines.push("今天目前沒有需要提醒的項目。");
  } else {
    lines.push("今日行程");
    for (const apt of appointments.slice(0, 6)) {
      const profile = apt.profile_id ? profileMap.get(apt.profile_id) : undefined;
      lines.push(`- ${buildAppointmentReminderLine(apt, profile, todayStr)}`);
      const placeLine = appointmentPlaceLine(apt);
      if (placeLine) lines.push(`  ${placeLine}`);
      if (apt.fasting_required) lines.push(`  空腹提醒：前 ${apt.fasting_hours || 8} 小時禁食。`);
      if (apt.notes) lines.push(`  ${apt.notes}`);
    }
  }

  lines.push(BRAND_SIGNATURE);
  return lines.join("\n").trim();
}

async function fetchCareProfiles(env: Env, profileIds: number[]) {
  if (profileIds.length === 0) return [] as CareProfile[];

  return supabaseFetch<CareProfile[]>(
    env,
    `care_profiles?id=in.(${profileIds.join(",")})&select=id,group_id,display_name`,
  );
}

async function fetchReminderAppointments(env: Env, targetDate: string) {
  const baseSelect =
    "id,type,date,time,hospital,department,doctor,number,location,fasting_required,fasting_hours,notes,reminder_text,user_id,group_id,profile_id,users!appointments_user_id_fkey(line_user_id)";

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

async function loadGroupRecipients(env: Env, groupIds: number[], alertField: string) {
  if (groupIds.length === 0) return [] as RecipientRow[];

  return supabaseFetch<RecipientRow[]>(
    env,
    `user_family_groups?group_id=in.(${groupIds.join(",")})&${alertField}=eq.true&select=group_id,user_id,users(line_user_id)`,
  );
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
    return [{ lineId, userId: item.user_id, groupId }];
  }

  return [];
}

function uniqueNumbers(values: Array<number | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is number => Number.isInteger(value) && value > 0)));
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get("Authorization");
  if (!env.CRON_SECRET) {
    logEvent("cron.reminders_missing_secret");
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
    logEvent("cron.reminders_unauthorized");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const now = new Date();
    const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
    const targetDate = today;
    logEvent("cron.reminders_started", { target_date: targetDate });

    const reminders = await fetchReminderAppointments(env, targetDate);
    const testOnly = env.REMINDER_TEST_ONLY !== "0";
    const testTargetName = env.REMINDER_TEST_TARGET_NAME?.trim() || "日月MING";
    const allowedLineIds = testOnly ? await fetchLineIdsByUserName(env, testTargetName) : null;
    if (testOnly && allowedLineIds && allowedLineIds.size === 0) {
      logEvent("cron.reminders_test_target_not_found", { target_name: testTargetName });
    }

    const profileIds = new Set<number>();
    const groupIds = new Set<number>();

    for (const apt of reminders) {
      if (apt.profile_id) profileIds.add(apt.profile_id);
      if (apt.group_id) groupIds.add(apt.group_id);
    }

    const careProfiles = await fetchCareProfiles(env, Array.from(profileIds));
    const profileMap = new Map(careProfiles.map((profile) => [profile.id, profile]));

    for (const profile of careProfiles) {
      if (profile.group_id) groupIds.add(profile.group_id);
    }

    const recipientRows = await loadGroupRecipients(env, Array.from(groupIds), "receive_daily_brief");
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

    const userBriefings = new Map<string, { recipient: LineRecipient; appointments: AppointmentWithUser[] }>();

    for (const apt of reminders) {
      const recipients = resolveLineRecipients(apt, groupRecipientsById, profileMap);
      for (const recipient of recipients) {
        if (allowedLineIds && !allowedLineIds.has(recipient.lineId)) continue;
        if (!userBriefings.has(recipient.lineId)) {
          userBriefings.set(recipient.lineId, { recipient, appointments: [] });
        }
        userBriefings.get(recipient.lineId)!.appointments.push(apt);
      }
    }

    let sentCount = 0;

    for (const [lineUserId, briefing] of userBriefings.entries()) {
      const { recipient, appointments } = briefing;
      if (appointments.length === 0) continue;

      const msgText = buildDailyReminderMessage(appointments, profileMap, today);
      const pushResult = await pushText(env, lineUserId, msgText);
      const logGroupIds = uniqueNumbers(appointments.map((apt) => apt.group_id ?? (apt.profile_id ? profileMap.get(apt.profile_id)?.group_id : null)));
      const logProfileIds = uniqueNumbers(appointments.map((apt) => apt.profile_id));

      await recordLinePushLog(env, {
        eventType: "daily_appointment_reminder",
        recipientUserId: recipient.userId,
        groupId: logGroupIds.length === 1 ? logGroupIds[0] : recipient.groupId,
        profileId: logProfileIds.length === 1 ? logProfileIds[0] : null,
        targetDate: today,
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
          group_ids: logGroupIds,
          profile_ids: logProfileIds,
        },
      });

      if (pushResult.status === "sent") {
        sentCount++;
        for (const apt of appointments) {
          await markAsNotified(env, apt.id);
        }
      }
    }

    await supabaseFetch(env, `appointments?date=lt.${today}&status=eq.upcoming`, {
      method: "PATCH",
      body: JSON.stringify({ status: "expired" }),
    });

    logEvent("cron.reminders_completed", {
      processed_date: targetDate,
      messages_sent: sentCount,
      reminder_count: reminders.length,
      test_only: testOnly,
      test_target_name: testTargetName,
      duration_ms: Date.now() - startedAt,
    });
    return Response.json({ success: true, processed_date: targetDate, messages_sent: sentCount });
  } catch (error) {
    logError("cron.reminders_failed", error, { duration_ms: Date.now() - startedAt });
    await sendProductionAlert(env, "cron.reminders_failed", {
      duration_ms: Date.now() - startedAt,
      error,
    });
    return Response.json({ error: String(error) }, { status: 500 });
  }
};
