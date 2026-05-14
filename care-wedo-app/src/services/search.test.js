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
  ]);

  assert.equal(suggestions.includes("示範醫院"), true);
  assert.equal(suggestions.includes("復健科"), true);
  assert.equal(suggestions.includes("陳安心"), true);
  assert.equal(suggestions.includes("領藥"), true);
});
