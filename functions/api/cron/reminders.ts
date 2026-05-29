import { supabaseFetch, Env as SupabaseEnv } from "../../_shared/supabase";
import { logError, logEvent } from "../../_shared/logger";
import { sendProductionAlert } from "../../_shared/alerts";

const DEFAULT_RECIPIENT = "親愛的家人";
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const BRAND_SIGNATURE = "Care WEDO\n陪你照顧最重要的人\nhttps://care.wedopr.com/app/open";

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
  group_id: number | null;
  profile_id: number | null;
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
  }
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
  data: { apts: AppointmentWithUser[]; meds: MedicationWithUser[] },
  profileMap: Map<number, CareProfile>,
  todayStr: string,
) {
  const hasMeds = data.meds.length > 0;
  const hasAppointments = data.apts.length > 0;
  const lines = ["早安", "提醒您接下來的注意事項。", ""];

  if (hasMeds) {
    for (const med of data.meds) {
      const profile = med.profile_id ? profileMap.get(med.profile_id) : undefined;
      const name = profileLabel(profile);
      const dosage = med.dosage || "照單子份量";
      lines.push(`${name} 今天要吃 ${med.name}，${dosage}。`);
      if (med.frequency) lines.push(`時間照 ${med.frequency}。`);
      if (med.reminder_text) lines.push(med.reminder_text);
    }
    lines.push("");
  }

  if (hasAppointments) {
    for (const apt of data.apts) {
      const profile = apt.profile_id ? profileMap.get(apt.profile_id) : undefined;
      lines.push(buildAppointmentReminderLine(apt, profile, todayStr));
      const placeLine = appointmentPlaceLine(apt);
      if (placeLine) lines.push(placeLine);
      if (apt.fasting_required) lines.push(`要記得空腹，前 ${apt.fasting_hours || 8} 小時先不要吃東西。`);
      if (apt.notes) lines.push(apt.notes);
      lines.push("");
    }
  }

  lines.push(BRAND_SIGNATURE);

  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").trim();
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

async function fetchActiveMedications(env: Env) {
  return supabaseFetch<MedicationWithUser[]>(
    env,
    `medications?active=eq.true&select=id,name,dosage,frequency,purpose,warnings,reminder_text,user_id,group_id,profile_id,users!medications_user_id_fkey(line_user_id)`,
  );
}

async function loadGroupRecipients(env: Env, groupIds: number[], alertField: string) {
  if (groupIds.length === 0) return [] as RecipientRow[];

  return supabaseFetch<RecipientRow[]>(
    env,
    `user_family_groups?group_id=in.(${groupIds.join(",")})&${alertField}=eq.true&select=group_id,user_id,users(line_user_id)`,
  );
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
    const activeMeds = await fetchActiveMedications(env);

    const profileIds = new Set<number>();
    const groupIds = new Set<number>();

    for (const apt of reminders) {
      if (apt.profile_id) profileIds.add(apt.profile_id);
      if (apt.group_id) groupIds.add(apt.group_id);
    }

    for (const med of activeMeds) {
      if (med.profile_id) profileIds.add(med.profile_id);
      if (med.group_id) groupIds.add(med.group_id);
    }

    const careProfiles = await fetchCareProfiles(env, Array.from(profileIds));
    const profileMap = new Map(careProfiles.map((profile) => [profile.id, profile]));

    for (const profile of careProfiles) {
      if (profile.group_id) groupIds.add(profile.group_id);
    }

    const recipientRows = await loadGroupRecipients(env, Array.from(groupIds), "receive_daily_brief");
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

    const userBriefings = new Map<string, { apts: AppointmentWithUser[]; meds: MedicationWithUser[] }>();

    for (const apt of reminders) {
      const lineIds = resolveLineRecipients(apt, groupRecipientsById, profileMap);
      for (const lineId of lineIds) {
        if (!userBriefings.has(lineId)) userBriefings.set(lineId, { apts: [], meds: [] });
        userBriefings.get(lineId)!.apts.push(apt);
      }
    }

    for (const med of activeMeds) {
      const lineIds = resolveLineRecipients(med, groupRecipientsById, profileMap);
      for (const lineId of lineIds) {
        if (!userBriefings.has(lineId)) userBriefings.set(lineId, { apts: [], meds: [] });
        userBriefings.get(lineId)!.meds.push(med);
      }
    }

    let sentCount = 0;

    for (const [lineUserId, data] of userBriefings.entries()) {
      if (data.apts.length === 0 && data.meds.length === 0) continue;

      const msgText = buildDailyReminderMessage(data, profileMap, today);

      await pushText(env, lineUserId, msgText);
      sentCount++;

      for (const apt of data.apts) {
        await markAsNotified(env, apt.id);
      }
    }

    await supabaseFetch(env, `appointments?date=lt.${today}&status=eq.upcoming`, {
      method: "PATCH",
      body: JSON.stringify({ status: "expired" }),
    });

    logEvent("cron.reminders_completed", {
      processed_date: targetDate,
      users_notified: sentCount,
      reminder_count: reminders.length,
      medication_count: activeMeds.length,
      duration_ms: Date.now() - startedAt,
    });
    return Response.json({ success: true, processed_date: targetDate, users_notified: sentCount });
  } catch (error) {
    logError("cron.reminders_failed", error, { duration_ms: Date.now() - startedAt });
    await sendProductionAlert(env, "cron.reminders_failed", {
      duration_ms: Date.now() - startedAt,
      error,
    });
    return Response.json({ error: String(error) }, { status: 500 });
  }
};
