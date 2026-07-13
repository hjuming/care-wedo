import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("API middleware rejects protected requests without a bearer token", () => {
  const source = readProjectFile("functions/api/_middleware.ts");
  assert.match(source, /if \(!token\) \{/);
  assert.match(source, /status:\s*401/);
});

test("API middleware rejects invalid bearer tokens before reaching handlers", () => {
  const source = readProjectFile("functions/api/_middleware.ts");
  assert.match(source, /catch\s*\([^)]*\)\s*\{/);
  assert.match(source, /登入已失效|Invalid token|Unauthorized/);
});

test("Feedback API is public for landing page visitors", () => {
  const source = readProjectFile("functions/api/_middleware.ts");
  assert.match(source, /pathname === "\/api\/feedback" && method === "POST"/);
});

test("OCR API requires a valid authenticated LINE identity", () => {
  const source = readProjectFile("functions/api/ocr/[[path]].ts");
  assert.match(source, /if \(!token\) \{/);
  assert.doesNotMatch(source, /getOrCreateDefaultUser\(env,\s*identity\?\.lineUserId\)/);
});

test("Groups API requires a bearer token before resolving a user", () => {
  const source = readProjectFile("functions/api/groups.ts");
  const authContext = readProjectFile("functions/_shared/auth_context.ts");
  assert.match(source, /getRequestUser\(context\)/);
  assert.match(authContext, /const token = getBearerToken\(context\.request\)/);
  assert.match(authContext, /if \(!token\) throw new Error\("請先登入"\)/);
});

test("Groups API keeps invite join idempotent for existing members before plan limits", () => {
  const source = readProjectFile("functions/api/groups.ts");
  const joinAction = source.slice(source.indexOf('if (body.action === "join")'));
  const existingMembershipIndex = joinAction.indexOf("const existingMembership");
  const limitCheckIndex = joinAction.indexOf("checkGroupMemberLimit");
  assert.notEqual(existingMembershipIndex, -1);
  assert.notEqual(limitCheckIndex, -1);
  assert.ok(existingMembershipIndex < limitCheckIndex);
  assert.match(source, /if \(existingMembership\.length === 0\) \{/);
});

test("Dashboard API returns family members for the global care contact dock", () => {
  const source = readProjectFile("functions/api/dashboard.ts");
  assert.match(source, /getDashboardMembers|fetchDashboardMembers/);
  assert.match(source, /users\(name,line_user_id,picture_url\)/);
  assert.match(source, /members:/);
  assert.match(source, /collaborators:/);
});

test("Family notes are stored as group-scoped reminders", () => {
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(groupsApi, /update_family_notes/);
  assert.match(groupsApi, /group_id:\s*body\.group_id/);
  assert.match(groupsApi, /type:\s*"family_note"/);
  assert.match(groupsApi, /profile_id:\s*null/);
  assert.match(dashboard, /parseGroupId/);
  assert.match(dashboard, /active_group_id/);
  assert.match(dashboard, /family_notes/);
  assert.match(app, /GroupBadge/);
  assert.match(app, /FamilyNotesEditor notes=\{familyNotes\} onChange=\{onFamilyNotesChange\}/);
  assert.match(app, /family-note-draft-card/);
  assert.match(app, /removeDraft/);
  assert.match(app, />\s*新增\s*</);
  assert.match(app, />\s*刪除\s*</);
  assert.match(app, /:\s*"儲存"/);
  assert.match(css, /\.family-note-draft-card/);
  assert.match(css, /\.family-notes-actions \.inline-action/);
  assert.match(css, /height:\s*56px/);
  assert.match(css, /margin-top:\s*0/);
  assert.match(css, /\.nav-login-link/);
  assert.match(css, /text-decoration:\s*none/);
});

test("Dashboard fetches group-level reminders with the active profile", () => {
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  assert.match(dashboard, /profile_id=is\.null/);
  assert.match(dashboard, /type=eq\.family_note/);
  assert.match(dashboard, /group_id=eq\.\$\{groupId\}/);
});

test("Dashboard honors an explicitly selected profile over stale group state", () => {
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  const chooseProfile = dashboard.slice(dashboard.indexOf("function chooseProfile"), dashboard.indexOf("type DashboardMemberRow"));
  assert.match(chooseProfile, /if \(requestedProfileId\)/);
  assert.match(chooseProfile, /if \(found\) return found/);
  assert.match(chooseProfile, /if \(preferredProfileId\)/);
  assert.doesNotMatch(chooseProfile, /found && \(!requestedGroupId \|\| found\.group_id === requestedGroupId\)/);
});

test("Floating contact dock is removed from elder-facing pages", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  assert.doesNotMatch(source, /function GlobalCareContactDock/);
  assert.doesNotMatch(source, /global-care-contact-dock/);
  assert.match(source, /協作者管理中心/);
});

test("Mobile LINE login uses a real LIFF link instead of a script-only redirect", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const loginAction = source.slice(source.indexOf("function LineLoginAction"), source.indexOf("function LandingPage"));

  assert.match(source, /buildLiffEntryUrl/);
  assert.match(source, /buildLineAppLiffFallbackUrl/);
  assert.match(source, /shouldOpenLiffEntryUrl/);
  assert.match(loginAction, /const isMobile = shouldOpenLiffEntryUrl\(\)/);
  assert.match(loginAction, /const loginHref = isMobile \? buildLineAppLiffFallbackUrl\(\) : buildLiffEntryUrl\(\)/);
  assert.match(loginAction, /href=\{loginHref\}/);
  assert.match(loginAction, /if \(!isMobile\)/);
  assert.doesNotMatch(source, /nav-login-button/);
  assert.match(css, /\.line-login-btn\[aria-disabled="true"\]/);
  assert.match(css, /\.nav-login-line-login/);
});

test("Care WEDO session cookie keeps returning users signed in", () => {
  const shared = readProjectFile("functions/_shared/supabase.ts");
  const authIdentity = readProjectFile("functions/_shared/auth_identity.ts");
  const sessionApi = readProjectFile("functions/api/session.ts");
  const middleware = readProjectFile("functions/api/_middleware.ts");
  const liff = readProjectFile("care-wedo-app/src/services/liff.js");
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const loginSetup = readProjectFile("care-wedo-app/src/components/LoginSetup.jsx");

  assert.match(authIdentity, /CARE_WEDO_SESSION_COOKIE = "care_wedo_session"/);
  assert.match(authIdentity, /HttpOnly/);
  assert.match(authIdentity, /Secure/);
  assert.match(authIdentity, /SameSite=Lax/);
  assert.match(authIdentity, /crypto\.subtle\.sign\("HMAC"/);
  assert.match(authIdentity, /verifyCareWedoSessionToken/);
  assert.match(authIdentity, /getCookieValue\(request, CARE_WEDO_SESSION_COOKIE\)/);
  assert.match(shared, /verifyCareWedoSessionToken/);
  assert.match(sessionApi, /onRequestPost/);
  assert.match(sessionApi, /Set-Cookie/);
  assert.match(sessionApi, /onRequestDelete/);
  assert.match(middleware, /pathname === "\/api\/session"/);
  assert.match(liff, /fetchSessionIdentity/);
  assert.match(liff, /createServerSession\(idToken\)/);
  assert.match(liff, /clearServerSession/);
  assert.match(app, /window\.history\.replaceState\(null, "", "\/app"\)/);
  assert.match(loginSetup, /credentials:\s*"same-origin"/);
  assert.match(loginSetup, /headers:\s*identity\.idToken\s*\?\s*\{\s*Authorization:\s*`Bearer \$\{identity\.idToken\}`\s*\}\s*:\s*undefined/);
  assert.match(loginSetup, /\.\.\.\(identity\.idToken\s*\?\s*\{\s*Authorization:\s*`Bearer \$\{identity\.idToken\}`\s*\}\s*:\s*\{\}\)/);
});

test("Returning cookie sessions run the setup check without a readable idToken", () => {
  const loginSetup = readProjectFile("care-wedo-app/src/components/LoginSetup.jsx");

  assert.match(loginSetup, /identity\?\.status === "authenticated" && step === "check"/);
  assert.doesNotMatch(loginSetup, /if \(identity\?\.idToken && step === "check"\)/);
});

test("LINE links use an external browser handoff page", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const routing = readProjectFile("care-wedo-app/src/routing.js");
  const liff = readProjectFile("care-wedo-app/src/services/liff.js");
  const api = readProjectFile("care-wedo-app/src/services/api.js");
  const callback = readProjectFile("functions/callback.ts");
  const handoffApi = readProjectFile("functions/api/session/handoff.ts");
  const middleware = readProjectFile("functions/api/_middleware.ts");
  const reminders = readProjectFile("functions/api/cron/reminders.ts");

  assert.match(routing, /external-open/);
  assert.match(app, /function ExternalOpenPage/);
  assert.match(app, /用瀏覽器開啟/);
  assert.match(app, /openDashboardInExternalBrowserAfterLineCallback/);
  assert.match(liff, /issueBrowserHandoffToken/);
  assert.match(liff, /exchangeBrowserHandoffToken/);
  assert.match(liff, /\/app\/open\?handoff=/);
  assert.match(api, /buildSessionHandoffRequest/);
  assert.match(handoffApi, /createCareWedoHandoffToken/);
  assert.match(handoffApi, /verifyCareWedoHandoffToken/);
  assert.match(middleware, /pathname === "\/api\/session\/handoff"/);
  assert.match(liff, /liff\.openWindow\(\{ url, external: true \}\)/);
  assert.match(callback, /CARE_WEDO_OPEN_URL = "https:\/\/care\.wedopr\.com\/app\/open"/);
  assert.match(reminders, /https:\/\/care\.wedopr\.com\/app\/open/);
});

test("Medication view groups medicines by time and keeps one calm taken action", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");
  assert.match(medicationView, /groupMedicationsBySchedule/);
  assert.match(medicationView, /medicine-time-group/);
  assert.match(medicationView, /medicine-slot-actions/);
  assert.match(medicationView, /medicine-chip-button/);
  assert.doesNotMatch(medicationView, /medicine-slot-picker/);
  assert.doesNotMatch(medicationView, /刪除這顆藥/);
  assert.doesNotMatch(medicationView, /onUpdateMedication/);
  assert.doesNotMatch(medicationView, /onDeleteMedication/);
  assert.match(medicationView, /getMedicationShortName/);
  assert.match(medicationView, /"標記本次已服用"/);
  assert.doesNotMatch(medicationView, /我已吃完/);
  assert.match(medicationView, /formatDateLabel\(todayDate\).*已記錄/);
  assert.match(medicationView, /顯示全部藥物/);
  assert.match(medicationView, /totalMedicationCount/);
  assert.doesNotMatch(medicationView, />\s*忘了\s*</);
  assert.doesNotMatch(medicationView, /我忘記有沒有吃/);
  assert.match(app, /markMedicationSlotStatus/);
  assert.match(app, /taken_slots/);
  assert.doesNotMatch(medicationView, /尚未記錄/);
});

test("Medication view exposes an A4-friendly doctor summary", () => {
  const source = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const medicationArea = source.slice(source.indexOf("function MedicationSummarySheet"));

  assert.match(medicationArea, /給醫生看/);
  assert.match(medicationArea, /用藥總表/);
  assert.match(medicationArea, /藥品全名/);
  assert.match(medicationArea, /用途/);
  assert.match(medicationArea, /劑量/);
  assert.match(medicationArea, /服用時間/);
  assert.match(medicationArea, /複製文字/);
  assert.match(medicationArea, /儲存圖片/);
  assert.match(medicationArea, /medicationSummarySource/);
  assert.match(source, /MEDICATION_SLOT_SORT_ORDER/);
  assert.match(source, /function medicationSlotRank/);
  assert.match(source, /medication\.active !== false/);
  assert.match(source, /slotRankA - slotRankB/);
  assert.match(css, /\.medicine-summary-sheet/);
  assert.match(css, /data-label/);
  assert.match(css, /@media print/);
});

test("Version A pricing is visible without wiring live payments", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /recipientMonthly:\s*30/);
  assert.match(app, /collaboratorMonthly:\s*10/);
  assert.match(app, /maxCareProfiles:\s*4/);
  assert.match(app, /maxPaidCollaborators:\s*5/);
  assert.match(app, /estimateCareCirclePrice/);
  assert.match(app, /本月費用預估/);
  assert.match(app, /主帳號不列入協作者費用/);
  assert.doesNotMatch(app, /主帳號：\$0/);
  assert.match(app, /首位減免，增加才收費/);
  assert.match(app, /每位照護對象 100 筆\/月/);
  assert.match(app, /保留最近 30 天/);
  assert.match(app, /綠界安全付款|綠界安全處理/);
  assert.match(app, /Care@wedopr\.com/);
  assert.doesNotMatch(app, /paymentIntent|card_number|credit_card_number/i);
  assert.match(css, /\.billing-estimate-panel/);
  assert.match(css, /\.pricing-example-band/);
});

test("OCR quota limit opens a plan upgrade prompt instead of a raw error", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /function isQuotaLimitMessage/);
  assert.match(app, /planUpgradePrompt/);
  assert.match(app, /function PlanUpgradeModal/);
  assert.match(app, /本月免費整理額度已用完/);
  assert.match(app, /showPlanUpgradePrompt\("quota", "image_upload", message\)/);
  assert.match(app, /showPlanUpgradePrompt\("quota", "text_upload", message\)/);
  assert.match(app, /查看方案/);
  assert.match(app, /先不要保存/);
  assert.match(app, /聯絡客服/);
  assert.match(app, /Care@wedopr\.com/);
  assert.match(css, /\.quota-upgrade-modal/);
  assert.match(css, /\.quota-upgrade-options/);
  assert.match(css, /\.quota-upgrade-actions/);
});

test("Family assistance controls do not appear outside centralized settings", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.doesNotMatch(source, /function AskFamilyModal/);
  assert.doesNotMatch(source, /function handleAskFamily/);
  assert.doesNotMatch(source, /familyHelpDraft/);
  assert.doesNotMatch(css, /\.ask-family-modal/);
  assert.doesNotMatch(css, /\.ask-family-textarea/);
  assert.match(source, /協作者管理中心/);
});

test("Manual reminders derive title from type while preserving department", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const schema = readProjectFile("supabase/schema.sql");
  const migration = readProjectFile("supabase/migration_phase48_appointment_title.sql");
  const createApi = readProjectFile("functions/api/appointments.ts");
  const updateApi = readProjectFile("functions/api/appointments/[id].ts");
  const shared = readProjectFile("functions/_shared/supabase.ts");
  const manualModal = appointmentView.slice(appointmentView.indexOf("function buildReminderFormData"), appointmentView.indexOf("export function CalendarView"));
  const saveHandler = app.slice(app.indexOf("async function handleManualReminderSave"), app.indexOf("function handleAddAppointmentToCalendar"));

  assert.match(schema, /title text/);
  assert.match(migration, /add column if not exists title text/);
  assert.match(shared, /title\?: string \| null/);
  assert.match(shared, /title: row\.title/);
  assert.match(createApi, /title,/);
  assert.match(createApi, /department: cleanString\(body\.department\) \|\| null/);
  assert.match(createApi, /Could not find\.\*title/);
  assert.match(createApi, /department: legacyPayload\.department \|\| legacyTitle/);
  assert.match(updateApi, /allowed\.title = body\.title/);
  assert.match(shared, /Could not find\.\*title/);
  assert.match(shared, /department: legacyUpdates\.department \|\| title/);
  assert.doesNotMatch(manualModal, /<label>提醒名稱<\/label>/);
  assert.match(manualModal, /title: typeLabel\(formData\.type\)/);
  assert.match(manualModal, /department: formData\.department,/);
  assert.match(saveHandler, /createAppointment\(\{ \.\.\.payload, profile_id: activeProfileId \}/);
  assert.match(app, /async function handleAppointmentUpdateSave/);
  assert.match(app, /async function handleAppointmentDelete/);
});

test("Appointment cards expose edit and soft-delete controls with scoped APIs", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const api = readProjectFile("care-wedo-app/src/services/api.js");
  const updateApi = readProjectFile("functions/api/appointments/[id].ts");
  const calendarView = appointmentView.slice(appointmentView.indexOf("export function CalendarView"));
  const recordsView = app.slice(app.indexOf("function RecordsView"), app.indexOf("function SettingsView"));
  const editSaveHandler = app.slice(app.indexOf("async function handleAppointmentUpdateSave"), app.indexOf("async function handleAppointmentDelete"));
  const deleteHandler = app.slice(app.indexOf("async function handleAppointmentDelete"), app.indexOf("async function handleAppointmentCopySave"));
  const copySaveHandler = app.slice(app.indexOf("async function handleAppointmentCopySave"), app.indexOf("async function handleAddAppointmentToCalendar"));
  const editModalMount = app.slice(app.indexOf("{editingAppointment && ("), app.indexOf("{showFamilyNotesEditor && ("));
  const editModal = appointmentView.slice(appointmentView.indexOf("export function ManualReminderModal"), appointmentView.indexOf("export function CalendarView"));

  assert.match(app, /deleteAppointment/);
  assert.match(app, /editingAppointment/);
  assert.match(calendarView, /onEditAppointment/);
  assert.match(recordsView, /onEditRecord/);
  assert.match(editSaveHandler, /patchAppointment\(editingAppointment\.id/);
  assert.match(deleteHandler, /deleteAppointment\(editingAppointment\.id/);
  assert.match(copySaveHandler, /createAppointment\(\{ \.\.\.payload, profile_id: activeProfileId \}/);
  assert.doesNotMatch(copySaveHandler, /patchAppointment/);
  assert.doesNotMatch(copySaveHandler, /deleteAppointment/);
  assert.match(editModalMount, /onCopy=\{handleAppointmentCopySave\}/);
  assert.match(editModal, /複製成新提醒/);
  assert.match(editModal, /handleCopySubmit/);
  assert.match(api, /export async function deleteAppointment/);
  assert.match(api, /method: "DELETE"/);
  assert.match(updateApi, /onRequestDelete/);
  assert.match(updateApi, /status: "deleted"/);
  assert.match(updateApi, /getIdentityAndGroups/);
});

test("Care reminder detail text is highlighted on cards", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(css, /\.event-row \.soft-note,\s*\.elder-task-body \.elder-task-detail/);
  assert.match(css, /rgba?\(255,?\s*224,?\s*111\s*[,/]\s*(0\.58|58%)\)/);
  assert.match(css, /box-decoration-break:\s*clone/);
});

test("Today task cards keep only the primary elder action", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const overviewView = app.slice(app.indexOf("function OverviewView"), app.indexOf("function appointmentTimeValue"));
  const todayTaskCard = overviewView.slice(
    overviewView.indexOf('<article key={task.id}'),
    overviewView.indexOf("</article>"),
  );

  assert.match(todayTaskCard, /elder-primary-action/);
  assert.doesNotMatch(todayTaskCard, /問家人/);
  assert.doesNotMatch(todayTaskCard, /elder-task-edit-action/);
  assert.doesNotMatch(todayTaskCard, /編輯/);
});

test("Today page makes photo-first care upload the primary action", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const ocrWorkflow = readProjectFile("care-wedo-app/src/features/ocr/OcrWorkflow.jsx");
  const overviewView = app.slice(app.indexOf("function OverviewView"), app.indexOf("function appointmentTimeValue"));
  const uploadGuide = ocrWorkflow.slice(ocrWorkflow.indexOf("export function UploadGuide"), ocrWorkflow.indexOf("export function CareDocumentUploadModal"));

  assert.match(overviewView, /今天要照顧的事/);
  assert.match(overviewView, /拍照新增照護資料/);
  assert.match(overviewView, /用藥、回診、處方箋、掛號單都從這裡開始。/);
  assert.doesNotMatch(overviewView, /手動新增提醒/);
  assert.doesNotMatch(overviewView, /最近下一筆照護事項/);
  assert.match(uploadGuide, /不用先分類/);
  assert.match(uploadGuide, /系統會先幫你整理/);
});

test("LINE setup check does not treat auth check failures as first-time setup", () => {
  const loginSetup = readProjectFile("care-wedo-app/src/components/LoginSetup.jsx");
  const catchBlock = loginSetup.slice(loginSetup.indexOf("} catch (err) {"), loginSetup.indexOf("async function handleSetup"));

  assert.match(loginSetup, /if \(!res\.ok\)/);
  assert.match(loginSetup, /setStep\("error"\)/);
  assert.match(loginSetup, /避免讓你重複綁定/);
  assert.doesNotMatch(catchBlock, /setStep\("setup"\)/);
});

test("Logged-in dashboard exposes a clear care context header", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /<CareContextHeader/);
  assert.match(app, /function CareContextHeader/);
  assert.match(app, /正在照護/);
  assert.match(app, /照護圈/);
  assert.match(app, /照護協作者/);
  assert.match(app, /登入者/);
  assert.match(css, /\.care-context-header/);
  assert.match(css, /\.today-main-actions/);
});

test("Records page defaults to future arrangements and loads history on demand", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  const recordsView = app.slice(app.indexOf("function RecordsView"), app.indexOf("function SettingsView"));

  assert.match(dashboard, /status=neq\.deleted/);
  assert.match(dashboard, /filterAppointmentsByHistoryAccess/);
  assert.match(dashboard, /can_view_history/);
  assert.match(dashboard, /FREE_HISTORY_RETENTION_DAYS\s*=\s*30/);
  assert.match(dashboard, /fetchAppointments\(env, activeGroupId, activeProfileId, \{ canViewHistory \}\)/);
  assert.match(app, /records=\{allAppointments\}/);
  assert.match(app, /canViewHistory=\{canViewHistory\}/);
  assert.match(app, /onUpgradeRequired=\{\(reason\) => showPlanUpgradePrompt\(reason, "records_history"\)\}/);
  assert.match(recordsView, /useState\("future"\)/);
  assert.match(recordsView, /歷史紀錄/);
  assert.match(recordsView, /canViewHistory = true/);
  assert.match(recordsView, /onUpgradeRequired\?\.\("history"\)/);
  assert.match(recordsView, /isDateTodayOrFuture\(record\.date,\s*today\)/);
  assert.match(recordsView, /matchSearch\(record,\s*searchQuery\)/);
  assert.match(recordsView, /appointmentTimeValue\(a\)\.localeCompare\(appointmentTimeValue\(b\)\)/);
  assert.match(recordsView, /record-summary-button/);
  assert.match(app, /function buildRecordReminderCopy/);
  assert.match(recordsView, /buildRecordReminderCopy\(record\)/);
  assert.match(recordsView, /const title = typeLabel\(record\.type\)/);
  assert.match(recordsView, /record-type-chip record-type-icon/);
  assert.match(recordsView, /record-type-chip record-tag/);
  assert.match(recordsView, /record-status-copy/);
  assert.match(recordsView, /onEditRecord\?\.\(record\)/);
  assert.match(recordsView, /record-edit-button/);
  assert.doesNotMatch(recordsView, /onDeleteRecord/);
  assert.doesNotMatch(recordsView, /danger-subtle/);
  assert.match(css, /\.record-mode-switch/);
  assert.match(css, /\.record-summary-button/);
  assert.match(css, /\.record-type-chip/);
  assert.match(css, /\.record-card-actions/);
});

test("Family invite card keeps copy actions elder-friendly on mobile", () => {
  const component = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(component, /invite-copy-head/);
  assert.match(component, /複製完整邀請/);
  assert.match(component, /只複製邀請碼/);
  assert.match(component, /CARE_WEDO_LINE_URL/);
  assert.match(component, /加入 LINE 小管家/);
  assert.match(component, /要收到家人上傳摘要與每日提醒/);
  assert.match(css, /\.invite-copy-head strong/);
  assert.match(css, /\.invite-line-link/);
  assert.match(css, /\.invite-code-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.invite-code-row\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});

test("Medication records expose schedule fields for elder-friendly medicine instructions", () => {
  const schema = readProjectFile("supabase/schema.sql");
  const migration = readProjectFile("supabase/migration_phase51_medication_schedule_columns.sql");
  const shared = readProjectFile("functions/_shared/supabase.ts");
  assert.match(schema, /time_slot text/);
  assert.match(schema, /meal_timing text/);
  assert.match(schema, /scheduled_time text/);
  assert.match(schema, /taken_status text/);
  assert.match(migration, /alter table public\.medications/);
  assert.match(migration, /add column if not exists time_slot text/);
  assert.match(migration, /add column if not exists meal_timing text/);
  assert.match(migration, /add column if not exists scheduled_time text/);
  assert.match(shared, /time_slot:\s*row\.time_slot/);
  assert.match(shared, /meal_timing:\s*row\.meal_timing/);
  assert.match(shared, /scheduled_time:\s*row\.scheduled_time/);
  assert.match(shared, /taken_status:\s*row\.taken_status/);
});

test("Medication slot status API records dated logs with ownership checks", () => {
  const schema = readProjectFile("supabase/schema.sql");
  const migration = readProjectFile("supabase/migration_phase50_medication_logs.sql");
  const api = readProjectFile("functions/api/medications/taken.ts");
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  assert.match(schema, /create table if not exists public\.medication_logs/);
  assert.match(migration, /create table if not exists public\.medication_logs/);
  assert.match(schema, /taken_date date not null/);
  assert.match(schema, /confirmed_by_user_id bigint/);
  assert.match(api, /getBearerToken/);
  assert.match(api, /getUserMemberships/);
  assert.match(api, /medication_ids/);
  assert.match(api, /medications\?id=in\.\(\$\{medicationIds\.join\(","\)\}\)/);
  assert.match(api, /medication_logs\?select=/);
  assert.match(api, /status:\s*status/);
  assert.match(api, /medications\.taken_logs_missing/);
  assert.doesNotMatch(api, /body:\s*JSON\.stringify\(\{\s*taken_status:\s*status\s*\}\)/);
  assert.match(dashboard, /fetchTodayMedicationLogs/);
  assert.match(dashboard, /taken_date=eq\.\$\{todayInTaipei\(\)\}/);
  assert.match(dashboard, /taken_slots/);
  assert.match(dashboard, /dashboard\.medication_logs_missing/);
});

test("Collaborator controls are centralized in the settings page", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(app, /collaborator-control-panel/);
  assert.match(app, /協作者管理中心/);
  assert.match(app, /編輯照護對象/);
  assert.match(app, /手動新增提醒/);
  assert.match(css, /\.management-action-grid/);
  assert.doesNotMatch(app, /function GlobalCareContactDock/);
});

test("Collaborator contact action uses reliable contact methods instead of raw LINE U ids", () => {
  const groupSettings = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");
  const contactService = readProjectFile("care-wedo-app/src/services/contact.js");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(groupSettings, /buildCollaboratorContact/);
  assert.match(groupSettings, /getMemberContact/);
  assert.match(groupSettings, /handleMemberContact/);
  assert.match(groupSettings, /請先補聯絡方式/);
  assert.match(groupSettings, /目前沒有可直接聯絡方式/);
  assert.match(groupSettings, /member-contact-tag/);
  assert.match(contactService, /normalizeLineContactId/);
  assert.match(contactService, /\^U\[0-9a-f\]\{20,\}\$/i);
  assert.match(contactService, /mailto:/);
  assert.match(contactService, /line\.me\/R\/ti\/p/);
  assert.match(css, /\.member-contact-tag-line/);
  assert.match(css, /\.member-contact-tag-email/);
  assert.match(css, /\.member-contact-tag-none/);
});

test("Family group creation uses a user feature flag, not group plans", () => {
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const billing = readProjectFile("functions/_shared/billing.ts");
  const migration = readProjectFile("supabase/migration_phase46_user_feature_flags.sql");
  const createAction = groupsApi.slice(groupsApi.indexOf('if (body.action === "create")'));
  const canCreateStart = billing.indexOf("export async function canCreateFamilyGroup");
  const canCreateEnd = billing.indexOf("/**\n * Check whether a new member", canCreateStart);
  const canCreate = billing.slice(canCreateStart, canCreateEnd);

  assert.match(migration, /create table if not exists public\.user_feature_flags/i);
  assert.match(migration, /multiple_family_groups/);
  assert.match(createAction, /canCreateFamilyGroup\(env,\s*userId\)/);
  assert.match(canCreate, /hasUserFeatureFlag\(env,\s*userId,\s*MULTIPLE_FAMILY_GROUPS_FEATURE\)/);
  assert.doesNotMatch(canCreate, /getGroupPlan|plan_id|internal/);
});

test("Beta family groups default to the Care Circle plan while multiple group access stays user-scoped", () => {
  const supabase = readProjectFile("functions/_shared/supabase.ts");
  const createGroup = supabase.slice(
    supabase.indexOf("export async function createGroup"),
    supabase.indexOf("// Add creator as admin"),
  );

  assert.match(createGroup, /plan_id:\s*"pro"/);
  assert.doesNotMatch(createGroup, /hasUserFeatureFlag/);
});

test("Version A plan rows keep legacy plans inactive and price Care Circle at 30", () => {
  const schema = readProjectFile("supabase/schema.sql");
  const migration = readProjectFile("supabase/migration_phase52_version_a_plan_limits.sql");
  const capsMigration = readProjectFile("supabase/migration_phase53_family_group_caps.sql");
  const combined = `${schema}\n${migration}\n${capsMigration}`;

  assert.match(combined, /'pro',\s*'照護圈升級',\s*100,\s*6,\s*4,\s*true,\s*30/);
  assert.match(combined, /max_members = 6/);
  assert.match(combined, /max_recipients = 4/);
  assert.match(combined, /'free',\s*'Free',\s*10,\s*1,\s*1,\s*false,\s*0/);
  assert.match(combined, /where id in \('basic', 'plus', 'team'\)/);
  assert.match(combined, /is_active = false/);
});

test("Group settings exposes plan limits before adding care recipients", () => {
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const component = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(groupsApi, /getGroupPlan/);
  assert.match(groupsApi, /care_profile_count/);
  assert.match(groupsApi, /member_count/);
  assert.match(groupsApi, /max_recipients/);
  assert.match(groupsApi, /billing_entitlement/);
  assert.match(component, /selectedRecipientLimitReached/);
  assert.match(component, /maxCareProfiles:\s*4/);
  assert.match(component, /maxPaidCollaborators:\s*5/);
  assert.match(component, /另外開設家庭群組/);
  assert.match(component, /quota-note/);
  assert.match(component, /showLimitModal\("profile", selectedGroup\)/);
  assert.match(component, /disabled=\{loading\}/);
  assert.match(css, /\.quota-note-warning/);
});

test("Paid care actions show a beta fee confirmation before continuing", () => {
  const component = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(component, /function PaidActionConfirmationModal/);
  assert.match(component, /calculateGroupMonthlyEstimate/);
  assert.match(component, /buildPaidActionPreview/);
  assert.match(component, /第一位主要照護對象測試期減免/);
  assert.match(component, /本次需要前往綠界安全付款/);
  assert.match(component, /requiresCheckout = action\.preview\.delta > 0/);
  assert.match(component, /這個動作會讓/);
  assert.match(component, /若協作者完成加入/);
  assert.match(component, /前往安全付款/);
  assert.match(component, /先不要新增/);
  assert.match(component, /requestProfileCreationConfirmation/);
  assert.match(component, /requestInviteConfirmation/);
  assert.match(component, /runConfirmedPaidAction/);
  assert.match(component, /handleGroupBillingCheckout/);
  assert.match(component, /actionType:\s*"settle_group"/);
  assert.match(component, /費用與付款/);
  assert.match(component, /前往付款/);
  assert.match(component, /createBillingCheckout/);
  assert.match(component, /submitGatewayCheckout/);
  assert.match(component, /Care WEDO 不保存信用卡資料/);
  assert.match(component, /已達 .*位共同協作者上限/);
  assert.match(css, /\.group-billing-panel/);
  assert.match(css, /\.group-billing-pay-button/);
  assert.match(css, /\.paid-action-modal/);
  assert.match(css, /width:\s*min\(560px,\s*calc\(100vw - 40px\)\)/);
  assert.match(css, /width:\s*calc\(100vw - 24px\)/);
  assert.match(css, /\.paid-action-breakdown/);
});

test("Cron endpoints fail closed when CRON_SECRET is not configured", () => {
  for (const file of ["functions/api/cron/reminders.ts", "functions/api/cron/evening.ts"]) {
    const source = readProjectFile(file);
    assert.match(source, /if \(!env\.CRON_SECRET\) \{/);
    assert.match(source, /CRON_SECRET is not configured/);
  }
});

test("Reminder schedules use Cloudflare Cron Worker instead of GitHub scheduled workflows", () => {
  const worker = readProjectFile("workers/reminder-scheduler/src/index.ts");
  const config = readProjectFile("workers/reminder-scheduler/wrangler.toml");
  const deployWorkflow = readProjectFile(".github/workflows/deploy-reminder-scheduler.yml");
  const eveningWorkflow = readProjectFile(".github/workflows/evening-fasting.yml");
  const morningWorkflow = readProjectFile(".github/workflows/daily-reminders.yml");

  assert.match(config, /name = "care-wedo-reminder-scheduler"/);
  assert.match(config, /crons = \[[\s\S]*"0 12 \* \* \*"[\s\S]*"0 0 \* \* \*"[\s\S]*\]/);
  assert.match(worker, /const EVENING_CRON = "0 12 \* \* \*"/);
  assert.match(worker, /const MORNING_CRON = "0 0 \* \* \*"/);
  assert.match(worker, /endpoint: "\/api\/cron\/evening"/);
  assert.match(worker, /endpoint: "\/api\/cron\/reminders"/);
  assert.match(worker, /ctx\.waitUntil\(triggerReminder\(env, controller\.cron\)\)/);
  assert.match(deployWorkflow, /wrangler@4 deploy --config workers\/reminder-scheduler\/wrangler\.toml/);
  assert.match(deployWorkflow, /secret put CRON_SECRET --config workers\/reminder-scheduler\/wrangler\.toml/);
  assert.doesNotMatch(eveningWorkflow, /schedule:/);
  assert.doesNotMatch(morningWorkflow, /schedule:/);
  assert.match(eveningWorkflow, /workflow_dispatch/);
  assert.match(morningWorkflow, /workflow_dispatch/);
});

test("Cron reminder queries pin appointment ownership relations explicitly", () => {
  const reminders = readProjectFile("functions/api/cron/reminders.ts");
  const evening = readProjectFile("functions/api/cron/evening.ts");

  assert.match(reminders, /users!appointments_user_id_fkey\(line_user_id\)/);
  assert.doesNotMatch(reminders, /users!medications_user_id_fkey\(line_user_id\)/);
  assert.match(evening, /users!appointments_user_id_fkey\(line_user_id\)/);
});

test("Daily LINE reminders use family-like copy instead of announcement-style notices", () => {
  const source = readProjectFile("functions/api/cron/reminders.ts");
  const builder = source.slice(source.indexOf("function buildDailyReminderMessage"), source.indexOf("async function fetchCareProfiles"));
  const evening = readProjectFile("functions/api/cron/evening.ts");
  const readme = readProjectFile("README.md");
  const developmentPlan = readProjectFile("DEVELOPMENT_PLAN.md");
  const groupSettings = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");

  assert.match(builder, /"早安",\s*"提醒您接下來的注意事項。"/);
  assert.match(source, /Care WEDO\\n陪你照顧最重要的人\\nhttps:\/\/care\.wedopr\.com/);
  assert.match(evening, /"晚安",\s*"提醒您接下來的注意事項。"/);
  assert.match(evening, /Care WEDO\\n陪你照顧最重要的人\\nhttps:\/\/care\.wedopr\.com/);
  assert.match(source, /!place\.includes\(doctor\)/);
  assert.doesNotMatch(source, /今日用藥/);
  assert.doesNotMatch(source, /fetchReminderMedications/);
  assert.doesNotMatch(source, /buildMedicationReminderLine/);
  assert.doesNotMatch(builder, /接下來的預約先提醒你：/);
  assert.doesNotMatch(builder, /親愛的家人，早安/);
  assert.doesNotMatch(builder, /地址：/);
  assert.doesNotMatch(builder, /明天要記得/);
  assert.doesNotMatch(builder, /完整清單在這裡/);
  assert.doesNotMatch(builder, /`【\$\{label\}】`/);
  assert.doesNotMatch(evening, /提醒您一下/);
  assert.doesNotMatch(evening, /itemPrefix/);
  assert.match(readme, /今日行程提醒/);
  assert.match(developmentPlan, /今日行程提醒/);
  assert.match(groupSettings, /今日行程提醒/);
  assert.doesNotMatch(readme, /吃藥簡報/);
  assert.doesNotMatch(developmentPlan, /吃藥簡報/);
  assert.doesNotMatch(groupSettings, /每日簡報/);
  assert.doesNotMatch(groupSettings, /用藥提醒通知/);
});

test("LINE reminder pushes are recorded as de-identified audit logs", () => {
  const migration = readProjectFile("supabase/migration_phase57_line_push_logs.sql");
  const schema = readProjectFile("supabase/schema.sql");
  const shared = readProjectFile("functions/_shared/line_push_logs.ts");
  const morning = readProjectFile("functions/api/cron/reminders.ts");
  const evening = readProjectFile("functions/api/cron/evening.ts");

  for (const source of [migration, schema]) {
    assert.match(source, /create table if not exists public\.line_push_logs/);
    assert.match(source, /line_user_suffix text/);
    assert.match(source, /message_character_count integer/);
    assert.match(source, /source_ids jsonb/);
    assert.match(source, /alter table public\.line_push_logs enable row level security/);
    assert.match(source, /revoke all on public\.line_push_logs from anon, authenticated/);
    assert.match(source, /grant select, insert, update, delete on public\.line_push_logs to service_role/);
  }

  assert.match(shared, /recordLinePushLog/);
  assert.match(shared, /line_push_logs/);
  assert.match(shared, /message_character_count/);
  assert.match(shared, /line_user_suffix/);
  assert.doesNotMatch(shared, /message_text/);
  assert.doesNotMatch(shared, /line_user_id/);
  assert.match(morning, /recordLinePushLog/);
  assert.match(morning, /daily_appointment_reminder/);
  assert.match(evening, /recordLinePushLog/);
  assert.match(evening, /evening_appointment_reminder/);
});

test("Dashboard exposes recent LINE push audit summaries without sensitive message content", () => {
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const helper = dashboard.slice(dashboard.indexOf("async function fetchLinePushAuditLogs"), dashboard.indexOf("function filterAppointmentsByHistoryAccess"));

  assert.match(dashboard, /type LinePushAuditRow/);
  assert.match(dashboard, /fetchLinePushAuditLogs/);
  assert.match(dashboard, /line_push_logs\?group_id=eq\.\$\{groupId\}/);
  assert.match(dashboard, /select=id,event_type,target_date,item_count,status,http_status,line_user_suffix,created_at/);
  assert.match(dashboard, /line_push_audit:\s*linePushAuditLogs/);
  assert.doesNotMatch(helper, /message_text|line_user_id/);

  assert.match(app, /const linePushAudit = dashboard\?\.line_push_audit \|\| \[\]/);
  assert.match(app, /linePushAudit=\{linePushAudit\}/);
  assert.match(app, /ReminderAuditPanel/);
  assert.match(app, /最近提醒送達/);
  assert.match(app, /LINE 後四碼/);
  assert.doesNotMatch(app, /line_user_id|message_text/);
  assert.match(css, /\.reminder-audit-panel/);
  assert.match(css, /\.reminder-audit-row/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.reminder-audit-row\s*\{\s*grid-template-columns:\s*1fr/s);
});

test("Morning reminders target today while evening reminders tolerate delayed schedule runs", () => {
  const morning = readProjectFile("functions/api/cron/reminders.ts");
  const evening = readProjectFile("functions/api/cron/evening.ts");
  const morningHandler = morning.slice(morning.indexOf("export const onRequestPost"));
  const eveningHandler = evening.slice(evening.indexOf("export const onRequestPost"));

  assert.match(morningHandler, /const targetDate = today/);
  assert.doesNotMatch(morningHandler, /setDate\(twTime\.getDate\(\) \+ 1\)/);
  assert.match(evening, /DELAYED_EVENING_GRACE_HOUR = 6/);
  assert.match(eveningHandler, /const targetDate = resolveEveningTargetDate\(now\)/);
  assert.doesNotMatch(eveningHandler, /twTime\.setDate/);
  assert.match(eveningHandler, /fetchNextDayAppointments\(env,\s*targetDate\)/);
  assert.match(eveningHandler, /targetDateLabel\(targetDate,\s*todayDate\)/);
  assert.match(eveningHandler, /dateLabel === "今天" \? "【今日行程提醒】" : "【明日行程提醒】"/);
});

test("Appointment calendar export is an authenticated ICS endpoint", () => {
  const source = readProjectFile("functions/api/appointments/[id]/calendar.ics.ts");
  assert.match(source, /text\/calendar;\s*charset=utf-8/);
  assert.match(source, /Content-Disposition/);
  assert.match(source, /BEGIN:VCALENDAR/);
  assert.match(source, /VERSION:2\.0/);
  assert.match(source, /UID:care-wedo-appointment-/);
  assert.match(source, /getUserMemberships/);
  assert.match(source, /group_id\.in/);
  assert.match(source, /status=neq\.deleted/);
});

test("Future appointment cards expose a calendar file export action", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const appointmentView = readProjectFile("care-wedo-app/src/features/appointments/AppointmentView.jsx");
  const calendarView = appointmentView.slice(appointmentView.indexOf("export function CalendarView"));
  assert.match(source, /downloadAppointmentCalendarFile/);
  assert.match(source, /downloadLocalAppointmentCalendarFile/);
  assert.match(appointmentView, /buildGoogleCalendarEventUrl/);
  assert.match(calendarView, /onAddToCalendar/);
  assert.match(calendarView, />\s*加入行事曆\s*</);
  assert.match(calendarView, />\s*加入 Google 行事曆\s*</);
  assert.match(calendarView, />\s*Apple \/ 手機行事曆\s*</);
  assert.match(calendarView, />\s*複製提醒文字\s*</);
  assert.match(calendarView, /event-card-actions[\s\S]*card-corner-calendar/);
  assert.match(calendarView, /event-card-edit-actions[\s\S]*card-corner-edit/);
  assert.doesNotMatch(calendarView.slice(calendarView.indexOf('<div className="event-card-actions"'), calendarView.indexOf('<div className="event-type">')), /card-corner-edit/);
  assert.match(calendarView, /onEditAppointment\?\.\(apt\)/);
  assert.doesNotMatch(calendarView, /event-edit-action/);
  assert.match(calendarView, />\s*拍照新增照護資料\s*</);
  assert.doesNotMatch(calendarView, />\s*手動新增提醒\s*</);
  assert.doesNotMatch(calendarView, />\s*拍照上傳\s*</);
});

test("LINE postback reassignment validates source user access before updating records", () => {
  const source = readProjectFile("functions/callback.ts");
  assert.match(source, /getUserMemberships/);
  assert.match(source, /getAccessibleProfiles/);
  assert.match(source, /targetProfile/);
  assert.match(source, /group_id\.in|group_id=in/);
});
