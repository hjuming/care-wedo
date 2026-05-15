import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(import.meta.dirname, "App.jsx"), "utf8");
const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("Dashboard profile switching ignores stale dashboard responses", () => {
  assert.match(appSource, /dashboardRequestSeqRef/);
  assert.match(appSource, /requestSeq !== dashboardRequestSeqRef\.current/);
});

test("Dashboard profile switching keeps a per-profile cache for immediate restoration", () => {
  assert.match(appSource, /dashboardCacheRef/);
  assert.match(appSource, /dashboardCacheRef\.current\.set/);
  assert.match(appSource, /dashboardCacheRef\.current\.get/);
});

test("Dashboard profile switching does not reuse stale care records when a profile has no data", () => {
  const shared = readProjectFile("functions/_shared/supabase.ts");

  assert.match(appSource, /dashboardHasCareData/);
  assert.doesNotMatch(appSource, /cachedProfileData && dashboardHasCareData\(cachedProfileData\) && !dashboardHasCareData\(data\)/);
  assert.match(appSource, /belongsToActiveCareScope/);
  assert.match(appSource, /profile_id/);
  assert.match(shared, /group_id: row\.group_id \|\| null/);
});

test("Dashboard keeps profile shell data separate from profile record data", () => {
  assert.match(appSource, /dashboardShellRef/);
  assert.match(appSource, /mergeDashboardShell/);
});

test("Dashboard supports switching family groups from the today page", () => {
  assert.match(appSource, /activeGroupId/);
  assert.match(appSource, /care_wedo_active_group_id/);
  assert.match(appSource, /function GroupBadge/);
  assert.match(appSource, /frontend\.group_switch/);
});

test("Profile switcher groups care profiles and persists drag order", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  const api = readProjectFile("care-wedo-app/src/services/api.js");
  const shared = readProjectFile("functions/_shared/supabase.ts");
  const orderApi = readProjectFile("functions/api/profiles/order.ts");
  const activeProfileApi = readProjectFile("functions/api/me/active-profile.ts");
  const schema = readProjectFile("supabase/schema.sql");
  const migration = readProjectFile("supabase/migration_phase49_care_profile_sort_order.sql");

  assert.match(schema, /sort_order integer not null default 0/);
  assert.match(schema, /active_profile_id bigint/);
  assert.match(migration, /care_profiles_group_order_idx/);
  assert.match(migration, /active_profile_id bigint/);
  assert.match(shared, /order=group_id\.asc,sort_order\.asc/);
  assert.match(shared, /sort_order: row\.sort_order \|\| 0/);
  assert.match(shared, /getUserActiveProfileId/);
  assert.match(shared, /setProfileOrderInFlags/);
  assert.match(shared, /active_profile:/);
  assert.match(shared, /profile_order:/);
  assert.match(api, /updateProfileOrder/);
  assert.match(api, /updateActiveProfilePreference/);
  assert.match(orderApi, /profile_ids/);
  assert.match(orderApi, /sort_order: \(index \+ 1\) \* 10/);
  assert.match(activeProfileApi, /setUserActiveProfileId/);
  assert.match(appSource, /groupProfilesForSwitcher/);
  assert.match(appSource, /profile-group-section/);
  assert.match(appSource, /persistActiveProfilePreference/);
  assert.match(appSource, /onDragStart/);
  assert.match(appSource, /onPointerDown/);
  assert.match(appSource, /setTimeout\(\(\) => \{/);
  assert.match(css, /\.profile-group-title/);
  assert.match(css, /\.profile-option\.is-drop-target/);
});

test("Mobile care pages keep important Chinese text readable", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /\.record-completed\s*\{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.record-info strong,\n\s*\.record-info span\s*\{[\s\S]*writing-mode: horizontal-tb/);
  assert.match(css, /\.care-tips-grid\s*\{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.invite-copy-head strong\s*\{[\s\S]*font-size: clamp\(28px, 7vw, 40px\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.invite-code-row\s*\{[\s\S]*grid-template-columns: 1fr/);
});

test("iPad portrait uses bottom navigation and keeps the contact dock clear", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1024px\) and \(orientation: portrait\)[\s\S]*\.side-rail\s*\{[\s\S]*display: none/);
  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1024px\) and \(orientation: portrait\)[\s\S]*\.mobile-bottom-nav\s*\{[\s\S]*display: grid/);
  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1024px\) and \(orientation: portrait\)[\s\S]*\.dashboard-grid\s*\{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1024px\) and \(orientation: portrait\)[\s\S]*\.global-care-contact-dock\s*\{[\s\S]*bottom: calc\(104px \+ env\(safe-area-inset-bottom\)\)/);
});

test("iPad landscape search controls stay inside the viewport", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(css, /\.toolbar\s*\{[\s\S]*flex-wrap: wrap/);
  assert.match(css, /\.section-heading-row\s*\{[\s\S]*min-width: 0/);
  assert.match(css, /\.search-box\s*\{[\s\S]*min-width: 0/);
  assert.match(css, /\.search-suggestions\s*\{[\s\S]*repeat\(auto-fit, minmax\(96px, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1080px\) and \(orientation: landscape\)[\s\S]*\.dashboard-grid\s*\{[\s\S]*grid-template-columns: 260px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1080px\) and \(orientation: landscape\)[\s\S]*\.content-area\s*\{[\s\S]*overflow-x: clip/);
  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1080px\) and \(orientation: landscape\)[\s\S]*\.toolbar \.search-box\s*\{[\s\S]*flex-basis: min\(420px, 100%\)/);
});
