import {
  AppointmentRow,
  CareProfileRow,
  Env,
  getBearerToken,
  getOrCreateDefaultUser,
  getUserMemberships,
  supabaseFetch,
  verifyLineIdToken,
} from "../../../_shared/supabase";

const CARE_WEDO_URL = "https://care.wedopr.com";
const TAIPEI_OFFSET_HOURS = 8;

function appointmentTypeLabel(type?: string | null) {
  if (type === "family_note") return "家庭提醒";
  if (type === "inspection") return "檢查";
  if (type === "refill_reminder") return "領藥";
  if (type === "medication") return "用藥";
  if (type === "measurement") return "量測";
  if (type === "document") return "文件";
  if (type === "rehab") return "復健";
  if (type === "exercise") return "運動";
  if (type === "other" || type === "reminder") return "提醒";
  return "回診提醒";
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string) {
  const maxLength = 75;
  if (line.length <= maxLength) return line;

  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  chunks.push(remaining);
  return chunks.join("\r\n ");
}

function buildIcs(lines: string[]) {
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function parseDateParts(value?: string | null) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseTimeParts(value?: string | null) {
  const text = String(value || "").trim().replace(/：/g, ":").replace(/\s+/g, "");
  const match = text.match(/^(上午|下午|晚上|早上)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  let hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;

  const meridiem = match[1] || "";
  if ((meridiem === "下午" || meridiem === "晚上") && hour < 12) hour += 12;
  if ((meridiem === "上午" || meridiem === "早上") && hour === 12) hour = 0;

  return { hour, minute };
}

function formatIcsDate(parts: { year: number; month: number; day: number }) {
  return `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
}

function nextCalendarDate(parts: { year: number; month: number; day: number }) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatUtcIcsDateTime(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildSummary(appointment: AppointmentRow, profileName = "") {
  const title = appointment.title
    || appointment.department
    || appointment.hospital
    || appointmentTypeLabel(appointment.type);
  return `Care WEDO：${[profileName, title].filter(Boolean).join(" ")}`;
}

function buildDescription(appointment: AppointmentRow) {
  const lines = [
    appointment.department && `科別：${appointment.department}`,
    appointment.doctor && `醫師：${appointment.doctor}`,
    appointment.number && `號碼：${appointment.number}`,
    appointment.fasting_required && `請記得空腹，前 ${appointment.fasting_hours || 8} 小時先不要吃東西。`,
    appointment.notes || appointment.reminder_text,
    "",
    `Care WEDO：${CARE_WEDO_URL}`,
  ];
  return lines.filter((line) => line !== null && line !== undefined && line !== "").join("\n");
}

function buildCalendarFile(appointment: AppointmentRow, profileName = "") {
  const dateParts = parseDateParts(appointment.date);
  if (!dateParts) throw new Error("行程日期格式不完整，無法產生行事曆檔。");

  const timeParts = parseTimeParts(appointment.time);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Care WEDO//Appointment Export//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:care-wedo-appointment-${appointment.id}@care.wedopr.com`,
    `DTSTAMP:${formatUtcIcsDateTime(new Date())}`,
    `SUMMARY:${escapeIcsText(buildSummary(appointment, profileName))}`,
  ];

  if (timeParts) {
    const start = new Date(Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hour - TAIPEI_OFFSET_HOURS,
      timeParts.minute,
    ));
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${formatUtcIcsDateTime(start)}`);
    lines.push(`DTEND:${formatUtcIcsDateTime(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(dateParts)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(nextCalendarDate(dateParts))}`);
  }

  const location = appointment.location || appointment.hospital || "";
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);

  lines.push(`DESCRIPTION:${escapeIcsText(buildDescription(appointment))}`);
  lines.push(`URL:${CARE_WEDO_URL}`);
  lines.push("STATUS:CONFIRMED");
  lines.push("TRANSP:OPAQUE");
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return buildIcs(lines);
}

async function fetchProfileName(env: Env, profileId?: number | null) {
  if (!profileId) return "";
  const rows = await supabaseFetch<Pick<CareProfileRow, "display_name">[]>(
    env,
    `care_profiles?id=eq.${profileId}&select=display_name&limit=1`,
  );
  return rows[0]?.display_name?.trim() || "";
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: "無效的 ID" }, { status: 400 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return Response.json({ error: "請先登入" }, { status: 401 });
    }

    const identity = await verifyLineIdToken(env, token);
    const userId = await getOrCreateDefaultUser(env, identity.lineUserId);
    const memberships = await getUserMemberships(env, userId);
    const groupIds = memberships.map((membership) => membership.group_id);
    const filters = [`user_id.eq.${userId}`];
    if (groupIds.length > 0) filters.push(`group_id.in.(${groupIds.join(",")})`);

    const rows = await supabaseFetch<AppointmentRow[]>(
      env,
      `appointments?id=eq.${id}&status=neq.deleted&or=(${filters.join(",")})&select=*&limit=1`,
    );

    const appointment = rows[0];
    if (!appointment) {
      return Response.json({ error: "找不到該行程或您沒有匯出權限" }, { status: 404 });
    }

    const profileName = await fetchProfileName(env, appointment.profile_id);
    const ics = buildCalendarFile(appointment, profileName);
    const filename = `care-wedo-appointment-${appointment.id}.ics`;

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法產生行事曆檔" },
      { status: 500 },
    );
  }
};
