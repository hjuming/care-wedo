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

test("medication completion copy identifies the slot and actor", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");

  assert.match(medicationView, /標記本次已服用/);
  assert.match(medicationView, /操作者/);
  assert.match(medicationView, /recordedAt|taken_at/);
  assert.doesNotMatch(medicationView, /我已吃完/);
});

test("mobile shell prevents long identity text and bottom navigation overlap", () => {
  const nav = readProjectFile("care-wedo-app/src/components/MobileBottomNav.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(nav, /--mobile-nav-count/);
  assert.match(css, /grid-template-columns:\s*repeat\(var\(--mobile-nav-count/);
  assert.match(css, /--mobile-bottom-nav-clearance:\s*116px/);
  assert.match(css, /\.mobile-bottom-nav[\s\S]*padding-bottom:\s*calc\(/);
  assert.match(css, /\.care-shell[\s\S]*padding-bottom:\s*calc\(var\(--mobile-bottom-nav-clearance\)\s*\+\s*env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.account-sub[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.mobile-bottom-nav strong[\s\S]*overflow-wrap:\s*anywhere/);
});

test("mobile controls and profile edit form remain elder-friendly on narrow screens", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-profile-quick-switch select[\s\S]*min-height:\s*48px/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.search-suggestions button[\s\S]*min-height:\s*48px/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.profile-edit-modal \.form-row-two[\s\S]*grid-template-columns:\s*1fr/);
});

test("mobile care context is a compact identity row without repeated account cards", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-context-details\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-context-avatar\s*\{[\s\S]*width:\s*56px[\s\S]*height:\s*56px/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.care-context-copy h2\s*\{[\s\S]*font-size:\s*26px/);
});

test("mobile navigation exposes one care-items entry and keeps search in that workflow", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const mobileSections = app.slice(app.indexOf("const MOBILE_SECTIONS"), app.indexOf("function normalizeAppointment"));
  const overviewView = app.slice(app.indexOf("function OverviewView"), app.indexOf("function appointmentTimeValue"));

  assert.match(mobileSections, /id:\s*"calendar"[\s\S]*mobileLabel:\s*"照護事項"/);
  assert.doesNotMatch(mobileSections, /id:\s*"records"/);
  assert.match(mobileSections, /id:\s*"settings"[\s\S]*mobileLabel:\s*"管理"/);
  assert.doesNotMatch(overviewView, /today-search-panel/);
  assert.match(app, /\["calendar",\s*"records"\]\.includes\(activeSection\)/);
  assert.match(app, /activeSection === "records" \? "calendar" : activeSection/);
  assert.match(app, /mobile-care-items-switch/);
  assert.match(app, /initialMode="history"/);
  assert.match(app, /showFutureMode=\{false\}/);
});

test("medication cards keep complete names readable and collapse non-current periods", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(medicationView, /className="medicine-full-name">\{med\.name \|\| "藥名待確認"\}/);
  assert.doesNotMatch(medicationView, /<span>\{getMedicationShortName\(med\.name\)\}<\/span>/);
  assert.match(medicationView, /expandedSlot/);
  assert.match(medicationView, /className="medicine-slot-toggle"/);
  assert.match(medicationView, /aria-expanded=\{isGroupExpanded\}/);
  assert.match(css, /\.medicine-full-name\s*\{[\s\S]*white-space:\s*normal[\s\S]*overflow-wrap:\s*anywhere/);
});

test("caregivers can preview the simplified elder display without exposing edit actions", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(app, /preferredDisplayMode/);
  assert.match(app, /function CareDisplayModeSwitch/);
  assert.match(app, /照護者模式/);
  assert.match(app, /長輩模式/);
  assert.match(app, /const effectiveReadOnly = readOnly \|\| isElderDisplay/);
  assert.match(app, /const effectiveCanManageCare = canManageCare && !isElderDisplay/);
  assert.match(css, /\.care-display-mode-switch/);
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
