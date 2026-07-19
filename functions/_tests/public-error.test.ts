import assert from "node:assert/strict";
import test from "node:test";

import { resolvePublicApiError } from "../_shared/public_error";

test("internal provider errors are replaced with a stable public message", () => {
  const result = resolvePublicApiError(
    new Error("relation users.active_profile_id does not exist; service_role=secret"),
    { fallback: "無法更新目前照護對象" },
  );

  assert.deepEqual(result, { message: "無法更新目前照護對象", status: 500 });
});

test("authentication and explicitly mapped user errors keep a useful status without raw details", () => {
  assert.deepEqual(
    resolvePublicApiError(new Error("請先登入：JWT expired at 2026-07-19"), { fallback: "操作失敗" }),
    { message: "請先登入", status: 401 },
  );

  assert.deepEqual(
    resolvePublicApiError(new Error("沒有修改權限: policy internal_name"), {
      fallback: "操作失敗",
      rules: [{ pattern: /沒有修改權限/, message: "沒有修改權限", status: 403 }],
    }),
    { message: "沒有修改權限", status: 403 },
  );
});

test("only an explicitly trusted validation message may be returned verbatim", () => {
  const result = resolvePublicApiError(new Error("單一文件不可超過 25MB。"), {
    fallback: "文件上傳失敗",
    rules: [{ pattern: /^單一文件不可超過 25MB。$/, preserveMessage: true, status: 400 }],
  });

  assert.deepEqual(result, { message: "單一文件不可超過 25MB。", status: 400 });
});
