export function todayInTaipei() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function isDateTodayOrFuture(dateValue, today = todayInTaipei()) {
  if (!dateValue) return false;
  const dateText = String(dateValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return false;
  return dateText >= String(today);
}

export function sortUpcomingAppointments(appointments = [], today = todayInTaipei()) {
  const items = Array.isArray(appointments) ? appointments : [];
  return items
    .map((appointment, originalIndex) => ({ appointment, originalIndex }))
    .filter(({ appointment }) => appointment?.status !== "completed" && isDateTodayOrFuture(appointment?.date, today))
    .sort((left, right) => {
      const dateCompare = String(left.appointment.date).localeCompare(String(right.appointment.date));
      if (dateCompare !== 0) return dateCompare;

      const normalizeTime = (value) => {
        const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return "23:59";
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour > 23 || minute > 59) return "23:59";
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      };
      const timeCompare = normalizeTime(left.appointment.time).localeCompare(normalizeTime(right.appointment.time));
      return timeCompare !== 0 ? timeCompare : left.originalIndex - right.originalIndex;
    })
    .map(({ appointment }) => appointment);
}

export function typeLabel(type) {
  if (type === "family_note") return "家庭提醒";
  if (type === "inspection") return "檢查";
  if (type === "refill_reminder") return "領藥";
  if (type === "medication") return "用藥";
  if (type === "measurement") return "量測";
  if (type === "document") return "文件";
  if (type === "rehab") return "復健";
  if (type === "exercise") return "運動";
  if (type === "other") return "其他";
  if (type === "reminder") return "提醒";
  return "回診";
}

export function buildAppointmentTitle(department, type) {
  const departmentText = String(department || "").trim();
  const typeText = typeLabel(type);
  if (!departmentText) return typeText;
  if (!typeText || departmentText === typeText) return departmentText;
  return `${departmentText}・${typeText}`;
}

export function formatDoctorName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  if (/(醫師|醫生)$/u.test(name) || /^(dr\.?|doctor)\s+/iu.test(name)) return name;
  return `${name}醫師`;
}

export function typeIcon(type) {
  if (type === "family_note") return "家";
  if (type === "inspection") return "驗";
  if (type === "refill_reminder") return "藥";
  if (type === "medication") return "服";
  if (type === "measurement") return "量";
  if (type === "document") return "文";
  if (type === "rehab") return "復";
  if (type === "exercise") return "動";
  if (type === "other") return "他";
  if (type === "reminder") return "醒";
  return "診";
}

export function normalizeDateInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return text;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function formatDateLabel(value, time = "") {
  if (!value) return "日期待確認";
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const dayName = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];

  const base = `${yyyy}/${mm}/${dd} (${dayName})`;
  return time ? `${base} ${time}` : base;
}
