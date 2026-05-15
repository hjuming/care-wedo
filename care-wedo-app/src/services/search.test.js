import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchSuggestions, matchSearch } from "./search.js";

test("matchSearch supports full-text fuzzy matching across uploaded care fields", () => {
  const item = {
    hospital: "示範醫院",
    department: "復健科",
    doctor: "陳安心",
    reminder_text: "回診前先領藥，帶健保卡與檢查單",
  };

  assert.equal(matchSearch(item, "示範"), true);
  assert.equal(matchSearch(item, "復健 陳"), true);
  assert.equal(matchSearch(item, "示醫"), true);
  assert.equal(matchSearch(item, "領藥"), true);
  assert.equal(matchSearch(item, "牙科"), false);
});

test("buildSearchSuggestions extracts useful uploaded-data keywords first", () => {
  const suggestions = buildSearchSuggestions([
    {
      type: "refill_reminder",
      hospital: "示範醫院",
      department: "復健科",
      doctor: "陳安心",
      reminder_text: "記得領藥",
    },
    {
      type: "clinic_visit",
      hospital: "示範醫院",
      department: "家醫科",
      doctor: "林照護",
    },
  ], 12);
  const labels = suggestions.map((item) => item.label);

  assert.equal(labels.includes("示範醫院"), true);
  assert.equal(labels.includes("復健科"), true);
  assert.equal(labels.includes("陳安心"), true);
  assert.equal(labels.includes("領藥"), true);
  assert.equal(labels.includes("記得領藥"), false);
});

test("buildSearchSuggestions keeps six tags and shows future counts", () => {
  const suggestions = buildSearchSuggestions([
    { type: "clinic_visit", hospital: "台大醫院", department: "內科", date: "2026-06-01" },
    { type: "clinic_visit", hospital: "台大醫院", department: "內科", date: "2026-06-03" },
    { type: "inspection", hospital: "台大醫院", department: "檢查中心", date: "2026-06-05" },
    { type: "refill_reminder", hospital: "藥局", department: "領藥", date: "2026-06-07" },
    { type: "document", hospital: "歷史醫院", department: "眼科", date: "2025-01-01", status: "completed" },
    { type: "rehab", hospital: "復健診所", department: "復健科", date: "2025-02-01", status: "completed" },
    { type: "exercise", hospital: "運動中心", department: "運動", date: "2025-03-01", status: "completed" },
  ], 6, "2026-05-15");

  assert.equal(suggestions.length, 6);
  assert.deepEqual(suggestions[0], { label: "台大醫院", count: 3 });
  assert.equal(suggestions.some((item) => item.label === "門診" && item.count === 2), true);
});

test("buildSearchSuggestions ranks history when no future records exist but displays zero", () => {
  const suggestions = buildSearchSuggestions([
    { type: "clinic_visit", hospital: "歷史醫院", department: "內科", date: "2025-01-01", status: "completed" },
    { type: "clinic_visit", hospital: "歷史醫院", department: "內科", date: "2025-01-02", status: "completed" },
    { type: "inspection", hospital: "檢查中心", department: "檢查", date: "2025-01-03", status: "completed" },
  ], 6, "2026-05-15");

  assert.equal(suggestions[0].label, "歷史醫院");
  assert.equal(suggestions[0].count, 0);
});
