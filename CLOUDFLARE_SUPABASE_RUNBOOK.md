# Care WEDO — Cloudflare + Supabase 部署 Runbook

> **版本**：Phase 3 完工，V1.0 Beta 開發中  
> **最後更新**：2026-05-05

---

## 目標架構

| 層 | 服務 | 說明 |
|---|---|---|
| 前端 | Cloudflare Pages | React + Vite，`care-wedo-app/dist` |
| API | Cloudflare Pages Functions | TypeScript，路徑 `/api/*` |
| 資料庫 | Supabase (PostgreSQL) | RLS 已啟用 |
| OCR | Gemini Vision API | 由 Cloudflare Function 呼叫 |
| 推播 | LINE Messaging API | Push + Reply |
| Cron | GitHub Actions | 每日觸發 `/api/cron/*` |

---

## Supabase 設定

1. 建立 Supabase project。
2. 到 **SQL Editor** 執行 `supabase/schema.sql`。
   - 若是既有資料庫（僅有 Phase 1–2 的 `users`、`appointments`、`medications`），執行 `supabase/migration_add_care_profiles.sql` 補上家庭照護對象欄位。
3. 到 **Project Settings → API** 取得：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

> **重要**：`SUPABASE_SERVICE_ROLE_KEY` 只能放在 Cloudflare 後端環境變數，**絕對不可** 放進前端 `.env`。

---

## Cloudflare Pages 建置設定

| 欄位 | 值 |
|---|---|
| Framework preset | Vite |
| Build command | `cd care-wedo-app && npm ci && npm run build` |
| Build output directory | `care-wedo-app/dist` |
| Root directory | repo root |
| Functions directory | `functions` |

---

## 環境變數清單

### Cloudflare Pages（後端 Functions）

在 **Pages project → Settings → Environment variables** 設定：

```bash
# AI OCR
GOOGLE_API_KEY=<Gemini API Key>
GEMINI_MODEL_NAME=gemini-2.5-flash

# 資料庫
SUPABASE_URL=https://你的-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Service Role Key>

# LINE Bot（Webhook 與推播）
LINE_CHANNEL_ACCESS_TOKEN=<Messaging API Token>
LINE_CHANNEL_SECRET=<Messaging API Secret>

# LINE Login（LIFF 身分驗證）
LINE_LOGIN_CHANNEL_ID=<Login Channel ID>

# Cron 排程保護
CRON_SECRET=<自訂密碼，用於保護排程 API>
```

### Cloudflare Pages（前端建置）

在 **Pages project → Settings → Environment variables（Build）** 另外設定：

```bash
# LINE LIFF 個人化 Dashboard
# 不設定則自動進入 demo 模式（展示用）
VITE_LINE_LIFF_ID=<LIFF App ID>
```

> **V1.0 Beta 注意**：正式開放前，`VITE_LINE_LIFF_ID` 必須設定。未設定時 `/app` 任何人都能以 demo 模式進入後台。

---

## LINE Developers Console 設定

### Messaging API（LINE Bot）

1. Webhook URL：`https://care.wedopr.com/callback`
2. 開啟 `Use webhook`
3. 點 `Verify` 確認收到 200

### LIFF App

1. 在 LINE Login Channel 建立 LIFF App
2. Endpoint URL：`https://care.wedopr.com/app`
3. Scope：`profile`、`openid`
4. 將 LIFF App ID 填入 Cloudflare 前端建置環境變數 `VITE_LINE_LIFF_ID`

---

## GitHub Actions Cron 設定

Cron Job 透過 `.github/workflows/` 每日觸發：

```bash
# 早安健康簡報（08:00 台灣時間 = UTC 00:00）
curl -X POST https://care.wedopr.com/api/cron/reminders \
  -H "Authorization: Bearer <CRON_SECRET>"

# 晚安空腹提醒（20:00 台灣時間 = UTC 12:00）
curl -X POST https://care.wedopr.com/api/cron/evening \
  -H "Authorization: Bearer <CRON_SECRET>"
```

---

## 上線驗收清單

### 基礎功能

- [ ] `GET /api/health` 回應 `{"status":"ok"}`
- [ ] 首頁 `https://care.wedopr.com/` 正常開啟（Landing Page）
- [ ] `https://care.wedopr.com/app` 未登入時導向 `/login`（⚠️ Beta 前必須實作）
- [ ] `https://care.wedopr.com/login` 頁面可正常顯示

### LIFF 登入流程

- [ ] 從 LINE 開啟 LIFF URL，正確取得使用者 profile
- [ ] Dashboard 顯示當前使用者的專屬資料（非 demo 資料）
- [ ] `VITE_LINE_LIFF_ID` 已設定於 Cloudflare 建置環境

### OCR 解析

- [ ] 上傳門診掛號單，`/api/ocr/` 回應 `success: true`
- [ ] Supabase `appointments` 資料表有新增或更新的紀錄
- [ ] 重複上傳相同日期/科別單據，資料正確 upsert（不重複）
- [ ] OCR 解析後，LINE Bot 正確推播摘要給使用者（實機驗證）

### Cron 推播

- [ ] 手動觸發 `POST /api/cron/reminders`，LINE 收到早安健康簡報
- [ ] 手動觸發 `POST /api/cron/evening`，LINE 收到晚安空腹提醒（有隔天空腹需求者）
- [ ] 過期預約正確標記為 `expired`

### 家庭群組

- [ ] 建立群組，取得邀請碼
- [ ] 使用邀請碼加入群組
- [ ] 新增照護對象，切換後 Dashboard 資料正確切換

### 資料持久化（⚠️ Beta 前必須實作）

- [ ] 點「完成」後重整頁面，狀態維持 `completed`
- [ ] 可新增預約並立即顯示於 Dashboard
- [ ] 可刪除預約，Supabase 資料確實移除

---

## V1.0 Beta 前的已知缺口

以下問題在正式開放前**必須**修復，詳見 `DEVELOPMENT_PLAN.md`：

1. **`/app` 無登入閘門**：`routing.js` 與 `App.jsx` 未檢查身分，未登入即進 demo 後台
2. **API 無全域驗證**：`functions/api/_middleware.ts` 只做 CORS，未驗證 JWT
3. **待辦完成不持久化**：`handleComplete()` 只更新前端 state（`App.jsx` line 498）
4. **缺少 `PATCH /api/appointments/:id`**：前端無法同步狀態變更至資料庫
5. **無方案限制**：所有使用者享有相同功能，無 quota 或 entitlement 機制
6. **法規頁面缺失**：無隱私政策、服務條款、非醫療診斷聲明

---

## 已知取捨

- Cloudflare Pages Functions 不使用 Python Flask，OCR 直接用 Gemini Vision
- Cron 使用 GitHub Actions 外部觸發，而非 Cloudflare Cron Triggers（Pages 不原生支援）
- LIFF 未設定時，系統靜默進入 demo 模式；正式環境必須設定 `VITE_LINE_LIFF_ID`
- Service Role Key 跳過 RLS，需確保所有後端查詢邏輯不允許跨群組存取
