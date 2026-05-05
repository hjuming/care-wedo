const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const SLOT_ORDER = {
  "早上": 700,
  "上午": 800,
  "中午": 1200,
  "下午": 1500,
  "晚上": 1900,
  "睡前": 2200,
  "日期待確認": 9900,
};

function parseTaipeiDate(dateValue) {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeRank(value = "") {
  const text = String(value || "");
  const timeMatch = text.match(/(\d{1,2}):?(\d{2})?/);
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || 0);
    return hour * 100 + minute;
  }
  const slot = Object.keys(SLOT_ORDER).find((key) => text.includes(key));
  return slot ? SLOT_ORDER[slot] : 5000;
}

function appointmentActionLabel(type) {
  if (type === "refill_reminder") return "我已領藥";
  if (type === "inspection") return "我已完成";
  return "我已看診";
}

function appointmentKindLabel(type) {
  if (type === "refill_reminder") return "領藥";
  if (type === "inspection") return "檢查";
  return "看診";
}

function isActiveAppointment(appointment) {
  return appointment?.status !== "completed" && appointment?.status !== "deleted";
}

function isActiveMedication(medication) {
  return medication?.active !== false;
}

function isSameDate(dateValue, today) {
  return Boolean(dateValue && today && dateValue === today);
}

function buildAppointmentTask(appointment, today) {
  const needsReview = !appointment.date;
  return {
    id: `appointment-${appointment.id}`,
    sourceId: appointment.id,
    kind: "appointment",
    type: appointment.type || "clinic_visit",
    label: appointmentKindLabel(appointment.type),
    title: appointment.department || appointment.hospital || appointmentKindLabel(appointment.type),
    subtitle: [appointment.time, appointment.hospital, appointment.doctor && `${appointment.doctor}醫師`].filter(Boolean).join(" ｜ "),
    detail: appointment.reminder_text || appointment.notes || appointment.location || "",
    time: needsReview ? "日期待確認" : (appointment.time || "時間待確認"),
    primaryActionLabel: appointmentActionLabel(appointment.type),
    status: appointment.status || "upcoming",
    needsReview,
    rank: needsReview ? SLOT_ORDER["日期待確認"] : timeRank(appointment.time),
    isToday: isSameDate(appointment.date, today),
  };
}

function buildMedicationTask(medication) {
  const time = medication.scheduled_time || medication.time_slot || medication.frequency || "時間待確認";
  return {
    id: `medication-${medication.id}`,
    sourceId: medication.id,
    kind: "medication",
    type: "medication",
    label: "吃藥",
    title: medication.name || "藥名待確認",
    subtitle: [medication.dosage, medication.purpose].filter(Boolean).join(" ｜ "),
    detail: medication.warnings || medication.reminder_text || "",
    time,
    primaryActionLabel: "我吃了",
    status: medication.taken_status || "upcoming",
    needsReview: !medication.frequency && !medication.scheduled_time && !medication.time_slot,
    rank: timeRank(time),
    isToday: true,
  };
}

export function formatTaipeiTodayLabel(today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })) {
  const date = parseTaipeiDate(today);
  if (!date) return { headline: "今天", date: today };
  return {
    headline: "今天",
    date: `${date.getMonth() + 1} 月 ${date.getDate()} 日（${WEEKDAYS[date.getDay()]}）`,
  };
}

export function buildTodayTasks({ today, appointments = [], medications = [] }) {
  const appointmentTasks = appointments
    .filter(isActiveAppointment)
    .filter((appointment) => !appointment.date || isSameDate(appointment.date, today))
    .map((appointment) => buildAppointmentTask(appointment, today));

  const medicationTasks = medications
    .filter(isActiveMedication)
    .map(buildMedicationTask);

  return [...appointmentTasks, ...medicationTasks]
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title, "zh-Hant"))
    .map((task) => {
      const publicTask = { ...task };
      delete publicTask.rank;
      return publicTask;
    });
}
