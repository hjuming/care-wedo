const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const SLOT_ORDER = {
  "早": 700,
  "中": 1200,
  "晚": 1900,
  "睡前": 2200,
  "其他": 9000,
  "日期待確認": 9900,
};

const MEDICATION_SLOT_LABELS = {
  morning: "早",
  noon: "中",
  evening: "晚",
  bedtime: "睡前",
  other: "其他",
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
  if (["reminder", "medication", "measurement", "document", "rehab", "exercise", "other"].includes(type)) return "我知道了";
  return "我已看診";
}

function appointmentKindLabel(type) {
  if (type === "refill_reminder") return "領藥";
  if (type === "inspection") return "檢查";
  if (type === "medication") return "用藥";
  if (type === "measurement") return "量測";
  if (type === "document") return "文件";
  if (type === "rehab") return "復健";
  if (type === "exercise") return "運動";
  if (type === "other") return "其他";
  if (type === "reminder") return "提醒";
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

export function getMedicationSchedule(medication = {}) {
  const rawSlot = medication.time_slot || medication.scheduled_time || medication.frequency || "";
  const slotText = String(rawSlot || "");
  const lowerSlot = slotText.toLowerCase();
  let slot = "other";

  if (lowerSlot.includes("bedtime") || slotText.includes("睡前")) {
    slot = "bedtime";
  } else if (lowerSlot.includes("evening") || lowerSlot.includes("night") || slotText.includes("晚上") || slotText.includes("晚餐")) {
    slot = "evening";
  } else if (lowerSlot.includes("noon") || lowerSlot.includes("lunch") || slotText.includes("中午") || slotText.includes("午餐")) {
    slot = "noon";
  } else if (lowerSlot.includes("morning") || lowerSlot.includes("breakfast") || slotText.includes("早上") || slotText.includes("早餐") || slotText.includes("上午")) {
    slot = "morning";
  }

  const mealTimingText = {
    before_meal: "飯前",
    after_meal: "飯後",
    with_meal: "隨餐",
    bedtime: "睡前",
    as_needed: "需要時",
  }[medication.meal_timing] || "";
  const inferredMealTiming = slotText.match(/飯前|飯後|隨餐|睡前|需要時/)?.[0]
    || (slotText.match(/早餐後|午餐後|晚餐後/) ? "飯後" : "")
    || (slotText.match(/早餐前|午餐前|晚餐前/) ? "飯前" : "")
    || "";

  return {
    slot,
    slotLabel: MEDICATION_SLOT_LABELS[slot] || "其他",
    timeLabel: medication.scheduled_time || MEDICATION_SLOT_LABELS[slot] || medication.frequency || "時間待確認",
    mealTimingLabel: mealTimingText || inferredMealTiming,
  };
}

export function groupMedicationsBySchedule(medications = []) {
  const groups = new Map();
  medications
    .filter(isActiveMedication)
    .forEach((medication) => {
      const schedule = getMedicationSchedule(medication);
      if (!groups.has(schedule.slot)) {
        groups.set(schedule.slot, {
          slot: schedule.slot,
          label: schedule.slotLabel,
          medications: [],
          medicationIds: [],
          rank: SLOT_ORDER[schedule.slotLabel] || 5000,
        });
      }
      const group = groups.get(schedule.slot);
      group.medications.push({ ...medication, schedule });
      group.medicationIds.push(medication.id);
    });

  return Array.from(groups.values())
    .sort((a, b) => a.rank - b.rank)
    .map((group) => {
      const publicGroup = {
        slot: group.slot,
        label: group.label,
        medicationIds: group.medicationIds,
        medications: group.medications.sort((a, b) => (timeRank(a.schedule.timeLabel) - timeRank(b.schedule.timeLabel)) || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant")),
      };
      return publicGroup;
    });
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
    date: appointment.date || "",
    dateLabel: appointment.date ? formatShortDateLabel(appointment.date) : "",
    primaryActionLabel: appointmentActionLabel(appointment.type),
    status: appointment.status || "upcoming",
    needsReview,
    rank: needsReview ? SLOT_ORDER["日期待確認"] * 10000 : appointmentRank(appointment),
    isToday: isSameDate(appointment.date, today),
  };
}

function formatShortDateLabel(dateValue) {
  const date = parseTaipeiDate(dateValue);
  if (!date) return dateValue;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}（${WEEKDAYS[date.getDay()]}）`;
}

function appointmentRank(appointment = {}) {
  const dateRank = appointment.date ? Number(String(appointment.date).replaceAll("-", "")) * 10000 : SLOT_ORDER["日期待確認"] * 10000;
  return dateRank + timeRank(appointment.time);
}

export function formatTaipeiTodayLabel(today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })) {
  const date = parseTaipeiDate(today);
  if (!date) return { headline: "今天", date: today };
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    headline: "今天",
    date: `${date.getFullYear()}年${month}月${day}日（${WEEKDAYS[date.getDay()]}）`,
  };
}

export function buildTodayTasks({ today, appointments = [] }) {
  const activeAppointments = appointments.filter(isActiveAppointment);
  const sameDayTasks = activeAppointments
    .filter((appointment) => !appointment.date || isSameDate(appointment.date, today))
    .map((appointment) => buildAppointmentTask(appointment, today));

  const appointmentTasks = sameDayTasks.length ? sameDayTasks : activeAppointments
    .filter((appointment) => appointment.date && appointment.date > today)
    .sort((a, b) => appointmentRank(a) - appointmentRank(b))
    .slice(0, 1)
    .map((appointment) => buildAppointmentTask(appointment, today));

  return appointmentTasks
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title, "zh-Hant"))
    .map((task) => {
      const publicTask = { ...task };
      delete publicTask.rank;
      return publicTask;
    });
}

export function hasSameDayTasks({ today, appointments = [] }) {
  return appointments
    .filter(isActiveAppointment)
    .some((appointment) => !appointment.date || isSameDate(appointment.date, today));
}
