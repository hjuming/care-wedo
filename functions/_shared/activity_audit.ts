type AuditAppointment = {
  id: number;
  type?: string | null;
  title?: string | null;
  department?: string | null;
  hospital?: string | null;
  reminder_text?: string | null;
  created_by_user_id?: number | null;
  user_id?: number | null;
  created_at?: string | null;
};

type AuditMedicationLog = {
  id?: number;
  medication_id: number;
  medication_name?: string | null;
  status?: string | null;
  taken_date?: string | null;
  time_slot?: string | null;
  confirmed_by_user_id?: number | null;
  created_at?: string | null;
};

export type CareActivityAudit = {
  id: string;
  entity: "appointment" | "family_note" | "medication";
  action: "appointment_created" | "family_note_created" | "medication_taken" | "medication_forgotten";
  actor_user_id: number | null;
  actor_display_name: string;
  occurred_at: string | null;
  status: string;
  summary: string;
};

const SLOT_LABELS: Record<string, string> = {
  morning: "早",
  noon: "中",
  evening: "晚",
  bedtime: "睡前",
  unspecified: "未指定時段",
};

function actorName(userId: number | null | undefined, userNames: Map<number, string>): string {
  return (userId ? userNames.get(userId) : "") || "家庭協作者";
}

function appointmentSummary(appointment: AuditAppointment): string {
  if (appointment.type === "family_note") {
    return appointment.reminder_text || appointment.title || "家庭提醒";
  }
  return appointment.title
    || [appointment.department, appointment.hospital].filter(Boolean).join("・")
    || "照護行程";
}

export function buildActivityAudit({
  appointments = [],
  medicationLogs = [],
  userNames = new Map<number, string>(),
  limit = 20,
}: {
  appointments?: AuditAppointment[];
  medicationLogs?: AuditMedicationLog[];
  userNames?: Map<number, string>;
  limit?: number;
} = {}): CareActivityAudit[] {
  const appointmentEvents = appointments
    .filter((appointment) => appointment.created_at)
    .map((appointment) => ({
      id: `${appointment.type === "family_note" ? "family-note" : "appointment"}-${appointment.id}`,
      entity: appointment.type === "family_note" ? "family_note" as const : "appointment" as const,
      action: appointment.type === "family_note" ? "family_note_created" as const : "appointment_created" as const,
      actor_user_id: appointment.created_by_user_id || appointment.user_id || null,
      actor_display_name: actorName(appointment.created_by_user_id || appointment.user_id, userNames),
      occurred_at: appointment.created_at || null,
      status: "success",
      summary: appointmentSummary(appointment),
    }));

  const medicationEvents = medicationLogs
    .filter((log): log is AuditMedicationLog & { id: number } => Boolean(log.id && log.created_at))
    .map((log) => ({
      id: `medication-log-${log.id}`,
      entity: "medication" as const,
      action: log.status === "forgotten" ? "medication_forgotten" as const : "medication_taken" as const,
      actor_user_id: log.confirmed_by_user_id || null,
      actor_display_name: actorName(log.confirmed_by_user_id, userNames),
      occurred_at: log.created_at || null,
      status: log.status || "taken",
      summary: [log.medication_name || "用藥", SLOT_LABELS[log.time_slot || "unspecified"] || log.time_slot || "未指定時段"]
        .filter(Boolean)
        .join("・"),
    }));

  return [...appointmentEvents, ...medicationEvents]
    .sort((left, right) => String(right.occurred_at || "").localeCompare(String(left.occurred_at || "")))
    .slice(0, Math.max(Number(limit) || 20, 1));
}
