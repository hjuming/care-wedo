import { test } from "node:test";
import assert from "node:assert/strict";

import { buildActivityAudit } from "../_shared/activity_audit";

test("activity audit exposes actor, time, action and summary for shared care changes", () => {
  const result = buildActivityAudit({
    appointments: [
      {
        id: 101,
        type: "clinic_visit",
        title: "神經內科回診",
        date: "2026-08-20",
        time: "14:30",
        created_by_user_id: 7,
        created_at: "2026-07-14T03:00:00.000Z",
      },
      {
        id: 102,
        type: "family_note",
        title: "家庭提醒",
        reminder_text: "記得帶健保卡",
        created_by_user_id: 8,
        created_at: "2026-07-14T04:00:00.000Z",
      },
    ] as any,
    medicationLogs: [
      {
        id: 201,
        medication_id: 301,
        medication_name: "測試降壓",
        status: "taken",
        taken_date: "2026-07-14",
        time_slot: "morning",
        confirmed_by_user_id: 8,
        created_at: "2026-07-14T05:00:00.000Z",
      },
    ],
    userNames: new Map([[7, "林怡"], [8, "陳志"]]),
  });

  assert.deepEqual(result.map((item) => item.action), ["medication_taken", "family_note_created", "appointment_created"]);
  assert.deepEqual(result[0], {
    id: "medication-log-201",
    entity: "medication",
    action: "medication_taken",
    actor_user_id: 8,
    actor_display_name: "陳志",
    occurred_at: "2026-07-14T05:00:00.000Z",
    status: "taken",
    summary: "測試降壓・早",
  });
  assert.equal(result[1].summary, "記得帶健保卡");
  assert.equal(result[2].actor_display_name, "林怡");
});
