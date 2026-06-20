# Care WEDO Subscription State Machine

> 最後更新：2026-06-20
> 狀態：設計合約 + pure transition helper / unit tests；尚未接正式付款按鈕、金流 provider 或 webhook。
> 原則：先定狀態機與資料不變條件，再實作 migration / webhook / checkout UI。

## 1. 現況事實

| 事實 | 依據 |
|---|---|
| Billing foundation 已存在 | `billing_subscriptions`、`billing_events`、`invoices` 已在 phase55 migration / `supabase/schema.sql` |
| 目前仍是 Beta / no-charge | `recordBillingGroupEvent()` 會寫 subscription snapshot 與 draft invoice，但不收款 |
| 方案計算已有後端來源 | `resolveGroupBillingEntitlement()` 計算照護對象數、共同協作者數、估算月費與上限 |
| 正式金流尚未接 | 目前前端只有費用確認與方案說明，沒有 checkout / paymentIntent / 信用卡付款 flow |
| Pure state helper 已存在 | `functions/_shared/subscription_state.ts` 定義狀態、事件、side effects、idempotency key contract 與 `transitionSubscriptionState()` |
| State helper 已有 unit tests | `functions/_tests/subscription-state.test.ts` 覆蓋合法 transition、非法 transition、checkout pending 不擴權、provider webhook idempotency key 與 no-op entitlement/retry 事件 |

## 2. 狀態定義

`billing_subscriptions.status` 只能由狀態機改變。不要在任意 handler 直接改字串。

| State | 意義 | 權益 | 可進入原因 | 可離開原因 |
|---|---|---|---|---|
| `beta` | 測試期，不收款 | 依 Care Circle beta 權益 | 建立群組、目前既有狀態 | 正式啟用收款，使用者建立 checkout |
| `checkout_pending` | 已建立付款意圖，尚未完成付款 | 維持原權益，不因 pending 加權益 | 使用者按升級或正式啟用 | `payment_succeeded`、`checkout_expired`、`checkout_canceled` |
| `active` | 訂閱有效且當期已付款 | 付費權益可用 | 首次付款成功、續扣成功、past_due 補款成功 | 使用者取消、付款失敗、退款或 chargeback |
| `past_due` | 扣款失敗，仍在寬限期 | 保留讀取與提醒，限制新增付費資源 | `payment_failed` | 補款成功、寬限期結束、取消 |
| `grace_period` | 付款失敗後的最後寬限 | 保留既有資料；新增照護對象/協作者需付款 | past_due 超過第一次重試 | 補款成功、寬限期結束 |
| `suspended` | 寬限結束仍未付款 | 不刪資料；限制付費寫入與新邀請 | `grace_period_expired` | 補款成功、取消 |
| `cancel_at_period_end` | 已取消續訂，當期仍有效 | 到期前維持 active 權益 | 使用者取消續訂 | 到期轉 `canceled`、使用者恢復 |
| `canceled` | 訂閱結束 | 降回 Free / beta 可用權益；資料保留但依方案限制顯示 | 到期取消、checkout 取消、退款確認 | 重新 checkout |

不新增 `deleted` state。醫療資料與帳務資料不可因取消訂閱被硬刪。

## 3. 事件定義

所有狀態轉移都必須寫 `billing_events`，並帶 `before_snapshot` / `after_snapshot`。

| Event | 來源 | 必要欄位 | 作用 |
|---|---|---|---|
| `checkout_created` | 後端 checkout API | `provider`、`provider_checkout_id`、`invoice_id` | `beta/canceled` → `checkout_pending` |
| `checkout_expired` | provider webhook / scheduled job | `provider_event_id` | `checkout_pending` → 原 state 或 `canceled` |
| `payment_succeeded` | provider webhook | `provider_event_id`、`provider_payment_id`、`paid_at` | `checkout_pending/past_due/grace_period/suspended` → `active` |
| `payment_failed` | provider webhook | `provider_event_id`、`failure_code` | `active` → `past_due` |
| `retry_scheduled` | 後端 job | `next_retry_at` | 記錄重試，不一定轉 state |
| `grace_period_started` | 後端 job | `grace_until` | `past_due` → `grace_period` |
| `grace_period_expired` | 後端 job | `grace_until` | `grace_period` → `suspended` |
| `cancel_requested` | 使用者 API | `requested_by_user_id` | `active` → `cancel_at_period_end` |
| `cancel_reverted` | 使用者 API | `requested_by_user_id` | `cancel_at_period_end` → `active` |
| `subscription_canceled` | period-end job / webhook | `canceled_at` | `cancel_at_period_end/suspended` → `canceled` |
| `refund_confirmed` | provider webhook / admin | `provider_refund_id` | 依情境轉 `past_due`、`suspended` 或 `canceled` |
| `entitlement_changed` | 內部事件 | `care_profile_count`、`paid_collaborator_count` | 更新金額快照，不直接代表付款成功 |

## 4. Transition Table

| From | Event | To | 必做動作 |
|---|---|---|---|
| `beta` | `checkout_created` | `checkout_pending` | 建立 `invoice.status=open`；保存 provider checkout id |
| `checkout_pending` | `payment_succeeded` | `active` | `invoice.status=paid`；設定 current period；更新 entitlement snapshot |
| `checkout_pending` | `checkout_expired` | `beta` / `canceled` | `invoice.status=void`；不可授權 paid entitlement |
| `active` | `payment_failed` | `past_due` | `invoice.status=failed` 或 `open`；設定 retry schedule |
| `past_due` | `payment_succeeded` | `active` | 清除 failure / retry；補記 paid invoice |
| `past_due` | `grace_period_started` | `grace_period` | 設定 `grace_until` |
| `grace_period` | `payment_succeeded` | `active` | 恢復付費寫入 |
| `grace_period` | `grace_period_expired` | `suspended` | 鎖新增付費資源，不刪既有醫療資料 |
| `suspended` | `payment_succeeded` | `active` | 恢復權益並寫恢復事件 |
| `active` | `cancel_requested` | `cancel_at_period_end` | 設定 `cancel_at_period_end=true` 與 period end |
| `cancel_at_period_end` | `cancel_reverted` | `active` | 清除 cancel flag |
| `cancel_at_period_end` | `subscription_canceled` | `canceled` | 降回 Free / beta 權益；保留資料 |
| `canceled` | `checkout_created` | `checkout_pending` | 建立新 invoice / checkout |

任何未列出的 transition 預設拒絕，除非新增 migration/test 同步更新本文件。

目前程式合約：

- `transitionSubscriptionState(currentState, event)` 是純函式；不呼叫 provider、不寫 DB、不改前端權益。
- 所有接受的 transition 都回傳 `sideEffects`，由未來 webhook / checkout API 決定如何落到 `billing_subscriptions`、`invoices`、`billing_events`。
- `payment_succeeded`、`payment_failed`、`checkout_expired`、`subscription_canceled`、`refund_confirmed` 屬 provider webhook event，必須有 `provider + providerEventId` 形成 idempotency key，否則 transition 會拒絕。
- `refund_confirmed` 目前刻意拒絕並回 `refund_transition_requires_policy`；正式退款 / chargeback 規則未定前，不讓 helper 自行猜測狀態。

## 5. DB 欄位缺口

正式實作前，需要在 migration 補齊：

| Table | 欄位 | 原因 |
|---|---|---|
| `billing_subscriptions` | `provider`、`provider_customer_id`、`provider_subscription_id` | 對應 LINE Pay / NewebPay / ECPay / Stripe |
| `billing_subscriptions` | `current_period_start`、`current_period_end` | 判斷當期權益與到期取消 |
| `billing_subscriptions` | `grace_until`、`cancel_at_period_end`、`canceled_at` | 支援付款失敗與取消流程 |
| `billing_subscriptions` | `state_version` | 避免 webhook / API 競態覆蓋 |
| `billing_events` | `provider_event_id`、`provider_event_type` | webhook idempotency |
| `billing_events` | `request_id` | API / job 重試去重 |
| `invoices` | `provider_invoice_id`、`provider_payment_id` | 對帳 |
| `invoices` | `status` enum-like contract: `draft/open/paid/failed/void/refunded` | 避免自由字串 |
| `invoices` | `due_at`、`paid_at`、`voided_at`、`refunded_at` | 對帳與客服排查 |

必要索引 / unique：

```sql
-- 概念草案，正式 migration 需 idempotent。
create unique index if not exists billing_events_provider_event_uidx
  on public.billing_events (provider, provider_event_id)
  where provider_event_id is not null;

create unique index if not exists invoices_provider_invoice_uidx
  on public.invoices (provider, provider_invoice_id)
  where provider_invoice_id is not null;
```

## 6. Webhook 規則

1. Webhook 必須先驗簽，再解析 payload。
2. `provider_event_id` 必須 idempotent；重送 webhook 只能回 200，不可重複入帳。
3. Webhook 不直接信任前端金額；金額以後端 entitlement snapshot + provider paid amount 對帳。
4. 付款成功必須同時更新 `billing_subscriptions`、`invoices`、`billing_events`，任一失敗要可重試。
5. 付款失敗不可刪除醫療資料，只能限制新增付費資源與新邀請。
6. Chargeback / refund 必須進事件流，不可人工直接改 status。

## 7. Entitlement Rules

權益判斷只讀後端狀態，不從前端猜。

| State | 可新增照護對象 | 可邀請協作者 | 可查看既有資料 | 備註 |
|---|---|---|---|---|
| `beta` | 可，依 beta 上限 | 可，依 beta 上限 | 可 | 測試期不收款 |
| `checkout_pending` | 不因 pending 擴權 | 不因 pending 擴權 | 可 | 等付款結果 |
| `active` | 可，依付費上限 | 可，依付費上限 | 可 | 正常 |
| `past_due` | 不可新增付費資源 | 不可新增付費協作者 | 可 | 提示補款 |
| `grace_period` | 不可新增付費資源 | 不可新增付費協作者 | 可 | 明確顯示期限 |
| `suspended` | 不可 | 不可 | 可查看基本與最近資料 | 不刪資料 |
| `cancel_at_period_end` | 可，直到 period end | 可，直到 period end | 可 | 顯示到期日 |
| `canceled` | 依 Free / beta 上限 | 依 Free / beta 上限 | 依 Free / beta 規則 | 可重新 checkout |

## 8. 不可變條件

- 醫療資料不能因付款失敗或取消被硬刪。
- `payment_succeeded` 是唯一能把正式收費訂閱轉 `active` 的外部事件。
- `checkout_created` 不等於付款成功，不得開通付費權益。
- `entitlement_changed` 只表示人數或金額快照變了，不代表已付款。
- 所有金額以整數 TWD 儲存，不用浮點數。
- 任何 provider webhook 都不得寫入 token、完整卡號或敏感付款資料。
- 每個 transition 都要有 regression test 或 webhook fixture test。

## 9. 實作順序

1. 補 migration：欄位、索引、enum-like check 或 domain contract。（待做）
2. 補 pure state transition helper：輸入 current state + event，輸出 next state + side effects。（已完成：`functions/_shared/subscription_state.ts`）
3. 補 unit tests：合法 transition、非法 transition、idempotent webhook replay。（已完成：`functions/_tests/subscription-state.test.ts`）
4. 補 provider adapter：先 LINE Pay，其次 NewebPay / ECPay；adapter 只轉 provider payload，不決定商業狀態。（待做）
5. 補 webhook API：驗簽、去重、呼叫 state transition helper。（待做）
6. 補 checkout API / UI：只有 state helper 與 webhook 測試綠了，才放付款按鈕。（待做）
7. 補 staging E2E：checkout → webhook success → entitlement active；payment_failed → grace/suspended。（待做）

## 10. Review Gate

正式付款 PR 若沒有以下項目，不應 merge：

- `SUBSCRIPTION_STATE_MACHINE.md` 同步更新。
- `functions/_shared/subscription_state.ts` 與 `functions/_tests/subscription-state.test.ts` 同步更新。
- migration 有 rollback / idempotent 策略。
- webhook fixture test 覆蓋成功、失敗、重送、取消。
- `billing_events` 有 provider event id 去重。
- 前端沒有直接依付款按鈕點擊開通權益。
- staging E2E 證明 subscription state 與 invoice state 一致。
