import { useMemo, useState } from "react";
import { groupMedicationsBySchedule } from "../../services/todayTasks";
import { medicationMutationErrorMessage } from "../../services/medicationFeedback";

const MEDICATION_SLOT_OPTIONS = [
  { value: "morning", label: "早" },
  { value: "noon", label: "中" },
  { value: "evening", label: "晚" },
  { value: "bedtime", label: "睡前" },
  { value: "other", label: "其他" },
];
const MEDICATION_SLOT_SORT_ORDER = MEDICATION_SLOT_OPTIONS.map((option) => option.value);

function EmptyMedicationGuide({ title, description, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
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

function getMedicationShortName(name = "藥") {
  return String(name || "藥")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 4) || "藥";
}

function currentMedicationSlot() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    hour12: false,
  }).format(new Date()));
  if (hour < 11) return "morning";
  if (hour < 16) return "noon";
  if (hour < 21) return "evening";
  return "bedtime";
}

function getMedicationSlotValues(medication = {}) {
  const text = [medication.time_slot, medication.scheduled_time, medication.frequency, medication.reminder_text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const values = new Set();
  if (/morning|breakfast|早/.test(text)) values.add("morning");
  if (/noon|lunch|中/.test(text)) values.add("noon");
  if (/evening|night|dinner|晚/.test(text)) values.add("evening");
  if (/bedtime|睡前/.test(text)) values.add("bedtime");
  if (values.size === 0) values.add("other");
  return values;
}

function medicationSlotRank(medication = {}) {
  const ranks = Array.from(getMedicationSlotValues(medication))
    .map((slot) => MEDICATION_SLOT_SORT_ORDER.indexOf(slot))
    .filter((rank) => rank >= 0);
  return ranks.length ? Math.min(...ranks) : MEDICATION_SLOT_SORT_ORDER.length;
}

function uniqueActiveMedications(medications = []) {
  const byId = new Map();
  medications
    .filter((medication) => medication.active !== false)
    .forEach((medication, index) => {
      const key = String(medication.id || medication.name || index);
      if (!byId.has(key)) byId.set(key, medication);
    });
  return Array.from(byId.values())
    .sort((a, b) => {
      const slotRankA = medicationSlotRank(a);
      const slotRankB = medicationSlotRank(b);
      if (slotRankA !== slotRankB) return slotRankA - slotRankB;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
    });
}

function medicationScheduleText(medication = {}) {
  const schedule = medication.schedule || {};
  const slotText = Array.from(getMedicationSlotValues(medication))
    .map((slot) => MEDICATION_SLOT_OPTIONS.find((option) => option.value === slot)?.label)
    .filter(Boolean)
    .join("、");
  return [
    schedule.timeLabel && schedule.timeLabel !== "時間待確認" ? schedule.timeLabel : slotText,
    schedule.mealTimingLabel,
    medication.frequency,
  ].filter(Boolean).join(" ｜ ") || "照藥袋或醫囑";
}

function formatRecordedAt(value) {
  if (!value) return "時間待確認";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時間待確認";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveSlotRecordMeta(group, activityAudit = [], localMeta = null) {
  const medicationMeta = group.medications.find((medication) => medication.taken_at || medication.taken_by);
  const auditMeta = activityAudit.find((event) => (
    event?.entity === "medication"
    && event?.status !== "forgotten"
    && String(event?.summary || "").includes(group.label)
  ));
  return {
    actor: localMeta?.actor || medicationMeta?.taken_by || auditMeta?.actor_display_name || "家庭協作者",
    recordedAt: localMeta?.recordedAt || medicationMeta?.taken_at || auditMeta?.occurred_at || "",
  };
}

function buildMedicationSummaryText(medications = [], date, formatDateLabel) {
  const rows = uniqueActiveMedications(medications);
  return [
    "Care WEDO 用藥總表",
    `更新日期：${formatDateLabel(date)}`,
    "",
    ...rows.map((medication, index) => [
      `${index + 1}. ${medication.name || "藥名待確認"}`,
      `用途：${medication.purpose || "用途待確認"}`,
      `劑量：${medication.dosage || "待確認"}`,
      `時間：${medicationScheduleText(medication)}`,
      medication.warnings ? `注意：${medication.warnings}` : "",
    ].filter(Boolean).join("\n")),
    "",
    "本表供看診溝通使用，實際用藥請以醫師或藥師指示為準。",
  ].join("\n\n");
}

function saveMedicationSummaryImage(medications = [], date, formatDateLabel) {
  const rows = uniqueActiveMedications(medications);
  const width = 1200;
  const padding = 64;
  const lineHeight = 36;
  const blockGap = 32;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const measure = (text, font = "28px sans-serif") => {
    context.font = font;
    const words = Array.from(String(text || ""));
    const lines = [];
    let line = "";
    words.forEach((char) => {
      const next = `${line}${char}`;
      if (context.measureText(next).width > width - padding * 2 && line) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  };
  const rowBlocks = rows.map((medication) => [
    { label: "藥品全名", value: medication.name || "藥名待確認" },
    { label: "用途", value: medication.purpose || "用途待確認" },
    { label: "劑量", value: medication.dosage || "待確認" },
    { label: "服用時間", value: medicationScheduleText(medication) },
    { label: "注意事項", value: medication.warnings || "無特別註記" },
  ]);
  const estimatedHeight = 260 + rowBlocks.reduce((sum, block) => (
    sum + 34 + block.reduce((innerSum, item) => innerSum + measure(`${item.label}：${item.value}`).length * lineHeight + 18, 0) + blockGap
  ), 0);
  canvas.width = width;
  canvas.height = Math.max(estimatedHeight, 760);
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#172426";
  context.font = "700 56px sans-serif";
  context.fillText("Care WEDO 用藥總表", padding, 92);
  context.font = "700 30px sans-serif";
  context.fillStyle = "#4c5c60";
  context.fillText(`更新日期：${formatDateLabel(date)}`, padding, 150);
  let y = 215;
  rowBlocks.forEach((block, index) => {
    context.fillStyle = "#2c6670";
    context.font = "700 34px sans-serif";
    context.fillText(`第 ${index + 1} 筆`, padding, y);
    y += 52;
    block.forEach((item) => {
      context.font = "700 28px sans-serif";
      context.fillStyle = "#b8722b";
      context.fillText(`${item.label}：`, padding, y);
      const lines = measure(item.value);
      context.font = "28px sans-serif";
      context.fillStyle = "#172426";
      lines.forEach((line, lineIndex) => {
        context.fillText(line, padding + 150, y + lineIndex * lineHeight);
      });
      y += Math.max(lines.length, 1) * lineHeight + 18;
    });
    y += blockGap;
  });
  const link = document.createElement("a");
  link.download = `care-wedo-medications-${date}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function MedicationSummarySheet({ medications, todayDate, copyText, formatDateLabel, onClose }) {
  const [notice, setNotice] = useState("");
  const rows = uniqueActiveMedications(medications);
  const summaryText = buildMedicationSummaryText(rows, todayDate, formatDateLabel);

  async function handleCopySummary() {
    try {
      await copyText(summaryText);
      setNotice("已複製用藥總表文字。");
    } catch {
      setNotice("複製失敗，請再試一次。");
    }
  }

  function handleSaveImage() {
    try {
      saveMedicationSummaryImage(rows, todayDate, formatDateLabel);
      setNotice("已產生用藥總表圖片。");
    } catch {
      setNotice("儲存圖片失敗，請再試一次。");
    }
  }

  return (
    <div className="medicine-summary-backdrop" role="presentation" onClick={onClose}>
      <div className="medicine-summary-modal" role="dialog" aria-modal="true" aria-labelledby="medicine-summary-title" onClick={(event) => event.stopPropagation()}>
        <div className="medicine-summary-actions no-print">
          <button type="button" className="secondary-action" onClick={onClose}>返回</button>
          <button type="button" className="secondary-action" onClick={handleCopySummary}>複製文字</button>
          <button type="button" className="primary-action" onClick={handleSaveImage}>儲存圖片</button>
        </div>
        <section className="medicine-summary-sheet" aria-label="給醫生看的用藥總表">
          <div className="medicine-summary-header">
            <p className="panel-eyebrow">給醫生看</p>
            <h2 id="medicine-summary-title">用藥總表</h2>
            <span>更新日期：{formatDateLabel(todayDate)}</span>
          </div>
          {rows.length ? (
            <div className="medicine-summary-table" role="table">
              <div className="medicine-summary-row medicine-summary-head" role="row">
                <strong>藥品全名</strong>
                <strong>用途</strong>
                <strong>劑量</strong>
                <strong>服用時間</strong>
                <strong>注意事項</strong>
              </div>
              {rows.map((medication) => (
                <div className="medicine-summary-row" role="row" key={medication.id || medication.name}>
                  <span data-label="藥品全名">{medication.name || "藥名待確認"}</span>
                  <span data-label="用途">{medication.purpose || "用途待確認"}</span>
                  <span data-label="劑量">{medication.dosage || "待確認"}</span>
                  <span data-label="服用時間">{medicationScheduleText(medication)}</span>
                  <span data-label="注意事項">{medication.warnings || "無特別註記"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">目前還沒有可列出的用藥資料。</p>
          )}
          <p className="medicine-summary-disclaimer">本表供看診溝通使用，實際用藥請以醫師或藥師指示為準。</p>
        </section>
        {notice && <p className="calendar-action-notice no-print">{notice}</p>}
      </div>
    </div>
  );
}

export default function MedicationView({
  medications,
  medicationSummarySource = medications,
  totalMedicationCount = 0,
  searchQuery = "",
  todayDate,
  copyText,
  formatDateLabel,
  onClearSearch,
  onUpload,
  onTaken,
  canCompleteMedication = true,
  readOnly = false,
  activityAudit = [],
}) {
  const [savingSlot, setSavingSlot] = useState(null);
  const [expandedMedicationId, setExpandedMedicationId] = useState(null);
  const [expandedSlot, setExpandedSlot] = useState(() => currentMedicationSlot());
  const [showMedicationSummary, setShowMedicationSummary] = useState(false);
  const [locallyTakenSlots, setLocallyTakenSlots] = useState(() => new Set());
  const [slotFeedback, setSlotFeedback] = useState({});
  const [localRecordMeta, setLocalRecordMeta] = useState({});
  const medicationGroups = useMemo(() => groupMedicationsBySchedule(medications), [medications]);
  const summaryMedications = useMemo(() => uniqueActiveMedications(medicationSummarySource), [medicationSummarySource]);
  const hasAnyMedication = medicationGroups.some((group) => group.medications.length > 0);
  const currentExpandedSlot = expandedSlot === null
    ? null
    : medicationGroups.some((group) => group.slot === expandedSlot && group.medications.length > 0)
      ? expandedSlot
      : medicationGroups.find((group) => group.medications.length > 0)?.slot || null;

  function isSlotDone(group) {
    return locallyTakenSlots.has(`${todayDate}:${group.slot}`)
      || group.medications.every((med) => (
        med.taken_slots?.includes(group.slot)
        || (med.taken_status === "taken" && med.taken_date === todayDate)
      ));
  }

  async function handleSlotStatus(group, status) {
    if (!group.medicationIds.length || !onTaken || !canCompleteMedication || readOnly) return;
    setSavingSlot(`${group.slot}-${status}`);
    setSlotFeedback((current) => ({ ...current, [group.slot]: null }));
    try {
      const result = await onTaken?.(group, status);
      if (status === "taken") {
        setLocallyTakenSlots((prev) => new Set(prev).add(`${todayDate}:${group.slot}`));
        setLocalRecordMeta((current) => ({
          ...current,
          [group.slot]: {
            actor: result?.confirmed_by_name || result?.taken_by || "目前帳號",
            recordedAt: result?.created_at || result?.taken_at || new Date().toISOString(),
          },
        }));
      }
      setSlotFeedback((current) => ({ ...current, [group.slot]: { kind: "success", message: `本次${group.label}服用已記錄。` } }));
    } catch (error) {
      setSlotFeedback((current) => ({ ...current, [group.slot]: { kind: "error", message: medicationMutationErrorMessage(error) } }));
    } finally {
      setSavingSlot(null);
    }
  }

  return (
    <div className="medicine-grid">
      {summaryMedications.length > 0 && (
        <section className="medicine-summary-entry">
          <div>
            <p className="panel-eyebrow">看診時快速出示</p>
            <h3>給醫生看的用藥總表</h3>
            <p>不用一顆一顆點開，直接整理成全名、用途、劑量與服用時間。</p>
          </div>
          <button type="button" className="primary-action" onClick={() => setShowMedicationSummary(true)}>給醫生看</button>
        </section>
      )}

      {hasAnyMedication ? medicationGroups.map((group) => (
        <section key={group.slot} className="medicine-time-group">
          {(() => {
            const isGroupExpanded = currentExpandedSlot === group.slot;
            return (
              <>
          <div className="medicine-slot-head">
            <button
              type="button"
              className="medicine-slot-toggle"
              onClick={() => setExpandedSlot(isGroupExpanded ? null : group.slot)}
              aria-expanded={isGroupExpanded}
              aria-controls={`medicine-slot-${group.slot}`}
            >
              <span>
                <small>{group.medications.length ? `${group.medications.length} 種藥` : "沒有安排"}</small>
                <strong>{group.label}</strong>
              </span>
              <span className="medicine-slot-chevron" aria-hidden="true">{isGroupExpanded ? "−" : "+"}</span>
            </button>
            <div className="medicine-slot-actions">
              {group.medications.length > 0 && isSlotDone(group) && (
                <span className="medicine-slot-status is-done">
                  <strong>{formatDateLabel(todayDate)}・{group.label} 已記錄</strong>
                  <small>
                    {(() => {
                      const meta = resolveSlotRecordMeta(group, activityAudit, localRecordMeta[group.slot]);
                      return `操作者：${meta.actor}・時間：${formatRecordedAt(meta.recordedAt)}`;
                    })()}
                  </small>
                </span>
              )}
              {group.medications.length > 0 && !isSlotDone(group) && canCompleteMedication && !readOnly && (
                <button type="button" className="primary-action compact-action" onClick={() => handleSlotStatus(group, "taken")} disabled={savingSlot === `${group.slot}-taken`}>
                  {savingSlot === `${group.slot}-taken` ? "記錄中…" : "標記本次已服用"}
                </button>
              )}
            </div>
          </div>
          {slotFeedback[group.slot]?.message && (
            <p className={slotFeedback[group.slot].kind === "error" ? "error-msg" : "success-msg"} role="status">
              {slotFeedback[group.slot].message}
            </p>
          )}
          {isGroupExpanded && (group.medications.length ? <div className="medicine-chip-list" id={`medicine-slot-${group.slot}`}>
            {group.medications.map((med) => {
              const isExpanded = expandedMedicationId === med.id;
              return (
                <article key={med.id} className={`medicine-card ${isExpanded ? "is-expanded" : ""}`}>
                  <button
                    type="button"
                    className="medicine-chip-button"
                    onClick={() => setExpandedMedicationId(isExpanded ? null : med.id)}
                    aria-expanded={isExpanded}
                    aria-label={`查看 ${med.name || "藥名待確認"} 說明`}
                  >
                    <span className="medicine-color" style={{ backgroundColor: med.color }} aria-hidden="true">
                      {getMedicationShortName(med.name).slice(0, 1)}
                    </span>
                    <span className="medicine-full-name">{med.name || "藥名待確認"}</span>
                  </button>
                  {isExpanded && (
                    <div className="medicine-card-detail">
                      <dl>
                        <div><dt>全名</dt><dd>{med.name || "藥名待確認"}</dd></div>
                        <div><dt>份量</dt><dd>{med.dosage || "待確認"}</dd></div>
                        {[med.schedule.timeLabel, med.schedule.mealTimingLabel].filter(Boolean).length > 0 && (
                          <div><dt>時間</dt><dd>{[med.schedule.timeLabel, med.schedule.mealTimingLabel].filter(Boolean).join(" ｜ ")}</dd></div>
                        )}
                        {med.purpose && <div><dt>用途</dt><dd>{med.purpose}</dd></div>}
                        {med.warnings && <div><dt>注意</dt><dd>{med.warnings}</dd></div>}
                      </dl>
                    </div>
                  )}
                </article>
              );
            })}
          </div> : (
            <p className="medicine-slot-empty" id={`medicine-slot-${group.slot}`}>這個時段目前沒有藥。</p>
          ))}
              </>
            );
          })()}
        </section>
      )) : (
        <EmptyMedicationGuide
          title={searchQuery && totalMedicationCount > 0 ? "沒有符合搜尋的藥物。" : "目前還沒有吃藥說明。"}
          description={searchQuery && totalMedicationCount > 0 ? "目前的關鍵字把藥物篩掉了，可以先顯示全部藥物再重新查看。" : "拍藥袋或處方箋就可以開始，Care WEDO 會幫你整理吃藥時間、份量與注意事項。"}
          primaryLabel={searchQuery && totalMedicationCount > 0 ? "顯示全部藥物" : onUpload && !readOnly ? "拍照新增照護資料" : undefined}
          onPrimary={searchQuery && totalMedicationCount > 0 ? onClearSearch : onUpload}
          secondaryLabel={searchQuery && totalMedicationCount > 0 && onUpload && !readOnly ? "拍照新增照護資料" : undefined}
          onSecondary={searchQuery && totalMedicationCount > 0 ? onUpload : undefined}
        />
      )}
      {showMedicationSummary && (
        <MedicationSummarySheet
          medications={summaryMedications}
          todayDate={todayDate}
          copyText={copyText}
          formatDateLabel={formatDateLabel}
          onClose={() => setShowMedicationSummary(false)}
        />
      )}
    </div>
  );
}
