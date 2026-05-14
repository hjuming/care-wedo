import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(import.meta.dirname, "App.jsx"), "utf8");

test("Dashboard profile switching ignores stale dashboard responses", () => {
  assert.match(appSource, /dashboardRequestSeqRef/);
  assert.match(appSource, /requestSeq !== dashboardRequestSeqRef\.current/);
});

test("Dashboard profile switching keeps a per-profile cache for immediate restoration", () => {
  assert.match(appSource, /dashboardCacheRef/);
  assert.match(appSource, /dashboardCacheRef\.current\.set/);
  assert.match(appSource, /dashboardCacheRef\.current\.get/);
});

test("Dashboard profile switching does not overwrite populated profile data with an empty response", () => {
  assert.match(appSource, /dashboardHasCareData/);
  assert.match(appSource, /cachedProfileData && dashboardHasCareData\(cachedProfileData\) && !dashboardHasCareData\(data\)/);
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
