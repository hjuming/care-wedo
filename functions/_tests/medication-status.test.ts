import assert from "node:assert/strict";
import test from "node:test";

import { resolveLatestMedicationSlotStatus } from "../_shared/medication_status";

test("a newer forgotten log clears an earlier taken record for the same medication slot", () => {
  const result = resolveLatestMedicationSlotStatus([
    { id: 11, status: "taken", time_slot: "morning", created_at: "2026-07-19T01:00:00.000Z" },
    { id: 12, status: "forgotten", time_slot: "morning", created_at: "2026-07-19T01:05:00.000Z" },
  ]);

  assert.deepEqual(result.takenSlots, []);
  assert.equal(result.latestTakenLog, null);
});

test("correcting one slot does not clear another slot that is still recorded as taken", () => {
  const result = resolveLatestMedicationSlotStatus([
    { id: 21, status: "taken", time_slot: "morning", created_at: "2026-07-19T01:00:00.000Z" },
    { id: 22, status: "forgotten", time_slot: "morning", created_at: "2026-07-19T01:05:00.000Z" },
    { id: 23, status: "taken", time_slot: "evening", created_at: "2026-07-19T01:10:00.000Z" },
  ]);

  assert.deepEqual(result.takenSlots, ["evening"]);
  assert.equal(result.latestTakenLog?.id, 23);
});
