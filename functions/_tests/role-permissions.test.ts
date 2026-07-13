import test from "node:test";
import assert from "node:assert/strict";

import { manageableGroupIds, assertGroupWriteAccess } from "../_shared/group_permissions";

const memberships = [
  { user_id: 7, group_id: 10, role: "member", can_manage: false },
  { user_id: 7, group_id: 20, role: "member", can_manage: true },
  { user_id: 7, group_id: 30, role: "admin", can_manage: false },
];

test("elder membership is read-only while manager and admin memberships can write", () => {
  assert.deepEqual(manageableGroupIds(memberships), [20, 30]);
  assert.throws(() => assertGroupWriteAccess(memberships, 10), /沒有修改權限/);
  assert.doesNotThrow(() => assertGroupWriteAccess(memberships, 20));
  assert.doesNotThrow(() => assertGroupWriteAccess(memberships, 30));
});
