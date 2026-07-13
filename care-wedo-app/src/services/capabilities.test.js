import test from "node:test";
import assert from "node:assert/strict";

import { deriveCareCapabilities } from "./capabilities.js";

test("explicit read-only membership removes management capabilities", () => {
  assert.deepEqual(
    deriveCareCapabilities({
      current_membership: { role: "member", can_manage: false },
      capabilities: { can_manage_care: false, can_complete_medication: false },
    }),
    { hasMembership: true, canManageCare: false, canCompleteMedication: false, readOnly: true },
  );
});

test("admin or manager membership can manage care", () => {
  assert.equal(deriveCareCapabilities({ current_membership: { role: "admin", can_manage: false } }).canManageCare, true);
  assert.equal(deriveCareCapabilities({ current_membership: { role: "member", can_manage: true } }).canManageCare, true);
});

test("legacy demo payload without membership keeps existing editable behavior", () => {
  assert.deepEqual(deriveCareCapabilities({}), {
    hasMembership: false,
    canManageCare: true,
    canCompleteMedication: true,
    readOnly: false,
  });
});

test("authenticated setup payload without a membership is not trapped in read-only mode", () => {
  assert.equal(deriveCareCapabilities({ active_membership: null, capabilities: { can_manage_care: false } }).readOnly, false);
  assert.equal(deriveCareCapabilities({ active_membership: null, capabilities: { can_manage_care: false } }).canManageCare, true);
});
