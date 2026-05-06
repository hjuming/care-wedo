import { useEffect, useMemo, useState } from "react";
import aiAvatar from "../assets/ai-avatar.png";

function normalizeAppointmentDraft(apt = {}) {
  return {
    type: apt.type || "clinic_visit",
    date: apt.date || "",
    time: apt.time || "",
    hospital: apt.hospital || "",
    department: apt.department || "",
    doctor: apt.doctor || "",
    number: apt.number || "",
    location: apt.location || "",
    fasting_required: Boolean(apt.fasting_required),
    fasting_hours: apt.fasting_hours || "",
    notes: apt.notes || "",
    reminder_text: apt.reminder_text || "",
  };
}

function normalizeMedicationDraft(med = {}) {
  return {
    name: med.name || "",
    dosage: med.dosage || med.qty || "",
    frequency: med.frequency || med.freq || "",
    purpose: med.purpose || med.use || "",
    warnings: med.warnings || "",
    reminder_text: med.reminder_text || "",
  };
}

function cleanAppointmentDraft(apt) {
  return {
    ...apt,
    fasting_required: Boolean(apt.fasting_required),
    fasting_hours: apt.fasting_hours ? Number(apt.fasting_hours) : null,
  };
}

function cleanMedicationDraft(med) {
  return { ...med };
}

export default function OcrResult({ data, onClose, onSaveCorrections, onAskFamily, onNavigate }) {
  const parsed = data?.data || data;
  const saved = data?.saved || {};
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [draft, setDraft] = useState({ appointments: [], medications: [] });

  const canPersist = Boolean(onSaveCorrections)
    && ((saved.appointment_ids || []).length > 0 || (saved.medication_ids || []).length > 0);

  useEffect(() => {
    setDraft({
      appointments: (parsed?.appointments || []).map(normalizeAppointmentDraft),
      medications: (parsed?.medications || []).map(normalizeMedicationDraft),
    });
    setEditing(false);
    setSaveError("");
    setSavedMessage("");
  }, [parsed]);

  const hasContent = useMemo(() => {
    return Boolean(
      parsed?.patient?.name
      || parsed?.appointments?.length
      || parsed?.medications?.length
      || parsed?.exams?.length
      || parsed?.reminders?.length
      || parsed?.next_visit?.date,
    );
  }, [parsed]);

  if (!parsed) return null;

  async function handleSave() {
    if (!onSaveCorrections) return;
    setSaving(true);
    setSaveError("");
    setSavedMessage("");
    try {
      const appointments = draft.appointments.map(cleanAppointmentDraft);
      const medications = draft.medications.map(cleanMedicationDraft);
      await onSaveCorrections({ appointments, medications });
      setEditing(false);
      setSavedMessage("已經幫你記好了。");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "暫時無法存起來，請再試一次。");
    } finally {
      setSaving(false);
    }
  }

  function updateAppointment(index, field, value) {
    setDraft((prev) => ({
      ...prev,
      appointments: prev.appointments.map((apt, i) => i === index ? { ...apt, [field]: value } : apt),
    }));
  }

  function updateMedication(index, field, value) {
    setDraft((prev) => ({
      ...prev,
      medications: prev.medications.map((med, i) => i === index ? { ...med, [field]: value } : med),
    }));
  }

  return (
    <div className="ocr-result-panel">
      <div className="ocr-result-header">
        <div className="ocr-result-title">
          <img src={aiAvatar} alt="健康小管家" />
          <div>
            <p>{editing ? "正在校正內容" : "我幫你看出這些內容，對嗎？"}</p>
            <span>{editing ? "你可以修正任何不正確的欄位" : "確認後才會放進今日照護、看診與吃藥清單。"}</span>
          </div>
        </div>
        <div className="ocr-result-actions">
          {canPersist && !editing && (
            <>
              <button type="button" className="primary-action compact-action" onClick={handleSave} disabled={saving}>
                {saving ? "存起來…" : "正確，存起來"}
              </button>
              <button type="button" className="secondary-action compact-action" onClick={() => setEditing(true)} disabled={saving}>
                有錯，我要修改
              </button>
              <button type="button" className="secondary-action compact-action" onClick={() => onAskFamily?.(null)} disabled={saving}>
                我看不懂，問家人
              </button>
            </>
          )}
          {editing && (
            <>
              <button type="button" className="secondary-action compact-action" onClick={() => setEditing(false)} disabled={saving}>
                取消
              </button>
              <button type="button" className="primary-action compact-action" onClick={handleSave} disabled={saving}>
                {saving ? "存起來…" : "正確，存起來"}
              </button>
            </>
          )}
          <button type="button" className="inline-action ocr-close-action" onClick={onClose}>
            收起
          </button>
        </div>
      </div>

      {saveError && (
        <div className="ocr-save-note danger">{saveError}</div>
      )}
      {savedMessage && (
        <div className="ocr-success-card">
          <p className="ocr-success-title">✓ 已經幫你記好了。</p>
          <p className="ocr-success-copy">
            你可以在「今日照護」查看下一件要記得的事，也可以到「看診排程」查看回診提醒。
          </p>
          <div className="ocr-nav-actions">
            <button type="button" className="primary-action compact-action" onClick={() => onNavigate?.("overview")}>
              查看今日照護
            </button>
            <button type="button" className="secondary-action compact-action" onClick={() => onNavigate?.("calendar")}>
              看診日曆
            </button>
          </div>
        </div>
      )}

      {!hasContent && (
        <section className="ocr-card">
          <p className="empty-state">這張單據沒有解析出可保存的提醒。</p>
        </section>
      )}

      {parsed.patient?.name && (
        <section className="ocr-card ocr-person-card">
          <div className="ocr-person-avatar">{parsed.patient.name.charAt(0)}</div>
          <div>
            <strong>{parsed.patient.name}</strong>
            <span>{[parsed.patient.age, parsed.department, parsed.visit_date].filter(Boolean).join(" · ")}</span>
          </div>
        </section>
      )}

      {draft.appointments.length > 0 && (
        <section className="ocr-card">
          <SectionTitle>看診或領藥提醒 ({draft.appointments.length} 筆)</SectionTitle>
          {editing
            ? draft.appointments.map((apt, index) => (
              <AppointmentEditor key={index} appointment={apt} onChange={(field, value) => updateAppointment(index, field, value)} />
            ))
            : draft.appointments.map((apt, index) => <AppointmentPreview key={index} appointment={apt} />)}
        </section>
      )}

      {draft.medications.length > 0 && (
        <section className="ocr-card">
          <SectionTitle>要注意的藥 ({draft.medications.length} 種)</SectionTitle>
          {editing
            ? draft.medications.map((med, index) => (
              <MedicationEditor key={index} medication={med} onChange={(field, value) => updateMedication(index, field, value)} />
            ))
            : draft.medications.map((med, index) => <MedicationPreview key={index} medication={med} />)}
        </section>
      )}

      {parsed.exams?.length > 0 && !editing && (
        <section className="ocr-card">
          <SectionTitle>檢查安排 ({parsed.exams.length} 項)</SectionTitle>
          {parsed.exams.map((exam, index) => (
            <div key={index} className="ocr-row">
              <strong>{[exam.type, exam.date, exam.time].filter(Boolean).join(" · ")}</strong>
              <span>{[exam.location, exam.notes].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="ocr-section-title">{children}</p>;
}

function AppointmentPreview({ appointment }) {
  return (
    <div className="ocr-row">
      <strong>{[appointment.date, appointment.time, appointment.department || appointment.hospital].filter(Boolean).join(" · ")}</strong>
      <span>{[appointment.hospital, appointment.doctor && `${appointment.doctor}醫師`, appointment.location].filter(Boolean).join(" · ")}</span>
      {appointment.fasting_required && <em>前 {appointment.fasting_hours || 8} 小時先不要吃東西</em>}
    </div>
  );
}

function MedicationPreview({ medication }) {
  return (
    <div className="ocr-row">
      <strong>{medication.name || "藥名待確認"}</strong>
      <span>{[medication.frequency, medication.dosage, medication.purpose].filter(Boolean).join(" · ")}</span>
      {medication.warnings && <em>{medication.warnings}</em>}
    </div>
  );
}

function AppointmentEditor({ appointment, onChange }) {
  return (
    <div className="ocr-edit-grid">
      <Field label="日期" value={appointment.date} onChange={(value) => onChange("date", value)} type="date" />
      <Field label="時間" value={appointment.time} onChange={(value) => onChange("time", value)} type="time" />
      <Field label="醫院" value={appointment.hospital} onChange={(value) => onChange("hospital", value)} />
      <Field label="科別" value={appointment.department} onChange={(value) => onChange("department", value)} />
      <Field label="醫師" value={appointment.doctor} onChange={(value) => onChange("doctor", value)} />
      <Field label="號碼" value={appointment.number} onChange={(value) => onChange("number", value)} />
      <Field label="地點" value={appointment.location} onChange={(value) => onChange("location", value)} wide />
      <Field label="提醒文字" value={appointment.reminder_text} onChange={(value) => onChange("reminder_text", value)} wide />
      <label className="ocr-checkbox-field">
        <input
          type="checkbox"
          checked={appointment.fasting_required}
          onChange={(event) => onChange("fasting_required", event.target.checked)}
        />
        需要空腹
      </label>
      {appointment.fasting_required && (
        <Field label="空腹小時" value={appointment.fasting_hours} onChange={(value) => onChange("fasting_hours", value)} type="number" />
      )}
    </div>
  );
}

function MedicationEditor({ medication, onChange }) {
  return (
    <div className="ocr-edit-grid">
      <Field label="藥名" value={medication.name} onChange={(value) => onChange("name", value)} />
      <Field label="劑量" value={medication.dosage} onChange={(value) => onChange("dosage", value)} />
      <Field label="頻率" value={medication.frequency} onChange={(value) => onChange("frequency", value)} />
      <Field label="用途" value={medication.purpose} onChange={(value) => onChange("purpose", value)} />
      <Field label="注意事項" value={medication.warnings} onChange={(value) => onChange("warnings", value)} wide />
      <Field label="提醒文字" value={medication.reminder_text} onChange={(value) => onChange("reminder_text", value)} wide />
    </div>
  );
}

function Field({ label, value, onChange, type = "text", wide = false }) {
  return (
    <label className={wide ? "ocr-field wide" : "ocr-field"}>
      <span>{label}</span>
      <input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
