const APPOINTMENT_FINGERPRINT_FIELDS = [
  "profile_id",
  "type",
  "date",
  "time",
  "title",
  "hospital",
  "department",
  "doctor",
  "number",
  "location",
  "fasting_required",
  "fasting_hours",
  "notes",
  "reminder_text",
];

function normalizeFingerprintValue(value) {
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-Hant");
}

function appointmentFingerprint(appointment = {}) {
  return APPOINTMENT_FINGERPRINT_FIELDS
    .map((field) => normalizeFingerprintValue(appointment[field]))
    .join("|");
}

export function dedupeAppointments(appointments = []) {
  const groups = new Map();
  appointments.forEach((appointment) => {
    if (appointment?.status === "deleted") return;
    const key = appointmentFingerprint(appointment);
    const group = groups.get(key) || [];
    group.push(appointment);
    groups.set(key, group);
  });

  return Array.from(groups.values()).map((group) => {
    const [first] = group;
    return group.length > 1 ? { ...first, duplicate_count: group.length } : first;
  });
}
