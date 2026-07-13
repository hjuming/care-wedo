import test from "node:test";
import assert from "node:assert/strict";

import { medicationMutationErrorMessage } from "./medicationFeedback.js";

test("403 medication mutation explains that the record was not saved", () => {
  const error = new Error("沒有修改權限");
  error.status = 403;
  assert.equal(medicationMutationErrorMessage(error), "目前帳號只有查看權限，這次沒有記錄成功。");
});

test("unknown medication mutation errors remain actionable", () => {
  assert.equal(medicationMutationErrorMessage(new Error("網路逾時")), "網路逾時");
});
