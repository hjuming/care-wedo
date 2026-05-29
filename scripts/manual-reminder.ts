#!/usr/bin/env tsx

import { readFileSync } from "node:fs";

type UserRow = {
  id: number;
  name: string | null;
  line_user_id: string | null;
};

type MembershipRow = {
  group_id: number;
};

type ProfileRow = {
  id: number;
  group_id: number | null;
  display_name: string | null;
};

type AppointmentRow = {
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
  user_id: number;
  group_id: number | null;
  profile_id: number | null;
};

type MedicationRow = {
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
};

const DEFAULT_RECIPIENT = "親愛的家人";
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const BRAND_SIGNATURE = "Care WEDO\n陪你照顧最重要的人\nhttps://care.wedopr.com/app/open";

function loadEnv(): void {
  const candidates = [".env.scripts", ".env"];

  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, "utf-8");
      for (const line of content.split("\n")) {
        const match = line.match(/^([^#=\s][^=]*)=(.*)/);
        if (!match) continue;
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {
      // ignore missing env files
    }
  }
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
      continue;
    }
    args.set(key, next);
    i += 1;
  }
  return args;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function createClient(url: string, serviceKey: string) {
  const base = `${url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${base}/${path}`, { headers });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`GET /${path} -> ${res.status}: ${text}`);
    }
    return text ? JSON.parse(text) as T : ([] as T);
  }

  return { get };
}

function formatDateLabel(dateStr: string) {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return dateStr;
  return `${Number(month)}/${Number(day)}（${WEEKDAY_LABELS[date.getUTCDay()]}）`;
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
  const todayDate = new Date(`${todayStr}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime()) || Number.isNaN(todayDate.getTime())) return formatDateLabel(dateStr);

  const diffDays = Math.round((date.getTime() - todayDate.getTime()) / 86400000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "明天";
  return formatDateLabel(dateStr);
}

function profileLabel(profile?: ProfileRow | null) {
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

function appointmentActionLabel(apt: AppointmentRow) {
  if (apt.type === "refill_reminder") return "可以去領下一次藥";
  if (apt.type === "inspection") return apt.department ? `要去做${apt.department}` : "要去做檢查";
  if (apt.department) return `要去${apt.department}`;
  return `有一個${appointmentTypeLabel(apt.type)}提醒`;
}

function appointmentPlaceLine(apt: AppointmentRow) {
  const place = apt.hospital?.trim();
  const doctor = apt.doctor?.trim();
  if (place && doctor && !place.includes(doctor)) return `在${place}，${doctor}醫師。`;
  if (place) return `地點在${place}。`;
  if (doctor) return `醫師是${doctor}。`;
  return "";
}

function buildAppointmentReminderLine(apt: AppointmentRow, profile: ProfileRow | undefined, todayStr: string) {
  const name = profileLabel(profile);
  const dateLabel = relativeDateLabel(apt.date, todayStr);
  const timeLabel = formatTimeLabel(apt.time);
  const when = [dateLabel, timeLabel].filter(Boolean).join("");
  return `${name} ${when}${when ? " " : ""}${appointmentActionLabel(apt)}。`;
}

function buildDailyReminderMessage(
  data: { apts: AppointmentRow[]; meds: MedicationRow[] },
  profileMap: Map<number, ProfileRow>,
  todayStr: string,
) {
  const lines = ["早安", "提醒您接下來的注意事項。", ""];

  if (data.meds.length > 0) {
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

  if (data.apts.length > 0) {
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

  return lines
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
    .trim();
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  const rawUserId = args.get("user-id");
  const rawLineUserId = args.get("line-user-id");
  const date = String(args.get("date") || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split("T")[0]);
  const dryRun = args.get("dry-run") === true;

  if (!rawUserId && !rawLineUserId) {
    throw new Error("請提供 --user-id 或 --line-user-id");
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRole = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const lineToken = dryRun ? "" : requireEnv("LINE_CHANNEL_ACCESS_TOKEN");
  const db = createClient(supabaseUrl, serviceRole);

  let user: UserRow | null = null;

  if (rawUserId) {
    const userId = Number(rawUserId);
    if (!Number.isFinite(userId) || userId <= 0) throw new Error("--user-id 必須是正整數");
    const rows = await db.get<UserRow[]>(`users?id=eq.${userId}&select=id,name,line_user_id&limit=1`);
    user = rows[0] || null;
  } else if (rawLineUserId) {
    const encoded = encodeURIComponent(String(rawLineUserId));
    const rows = await db.get<UserRow[]>(`users?line_user_id=eq.${encoded}&select=id,name,line_user_id&limit=1`);
    user = rows[0] || null;
  }

  if (!user) throw new Error("找不到指定用戶");
  if (!user.line_user_id) throw new Error("指定用戶沒有 LINE user id");

  const memberships = await db.get<MembershipRow[]>(`user_family_groups?user_id=eq.${user.id}&select=group_id`);
  const groupIds = [...new Set(memberships.map((row) => row.group_id).filter(Boolean))];
  if (groupIds.length === 0) throw new Error("指定用戶目前沒有家庭群組");

  const groupFilter = `in.(${groupIds.join(",")})`;
  const appointments = await db.get<AppointmentRow[]>(
    `appointments?group_id=${groupFilter}&date=eq.${date}&status=eq.upcoming&select=id,type,date,time,hospital,department,doctor,number,location,fasting_required,fasting_hours,notes,reminder_text,user_id,group_id,profile_id`,
  );
  const medications = await db.get<MedicationRow[]>(
    `medications?group_id=${groupFilter}&active=eq.true&select=id,name,dosage,frequency,purpose,warnings,reminder_text,user_id,group_id,profile_id`,
  );

  const profileIds = [
    ...new Set(
      [...appointments, ...medications]
        .map((row) => row.profile_id)
        .filter((value): value is number => Number.isFinite(value as number) && Number(value) > 0),
    ),
  ];

  const profiles = profileIds.length
    ? await db.get<ProfileRow[]>(`care_profiles?id=in.(${profileIds.join(",")})&select=id,group_id,display_name`)
    : [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  const message = buildDailyReminderMessage({ apts: appointments, meds: medications }, profileMap, date);

  if (!dryRun) {
    const pushResponse = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lineToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: user.line_user_id,
        messages: [{ type: "text", text: message }],
      }),
    });
    const pushBody = await pushResponse.text();
    if (!pushResponse.ok) {
      throw new Error(`LINE push failed (${pushResponse.status}): ${pushBody}`);
    }

    console.log(JSON.stringify({
      success: true,
      dry_run: false,
      target_user: { id: user.id, name: user.name, line_user_id_suffix: user.line_user_id.slice(-6) },
      processed_date: date,
      appointment_count: appointments.length,
      medication_count: medications.length,
      line_response: pushBody || "ok",
      preview_lines: message.split("\n").slice(0, 8),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    success: true,
    dry_run: true,
    target_user: { id: user.id, name: user.name, line_user_id_suffix: user.line_user_id.slice(-6) },
    processed_date: date,
    appointment_count: appointments.length,
    medication_count: medications.length,
    preview_lines: message.split("\n").slice(0, 20),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
