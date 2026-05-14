import test from "node:test";
import assert from "node:assert/strict";
import { buildTodayTasks, formatTaipeiTodayLabel, groupMedicationsBySchedule } from "./todayTasks.js";

test("buildTodayTasks turns same-day care events into elder-friendly tasks without medicine detail", () => {
  const tasks = buildTodayTasks({
    today: "2026-05-06",
    appointments: [
      {
        id: 1,
        type: "clinic_visit",
        date: "2026-05-06",
        time: "09:30",
        hospital: "台大醫院",
        department: "心臟內科",
        doctor: "王醫師",
        status: "upcoming",
      },
      {
        id: 2,
        type: "clinic_visit",
        date: "2026-05-07",
        time: "10:00",
        hospital: "台大醫院",
        department: "眼科",
        status: "upcoming",
      },
    ],
    medications: [
      {
        id: 9,
        name: "降血壓藥",
        dosage: "1 顆",
        frequency: "中午飯後",
        active: true,
      },
    ],
  });

  assert.deepEqual(tasks.map((task) => ({
    kind: task.kind,
    title: task.title,
    time: task.time,
    primaryActionLabel: task.primaryActionLabel,
  })), [
    { kind: "appointment", title: "心臟內科", time: "09:30", primaryActionLabel: "我已看診" },
  ]);
});

test("buildTodayTasks keeps undated appointment cards visible for family follow-up", () => {
  const tasks = buildTodayTasks({
    today: "2026-05-06",
    appointments: [
      {
        id: 3,
        type: "inspection",
        date: "",
        hospital: "台大醫院",
        department: "影像醫學部",
        status: "upcoming",
      },
    ],
    medications: [],
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].time, "日期待確認");
  assert.equal(tasks[0].primaryActionLabel, "我已完成");
  assert.equal(tasks[0].needsReview, true);
});

test("formatTaipeiTodayLabel returns a large-date friendly label", () => {
  assert.deepEqual(formatTaipeiTodayLabel("2026-05-06"), {
    headline: "今天",
    date: "2026年05月06日（三）",
  });
});

test("groupMedicationsBySchedule groups active medicines by elder-friendly time slots", () => {
  const groups = groupMedicationsBySchedule([
    {
      id: 1,
      name: "降血壓藥",
      dosage: "1 顆",
      frequency: "早餐後",
      active: true,
    },
    {
      id: 2,
      name: "胃藥",
      dosage: "1 顆",
      time_slot: "evening",
      meal_timing: "before_meal",
      active: true,
    },
    {
      id: 3,
      name: "已停用藥",
      dosage: "1 顆",
      time_slot: "morning",
      active: false,
    },
  ]);

  assert.deepEqual(groups.map((group) => ({
    label: group.label,
    names: group.medications.map((med) => med.name),
    mealTiming: group.medications.map((med) => med.schedule.mealTimingLabel),
  })), [
    { label: "早", names: ["降血壓藥"], mealTiming: ["飯後"] },
    { label: "晚", names: ["胃藥"], mealTiming: ["飯前"] },
  ]);
});

test("groupMedicationsBySchedule exposes slot-level ids for one-tap confirmation", () => {
  const groups = groupMedicationsBySchedule([
    { id: 1, name: "A", time_slot: "morning", active: true },
    { id: 2, name: "B", time_slot: "morning", active: true },
    { id: 3, name: "C", time_slot: "bedtime", active: true },
  ]);

  assert.deepEqual(groups.map((group) => ({
    slot: group.slot,
    medicationIds: group.medicationIds,
  })), [
    { slot: "morning", medicationIds: [1, 2] },
    { slot: "bedtime", medicationIds: [3] },
  ]);
});
