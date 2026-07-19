import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("elder today view and care circle use explicit role sections", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");

  assert.match(app, /今天用藥/);
  assert.match(app, /家庭與成員/);
  assert.match(app, /提醒與通知/);
  assert.match(app, /照護資料/);
  assert.match(app, /費用與帳號/);
  assert.match(app, /目前為測試模式：不會實際扣款/);
});

test("today task completion is available only for truly same-day items", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const overviewView = app.slice(
    app.indexOf("function OverviewView"),
    app.indexOf("function appointmentTimeValue"),
  );

  assert.match(overviewView, /if \(readOnly \|\| !onComplete \|\| !task\.isToday \|\| task\.canComplete === false\) return/);
  assert.match(overviewView, /\{task\.isToday && task\.canComplete !== false && !readOnly && onComplete && \(/);
});

test("medication completion copy identifies the slot and actor", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");

  assert.match(medicationView, /aria-label=\{`記錄\$\{slotLabel\}這些藥已服用`\}/);
  assert.match(medicationView, /`記錄：\$\{slotLabel\}已服用`/);
  assert.match(medicationView, /操作者/);
  assert.match(medicationView, /recordedAt|taken_at/);
  assert.doesNotMatch(medicationView, /我已吃完/);
});

test("dashboard medication normalization preserves the backend schedule labels", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const normalizer = app.slice(app.indexOf("function normalizeMedication"), app.indexOf("function documentTypeLabel"));

  assert.match(normalizer, /schedule:\s*med\.schedule \|\| null/);
});

test("mobile shell prevents long identity text and bottom navigation overlap", () => {
  const nav = readProjectFile("care-wedo-app/src/components/MobileBottomNav.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(nav, /--mobile-nav-count/);
  assert.match(css, /grid-template-columns:\s*repeat\(var\(--mobile-nav-count/);
  assert.match(css, /--mobile-bottom-nav-clearance:\s*142px/);
  assert.match(css, /\.mobile-bottom-nav[\s\S]*padding-bottom:\s*8px/);
  assert.match(css, /\.content-area\s*\{[\s\S]*padding:\s*12px 12px calc\(var\(--mobile-bottom-nav-clearance\)\s*\+\s*env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(css, /\.dashboard-grid,\s*\.content-area\s*\{\s*padding-bottom:\s*96px/);
  assert.doesNotMatch(css, /padding-bottom:\s*calc\(var\(--mobile-bottom-nav-clearance\)\s*\+\s*env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.account-sub[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.mobile-bottom-nav strong[\s\S]*overflow-wrap:\s*anywhere/);
});

test("mobile navigation returns every workflow to the top without a second sticky tab bar", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const navHandler = app.slice(app.indexOf("function handleMobileNavChange"), app.indexOf("async function handleComplete"));
  const mobileCss = css.slice(css.indexOf("@media (max-width: 760px)"));
  const managementTabsRule = mobileCss.match(/\.management-section-tabs\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(navHandler, /window\.requestAnimationFrame/);
  assert.match(navHandler, /prefers-reduced-motion:\s*reduce/);
  assert.match(navHandler, /window\.scrollTo\(\{\s*top:\s*0,/);
  assert.match(app, /className="toolbar management-toolbar"/);
  assert.match(mobileCss, /\.management-toolbar\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*760px\) and \(max-height:\s*640px\)[\s\S]*\.mobile-bottom-nav span\s*\{\s*display:\s*none/);
  assert.match(css, /\.management-section-tabs button\s*\{[^}]*line-height:\s*1\.2/);
  assert.doesNotMatch(managementTabsRule, /position:\s*sticky/);
});

test("care identity header stays informational and uses care-recipient terminology", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const header = app.slice(app.indexOf("function CareContextHeader"), app.indexOf("function SectionHeading"));
  const dashboard = app.slice(app.indexOf('<section className="content-area"'), app.indexOf('{activeSection === "overview"'));
  const settings = app.slice(app.indexOf("function SettingsView"), app.indexOf("function FamilyNotesEditor"));

  assert.doesNotMatch(header, /onOpenProfile/);
  assert.doesNotMatch(header, /<button[^>]*className="care-context-avatar"/);
  assert.match(header, /<div className="care-context-avatar" aria-hidden="true">/);
  assert.match(header, />切換照護對象</);
  assert.doesNotMatch(header, /編輯照護者資料|切換照護者/);
  assert.doesNotMatch(dashboard, /onOpenProfile=/);
  assert.match(app, />編輯照護對象<\/button>/);
  assert.doesNotMatch(settings, /className="care-profile-list"|className="care-profile-item/);
  assert.match(settings, /onPreviewElder/);
  assert.match(settings, /className="secondary-action mobile-preview-action"[^>]*>看長輩版<\/button>/);
  assert.match(app, /onPreviewElder=\{\(\) => setPreferredDisplayMode\("elder"\)\}/);
  assert.match(css, /\.management-action-grid \.mobile-preview-action\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-display-mode-switch:not\(\[aria-pressed="true"\]\)\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.management-action-grid \.mobile-preview-action\s*\{[\s\S]*display:\s*inline-flex/);
});

test("family management progressively reveals secondary forms on mobile", () => {
  const settings = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.ok((settings.match(/<details className="group-settings-disclosure/g) || []).length >= 4);
  assert.match(settings, /<summary>邀請協作者<\/summary>/);
  assert.match(settings, /<summary>照護協作者名單/);
  assert.match(settings, /<summary>我的通知設定<\/summary>/);
  assert.match(settings, /<summary>新增照護對象<\/summary>/);
  assert.match(css, /\.group-settings-disclosure > summary\s*\{[\s\S]*min-height:\s*52px/);
  assert.match(css, /\.group-settings-disclosure > summary::after\s*\{[\s\S]*content:\s*"展開"/);
  assert.match(css, /\.group-settings-disclosure\[open\] > summary::after\s*\{[\s\S]*content:\s*"收起"/);
});

test("mobile controls and profile edit form remain elder-friendly on narrow screens", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-profile-quick-switch select[\s\S]*min-height:\s*48px/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.search-suggestions button[\s\S]*min-height:\s*48px/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.profile-edit-modal \.form-row-two[\s\S]*grid-template-columns:\s*1fr/);
});

test("profile edits require explicit discard and stay locked during avatar or save work", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const modal = app.slice(app.indexOf("function ProfileEditModal"), app.indexOf("function profileSortValue"));

  assert.match(modal, /const initialFormDataRef = useRef/);
  assert.match(modal, /const busyRef = useRef\(false\)/);
  assert.match(modal, /const isBusy = saving \|\| uploading/);
  assert.match(modal, /const isDirty = Object\.keys\(initialFormDataRef\.current\)\.some/);
  assert.match(modal, /function requestClose\(\)[\s\S]*if \(busyRef\.current\) return;[\s\S]*if \(isDirty\)[\s\S]*setConfirmDiscard\(true\)[\s\S]*onClose\(\)/);
  assert.match(modal, /async function handleAvatarUpload[\s\S]*if \(busyRef\.current\) return;[\s\S]*busyRef\.current = true[\s\S]*finally \{[\s\S]*busyRef\.current = false/);
  assert.match(modal, /async function handleSave[\s\S]*if \(busyRef\.current\) return;[\s\S]*busyRef\.current = true[\s\S]*finally \{[\s\S]*busyRef\.current = false/);
  assert.match(modal, /role="dialog"[\s\S]*aria-labelledby="profile-edit-title"[\s\S]*aria-busy=\{isBusy\}/);
  assert.match(modal, /onClick=\{requestClose\} className="btn-close" aria-label="關閉" disabled=\{isBusy\}/);
  assert.match(modal, /<fieldset className="profile-edit-fields" disabled=\{isBusy \|\| confirmDiscard\}>/);
  assert.match(modal, /className="profile-save-status" role="status"/);
  assert.match(modal, /role="alertdialog"[\s\S]*要放棄尚未儲存的修改嗎？[\s\S]*繼續編輯[\s\S]*放棄修改/);
  assert.match(modal, /className="error-msg" role="alert"/);
  assert.match(modal, /className="secondary-action" onClick=\{requestClose\} disabled=\{isBusy\}/);
  assert.match(css, /\.profile-edit-fields\s*\{[\s\S]*display:\s*grid[\s\S]*min-width:\s*0[\s\S]*border:\s*0/);
  assert.match(css, /@media \(max-width:\s*420px\)[\s\S]*\.profile-discard-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("mobile care context is a compact identity row without repeated account cards", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-context-details\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-context-avatar\s*\{[\s\S]*width:\s*56px[\s\S]*height:\s*56px/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-context-copy h2\s*\{[\s\S]*font-size:\s*26px/);
});

test("mobile care identity lets the mode control wrap when system text is enlarged", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  const finalMobileRules = css.slice(css.lastIndexOf("@media (max-width: 760px)"));

  assert.match(finalMobileRules, /\.care-context-main\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(finalMobileRules, /\.care-context-copy\s*\{[\s\S]*flex:\s*1 1 180px/);
  assert.match(finalMobileRules, /\.care-context-avatar\s*\{[\s\S]*width:\s*56px[\s\S]*height:\s*56px/);
  assert.match(finalMobileRules, /\.care-context-copy h2\s*\{[\s\S]*font-size:\s*26px/);
});

test("mobile navigation exposes one care-items entry and keeps search in that workflow", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const mobileSections = app.slice(app.indexOf("const MOBILE_SECTIONS"), app.indexOf("function normalizeAppointment"));
  const overviewView = app.slice(app.indexOf("function OverviewView"), app.indexOf("function appointmentTimeValue"));
  const recordsStart = app.indexOf('{activeSection === "records" && (');
  const recordsSection = app.slice(recordsStart, app.indexOf('{activeSection === "settings"', recordsStart));

  assert.match(mobileSections, /id:\s*"calendar"[\s\S]*mobileLabel:\s*"照護事項"/);
  assert.doesNotMatch(mobileSections, /id:\s*"records"/);
  assert.match(mobileSections, /id:\s*"settings"[\s\S]*mobileLabel:\s*"管理"/);
  assert.doesNotMatch(overviewView, /today-search-panel/);
  assert.match(app, /activeSection === "calendar" && !isElderDisplay/);
  assert.match(app, /\["calendar",\s*"records"\]\.includes\(activeSection\)/);
  assert.match(app, /activeSection === "records" \? "calendar" : activeSection/);
  assert.match(app, /mobile-care-items-switch/);
  assert.match(app, /initialMode="history"/);
  assert.match(app, /showFutureMode=\{false\}/);
  assert.match(recordsSection, /className="mobile-care-items-return"/);
  assert.match(recordsSection, /返回接下來/);
  assert.doesNotMatch(recordsSection, /mobile-care-items-switch/);

  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(css, /\.mobile-care-items-return\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.mobile-care-items-return\s*\{[\s\S]*display:\s*flex/);
  assert.match(css, /\.mobile-care-items-return button\s*\{[\s\S]*min-height:\s*48px/);
});

test("caregiver medication cards show complete instructions before the taken action", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(medicationView, /className="medicine-caregiver-instructions"/);
  assert.match(medicationView, /className="medicine-instruction-card"/);
  assert.match(medicationView, /<h3>\{med\.name \|\| "藥名待確認"\}<\/h3>/);
  assert.match(medicationView, /<dt>份量<\/dt><dd>\{med\.dosage \|\| "份量待確認"\}<\/dd>/);
  assert.match(medicationView, /med\.schedule\?\.timeLabel \|\| slotLabel/);
  assert.match(medicationView, /med\.schedule\?\.mealTimingLabel \|\| med\.frequency \|\| "飯前或飯後待確認"/);
  assert.doesNotMatch(medicationView, /expandedMedicationId|expandedSlot|medicine-slot-toggle|medicine-chip-button/);
  assert.match(css, /\.medicine-instruction-card\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);

  const instructionIndex = medicationView.indexOf('className="medicine-caregiver-instructions"');
  const takenActionIndex = medicationView.indexOf('className="medicine-slot-actions"');
  assert.ok(instructionIndex >= 0, "應先顯示完整用藥指示");
  assert.ok(takenActionIndex > instructionIndex, "完成記錄必須放在用藥指示之後");
});

test("elder medication page reveals every instruction without disclosure controls", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(medicationView, /readOnly \? \(\s*<div className="elder-medication-list"/);
  assert.match(medicationView, /className="elder-medication-time-group"/);
  assert.match(medicationView, /className="elder-medication-card"/);
  assert.match(medicationView, /med\.name \|\| "藥名待家人確認"/);
  assert.match(medicationView, /med\.dosage \|\| "份量待家人確認"/);
  assert.match(medicationView, /med\.schedule\?\.mealTimingLabel \|\| "飯前或飯後待家人確認"/);
  assert.match(medicationView, /請照藥袋或醫師指示服用/);
  assert.match(css, /\.elder-medication-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width:\s*420px\)[\s\S]*\.elder-medication-time-head\s*\{[\s\S]*align-items:\s*flex-start/);
});

test("medication page keeps only actionable time slots and clear elder actions", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(medicationView, /const visibleMedicationGroups = useMemo\([\s\S]*group\.medications\.length > 0/);
  assert.match(medicationView, /visibleMedicationGroups\.map\(\(group\)/);
  assert.doesNotMatch(medicationView, /"沒有安排"/);
  assert.match(medicationView, /const slotLabel = ELDER_MEDICATION_SLOT_LABELS\[group\.slot\] \|\| group\.label/);
  assert.doesNotMatch(medicationView, /收起藥名|查看藥名/);
  assert.match(medicationView, /aria-label=\{`記錄\$\{slotLabel\}這些藥已服用`\}/);
  assert.match(medicationView, /savingSlot === `\$\{group\.slot\}-taken` \? "記錄中…" : `記錄：\$\{slotLabel\}已服用`/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.medicine-slot-head\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.medicine-slot-actions \.compact-action\s*\{[\s\S]*width:\s*100%/);
});

test("daily medication actions appear before the doctor summary tool", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");
  const medicationGrid = medicationView.slice(
    medicationView.indexOf('<div className="medicine-grid">'),
    medicationView.indexOf("{showMedicationSummary &&"),
  );

  const medicationSlotsIndex = medicationGrid.indexOf("visibleMedicationGroups.map");
  const doctorSummaryIndex = medicationGrid.indexOf('className="medicine-summary-entry"');
  assert.ok(medicationSlotsIndex >= 0, "應呈現有藥時段");
  assert.ok(doctorSummaryIndex > medicationSlotsIndex, "醫師用藥總表應排在每日服藥時段之後");
});

test("caregivers can preview the simplified elder display without exposing edit actions", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const dashboard = app.slice(app.indexOf('<section className="content-area"'), app.indexOf('{activeSection === "overview"'));
  const modeSwitch = app.slice(app.indexOf("function CareDisplayModeSwitch"), app.indexOf("function CareContextHeader"));

  assert.match(app, /preferredDisplayMode/);
  assert.match(app, /function CareDisplayModeSwitch/);
  assert.match(dashboard, /displayMode=\{isElderDisplay \? "elder" : "caregiver"\}/);
  assert.match(dashboard, /canSwitchDisplayMode=\{canManageCare && !readOnly\}/);
  assert.match(dashboard, /onDisplayModeChange=\{setPreferredDisplayMode\}/);
  assert.doesNotMatch(dashboard, /\/>\s*<CareDisplayModeSwitch/);
  assert.match(modeSwitch, /const isElderMode = value === "elder"/);
  assert.match(modeSwitch, /aria-pressed=\{isElderMode\}/);
  assert.match(modeSwitch, /看長輩版/);
  assert.match(modeSwitch, /返回照護者/);
  assert.match(modeSwitch, /aria-label="長輩版，只能查看資料">長輩版/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-display-mode-status\s*\{[\s\S]*font-size:\s*14px/);
  assert.match(app, /const effectiveReadOnly = readOnly \|\| isElderDisplay/);
  assert.match(app, /const effectiveCanManageCare = canManageCare && !isElderDisplay/);
  assert.match(css, /\.care-context-main[\s\S]*\.care-display-mode-switch/);
  assert.doesNotMatch(css, /\.care-display-mode-switch\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
});

test("care management is split into focused sections instead of one long page", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const settingsView = app.slice(app.indexOf("function SettingsView"), app.indexOf("function FamilyNotesEditor"));

  assert.match(settingsView, /settingsSection/);
  assert.match(settingsView, /management-section-tabs/);
  assert.match(settingsView, /照護與家庭/);
  assert.match(settingsView, /提醒紀錄/);
  assert.match(settingsView, /資料說明/);
  assert.match(settingsView, /帳號方案/);
});

test("internal navigation leaves modified and non-primary link clicks to the browser", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const clickHandler = app.slice(app.indexOf("const handleClick = (e) =>"), app.indexOf("document.addEventListener(\"click\", handleClick)"));

  assert.match(clickHandler, /e\.defaultPrevented \|\| e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/);
});

test("care profile, reminder, and group entry fields have programmatic labels", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const groupManager = readProjectFile("care-wedo-app/src/components/GroupManager.jsx");

  for (const [id, label] of [["profile-display-name", "顯示名稱"], ["profile-birth-date", "出生年月日"], ["profile-emergency-phone", "緊急聯絡電話"], ["profile-email", "EMAIL"], ["profile-notes", "重要附註"]]) {
    assert.match(app, new RegExp(`<label htmlFor="${id}">${label}`));
    assert.match(app, new RegExp(`id="${id}"`));
  }

  for (const [id, label] of [["reminder-date", "日期"], ["reminder-time", "時間"], ["reminder-hospital", "醫院 / 地點"], ["reminder-department", "診別 / 科別"], ["reminder-doctor", "醫師"], ["reminder-location", "詳細地點"], ["reminder-fasting-hours", "空腹小時數"], ["reminder-notes", "提醒內容"]]) {
    assert.match(appointmentView, new RegExp(`<label htmlFor="${id}">${label}`));
    assert.match(appointmentView, new RegExp(`id="${id}"`));
  }

  assert.match(groupManager, /<label htmlFor="group-action-value">/);
  assert.match(groupManager, /id="group-action-value"/);
});

test("feedback submission outcomes use an assertive error and polite status live region", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");

  assert.match(app, /role=\{feedbackStatus\.state === "error" \? "alert" : "status"\}/);
});

test("client navigation scroll respects reduced-motion preference", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const clickHandler = app.slice(app.indexOf("const handleClick = (e) =>"), app.indexOf("document.addEventListener(\"click\", handleClick)"));

  assert.match(clickHandler, /window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches \? "auto" : "smooth"/);
  assert.match(clickHandler, /behavior: scrollBehavior/);
});

test("plan details modal explains pricing in accessible elder-friendly sections", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const modal = app.slice(app.indexOf("function PlanDetailsModal"), app.indexOf("function PlanUpgradeModal"));

  assert.match(modal, /pricing = CARE_WEDO_PRICING/);
  assert.match(modal, /normalizeCareWedoPricing\(pricing\)/);
  assert.match(modal, /aria-labelledby="plan-details-title"/);
  assert.match(modal, /aria-describedby="plan-details-description"/);
  assert.match(modal, /id="plan-details-description"/);
  assert.match(modal, />升級規則與費用</);
  assert.match(modal, /先看升級後能使用的功能，再看什麼情況會增加月費/);
  assert.match(modal, /className="plan-details-summary"/);
  assert.match(modal, /目前只照顧 1 位家人，不收月費/);
  assert.match(modal, /只有新增要照顧的家人或一起管理的家人，月費才會增加/);
  assert.match(modal, /className="plan-details-benefit-list"/);
  assert.match(modal, /可照顧 \{normalizedPricing\.includedCareProfilesDuringBeta\} 位家人/);
  assert.match(modal, /每月可整理 \{normalizedPricing\.freeMonthlyOcrLimit\} 筆照護資料/);
  assert.match(modal, /免費使用時只能看未來提醒；要回頭查過去紀錄，需升級照護圈/);
  assert.match(modal, /目前是 \{normalizedPricing\.currency_symbol\}0\/月/);
  assert.match(modal, /每位照護對象每月可整理 \{normalizedPricing\.paidMonthlyOcrLimit\} 筆照護資料/);
  assert.match(modal, /可查看完整歷史紀錄/);
  assert.match(modal, /可邀請家人一起管理；新增協作者時才會增加月費/);
  assert.match(modal, /每增加 1 位一起管理的家人/);
  assert.match(modal, /className="plan-details-role-note">系統稱為「協作者」/);
  assert.match(modal, /className="plan-details-price-name"/);
  assert.match(modal, /className="plan-details-price-amount"/);
  assert.match(modal, /您現在使用的主要帳號不另外收費/);
  assert.match(modal, /\+\{normalizedPricing\.currency_symbol\}\{normalizedPricing\.collaboratorMonthly\}\/月/);
  assert.match(modal, /每增加 1 位要照顧的家人/);
  assert.match(modal, /className="plan-details-role-note">系統稱為「照護對象」/);
  assert.match(modal, /\+\{normalizedPricing\.currency_symbol\}\{normalizedPricing\.recipientMonthly\}\/月/);
  assert.match(modal, /付款前會先顯示新的每月費用/);
  assert.doesNotMatch(modal, /role="table"/);
  assert.doesNotMatch(modal, /Free|Care Circle|Helper|Care Recipient|版本 A/);
});

test("plan details modal stays single-column without horizontal overflow at 320px", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  const planDetailsCss = css.slice(css.indexOf(".plan-details-modal {"), css.indexOf(".quota-upgrade-modal {"));

  assert.match(planDetailsCss, /width:\s*min\(640px, calc\(100vw - 24px\)\)/);
  assert.match(planDetailsCss, /max-height:\s*calc\(100dvh - 24px\)/);
  assert.match(planDetailsCss, /\.plan-details-sections\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(planDetailsCss, /\.plan-details-price-item\s*\{[\s\S]*min-width:\s*0/);
  assert.match(planDetailsCss, /\.plan-details-price-name\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(planDetailsCss, /\.plan-details-role-note\s*\{[\s\S]*display:\s*block[\s\S]*line-height:\s*1\.4/);
  assert.match(planDetailsCss, /\.plan-details-price-list\s*\{[\s\S]*margin:\s*0[\s\S]*padding:\s*0/);
  assert.match(planDetailsCss, /overflow-wrap:\s*anywhere/);
  assert.match(planDetailsCss, /\.plan-details-modal \.btn-close\s*\{[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/);
  assert.match(planDetailsCss, /\.plan-details-summary\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(planDetailsCss, /\.plan-details-modal \.modal-body\s*\{[\s\S]*overflow-x:\s*hidden[\s\S]*overflow-y:\s*auto[\s\S]*min-height:\s*0/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.modal-overlay\.plan-details-overlay\s*\{[\s\S]*padding:\s*12px/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.plan-details-modal\s*\{[\s\S]*overflow-x:\s*hidden[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.plan-details-modal \.modal-header\s*\{[\s\S]*position:\s*sticky[\s\S]*top:\s*0/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.plan-details-modal \.modal-body\s*\{[\s\S]*flex:\s*0 0 auto[\s\S]*overflow-y:\s*visible/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.plan-details-price-item strong\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(planDetailsCss, /aspect-ratio/);
});

test("quota and history prompts explain one elder-friendly upgrade path with SSOT pricing", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const modal = app.slice(app.indexOf("function PlanUpgradeModal"), app.indexOf("async function sendFeedbackEmail"));

  assert.match(modal, /aria-describedby="quota-upgrade-description"/);
  assert.match(modal, /id="quota-upgrade-description"/);
  assert.match(modal, /className="quota-upgrade-benefit-list"/);
  assert.match(modal, /每位照護對象每月最多 \{normalizedPricing\.paidMonthlyOcrLimit\} 次 AI 整理/);
  assert.match(modal, /className="quota-upgrade-fee-list"/);
  assert.match(modal, /第一位照護對象/);
  assert.match(modal, /\{normalizedPricing\.currency_symbol\}0\/月/);
  assert.match(modal, /增加協作者（例如子女或其他家人）/);
  assert.match(modal, /\+\{normalizedPricing\.currency_symbol\}\{normalizedPricing\.collaboratorMonthly\}\/人\/月/);
  assert.match(modal, /增加照護對象（例如爸爸、媽媽或自己）/);
  assert.match(modal, /\+\{normalizedPricing\.currency_symbol\}\{normalizedPricing\.recipientMonthly\}\/人\/月/);
  assert.match(modal, /主要帳號不另收費/);
  assert.match(modal, /每次付款前都會先顯示新的每月費用/);
  assert.match(modal, /查看費用與升級方式/);
  assert.doesNotMatch(modal, /quota-upgrade-options|藍新/);
});

test("quota upgrade prompt uses a single-column 320px-safe decision layout", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  const quotaStart = css.indexOf(".quota-upgrade-modal {");
  const quotaCss = css.slice(quotaStart, css.indexOf(".plan-feature-comparison {", quotaStart));

  assert.match(quotaCss, /width:\s*min\(640px, calc\(100vw - 24px\)\)/);
  assert.match(quotaCss, /max-height:\s*calc\(100dvh - 24px\)/);
  assert.match(quotaCss, /\.quota-upgrade-flow\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(quotaCss, /\.quota-upgrade-fee-item\s*\{[\s\S]*min-width:\s*0/);
  assert.match(quotaCss, /overflow-wrap:\s*anywhere/);
  assert.match(quotaCss, /\.quota-upgrade-modal \.btn-close\s*\{[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/);
  assert.doesNotMatch(quotaCss, /grid-template-columns:\s*repeat\(3/);
});

test("pricing page stays focused instead of repeating the full product story", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const landing = app.slice(app.indexOf("function LandingPage"), app.indexOf("function LoginPage"));

  assert.match(landing, /const showProductStory = !isPricingPage/);
  assert.match(landing, /const visibleFaqs = isPricingPage \? PRICING_FAQS : LANDING_FAQS/);
  assert.match(landing, /isPricingPage \? null : <ProductPreviewPanel \/>/);
  assert.match(landing, /\{showProductStory && \([\s\S]*landing-entry-section[\s\S]*feedback-section[\s\S]*\)\}/);
  assert.match(landing, /\{isPricingPage \? "方案常見問題" : "常見問題"\}/);

  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(css, /\.landing-shell-pricing \.landing-hero\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("plan comparison uses an expandable single-column mobile layout", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const comparison = app.slice(app.indexOf("function PlanFeatureComparison"), app.indexOf("function PlanDetailsModal"));
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(comparison, /<details className="plan-feature-comparison"/);
  assert.match(comparison, /<summary>查看完整功能比較<\/summary>/);
  assert.match(comparison, /目前免費/);
  assert.match(comparison, /照護圈升級/);
  assert.doesNotMatch(comparison, /role="table"/);
  assert.match(css, /\.plan-feature-item\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 761px\)[\s\S]*\.plan-feature-item\s*\{[\s\S]*grid-template-columns:\s*minmax\(160px, 1\.2fr\) repeat\(2, minmax\(0, 1fr\)\)/);
});

test("mobile care schedule prioritizes upcoming items and tucks editing into a secondary disclosure", () => {
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const calendarView = appointmentView.slice(appointmentView.indexOf("export function CalendarView"));
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(calendarView, /className="event-card-primary-actions"/);
  assert.match(calendarView, /<details className="event-card-management">/);
  assert.match(calendarView, /<summary>管理這筆提醒<\/summary>/);
  assert.match(calendarView, />\s*編輯提醒\s*<\/button>/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.event-list\s*\{[\s\S]*order:\s*-1/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.event-card-primary-actions,[\s\S]*\.event-card-management\s*\{[\s\S]*position:\s*static/);
  assert.doesNotMatch(css, /@media \(max-width: 900px\)[\s\S]*\.event-row\s*\{\s*padding:\s*88px 16px 88px/);
});

test("elder calendar dates are readable text while caregiver dates remain interactive", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const calendarView = appointmentView.slice(appointmentView.indexOf("export function CalendarView"));
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /<CalendarView[\s\S]*readOnly=\{effectiveReadOnly\}/);
  assert.match(calendarView, /export function CalendarView\(\{[^}]*readOnly = false/);
  assert.match(calendarView, /const dateLabel = `\$\{year\} 年 \$\{month \+ 1\} 月 \$\{day\} 日\$\{hasEvent \? "，有照護事項" : "，沒有照護事項"\}`/);
  assert.match(calendarView, /readOnly \? \(\s*<time[\s\S]*dateTime=\{dateStr\}[\s\S]*aria-label=\{dateLabel\}[\s\S]*aria-current=\{isToday \? "date" : undefined\}/);
  assert.match(calendarView, /\) : \(\s*<button[\s\S]*onClick=\{\(\) => scrollToDate\(day\)\}[\s\S]*aria-current=\{isToday \? "date" : undefined\}/);
  assert.match(css, /\.calendar-day\s*\{[\s\S]*display:\s*flex[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/);
  assert.match(css, /button\.calendar-day\s*\{[\s\S]*cursor:\s*pointer/);
  assert.match(css, /button\.calendar-day:hover:not\(\.empty\)/);
});

test("narrow caregiver calendars keep every date target at least 44px without page overflow", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  const narrowStart = css.lastIndexOf("@media (max-width: 420px)");
  const narrowCss = css.slice(narrowStart, css.indexOf("@media print", narrowStart));

  assert.match(narrowCss, /\.care-shell\s*\{[\s\S]*width:\s*calc\(100% - 8px\)/);
  assert.match(narrowCss, /\.dashboard-grid\s*\{[\s\S]*width:\s*100%[\s\S]*max-width:\s*none/);
  assert.match(narrowCss, /\.content-area\s*\{[\s\S]*width:\s*100%[\s\S]*max-width:\s*none/);
  assert.match(narrowCss, /\.calendar-board\s*\{[\s\S]*width:\s*calc\(100vw - 8px\)[\s\S]*margin-left:\s*calc\(\(100% - \(100vw - 8px\)\) \/ 2\)[\s\S]*padding-inline:\s*0/);
  assert.match(narrowCss, /\.calendar-head\s*\{[\s\S]*padding-inline:\s*12px/);
  assert.match(narrowCss, /\.calendar-weekdays,[\s\S]*\.calendar-days\s*\{[\s\S]*column-gap:\s*0/);
  assert.match(narrowCss, /\.calendar-day\s*\{[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/);
  assert.doesNotMatch(narrowCss, /@media \(max-width: 360px\)/);
  assert.doesNotMatch(narrowCss, /justify-self:\s*center/);
});

test("care schedule shows the nearest three items before offering an explicit expansion", () => {
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const calendarView = appointmentView.slice(appointmentView.indexOf("export function CalendarView"));
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(appointmentView, /const INITIAL_VISIBLE_APPOINTMENTS = 3/);
  assert.match(calendarView, /sortUpcomingAppointments\(appointments\)/);
  assert.match(calendarView, /futureAppointments\.slice\(0, INITIAL_VISIBLE_APPOINTMENTS\)/);
  assert.match(calendarView, /aria-expanded=\{showAllAppointments\}/);
  assert.match(calendarView, /查看其餘 \$\{hiddenAppointmentCount\} 筆/);
  assert.match(calendarView, /只看最近 \$\{INITIAL_VISIBLE_APPOINTMENTS\} 筆/);
  assert.match(css, /\.event-list-more\s*\{[\s\S]*min-height:\s*48px/);
});

test("calendar offers photo and manual reminder entry before search without duplicating manual entry in settings", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const dashboard = app.slice(app.indexOf('<section className="content-area"'), app.indexOf('{activeSection === "meds"'));
  const settingsView = app.slice(app.indexOf("function SettingsView"), app.indexOf("function FamilyNotesEditor"));
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const calendarView = appointmentView.slice(appointmentView.indexOf("export function CalendarView"));
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(dashboard, /activeSection === "calendar" && effectiveCanManageCare[\s\S]*calendar-entry-actions[\s\S]*content-search-panel/);
  assert.match(dashboard, /aria-label="拍照新增照護資料"/);
  assert.match(dashboard, /className="calendar-upload-label-desktop">拍照新增照護資料/);
  assert.match(dashboard, /className="calendar-upload-label-mobile"[^>]*>拍照新增/);
  assert.match(dashboard, /className="secondary-action calendar-manual-reminder"[\s\S]*setShowManualReminder\(true\)[\s\S]*aria-label="手動新增提醒"[\s\S]*手動新增提醒/);
  assert.doesNotMatch(settingsView, /onAddReminder|手動新增提醒/);
  assert.doesNotMatch(calendarView, /event-list-actions/);
  assert.match(css, /\.calendar-primary-upload\s*\{[\s\S]*min-height:\s*56px/);
  assert.match(css, /\.calendar-entry-actions\s*\{[\s\S]*display:\s*flex[\s\S]*min-width:\s*0/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.care-items-toolbar\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.calendar-entry-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.calendar-entry-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.calendar-upload-label-desktop,[\s\S]*\.calendar-manual-label-desktop\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.calendar-upload-label-mobile,[\s\S]*\.calendar-manual-label-mobile\s*\{[\s\S]*display:\s*inline/);
});

test("free accounts see an explicit history lock instead of silently falling back to future records", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const recordsView = app.slice(app.indexOf("function RecordsView"), app.indexOf("function DocumentLibraryView"));

  assert.match(recordsView, /const activeMode = mode/);
  assert.match(recordsView, /const isHistoryLocked = activeMode === "history" && !canViewHistory/);
  assert.doesNotMatch(recordsView, /const activeMode = canViewHistory \? mode : "future"/);
  assert.match(recordsView, /setMode\(nextMode\)[\s\S]*onUpgradeRequired\?\.\("history"\)/);
  assert.match(recordsView, /className="history-locked-card"/);
  assert.match(recordsView, /完整歷史紀錄尚未開放/);
  assert.match(recordsView, /免費版仍可查看未來安排，也可以開啟已上傳的醫療文件/);
  assert.match(recordsView, /查看費用與升級方式/);
  assert.match(recordsView, /查看醫療文件/);
});

test("records search appears only after selecting a searchable mode", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const dashboardSearch = app.slice(
    app.indexOf('{["calendar", "records"].includes(activeSection)'),
    app.indexOf('{activeSection === "settings"'),
  );
  const recordsSection = app.slice(
    app.indexOf('{activeSection === "records"'),
    app.indexOf('{activeSection === "settings" && effectiveCanManageCare'),
  );
  const recordsView = app.slice(app.indexOf("function RecordsView"), app.indexOf("function DocumentLibraryView"));

  assert.match(
    dashboardSearch,
    /\["calendar", "records"\]\.includes\(activeSection\)[\s\S]*<\/div>\s*\)\}\s*\{activeSection === "calendar" && !isElderDisplay && \(\s*<section className="today-search-panel content-search-panel"/,
  );
  assert.match(recordsSection, /onSearchChange=\{setSearchQuery\}/);
  assert.match(recordsSection, /appointmentSearchSuggestions=\{appointmentSearchSuggestions\}/);
  assert.match(recordsSection, /documentSearchSuggestions=\{documentSearchSuggestions\}/);
  assert.match(recordsView, /!isHistoryLocked[\s\S]*content-search-panel[\s\S]*<SearchField/);
  assert.match(recordsView, /isDocumentMode \? "搜尋已上傳的醫療文件" : "搜尋歷史照護紀錄"/);
});

test("care item and medical document search keep suggestions in the selected context", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const dashboard = app.slice(app.indexOf("function Dashboard"), app.indexOf("function SectionHeading"));
  const recordsView = app.slice(app.indexOf("function RecordsView"), app.indexOf("function DocumentLibraryView"));

  assert.match(dashboard, /const appointmentSearchSuggestions = useMemo\([\s\S]*buildSearchSuggestions\(allAppointments\)/);
  assert.match(dashboard, /const documentSearchSuggestions = useMemo\([\s\S]*allDocuments\.map/);
  assert.match(dashboard, /suggestions=\{appointmentSearchSuggestions\}[\s\S]*placeholder="依醫院、診別或醫師篩選"/);
  assert.match(dashboard, /appointmentSearchSuggestions=\{appointmentSearchSuggestions\}/);
  assert.match(dashboard, /documentSearchSuggestions=\{documentSearchSuggestions\}/);
  assert.match(recordsView, /suggestions=\{isDocumentMode \? documentSearchSuggestions : appointmentSearchSuggestions\}/);
  assert.doesNotMatch(dashboard, /searchSuggestions=\{searchSuggestions\}/);
});

test("search suggestions stay collapsed until the user enters the search field", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const searchField = app.slice(app.indexOf("function SearchField"), app.indexOf("function OverviewView"));

  assert.match(searchField, /const \[showSuggestions, setShowSuggestions\] = useState\(false\)/);
  assert.match(searchField, /onFocusCapture=\{\(\) => setShowSuggestions\(true\)\}/);
  assert.match(searchField, /onBlurCapture=\{\(event\) => \{[\s\S]*event\.currentTarget\.contains\(event\.relatedTarget\)[\s\S]*setShowSuggestions\(false\)/);
  assert.match(searchField, /aria-label=\{placeholder\}/);
  assert.match(searchField, /aria-expanded=\{showSuggestions && suggestions\.length > 0\}/);
  assert.match(searchField, /\{showSuggestions && suggestions\.length > 0 && \(/);
  assert.match(searchField, /onChange\(label\);[\s\S]*setShowSuggestions\(false\)/);
});

test("mobile search removes its repeated visual label so care items appear sooner", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.search-box > span\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.content-search-panel\s*\{[\s\S]*margin-bottom:\s*14px/);
});

test("history lock card keeps two clear actions stacked at 320px", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /\.history-locked-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.history-locked-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.history-locked-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.history-locked-actions \.primary-action,[\s\S]*\.history-locked-actions \.secondary-action\s*\{[\s\S]*min-height:\s*52px[\s\S]*width:\s*100%/);
  assert.match(css, /\.records-timeline-view\s*\{[\s\S]*gap:\s*24px/);
  assert.match(css, /\.record-mode-switch\s*\{[\s\S]*margin-bottom:\s*0/);
});

test("every new-care dialog names the active care recipient before submission", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const ocrWorkflow = readProjectFile("care-wedo-app/src/features/ocr/OcrWorkflow.jsx");
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /const activeCareRecipientName = selectedProfile\?\.display_name \|\| "目前照護對象"/);
  assert.match(app, /<UploadGuide[\s\S]*careRecipientName=\{activeCareRecipientName\}/);
  assert.match(app, /<CareDocumentUploadModal[\s\S]*careRecipientName=\{activeCareRecipientName\}/);
  assert.match(app, /<ManualReminderModal[\s\S]*careRecipientName=\{activeCareRecipientName\}/);
  assert.match(ocrWorkflow, /export function UploadGuide\(\{[^}]*careRecipientName = "目前照護對象"/);
  assert.match(ocrWorkflow, /export function CareDocumentUploadModal\(\{[^}]*careRecipientName = "目前照護對象"/);
  assert.strictEqual((ocrWorkflow.match(/className="care-recipient-notice"/g) || []).length, 2);
  assert.match(appointmentView, /export function ManualReminderModal\(\{[^}]*careRecipientName = "目前照護對象"/);
  assert.match(appointmentView, /className="care-recipient-notice"/);
  assert.match(ocrWorkflow, /將新增至：/);
  assert.match(appointmentView, /將新增至：/);
  assert.match(css, /\.care-recipient-notice\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.care-recipient-notice strong\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
});

test("switching care context clears the previous recipient search before loading new data", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const profileHandler = app.slice(app.indexOf("function handleProfileChange"), app.indexOf("function handleGroupChange"));
  const groupHandler = app.slice(app.indexOf("function handleGroupChange"), app.indexOf("function handleSetupComplete"));

  assert.match(profileHandler, /setSearchQuery\(""\)/);
  assert.match(groupHandler, /setSearchQuery\(""\)/);
  assert.ok(profileHandler.indexOf('setSearchQuery("")') < profileHandler.indexOf("loadDashboard("));
  assert.ok(groupHandler.indexOf('setSearchQuery("")') < groupHandler.indexOf("loadDashboard("));
});

test("medical document deletion uses a title-aware in-app confirmation before the destructive action", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const deleteHandler = app.slice(app.indexOf("async function handleDocumentDelete"), app.indexOf("async function handleOcrCorrectionsSave"));
  const detailModal = app.slice(app.indexOf("function CareDocumentDetailModal"), app.indexOf("function EmptyGuide"));

  assert.doesNotMatch(deleteHandler, /window\.confirm/);
  assert.match(detailModal, /const \[confirmingDelete, setConfirmingDelete\] = useState\(false\)/);
  assert.match(detailModal, /setConfirmingDelete\(true\)/);
  assert.match(detailModal, /要刪除「\{documentTitle\}」嗎？/);
  assert.match(detailModal, /刪除後，這份文件與整理內容會從 Care WEDO 移除，無法復原/);
  assert.match(detailModal, /取消，保留文件/);
  assert.match(detailModal, /確認永久刪除/);
  assert.match(detailModal, /await onDelete\(\)/);
  assert.match(detailModal, /if \(!deleting\) onClose\(\)/);
  assert.match(detailModal, /className="calendar-action-notice" role="alert">\{notice\}/);
  assert.match(detailModal, /aria-label="關閉" disabled=\{deleting\}/);
  assert.match(css, /\.document-delete-confirmation\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.document-delete-confirmation-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("caregivers can safely correct a mistaken taken record without exposing the action to elder mode", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const caregiverArea = medicationView.slice(medicationView.indexOf('className="medicine-caregiver-list"'));

  assert.match(medicationView, /const \[confirmCorrectionSlot, setConfirmCorrectionSlot\] = useState\(null\)/);
  assert.match(medicationView, /const \[locallyCorrectedSlots, setLocallyCorrectedSlots\] = useState/);
  assert.match(medicationView, /handleSlotStatus\(group, "forgotten"\)/);
  assert.match(caregiverArea, /更正紀錄/);
  assert.match(caregiverArea, /要把「\{slotLabel\}」改成尚未服用嗎？/);
  assert.match(caregiverArea, /取消更正/);
  assert.match(caregiverArea, /確認更正/);
  assert.match(caregiverArea, /canCompleteMedication && !readOnly && \([\s\S]*更正紀錄/);
  assert.doesNotMatch(medicationView.slice(0, medicationView.indexOf('className="medicine-caregiver-list"')), /更正紀錄/);
  assert.doesNotMatch(medicationView, /window\.confirm/);
  assert.match(css, /\.medicine-correction-confirmation\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.medicine-correction-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("group administrators get a named in-app confirmation before removing members or replacing invite codes", () => {
  const settings = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const removeRequest = settings.slice(settings.indexOf("function requestMemberRemoval"), settings.indexOf("function requestInviteRegeneration"));
  const inviteRequest = settings.slice(settings.indexOf("function requestInviteRegeneration"), settings.indexOf("async function runConfirmedGroupAction"));
  const confirmedAction = settings.slice(settings.indexOf("async function runConfirmedGroupAction"), settings.indexOf('if (identity.status === "demo")'));

  assert.match(settings, /function GroupSafetyConfirmationModal/);
  assert.match(settings, /const \[pendingGroupAction, setPendingGroupAction\] = useState\(null\)/);
  assert.match(settings, /const \[groupActionSubmitting, setGroupActionSubmitting\] = useState\(false\)/);
  assert.doesNotMatch(removeRequest, /removeMember|window\.confirm/);
  assert.doesNotMatch(inviteRequest, /regenerateInvite|window\.confirm/);
  assert.match(confirmedAction, /await removeMember/);
  assert.match(confirmedAction, /await regenerateInvite/);
  assert.match(settings, /要移除「\{action\.memberName\}」嗎？/);
  assert.match(settings, /移除後，這位協作者將無法再查看「\{action\.groupName\}」的照護資料/);
  assert.match(settings, /要換掉「\{action\.groupName\}」的邀請碼嗎？/);
  assert.match(settings, /舊邀請碼會立即失效/);
  assert.match(settings, /取消，保留成員/);
  assert.match(settings, /確認移除/);
  assert.match(settings, /取消，保留原邀請碼/);
  assert.match(settings, /確認換新邀請碼/);
  assert.match(settings, /requestMemberRemoval\(group, m, displayName\)/);
  assert.match(settings, /requestInviteRegeneration\(group\)/);
  assert.match(css, /\.group-safety-confirmation\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.group-safety-confirmation-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("today care keeps ongoing family notes visible and records other tasks only after confirmation succeeds", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const parentCompletion = app.slice(app.indexOf("async function handleComplete"), app.indexOf("function showPlanUpgradePrompt"));
  const overview = app.slice(app.indexOf("function OverviewView"), app.indexOf("function appointmentTimeValue"));
  const primaryAction = overview.slice(overview.indexOf("function handlePrimaryAction"), overview.indexOf("async function handleConfirmedTask"));
  const confirmedAction = overview.slice(overview.indexOf("async function handleConfirmedTask"), overview.indexOf("const todayStatusCopy"));

  assert.match(overview, /const \[pendingTaskId, setPendingTaskId\] = useState\(null\)/);
  assert.match(overview, /const \[submittingTaskId, setSubmittingTaskId\] = useState\(null\)/);
  assert.match(overview, /const \[taskActionError, setTaskActionError\] = useState\(null\)/);
  assert.doesNotMatch(primaryAction, /onComplete\(/);
  assert.match(primaryAction, /setPendingTaskId\(task\.id\)/);
  assert.ok(confirmedAction.indexOf("await onComplete(task.sourceId)") < confirmedAction.indexOf("setLocallyDoneTaskIds"));
  const patchIndex = parentCompletion.indexOf("await patchAppointment");
  assert.ok(patchIndex >= 0);
  assert.ok(parentCompletion.indexOf("markCompleted();", patchIndex) > patchIndex);
  assert.match(overview, /task\.canComplete !== false/);
  assert.match(overview, /需要回報的事項再記錄完成/);
  assert.match(overview, /這是每天都要留意的提醒，不用按完成/);
  assert.doesNotMatch(overview, /照順序\$\{readOnly \? "查看" : "完成"\}/);
  assert.match(overview, /要記錄「\{task\.title\}」已完成嗎？/);
  assert.match(overview, /取消，還沒完成/);
  assert.match(overview, /確認已完成/);
  assert.match(overview, /className="today-task-action-error" role="alert"/);
  assert.match(css, /\.today-task-confirmation\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.today-task-confirmation-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("family reminder drafts stay recoverable until save and remain readable on narrow screens", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const editor = app.slice(app.indexOf("function FamilyNotesEditor"), app.indexOf("function FamilyNotesModal"));

  assert.match(editor, /const \[removedDraftIndexes, setRemovedDraftIndexes\] = useState\(\[\]\)/);
  assert.doesNotMatch(editor, /current\.filter\(\(_,[\s\S]*itemIndex !== index/);
  assert.match(editor, /function restoreDraft\(index\)/);
  assert.match(editor, /removedDraftIndexes\.includes\(index\)/);
  assert.match(editor, /已移除「\{draft \|\| `提醒 \$\{index \+ 1\}`\}」/);
  assert.match(editor, />\s*復原\s*</);
  assert.match(editor, /待移除的提醒會在按下「儲存變更」後才刪除/);
  assert.match(editor, /className="error-msg" role="alert"/);
  assert.match(editor, /drafts\.filter\(\(_draft, index\) => !removedDraftIndexes\.includes\(index\)\)/);
  assert.match(editor, /saving \? "儲存中\.\.\." : error \? "重試儲存" : saved \? "已儲存" : "儲存變更"/);
  assert.match(css, /\.family-note-removed\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*\.family-note-removed-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("family reminder drafts stay scoped to their care group across refreshes and switches", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const editor = app.slice(app.indexOf("function FamilyNotesEditor"), app.indexOf("function FamilyNotesModal"));
  const settings = app.slice(app.indexOf("function SettingsView"), app.indexOf("function FamilyNotesEditor"));
  const saveHandler = app.slice(app.indexOf("async function handleFamilyNotesChange"), app.indexOf("function handleMobileNavChange"));

  assert.match(app, /const activeGroupIdRef = useRef\(null\)/);
  assert.match(app, /activeGroupIdRef\.current = activeGroupId/);
  assert.match(app, /const \[familyNotesByGroup, setFamilyNotesByGroup\] = useState\(\{\}\)/);
  assert.match(app, /const familyNotesScopeId = String\(activeGroupId \|\| dashboard\?\.active_group_id \|\| "personal"\)/);
  assert.match(app, /Object\.prototype\.hasOwnProperty\.call\(familyNotesByGroup, familyNotesScopeId\)/);
  assert.match(app, /const familyNotes = familyNotesReady \? familyNotesByGroup\[familyNotesScopeId\] : \[\]/);
  assert.match(app, /setFamilyNotesByGroup\(\(current\) => \(\{[\s\S]*\[dashboardGroupId\]: dashboard\?\.family_notes \|\| \[\]/);
  assert.match(app, /familyNotesScopeId=\{familyNotesScopeId\}/);
  assert.match(app, /familyNotesLoading=\{!familyNotesReady\}/);
  assert.match(settings, /familyNotesScopeId/);
  assert.match(settings, /familyNotesLoading/);
  assert.match(settings, /<FamilyNotesEditor[\s\S]*scopeId=\{familyNotesScopeId\}[\s\S]*loading=\{familyNotesLoading\}/);
  assert.match(editor, /function FamilyNotesEditor\(\{ notes = \[\], scopeId, loading = false, onChange \}\)/);
  assert.match(editor, /const scopeDraftsRef = useRef\(new Map\(\)\)/);
  assert.match(editor, /const activeScopeRef = useRef\(String\(scopeId \?\? "personal"\)\)/);
  assert.match(editor, /const savingRef = useRef\(false\)/);
  assert.match(editor, /const savedTimerRef = useRef\(null\)/);
  assert.match(editor, /const \[dirty, setDirty\] = useState\(false\)/);
  assert.match(editor, /const scopeReady = activeScopeRef\.current === scopeKey && !loading/);
  assert.match(editor, /\{scopeReady && \(\s*<>\s*<div className="family-note-draft-list">/);
  assert.match(editor, /\{!scopeReady && <p className="helper-copy" role="status">正在切換照護圈提醒…<\/p>\}/);
  assert.match(editor, /if \(activeScopeRef\.current !== scopeKey\)[\s\S]*scopeDraftsRef\.current\.get\(scopeKey\)[\s\S]*setDrafts\(cached\?\.drafts \|\| initialDrafts\)/);
  assert.match(editor, /if \(!dirty\)[\s\S]*setDrafts\(initialDrafts\)/);
  assert.match(editor, /if \(!scopeReady \|\| savingRef\.current\) return[\s\S]*savingRef\.current = true/);
  assert.match(editor, /scopeDraftsRef\.current\.delete\(scopeKey\);[\s\S]*if \(activeScopeRef\.current !== scopeKey\) return/);
  assert.match(editor, /catch \(err\) \{[\s\S]*if \(activeScopeRef\.current === scopeKey\)/);
  assert.match(editor, /savedTimerRef\.current = setTimeout\(\(\) => \{[\s\S]*activeScopeRef\.current === scopeKey[\s\S]*setSaved\(false\)/);
  assert.match(editor, /finally \{[\s\S]*savingRef\.current = false[\s\S]*setSaving\(false\)/);
  assert.match(editor, /await onChange\(nextDrafts, scopeId\)/);
  assert.match(editor, /disabled=\{saving \|\| !scopeReady\}/);
  assert.match(saveHandler, /sourceGroupId = activeGroupId/);
  assert.match(saveHandler, /groupId: targetGroupId/);
  assert.match(saveHandler, /if \(String\(activeGroupIdRef\.current\) !== String\(targetGroupId\)\) return result/);
});
