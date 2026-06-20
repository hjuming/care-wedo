import { useMemo, useState } from "react";
import { buildGoogleCalendarEventUrl } from "../../services/api";
import { formatDateLabel, isDateTodayOrFuture, normalizeDateInput, todayInTaipei, typeIcon, typeLabel } from "../shared/careFormatters";

const REMINDER_TYPE_OPTIONS = [
  { value: "clinic_visit", label: "門診" },
  { value: "inspection", label: "檢查" },
  { value: "refill_reminder", label: "領藥" },
  { value: "rehab", label: "復健" },
  { value: "exercise", label: "運動" },
  { value: "other", label: "其他" },
];

function normalizeManualReminderType(type) {
  return REMINDER_TYPE_OPTIONS.some((option) => option.value === type) ? type : "other";
}

function addDaysInTaipei(days) {
  const date = new Date(`${todayInTaipei()}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function addMonthsInTaipei(months) {
  const date = new Date(`${todayInTaipei()}T00:00:00+08:00`);
  date.setMonth(date.getMonth() + months);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function buildCalendarReminderCopy(appointment = {}, careName = "") {
  const title = appointment.title || appointment.department || typeLabel(appointment.type);
  const place = [appointment.hospital, appointment.doctor && `${appointment.doctor}醫師`, appointment.number && `${appointment.number}號`].filter(Boolean).join(" ｜ ");
  return [
    careName && `${careName} 的照護排程`,
    formatDateLabel(appointment.date, appointment.time),
    title,
    place,
    appointment.location && `地點：${appointment.location}`,
    appointment.notes || appointment.reminder_text,
    "已存入 Care WEDO。",
  ].filter(Boolean).join("\n");
}

async function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available.");
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function EmptyGuide({ title, description, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
  return (
    <div className="empty-guide">
      <p className="empty-guide-title">{title}</p>
      <p className="empty-guide-copy">{description}</p>
      <div className="empty-guide-actions">
        {primaryLabel && (
          <button type="button" className="primary-action" onClick={onPrimary}>
            {primaryLabel}
          </button>
        )}
        {secondaryLabel && (
          <button type="button" className="secondary-action" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function buildReminderFormData(appointment = null) {
  return {
    type: normalizeManualReminderType(appointment?.type || "clinic_visit"),
    date: appointment?.date || todayInTaipei(),
    time: appointment?.time || "",
    hospital: appointment?.hospital || "",
    department: appointment?.department || "",
    doctor: appointment?.doctor || "",
    location: appointment?.location || "",
    notes: appointment?.notes || appointment?.reminder_text || "",
    fasting_required: Boolean(appointment?.fasting_required),
    fasting_hours: appointment?.fasting_hours || 8,
  };
}

function buildReminderPayload(formData) {
  return {
    ...formData,
    date: normalizeDateInput(formData.date),
    title: typeLabel(formData.type),
    department: formData.department,
    fasting_hours: formData.fasting_required ? formData.fasting_hours : null,
  };
}

export function ManualReminderModal({ mode = "create", initialAppointment = null, onClose, onSave, onDelete, onCopy }) {
  const [formData, setFormData] = useState(() => initialAppointment ? buildReminderFormData(initialAppointment) : {
    type: "clinic_visit",
    date: todayInTaipei(),
    time: "",
    hospital: "",
    department: "",
    doctor: "",
    location: "",
    notes: "",
    fasting_required: false,
    fasting_hours: 8,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(buildReminderPayload(formData));
    } catch (err) {
      setError(err.message || "新增提醒失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopySubmit() {
    setCopying(true);
    setError("");
    try {
      await onCopy?.(buildReminderPayload(formData));
    } catch (err) {
      setError(err.message || "複製失敗，請再試一次");
      setCopying(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await onDelete?.();
    } catch (err) {
      setError(err.message || "刪除失敗，請再試一次");
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content manual-reminder-modal">
        <div className="modal-header">
          <h2>{mode === "edit" ? "編輯提醒" : "手動新增提醒"}</h2>
          <button type="button" onClick={onClose} className="btn-close">✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <p className="error-msg">{error}</p>}
            <div className="form-group">
              <label>提醒類型</label>
              <div className="segmented-choice-grid" role="group" aria-label="提醒類型">
                {REMINDER_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`choice-pill choice-pill-${option.value} ${formData.type === option.value ? "active" : ""}`}
                    onClick={() => setFormData({ ...formData, type: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>日期</label>
                <div className="quick-choice-row">
                  <button type="button" onClick={() => setFormData({ ...formData, date: todayInTaipei() })}>今天</button>
                  <button type="button" onClick={() => setFormData({ ...formData, date: addDaysInTaipei(1) })}>明天</button>
                  <button type="button" onClick={() => setFormData({ ...formData, date: addDaysInTaipei(7) })}>下週</button>
                  <button type="button" onClick={() => setFormData({ ...formData, date: addMonthsInTaipei(1) })}>下月</button>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formData.date}
                  onChange={(event) => setFormData({ ...formData, date: event.target.value })}
                  placeholder="例：2026/05/15 或 2026-05-15"
                  required
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>時間</label>
                <div className="quick-choice-row">
                  {["上午", "下午", "晚上", "睡前", "全天"].map((timeLabel) => (
                    <button key={timeLabel} type="button" onClick={() => setFormData({ ...formData, time: timeLabel })}>
                      {timeLabel}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={formData.time}
                  onChange={(event) => setFormData({ ...formData, time: event.target.value })}
                  placeholder="例：07:45、上午、7:45-19:00"
                />
              </div>
              <div className="form-group">
                <label>醫院 / 地點</label>
                <input
                  value={formData.hospital}
                  onChange={(event) => setFormData({ ...formData, hospital: event.target.value })}
                  placeholder="例：常去的醫院、診所或藥局"
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>診別 / 科別</label>
                <input
                  value={formData.department}
                  onChange={(event) => setFormData({ ...formData, department: event.target.value })}
                  placeholder="例：家醫科、藥局、檢查室"
                />
              </div>
              <div className="form-group">
                <label>醫師</label>
                <input
                  value={formData.doctor}
                  onChange={(event) => setFormData({ ...formData, doctor: event.target.value })}
                  placeholder="例：醫師或藥師姓名"
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>詳細地點</label>
                <input
                  value={formData.location}
                  onChange={(event) => setFormData({ ...formData, location: event.target.value })}
                  placeholder="例：門診區、檢查室、領藥窗口"
                />
              </div>
            </div>
            <label className="settings-toggle compact-toggle">
              <span>需要空腹提醒</span>
              <input
                type="checkbox"
                checked={formData.fasting_required}
                onChange={(event) => setFormData({ ...formData, fasting_required: event.target.checked })}
              />
            </label>
            {formData.fasting_required && (
              <div className="form-group">
                <label>空腹小時數</label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={formData.fasting_hours}
                  onChange={(event) => setFormData({ ...formData, fasting_hours: Number(event.target.value) })}
                />
              </div>
            )}
            <div className="form-group">
              <label>提醒內容</label>
              <textarea
                value={formData.notes}
                onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
                placeholder="例：要帶的資料、注意事項、家人分工"
                rows={4}
              />
            </div>
            {mode === "edit" && onCopy && (
              <div className="modal-copy-zone">
                <div>
                  <strong>複製提醒</strong>
                  <p>會用目前表單內容建立新提醒。先改日期再複製，原本那筆不會被修改。</p>
                </div>
                <button type="button" className="secondary-action subtle copy-subtle" onClick={handleCopySubmit} disabled={saving || deleting || copying}>
                  {copying ? "複製中..." : "複製成新提醒"}
                </button>
              </div>
            )}
            {mode === "edit" && onDelete && (
              <div className="modal-danger-zone">
                <div>
                  <strong>刪除提醒</strong>
                  <p>{confirmDelete ? "刪除後，首頁與未來行程不會再顯示這筆資料。請再次確認。" : "如果這筆資料不需要了，可以在這裡刪除。"}</p>
                </div>
                <div className="modal-danger-actions">
                  {confirmDelete && (
                    <button type="button" className="secondary-action subtle" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      取消刪除
                    </button>
                  )}
                  <button type="button" className="secondary-action subtle danger-subtle" onClick={handleDelete} disabled={saving || deleting}>
                    {deleting ? "刪除中..." : confirmDelete ? "確認刪除" : "刪除這筆提醒"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="secondary-action" onClick={onClose} disabled={saving}>取消</button>
            <button type="submit" className="primary-action" disabled={saving}>{saving ? "儲存中..." : mode === "edit" ? "儲存修改" : "儲存提醒"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CalendarView({ appointments, careName = "", onUpload, onAddToCalendar, onEditAppointment }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarActionAppointment, setCalendarActionAppointment] = useState(null);
  const [calendarActionNotice, setCalendarActionNotice] = useState("");
  const futureAppointments = useMemo(
    () => appointments.filter((apt) => apt.status !== "completed" && isDateTodayOrFuture(apt.date)),
    [appointments],
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
  const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1; // Adjust to Mon starting

  const calendarDays = Array.from({ length: 42 }, (_, i) => {
    const dayNumber = i - adjustedFirstDay + 1;
    if (dayNumber > 0 && dayNumber <= daysInMonth) {
      return dayNumber;
    }
    return null;
  });

  function changeMonth(offset) {
    const nextDate = new Date(year, month + offset, 1);
    setCurrentDate(nextDate);
  }

  function scrollToDate(day) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const element = document.getElementById(`event-${dateStr}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function closeCalendarActions() {
    setCalendarActionAppointment(null);
    setCalendarActionNotice("");
  }

  async function handleCopyCalendarReminder(appointment) {
    try {
      await copyText(buildCalendarReminderCopy(appointment, careName));
      setCalendarActionNotice("已複製提醒文字。");
    } catch {
      setCalendarActionNotice("複製失敗，請再試一次。");
    }
  }

  return (
    <div className="calendar-layout">
      <section className="calendar-board" aria-label="月曆預覽">
        <div className="calendar-head">
          <div className="month-nav">
            <button type="button" onClick={() => changeMonth(-1)}>❮</button>
            <strong>{year} 年 {month + 1} 月</strong>
            <button type="button" onClick={() => changeMonth(1)}>❯</button>
          </div>
          <button type="button" className="btn-today" onClick={() => setCurrentDate(new Date())}>回到今天</button>
        </div>
        <div className="calendar-weekdays">
          {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-days">
          {calendarDays.map((day, index) => {
            if (!day) return <div key={`empty-${index}`} className="calendar-day empty" />;

            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const hasEvent = futureAppointments.some((apt) => apt.date === dateStr);
            const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();

            return (
              <button
                key={day}
                type="button"
                className={`calendar-day ${hasEvent ? "has-event" : ""} ${isToday ? "is-today" : ""}`}
                onClick={() => scrollToDate(day)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </section>

      <section className="event-list" aria-label="看診和領藥清單">
        <div className="inline-action-row event-list-actions">
          <button type="button" className="primary-action" onClick={onUpload}>拍照新增照護資料</button>
        </div>
        {futureAppointments.length ? futureAppointments.map((apt) => (
          <article key={apt.id} id={`event-${apt.date}`} className="event-row">
            <div className="event-card-actions">
              <button type="button" className="card-corner-calendar" onClick={() => setCalendarActionAppointment(apt)} aria-label={`加入 ${apt.title || apt.department || "提醒"} 到行事曆`}>
                加入行事曆
              </button>
            </div>
            <div className="event-type">{typeIcon(apt.type)}</div>
            <div>
              <p className="event-date">{formatDateLabel(apt.date, apt.time)}</p>
              <h3>{apt.title || apt.department}</h3>
              <p>{[apt.hospital, apt.doctor && `${apt.doctor}醫師`, apt.number && `${apt.number}號`].filter(Boolean).join(" ｜ ")}</p>
              {apt.location && <p className="location-line">地點：{apt.location}</p>}
              {apt.notes && <p className="soft-note">{apt.notes}</p>}
            </div>
            <div className="event-card-edit-actions">
              <button type="button" className="card-corner-edit" onClick={() => onEditAppointment?.(apt)} aria-label={`編輯 ${apt.title || apt.department || "提醒"}`}>
                編輯
              </button>
            </div>
          </article>
        )) : (
          <EmptyGuide
            title="目前還沒有看診提醒。"
            description="可以先拍掛號單、處方箋或提醒單，Care WEDO 會幫你整理下一次回診、檢查或領藥時間。"
            primaryLabel="拍照新增照護資料"
            onPrimary={onUpload}
          />
        )}
      </section>
      {calendarActionAppointment && (
        <div className="calendar-action-backdrop" role="presentation" onClick={closeCalendarActions}>
          <div className="calendar-action-sheet" role="dialog" aria-modal="true" aria-labelledby="calendar-action-title" onClick={(event) => event.stopPropagation()}>
            <div>
              <p className="panel-eyebrow">加入行事曆</p>
              <h3 id="calendar-action-title">{calendarActionAppointment.title || calendarActionAppointment.department || "照護排程"}</h3>
              <p>{formatDateLabel(calendarActionAppointment.date, calendarActionAppointment.time)}</p>
            </div>
            <div className="calendar-action-options">
              <a
                className="calendar-action-choice primary"
                href={buildGoogleCalendarEventUrl(calendarActionAppointment, { profileName: careName })}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeCalendarActions}
              >
                加入 Google 行事曆
              </a>
              <button type="button" className="calendar-action-choice" onClick={() => { onAddToCalendar?.(calendarActionAppointment); closeCalendarActions(); }}>
                Apple / 手機行事曆
              </button>
              <button type="button" className="calendar-action-choice" onClick={() => handleCopyCalendarReminder(calendarActionAppointment)}>
                複製提醒文字
              </button>
            </div>
            {calendarActionNotice && <p className="calendar-action-notice">{calendarActionNotice}</p>}
            <button type="button" className="calendar-action-cancel" onClick={closeCalendarActions}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
