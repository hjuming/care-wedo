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
  assert.match(source, /if \(!token\) \{/);
  assert.match(source, /請先登入/);
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
  assert.match(app, /onEditFamilyNotes/);
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

test("Global care contact sheets support keyboard close and focus return", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const dock = source.slice(source.indexOf("function GlobalCareContactDock"));
  assert.match(dock, /lastContactTriggerRef/);
  assert.match(dock, /contactSheetPrimaryRef/);
  assert.match(dock, /event\.key === "Escape"/);
  assert.match(dock, /\.focus\(\)/);
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

test("Medication view groups medicines by time and keeps one calm taken action", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const medicationView = source.slice(source.indexOf("function MedicationView"));
  assert.match(medicationView, /groupMedicationsBySchedule/);
  assert.match(medicationView, /medicine-time-group/);
  assert.match(medicationView, /medicine-slot-actions/);
  assert.match(medicationView, /medicine-chip-button/);
  assert.match(medicationView, /medicine-slot-picker/);
  assert.match(medicationView, /刪除這顆藥/);
  assert.match(medicationView, /onUpdateMedication/);
  assert.match(medicationView, /onDeleteMedication/);
  assert.match(medicationView, /getMedicationShortName/);
  assert.match(medicationView, /"我已吃完"/);
  assert.match(medicationView, /formatDateLabel\(todayDate\).*已記錄/);
  assert.match(medicationView, /顯示全部藥物/);
  assert.match(medicationView, /totalMedicationCount/);
  assert.doesNotMatch(medicationView, />\s*忘了\s*</);
  assert.doesNotMatch(medicationView, /我忘記有沒有吃/);
  assert.match(source, /markMedicationSlotStatus/);
  assert.match(source, /taken_slots/);
  assert.match(css, /\.medicine-manage-panel/);
  assert.match(css, /\.medicine-delete-action/);
  assert.doesNotMatch(medicationView, /尚未記錄/);
});

test("Medication view exposes an A4-friendly doctor summary", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const medicationArea = source.slice(source.indexOf("function MedicationSummarySheet"), source.indexOf("function appointmentTimeValue"));

  assert.match(medicationArea, /給醫生看/);
  assert.match(medicationArea, /用藥總表/);
  assert.match(medicationArea, /藥品全名/);
  assert.match(medicationArea, /用途/);
  assert.match(medicationArea, /劑量/);
  assert.match(medicationArea, /服用時間/);
  assert.match(medicationArea, /medicationSummarySource/);
  assert.match(css, /\.medicine-summary-sheet/);
  assert.match(css, /@media print/);
});

test("Version A pricing is visible without wiring live payments", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /baseCircleMonthly:\s*30/);
  assert.match(app, /extraCollaboratorMonthly:\s*10/);
  assert.match(app, /extraRecipientMonthly:\s*30/);
  assert.match(app, /estimateCareCirclePrice/);
  assert.match(app, /本月費用預估/);
  assert.match(app, /照護圈升級 \$30\/月/);
  assert.match(app, /每位照護對象 100 筆\/月/);
  assert.match(app, /保留最近 30 天/);
  assert.match(app, /LINE Pay/);
  assert.match(app, /Care@wedopr\.com/);
  assert.doesNotMatch(app, /checkout|paymentIntent|信用卡付款/);
  assert.match(css, /\.billing-estimate-panel/);
  assert.match(css, /\.pricing-example-band/);
});

test("OCR quota limit opens a plan upgrade prompt instead of a raw error", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /function isQuotaLimitMessage/);
  assert.match(app, /quotaUpgradePrompt/);
  assert.match(app, /本月免費整理額度已用完/);
  assert.match(app, /showQuotaUpgradePrompt\(message, "image_upload"\)/);
  assert.match(app, /showQuotaUpgradePrompt\(message, "text_upload"\)/);
  assert.match(app, /查看方案/);
  assert.match(app, /先不要保存/);
  assert.match(app, /聯絡客服/);
  assert.match(app, /Care@wedopr\.com/);
  assert.match(css, /\.quota-upgrade-modal/);
  assert.match(css, /\.quota-upgrade-options/);
  assert.match(css, /\.quota-upgrade-actions/);
});

test("Ask family opens an editable branded copy modal instead of a browser prompt", () => {
  const source = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const askFamily = source.slice(source.indexOf("function AskFamilyModal"));
  const handleAskFamily = source.slice(source.indexOf("function handleAskFamily"), source.indexOf("function handleMobileNavChange"));

  assert.match(source, /familyHelpDraft/);
  assert.match(askFamily, /textarea/);
  assert.match(askFamily, /一鍵複製/);
  assert.match(askFamily, /navigator\.clipboard\.writeText/);
  assert.match(css, /\.ask-family-modal/);
  assert.match(css, /\.ask-family-textarea/);
  assert.doesNotMatch(handleAskFamily, /window\.prompt|window\.alert|navigator\.share/);
});

test("Manual reminders derive title from type while preserving department", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const schema = readProjectFile("supabase/schema.sql");
  const migration = readProjectFile("supabase/migration_phase48_appointment_title.sql");
  const createApi = readProjectFile("functions/api/appointments.ts");
  const updateApi = readProjectFile("functions/api/appointments/[id].ts");
  const shared = readProjectFile("functions/_shared/supabase.ts");
  const manualModal = app.slice(app.indexOf("function buildReminderFormData"), app.indexOf("function OverviewView"));
  const updateHandler = app.slice(app.indexOf("async function handleAppointmentUpdate"), app.indexOf("async function handleDeleteAppointment"));

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
  assert.match(updateHandler, /title: payload\.title/);
  assert.match(updateHandler, /department: payload\.department \|\| null/);
});

test("Care reminder detail text is highlighted on cards", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(css, /\.event-row \.soft-note,\s*\.elder-task-body \.elder-task-detail/);
  assert.match(css, /rgba\(255,\s*224,\s*111,\s*0\.58\)/);
  assert.match(css, /box-decoration-break:\s*clone/);
});

test("Today task edit action is tucked into the lower-right corner", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const overviewView = app.slice(app.indexOf("function OverviewView"), app.indexOf("function CalendarView"));
  const todayTaskCard = overviewView.slice(
    overviewView.indexOf('<article key={task.id}'),
    overviewView.indexOf("</article>"),
  );
  const editRule = css.slice(css.indexOf(".elder-task-edit-action"), css.indexOf(".elder-task-time"));

  assert.match(todayTaskCard, /elder-task-actions[\s\S]*elder-task-edit-action/);
  assert.match(editRule, /grid-column:\s*1 \/ -1/);
  assert.match(editRule, /justify-self:\s*end/);
  assert.doesNotMatch(editRule, /position:\s*absolute/);
  assert.doesNotMatch(todayTaskCard, /card-corner-edit/);
});

test("Logged-in dashboard exposes a clear care context header", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /<CareContextHeader/);
  assert.match(app, /function CareContextHeader/);
  assert.match(app, /正在照護/);
  assert.match(app, /照護圈/);
  assert.match(app, /一起照護的人/);
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
  assert.match(app, /records=\{allAppointments\}/);
  assert.match(recordsView, /useState\("future"\)/);
  assert.match(recordsView, /歷史紀錄/);
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
  assert.doesNotMatch(recordsView, /onDeleteRecord/);
  assert.doesNotMatch(recordsView, /danger-subtle/);
  assert.match(css, /\.record-mode-switch/);
  assert.match(css, /\.record-summary-button/);
  assert.match(css, /\.record-type-chip/);
  assert.match(css, /\.record-card-actions/);
  assert.match(css, /\.record-edit-button/);
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

test("Global care contact dock uses a circular icon-only app avatar on mobile", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const dock = app.slice(app.indexOf("function GlobalCareContactDock"));
  assert.match(app, /CARE_WEDO_APP_ICON/);
  assert.match(app, /android-chrome-512x512\.png/);
  assert.doesNotMatch(dock, /care-contact-main-button with-label/);
  assert.match(css, /\.care-contact-main-button\s*\{[^}]*width:\s*64px/s);
  assert.match(css, /\.global-care-contact-dock\s*\{[^}]*right:\s*16px/s);
  assert.doesNotMatch(css, /calc\(\(100vw - min\(100vw, 430px\)\) \/ 2 \+ 72px\)/);
});

test("Family group creation uses a user feature flag, not group plans", () => {
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const supabase = readProjectFile("functions/_shared/supabase.ts");
  const migration = readProjectFile("supabase/migration_phase46_user_feature_flags.sql");
  const createAction = groupsApi.slice(groupsApi.indexOf('if (body.action === "create")'));
  const canCreateStart = supabase.indexOf("export async function canCreateFamilyGroup");
  const canCreateEnd = supabase.indexOf("/**\n * Check whether a new member", canCreateStart);
  const canCreate = supabase.slice(canCreateStart, canCreateEnd);

  assert.match(migration, /create table if not exists public\.user_feature_flags/i);
  assert.match(migration, /multiple_family_groups/);
  assert.match(createAction, /canCreateFamilyGroup\(env,\s*userId\)/);
  assert.match(canCreate, /hasUserFeatureFlag\(env,\s*userId,\s*MULTIPLE_FAMILY_GROUPS_FEATURE\)/);
  assert.doesNotMatch(canCreate, /getGroupPlan|plan_id|internal/);
});

test("Beta family groups default to Family Pro while multiple group access stays user-scoped", () => {
  const supabase = readProjectFile("functions/_shared/supabase.ts");
  const createGroup = supabase.slice(
    supabase.indexOf("export async function createGroup"),
    supabase.indexOf("// Add creator as admin"),
  );

  assert.match(createGroup, /plan_id:\s*"pro"/);
  assert.doesNotMatch(createGroup, /hasUserFeatureFlag/);
});

test("Group settings exposes plan limits before adding care recipients", () => {
  const groupsApi = readProjectFile("functions/api/groups.ts");
  const component = readProjectFile("care-wedo-app/src/components/GroupSettings.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(groupsApi, /getGroupPlan/);
  assert.match(groupsApi, /care_profile_count/);
  assert.match(groupsApi, /member_count/);
  assert.match(groupsApi, /max_recipients/);
  assert.match(component, /selectedRecipientLimitReached/);
  assert.match(component, /quota-note/);
  assert.match(component, /disabled=\{loading \|\| selectedRecipientLimitReached\}/);
  assert.match(css, /\.quota-note-warning/);
});

test("Cron endpoints fail closed when CRON_SECRET is not configured", () => {
  for (const file of ["functions/api/cron/reminders.ts", "functions/api/cron/evening.ts"]) {
    const source = readProjectFile(file);
    assert.match(source, /if \(!env\.CRON_SECRET\) \{/);
    assert.match(source, /CRON_SECRET is not configured/);
  }
});

test("Daily LINE reminders use family-like copy instead of announcement-style notices", () => {
  const source = readProjectFile("functions/api/cron/reminders.ts");
  const builder = source.slice(source.indexOf("function buildDailyReminderMessage"), source.indexOf("async function fetchCareProfiles"));
  const evening = readProjectFile("functions/api/cron/evening.ts");

  assert.match(builder, /"早安",\s*"提醒您接下來的注意事項。"/);
  assert.match(source, /Care WEDO\\n陪你照顧最重要的人\\nhttps:\/\/care\.wedopr\.com/);
  assert.match(evening, /"晚安",\s*"提醒您接下來的注意事項。"/);
  assert.match(evening, /Care WEDO\\n陪你照顧最重要的人\\nhttps:\/\/care\.wedopr\.com/);
  assert.match(source, /!place\.includes\(doctor\)/);
  assert.doesNotMatch(builder, /接下來的預約先提醒你：/);
  assert.doesNotMatch(builder, /親愛的家人，早安/);
  assert.doesNotMatch(builder, /地址：/);
  assert.doesNotMatch(builder, /明天要記得/);
  assert.doesNotMatch(builder, /完整清單在這裡/);
  assert.doesNotMatch(builder, /`【\$\{label\}】`/);
  assert.doesNotMatch(evening, /提醒您一下/);
  assert.doesNotMatch(evening, /itemPrefix/);
});

test("Morning reminders target today's appointments while evening fasting targets tomorrow", () => {
  const morning = readProjectFile("functions/api/cron/reminders.ts");
  const evening = readProjectFile("functions/api/cron/evening.ts");
  const morningHandler = morning.slice(morning.indexOf("export const onRequestPost"));
  const eveningHandler = evening.slice(evening.indexOf("export const onRequestPost"));

  assert.match(morningHandler, /const targetDate = today/);
  assert.doesNotMatch(morningHandler, /setDate\(twTime\.getDate\(\) \+ 1\)/);
  assert.match(eveningHandler, /setDate\(twTime\.getDate\(\) \+ 1\)/);
  assert.match(eveningHandler, /fetchFastingAppointments\(env,\s*targetDate\)/);
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
  const calendarView = source.slice(source.indexOf("function CalendarView"), source.indexOf("const MEDICATION_SLOT_OPTIONS"));
  assert.match(source, /downloadAppointmentCalendarFile/);
  assert.match(source, /downloadLocalAppointmentCalendarFile/);
  assert.match(source, /buildGoogleCalendarEventUrl/);
  assert.match(calendarView, /onAddToCalendar/);
  assert.match(calendarView, />\s*加入行事曆\s*</);
  assert.match(calendarView, />\s*加入 Google 行事曆\s*</);
  assert.match(calendarView, />\s*Apple \/ 手機行事曆\s*</);
  assert.match(calendarView, />\s*複製提醒文字\s*</);
  assert.match(calendarView, /event-card-actions[\s\S]*card-corner-calendar/);
  assert.doesNotMatch(calendarView.slice(calendarView.indexOf('<div className="event-card-actions"'), calendarView.indexOf('<div className="event-type">')), /card-corner-edit/);
  assert.match(calendarView, /event-type[\s\S]*event-edit-action/);
  assert.match(calendarView, />\s*新增排程\s*</);
  assert.doesNotMatch(calendarView, />\s*新增提醒\s*</);
});

test("LINE postback reassignment validates source user access before updating records", () => {
  const source = readProjectFile("functions/callback.ts");
  assert.match(source, /getUserMemberships/);
  assert.match(source, /getAccessibleProfiles/);
  assert.match(source, /targetProfile/);
  assert.match(source, /group_id\.in|group_id=in/);
});
