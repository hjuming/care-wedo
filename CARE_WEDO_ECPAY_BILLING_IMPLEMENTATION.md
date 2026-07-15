# Care WEDO 綠界金流串接實作紀錄

最後更新：2026-07-15（Asia/Taipei）

本文件記錄 Care WEDO 與 WEDO 中央金流（WEDOPR）串接綠界 ECPay 的實作方式、驗證結果與後續注意事項，供後續開發者、維運人員與其他 WEDO 專案複用。

## 1. 交付狀態

已完成程式串接與本機／函式測試；Phase 62 身分預設與 Phase 63 訂閱自助管理 migration 已在當日 SQL Editor 成功執行（`Success. No rows returned`）。不同 staging／production 專案仍需各自確認 migration 與 Cloudflare env。

已驗證的正式付款流程：

- 綠界信用卡定期定額付款頁可正常開啟。
- 可完成手機驗證與付款。
- 綠界成功通知信可收到交易資料。
- 使用者返回流程由 Care WEDO 以 server-side billing event 判斷，不以瀏覽器結果頁直接開通權益。

## 2. 架構與責任邊界

```text
Care WEDO browser
  │ 只接收中央 gateway 回傳的付款 form，不保存卡號
  ▼
Care WEDO Functions
  │ HMAC-SHA256
  ▼
WEDOPR Central Billing Gateway
  │ 綠界 HashKey / HashIV 只存在這裡
  ▼
ECPay checkout / recurring action
  │ server callback + period callback
  ▼
WEDOPR 標準化事件 → Care WEDO /api/billing/webhook
```

核心原則：

1. 子專案不保存綠界 `HashKey`、`HashIV` 或卡號。
2. 子專案與中央 gateway 之間使用 HMAC 簽章與 timestamp 防重放。
3. 綠界 `CheckMacValue` 由中央 gateway 驗證。
4. 使用者看到的 `OrderResultURL` 只代表付款頁返回，不代表付款已入帳。
5. 只有已驗證、具 idempotency 的 server callback 才能將訂閱推進為 `active`。

## 3. Care WEDO API

| 端點 | 方法 | 用途 |
|---|---|---|
| `/api/billing/checkout` | POST | 驗證付款權限、計算新月費、向 WEDOPR 建立綠界定期定額 checkout |
| `/api/billing/webhook` | POST | 接收 WEDOPR HMAC webhook，驗證付款事件並更新訂閱／帳單 |
| `/api/billing/status` | GET | 付款返回後，以 request id 查詢付款是否已由 webhook 入帳 |
| `/api/billing/cancel` | POST | 由管理者／付款負責人停止綠界下期續扣 |
| `/api/billing/history` | GET | 群組成員查詢群組範圍內的帳單與付款事件 |

中央 WEDOPR API：

| 端點 | 方法 | 用途 |
|---|---|---|
| `/api/billing/checkout` | POST | 產生綠界付款表單 |
| `/api/billing/subscription/cancel` | POST | 呼叫綠界 `CreditCardPeriodAction` 的 `Cancel` |
| `/api/billing/ecpay/return` | POST | 綠界一般付款返回 |
| `/api/billing/ecpay/period-return` | POST | 綠界定期定額扣款通知 |

## 4. 訂閱生命週期

```text
checkout_created
  → checkout_pending（尚未給付費權益）
  → payment_succeeded（server callback）
  → active
  → cancel_at_period_end（停止下期續扣，本期仍可用）
  → canceled（本期到期後不再提供付費權益）
```

付款失敗不可刪除照護資料，只能依訂閱狀態限制新增付費資源。所有 provider event 必須具備 `provider_event_id` 或等效去重依據，重送 callback 必須是安全 no-op。

## 5. 月費增加與減少

### 增加照護對象／協作者

ECPay 定期定額合約不可直接靜默改金額，因此採換約策略：

1. Care 計算新的人數與新月費。
2. 向中央 gateway 建立新金額的定期定額付款。
3. 新付款的 server callback 成功後，中央 gateway 呼叫 ECPay `Cancel` 終止舊合約。
4. Care webhook 寫入新的 provider merchant trade number、月費快照與付款事件。
5. 若新付款失敗，舊合約不動，避免使用者失去原本服務。

### 減少照護對象／協作者

ECPay 官方定期定額操作目前適合重新授權或取消，沒有安全的既有合約「直接改低金額」操作。因此目前後端會阻擋會降低已付款金額的移除成員操作，避免綠界仍以舊金額扣款。

後續正式方案應採：

1. 記錄下期降價意圖與新月費。
2. 取消原合約，保留本期服務。
3. 目前週期到期後，請使用者重新授權較低金額的新合約。
4. 以新合約成功事件作為新月費生效點。

不要在沒有新合約成功、沒有退款政策與沒有週期邊界的情況下，直接修改本地金額。

### 取消與退款要分開

- 取消訂閱：停止未來續扣，不代表退還本期已付款。
- 退款／退刷：處理已完成的付款交易，通常需要商戶後台或獨立退款流程。
- 使用者介面目前明確提示「本期仍可使用，已扣款不會自動退款」。

## 6. 資料庫 migration

### Phase 62：身分預設

檔案：`supabase/migrations/20260714165437_phase62_identity_profile_defaults.sql`

用途：將 `care_profiles.display_name` 的資料庫備援預設改為 `照護對象`。正常建立流程仍優先使用註冊者名稱與頭像；此 migration 不會修改既有資料。

查核：

```sql
select column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'care_profiles'
  and column_name = 'display_name';
```

預期：`'照護對象'::text`

### Phase 63：訂閱自助管理

檔案：`supabase/migrations/20260714214305_phase63_billing_self_service.sql`

新增／補強：

- `billing_subscriptions.provider`
- `provider_merchant_trade_no`
- `provider_trade_no`
- `cancel_at_period_end`
- `canceled_at`
- `cancel_reason`
- provider reference 與群組付款事件索引

套用後應以唯讀 SQL 確認欄位存在，並確認不同環境的 project ref 沒有混用。

## 7. 需要設定的環境變數

文件只記名稱，不記錄任何 secret 值：

Care WEDO：

- `WEDO_BILLING_CHECKOUT_SECRET`
- `WEDO_BILLING_SUBSCRIPTION_CANCEL_URL`（選填；未設定時使用 WEDOPR production endpoint）
- `WEDO_BILLING_CHECKOUT_URL`（選填）
- `CARE_WEDO_PUBLIC_BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

WEDOPR 中央金流：

- `WEDO_BILLING_ENABLED`
- `WEDO_BILLING_GATEWAY_SECRET`
- `WEDO_BILLING_BASE_URL`
- `ECPAY_ENV`
- `ECPAY_MERCHANT_ID`
- `ECPAY_HASH_KEY`
- `ECPAY_HASH_IV`
- `CARE_WEDO_BILLING_WEBHOOK_URL`
- `CARE_WEDO_BILLING_WEBHOOK_SECRET`

所有 secret 只能放在 Cloudflare Pages／Functions 的加密環境變數，不可寫入 README、migration、前端 bundle 或 commit。

## 8. 驗證清單與證據

2026-07-15 完成：

- Care WEDO Functions：59/59 tests passed。
- Care WEDO 前端：198/198 tests passed。
- Care TypeScript typecheck passed。
- Care ESLint、stylelint passed。
- WEDOPR ECPay tests：7/7 passed。
- WEDOPR TypeScript typecheck passed。
- 實際綠界小額付款完成，收到手機驗證並收到交易成功通知信。
- 綠界後台退刷已由商戶完成；程式端取消續扣與退款仍視為兩個不同流程。

建議每次部署後至少驗證：

1. 付款成功：新訂閱為 `active`，照護動作只執行一次。
2. 付款失敗：不開通新權益，原訂閱維持。
3. 瀏覽器返回早於 webhook：畫面顯示同步中，稍後查詢可得到正確狀態。
4. 停止下期續扣：中央 ECPay action 成功後本地才寫 `cancel_at_period_end`。
5. 交易紀錄：成員只能讀取自己所屬群組，不能跨群組查詢。
6. 新增／減少協作者：增加走換約，減少不允許靜默降低金額。

## 9. 其他 WEDO 專案複用方式

新專案不應複製 Care 的綠界 HashKey／HashIV，也不應自己建立第二套付款 callback。建議流程：

1. 在 WEDOPR `shared/billing/gateway.ts` 登記 project code、允許返回網域與 merchant trade prefix。
2. 子專案實作自己的 entitlement、權限檢查與群組／訂單 snapshot。
3. 子專案以 HMAC 呼叫中央 `/api/billing/checkout`。
4. 中央 gateway 產生綠界表單與標準化 callback。
5. 子專案提供 HMAC 驗證的 `/api/billing/webhook`，以 provider event idempotency 更新自己的帳務表。
6. 取消續扣一律由中央 gateway 呼叫 ECPay Period Action；子專案只保存狀態與 provider reference。
7. 付款返回頁只顯示結果，不直接寫入付費權益。

可複用的核心程式：

- WEDOPR：`shared/billing/ecpay.ts`
- WEDOPR：`shared/billing/gateway.ts`
- WEDOPR：`functions/_billing/ecpay-gateway.ts`
- Care 參考：`functions/_shared/billing_webhook.ts`
- Care 參考：`functions/api/billing/checkout.ts`
- Care 參考：`functions/api/billing/cancel.ts`

## 10. 已知限制與後續工作

- 減價訂閱尚未提供自助排程換約 UI，目前採後端安全阻擋。
- 退款／退刷尚未開放給一般使用者自助操作，仍由商戶後台或獨立人工流程處理。
- 邀請協作者時會先保留一個計費席位；邀請未接受時，後續應補邀請過期／釋放席位機制。
- migration 與 Cloudflare env 必須分別在 staging、production 核對，不可只驗其中一個環境。
