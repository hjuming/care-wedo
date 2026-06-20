# Changeset — Auth 統一 / Reminder 模式 / CI gate（待工程師確認後部署）

日期：2026-06-20
範圍：P0-1 auth 統一、P0-2 跨戶隔離測試、P0-3 reminder 模式、P1-4 CI gate。
**未改動前端任何 source；未改動 DB schema。**

## P0-1 統一 API 身份模型
所有 protected data API 改走既有的 `getAuthenticatedUser()`（= `verifyCareIdentity` + `getOrCreateUserFromIdentity`，同時支援 LINE 與 Supabase/Google），不再各自呼叫 LINE-only 的 `verifyLineIdToken()`，也不再經過會落到共用 `web-mvp` 帳號的 `getOrCreateDefaultUser(env, identity?.lineUserId)`。

改動檔案（12）：
- `functions/api/medications/taken.ts`、`functions/api/medications/[id].ts`、`functions/api/medications/[id]/taken.ts`
- `functions/api/appointments.ts`、`functions/api/appointments/[id].ts`、`functions/api/appointments/[id]/calendar.ics.ts`
- `functions/api/ocr/confirm.ts`、`functions/api/ocr/[[path]].ts`
- `functions/api/me/active-profile.ts`、`functions/api/profiles/[id].ts`、`functions/api/profiles/order.ts`
- `functions/_shared/care_documents.ts`

效果：Google/Supabase 登入者現在能在 OCR、新增/編輯預約、用藥確認、文件、profile 排序、active-profile 等寫入端正常解析到**自己的** userId（先前會被 LINE verifier 擋掉或落到共用帳號）。

未改動（刻意保留 LINE 驗證）：`functions/api/session.ts`、`functions/api/session/handoff.ts`（LINE 登入建立流程）、`functions/callback.ts`（LINE webhook，使用 `event.source.userId`）。

注意（後續可再優化，非本次範圍）：`_middleware.ts` 仍會先用 `verifyCareIdentity` 驗一次，handler 再經 `getAuthenticatedUser` 驗一次 → 每請求仍有重複驗證。若要消除，可讓 middleware 解析出 `userId` 並掛到 `context.data`，handler 直接取用。本次未動，避免擴大風險面。

## P0-2 跨戶隔離負向測試（真跑 handler）
新增 `functions/_tests/tenant-isolation.test.ts`：用 mock 過的 fetch（LINE verify + Supabase REST）真實驅動 `medications/[id]` 的 `onRequestPatch`：
- 跨群組的藥物 → 403，且**不會發出任何寫入**。
- 自己群組的藥物 → 200，寫入有送達。
新增 root script：`npm run test:functions`（用 tsx 跑）。

另新增 `care-wedo-app/src/auth-unification-regression.test.js`（source guard）：
- 任何 `functions/api/**` 的 protected route 不得直接呼叫 `verifyLineIdToken`（白名單僅 session.ts / session/handoff.ts）。
- 指定寫入端必須 import `getAuthenticatedUser`。
- reminder cron 必須是 `=== "1"` 的 opt-in 測試模式。

## P0-3 reminder 改 opt-in 測試模式
`functions/api/cron/reminders.ts` 與 `evening.ts`：
- `const testOnly = env.REMINDER_TEST_ONLY === "1";`（原本是 `!== "0"`，未設定就默默只送測試帳號）。
- 加 `cron.reminders_mode` / `cron.evening_mode` log（`test_only` 布林）方便上線後核對。
- 文件補充：`README.md`（環境變數）、`PRODUCTION_TEST_SCRIPT.md`（上線檢查表）。

**部署前務必確認 Cloudflare 沒有殘留 `REMINDER_TEST_ONLY`，或其值為 `0`。**

## P1-4 CI gate
`.github/workflows/deploy.yml`：deploy 前新增 Lint → Test（前端 + regression）→ Test（functions 隔離）→ receipt-pack 驗證；任一失敗即不部署。
- 測試步驟設 `TZ: Asia/Taipei`（GitHub runner 預設 UTC 會讓 todayTasks 的日期斷言偏一天）。

## 本機驗證結果（sandbox）
- 前端 + regression：`node --test` → **162/162 pass**（`TZ=Asia/Taipei`；新加 4 條 guard）。
- functions 隔離測試：**2/2 pass**。
- 全部改動的 .ts 模組：transpile + import smoke 全綠。
- `receipt-pack:check`：OK（10 cases / 5 types / 5 scenarios）。
- 新測試檔 eslint：clean。

## 沒能在 sandbox 驗的（請工程師於 CI/本機確認）
- `vite build`：sandbox 的 esbuild 是 macOS 版、跑不起來；但**本次未動任何前端 source**，build 不受影響，CI 會跑。
- 未實打 production API、未看 Cloudflare 實際 env、未做 LINE/Google 實機登入截圖。建議上線前在 staging 用一個 Google 帳號實測 OCR + 新增預約 + 用藥確認三條寫入路徑。
