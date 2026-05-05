import test from "node:test";
import assert from "node:assert/strict";
import { buildTodayTasks, formatTaipeiTodayLabel } from "./todayTasks.js";

test("buildTodayTasks turns same-day appointments and medications into elder-friendly tasks", () => {
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
    { kind: "medication", title: "降血壓藥", time: "中午飯後", primaryActionLabel: "我吃了" },
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
    date: "5 月 6 日（三）",
  });
});
