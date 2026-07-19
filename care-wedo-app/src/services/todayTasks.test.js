import test from "node:test";
import assert from "node:assert/strict";
import * as todayTasksModule from "./todayTasks.js";
import * as careFormattersModule from "../features/shared/careFormatters.js";

const {
  buildTodayTasks,
  formatTaipeiTodayLabel,
  getMedicationSchedule,
  groupMedicationsBySchedule,
} = todayTasksModule;

test("findNextAppointment skips the care item already shown on today's timeline", () => {
  assert.equal(typeof todayTasksModule.findNextAppointment, "function");
  const appointments = [
    { id: 1, date: "2026-07-18", time: "15:30", status: "upcoming" },
    { id: 2, date: "2026-07-25", time: "09:00", status: "upcoming" },
  ];
  const visibleTasks = buildTodayTasks({ today: "2026-07-18", appointments });

  assert.equal(todayTasksModule.findNextAppointment({
    today: "2026-07-18",
    appointments,
    visibleTasks,
  })?.id, 2);
});

test("formatDoctorName adds one doctor suffix without repeating an existing title", () => {
  assert.equal(typeof careFormattersModule.formatDoctorName, "function");
  assert.equal(careFormattersModule.formatDoctorName("陳"), "陳醫師");
  assert.equal(careFormattersModule.formatDoctorName("陳醫師"), "陳醫師");
  assert.equal(careFormattersModule.formatDoctorName(""), "");
});

test("sortUpcomingAppointments keeps the nearest date and time first even when API data is unordered", () => {
  assert.equal(typeof careFormattersModule.sortUpcomingAppointments, "function");
  const appointments = [
    { id: 4, date: "2026-07-25", time: "09:00", status: "upcoming" },
    { id: 2, date: "2026-07-18", time: "14:00", status: "upcoming" },
    { id: 1, date: "2026-07-18", time: "09:00", status: "upcoming" },
    { id: 3, date: "2026-07-18", time: "", status: "upcoming" },
    { id: 5, date: "2026-07-17", time: "09:00", status: "completed" },
  ];

  assert.deepEqual(
    careFormattersModule.sortUpcomingAppointments(appointments, "2026-07-18").map((item) => item.id),
    [1, 2, 3, 4],
  );
});

test("buildTodayTasks turns same-day care events into elder-friendly tasks without medicine detail", () => {
  const tasks = buildTodayTasks({
    today: "2026-05-06",
    appointments: [
      {
        id: 1,
        type: "clinic_visit",
        date: "2026-05-06",
        time: "09:30",
        hospital: "示範醫院",
        department: "心臟內科",
        doctor: "王醫師",
        status: "upcoming",
      },
      {
        id: 2,
        type: "clinic_visit",
        date: "2026-05-07",
        time: "10:00",
        hospital: "示範醫院",
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
        hospital: "示範醫院",
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

test("buildTodayTasks leaves future appointments out of today's tasks", () => {
  const appointments = [
    {
      id: 25,
      type: "clinic_visit",
      date: "2026-07-25",
      time: "09:00",
      hospital: "示範醫院",
      department: "眼科",
      status: "upcoming",
    },
  ];
  const tasks = buildTodayTasks({
    today: "2026-07-19",
    appointments,
  });

  assert.deepEqual(tasks, []);
  assert.equal(todayTasksModule.findNextAppointment({
    today: "2026-07-19",
    appointments,
    visibleTasks: tasks,
  })?.id, 25);
});

test("buildTodayTasks uses reminder title without overwriting department", () => {
  const tasks = buildTodayTasks({
    today: "2026-05-27",
    appointments: [
      {
        id: 3,
        type: "clinic_visit",
        title: "牙醫回診",
        department: "回診",
        hospital: "九大牙醫",
        doctor: "林昀蓉",
        date: "2026-05-27",
        time: "13:30",
        status: "upcoming",
      },
    ],
  });

  assert.equal(tasks[0].title, "牙醫回診");
  assert.match(tasks[0].subtitle, /九大牙醫/);
});

test("buildTodayTasks shows group family notes on the today page", () => {
  const tasks = buildTodayTasks({
    today: "2026-05-06",
    appointments: [
      {
        id: 10,
        type: "family_note",
        date: null,
        hospital: "家庭提醒",
        department: "家庭提醒",
        reminder_text: "哪些藥不能吃、以前有沒有過敏",
        status: "upcoming",
      },
    ],
  });

  assert.deepEqual(tasks.map((task) => ({
    kind: task.kind,
    label: task.label,
    title: task.title,
    time: task.time,
    detail: task.detail,
    primaryActionLabel: task.primaryActionLabel,
    canComplete: task.canComplete,
    isToday: task.isToday,
  })), [
    {
      kind: "appointment",
      label: "家庭提醒",
      title: "家庭提醒",
      time: "每天留意",
      detail: "哪些藥不能吃、以前有沒有過敏",
      primaryActionLabel: null,
      canComplete: false,
      isToday: true,
    },
  ]);
});

test("formatTaipeiTodayLabel returns a large-date friendly label", () => {
  assert.deepEqual(formatTaipeiTodayLabel("2026-05-06"), {
    headline: "今天",
    date: "5月6日（三）",
    fullDate: "2026年5月6日（星期三）",
  });
});

test("getMedicationSchedule infers meal timing from supporting text while preserving an explicit value", () => {
  const schedules = [
    getMedicationSchedule({ time_slot: "morning", frequency: "早餐後" }),
    getMedicationSchedule({ time_slot: "morning", reminder_text: "早餐前服用" }),
    getMedicationSchedule({ time_slot: "morning", frequency: "早餐後", meal_timing: "before_meal" }),
  ];

  assert.deepEqual(schedules.map((schedule) => schedule.mealTimingLabel), ["飯後", "飯前", "飯前"]);
});

test("getMedicationSchedule preserves explicit Chinese meal timing over inferred text", () => {
  const schedules = [
    getMedicationSchedule({ meal_timing: "飯前", frequency: "早餐後" }),
    getMedicationSchedule({ meal_timing: "飯後" }),
  ];

  assert.deepEqual(schedules.map((schedule) => schedule.mealTimingLabel), ["飯前", "飯後"]);
});

test("getMedicationSchedule preserves a normalized backend time and meal label", () => {
  const schedule = getMedicationSchedule({
    time_slot: "morning",
    frequency: "早餐後",
    schedule: {
      timeLabel: "早上 08:00",
      mealTimingLabel: "早餐後",
    },
  });

  assert.equal(schedule.timeLabel, "早上 08:00");
  assert.equal(schedule.mealTimingLabel, "早餐後");
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
    { label: "中", names: [], mealTiming: [] },
    { label: "晚", names: ["胃藥"], mealTiming: ["飯前"] },
    { label: "睡前", names: [], mealTiming: [] },
    { label: "其他", names: [], mealTiming: [] },
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
    { slot: "noon", medicationIds: [] },
    { slot: "evening", medicationIds: [] },
    { slot: "bedtime", medicationIds: [3] },
    { slot: "other", medicationIds: [] },
  ]);
});

test("groupMedicationsBySchedule supports shorthand and clock-time slots", () => {
  const groups = groupMedicationsBySchedule([
    { id: 1, name: "早中晚藥", frequency: "早、中、晚", active: true },
    { id: 2, name: "八點半藥", scheduled_time: "08:37", active: true },
    { id: 3, name: "睡前藥", reminder_text: "睡前服用", active: true },
  ]);

  const bySlot = Object.fromEntries(groups.map((group) => [group.slot, group.medicationIds]));
  assert.deepEqual(bySlot.morning, [1, 2]);
  assert.deepEqual(bySlot.noon, [1]);
  assert.deepEqual(bySlot.evening, [1]);
  assert.deepEqual(bySlot.bedtime, [3]);
});

test("groupMedicationsBySchedule lets an explicit medication time slot override OCR text", () => {
  const groups = groupMedicationsBySchedule([
    {
      id: 1,
      name: "手動改早上的藥",
      time_slot: "morning",
      frequency: "晚餐後",
      reminder_text: "睡前服用",
      active: true,
    },
  ]);

  const bySlot = Object.fromEntries(groups.map((group) => [group.slot, group.medicationIds]));
  assert.deepEqual(bySlot.morning, [1]);
  assert.deepEqual(bySlot.evening, []);
  assert.deepEqual(bySlot.bedtime, []);
});
