import test from "node:test";
import assert from "node:assert/strict";
import { dedupeAppointments } from "./appointmentDedupe.js";

test("dedupeAppointments folds exact legacy duplicates without merging different appointments", () => {
  const result = dedupeAppointments([
    { id: 1, profile_id: 10, type: "clinic_visit", date: "2026-08-18", time: "09:30", title: "心臟內科回診", hospital: "安心醫院", department: "心臟內科" },
    { id: 2, profile_id: 10, type: "clinic_visit", date: "2026-08-18", time: "09:30", title: "心臟內科回診", hospital: "安心醫院", department: "心臟內科" },
    { id: 3, profile_id: 10, type: "clinic_visit", date: "2026-08-18", time: "10:30", title: "心臟內科回診", hospital: "安心醫院", department: "心臟內科" },
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].id, 1);
  assert.equal(result[0].duplicate_count, 2);
  assert.equal(result[1].id, 3);
  assert.equal(result[1].duplicate_count, undefined);
});
