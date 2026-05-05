import { supabaseFetch, Env as SupabaseEnv } from "../../_shared/supabase";
import { logError, logEvent } from "../../_shared/logger";

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

function itemPrefix(profile: CareProfile | undefined | null) {
  const label = profileLabel(profile);
  return label === DEFAULT_RECIPIENT ? "" : `【${label}】 `;
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
    "id,type,date,time,hospital,department,doctor,number,location,fasting_required,fasting_hours,notes,reminder_text,user_id,group_id,profile_id,users(line_user_id)";

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
    `medications?active=eq.true&select=id,name,dosage,frequency,purpose,warnings,reminder_text,user_id,group_id,profile_id,users(line_user_id)`,
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
    const twTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    twTime.setDate(twTime.getDate() + 1);
    const targetDate = twTime.toISOString().split("T")[0];
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

      let msgText = `${DEFAULT_RECIPIENT}，早安。\n今天先看這幾件事就好。\n\n`;

      if (data.meds.length > 0) {
        msgText += "今天要吃的藥：\n";
        for (const med of data.meds) {
          const prefix = itemPrefix(med.profile_id ? profileMap.get(med.profile_id) : undefined);
          msgText += `• ${prefix}${med.name} (${med.dosage || "照單子份量"})\n`;
          if (med.frequency) msgText += `  時間：${med.frequency}\n`;
          if (med.reminder_text) msgText += `  ${med.reminder_text}\n`;
        }
        msgText += "\n";
      }

      if (data.apts.length > 0) {
        msgText += "明天要記得：\n";
        for (const apt of data.apts) {
          const prefix = itemPrefix(apt.profile_id ? profileMap.get(apt.profile_id) : undefined);
          if (apt.type === "refill_reminder") {
            msgText += `• ${prefix}可以去領下一次藥了。\n  地點：${apt.hospital || "醫院或藥局"}\n`;
          } else if (apt.type === "inspection") {
            msgText += `• ${prefix}${apt.time || ""} ${apt.hospital || ""} ${apt.department || "要去檢查"}\n`;
            if (apt.fasting_required) msgText += `  記得：前 ${apt.fasting_hours || 8} 小時先不要吃東西。\n`;
            if (apt.notes) msgText += `  ${apt.notes}\n`;
          } else {
            msgText += `• ${prefix}${apt.time || ""} ${apt.hospital || ""} ${apt.department || "要去看診"}\n`;
            if (apt.fasting_required) msgText += `  記得：前 ${apt.fasting_hours || 8} 小時先不要吃東西。\n`;
            if (apt.notes) msgText += `  ${apt.notes}\n`;
          }
        }
      }

      msgText += "\n完整清單在這裡：https://care.wedopr.com";

      await pushText(env, lineUserId, msgText);
      sentCount++;

      for (const apt of data.apts) {
        await markAsNotified(env, apt.id);
      }
    }

    const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
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
    return Response.json({ error: String(error) }, { status: 500 });
  }
};
