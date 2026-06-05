# Care WEDO — Cloudflare + Supabase 部署 Runbook

> **版本**：V1.0 Beta Candidate  
> **最後更新**：2026-05-17
> **部署方式**：GitHub Actions + wrangler v4（Cloudflare 原生 CI 已停用，見下方說明）

---

## 目標架構

| 層 | 服務 | 說明 |
|---|---|---|
| 前端 | Cloudflare Pages | React + Vite，`care-wedo-app/dist` |
| API | Cloudflare Pages Functions | TypeScript，路徑 `/api/*` |
| SPA 路由兜底 | `functions/[[path]].ts` | catch-all Worker，讓直接輸入 URL 也能載入 React |
| 資料庫 | Supabase (PostgreSQL) | RLS 已啟用 |
| OCR | Gemini Vision API | 由 Cloudflare Function 呼叫 |
| 推播 | LINE Messaging API | Push + Reply |
| Cron | GitHub Actions | 每日觸發 `/api/cron/*` |

---

## Supabase 設定

1. 建立 Supabase project。
2. 到 **SQL Editor** 執行 `supabase/schema.sql`。
3. 到 **Project Settings → API** 取得：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

> **重要**：`SUPABASE_SERVICE_ROLE_KEY` 只能放在 Cloudflare 後端環境變數，**絕對不可** 放進前端 `.env` 或 git commit。

---

## Cloudflare Pages 建置設定

| 欄位 | 值 |
|---|---|
| Framework preset | Vite |
| Build command | `cd care-wedo-app && npm ci && npm run build` |
| Build output directory | `care-wedo-app/dist` |
| Root directory | repo root |
| Functions directory | `functions` |

> **⚠️ 重要**：Cloudflare 原生 CI 現在**不使用**。部署由 `.github/workflows/deploy.yml` 的 GitHub Actions 處理，見下方「部署問題歷史」。

---

## 環境變數清單

### Cloudflare Pages（後端 Functions）

在 **Pages project → Settings → Environment variables** 設定（或透過 GitHub Actions `wrangler.toml`）：

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

# Supabase Auth（Google OAuth 後台登入；VITE_* 是前端 publishable config）
VITE_SUPABASE_URL=https://你的-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<Publishable / anon key>

# Cron 排程保護
CRON_SECRET=<自訂密碼，用於保護排程 API>

# Production 告警（選填；未設定則 no-op）
CARE_WEDO_ALERT_WEBHOOK_URL=<Slack/Make/Zapier/Google Chat 或自有 webhook>
CARE_WEDO_ALERT_WEBHOOK_SECRET=<接收端驗證用 secret>
CARE_WEDO_ENV=production
```

Google OAuth MVP 啟用前，還需要在 Supabase Dashboard 完成：

1. Authentication → Providers → Google：填入 Google OAuth Client ID / Client Secret 並啟用。
2. Authentication → URL Configuration：允許 `https://care.wedopr.com/auth/callback`，本機測試可另加 `http://localhost:5173/auth/callback`。
3. Production SQL Editor 套用 `supabase/migration_phase58_supabase_auth_identity.sql`，讓 `public.users` 可保存 `auth_user_id` 與 `auth_provider`。

> **2026-05-13 smoke test 發現**：正式站 `/api/cron/reminders` 與 `/api/cron/evening` 曾回傳 `CRON_SECRET is not configured.`。此問題已於 **2026-05-29** 修正；目前仍需確保 Cloudflare Pages production 與 GitHub Actions 的 `CRON_SECRET` 維持一致。

### CRON_SECRET 重設流程

若無法讀取既有 GitHub Actions secret，請直接重設兩邊為同一組新值：

1. 產生新的隨機 secret，不要貼到聊天或文件。
2. GitHub repo → Settings → Secrets and variables → Actions → 更新 `CRON_SECRET`。
3. Cloudflare Pages → `care-wedo` project → Settings → Environment variables → Production → 更新 `CRON_SECRET`。
4. 重新部署或等待 Cloudflare Pages Functions 讀取最新 production environment。
5. 手動執行 `Daily Medical Reminders` 與 `Evening Fasting Reminders` workflows。
6. 確認 `/api/cron/reminders`、`/api/cron/evening` 不再回 `CRON_SECRET is not configured.`。

> **2026-05-29 production 檢查補充**：GitHub Actions runner 直接打 `https://care.wedopr.com/api/cron/*` 曾被 Cloudflare challenge 攔下，log 會出現 `Just a moment...` 與 `HTTP Status: 403`。排程 workflow 已改成打 `https://care-wedo.pages.dev/api/cron/*`，並使用 `curl --fail-with-body`，避免假成功。

> **2026-05-29 cron 補充**：`Daily Medical Reminders` 曾再遇到兩個問題，現已修正：
> 1. `401 Unauthorized`：GitHub Actions secret 與 Cloudflare Pages production `CRON_SECRET` 不一致。
> 2. `500 Could not embed because more than one relationship was found for 'appointments' and 'users'`：cron 查詢已改為明確指定 `users!appointments_user_id_fkey` / `users!medications_user_id_fkey`。
>
> 最新手動驗證：
> - GitHub Actions `Daily Medical Reminders` run `26616795186`
> - 成功時間：**2026-05-29 03:49:42 UTC**
> - 回應：`{"success":true,"processed_date":"2026-05-29","users_notified":6}`

### Cloudflare Pages（前端建置）

`wrangler.toml` 的 `[vars]` 區塊已設定：

```toml
[vars]
VITE_LINE_LIFF_ID = "2009972224-fQcfBXw5"
```

> **說明**：Cloudflare Pages 使用 `wrangler.toml` 時，前端建置變數（`VITE_*`）必須放在 `[vars]`，不能透過 Dashboard 設定（Dashboard 只接受 Secret 類型）。

### GitHub Actions Secrets（部署用）

在 **GitHub repo → Settings → Secrets and variables → Actions** 設定：

```bash
CLOUDFLARE_API_TOKEN=<Cloudflare API Token，需有 Cloudflare Pages:Edit 權限>
CLOUDFLARE_ACCOUNT_ID=<Cloudflare Account ID>
```

> **建立 Cloudflare API Token 步驟**：Cloudflare Dashboard → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template → 確認有 `Cloudflare Pages: Edit` 權限。

---

## LINE Developers Console 設定

### Messaging API（LINE Bot）

1. Webhook URL：`https://care.wedopr.com/callback`
2. 開啟 `Use webhook`
3. 點 `Verify` 確認收到 200

### LIFF App（登入導向設定）

1. 在 LINE Login Channel 建立 LIFF App
2. **Endpoint URL 必須維持為：`https://care.wedopr.com/app`**
   - 這是 LINE OAuth 授權完成後的跳轉位址
   - 若設為根路徑 `/`，使用者登入後會被帶回首頁，不進 Dashboard（已知 bug）
3. Scope：`profile`、`openid`
4. LIFF App ID = `2009972224-fQcfBXw5`（已設定於 `wrangler.toml`）

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

## 部署問題歷史（重要！後續開發者必讀）

### 問題 1：Cloudflare 原生 CI wrangler 3.x bug

**症狀**：Cloudflare Pages 原生 CI 建置到最後步驟出現：
```
Error: Failed to publish your Function. Got error: Unknown internal error occurred.
```
Worker 編譯成功、靜態資產上傳成功，只有 Functions 發佈失敗。

**根本原因**：Cloudflare 原生 CI 使用 `wrangler 3.101.0`，其中有 Pages Functions 發佈的 server-side bug。本地與 GitHub Actions 使用 `wrangler 4.x` 則正常。

**解決方案**：建立 `.github/workflows/deploy.yml`，使用 `npx wrangler@4 pages deploy` 部署，完全繞過 Cloudflare 原生 CI。**Cloudflare Pages 設定中的 CI/CD 功能已停用。**

---

### 問題 2：SPA 路由 404

**症狀**：直接在瀏覽器輸入 `https://care.wedopr.com/login` 或 `/app`，Cloudflare 回傳 404 或空白頁。

**嘗試過但失敗的方案**：
- `care-wedo-app/public/_redirects` 設定 `/* /index.html 200` → Cloudflare wrangler 偵測到「Infinite loop」並忽略此規則
- `care-wedo-app/package.json` 加入 `cp dist/index.html dist/404.html` → 部分場景有效，但與 `_routes.json` 衝突

**最終解決方案**：
1. 刪除 `care-wedo-app/public/_routes.json`
2. 新增 `functions/[[path]].ts`（catch-all Pages Function）：靜態資源存在時正常回傳，找不到時改回傳 `index.html`（200 狀態）
3. `App.jsx` 全站使用 `pushState` client-side navigation，不觸發頁面重新載入

---

### 問題 3：GitHub Actions 認證失敗

**症狀**：
```
Authentication error [code: 10000]
```

**原因**：初次建立的 `CLOUDFLARE_API_TOKEN` 使用 `Edit Cloudflare Workers` template，但缺少 `Cloudflare Pages: Edit` 權限，且工作流程使用 `cloudflare/wrangler-action@v3`（綁定 wrangler 3.x）。

**解決方案**：
1. 重新建立 Cloudflare API Token，確認包含 `Cloudflare Pages: Edit`
2. 將 GitHub Actions 工作流程改為直接使用 `npx wrangler@4`（不使用 `cloudflare/wrangler-action`）

---

### 問題 4：前端建置環境變數無法取得 LIFF_ID

**症狀**：正式部署後，`VITE_LINE_LIFF_ID` 為空，`liff.js` 進入 demo 模式。

**原因**：Cloudflare Pages 使用 `wrangler.toml` 時，Dashboard 上設定的環境變數只會在 Runtime（Worker 執行時）注入，不會在 Build 時注入。`VITE_*` 變數需要在**建置期**（`vite build`）就存在。

**解決方案**：將 `VITE_LINE_LIFF_ID` 加入 `wrangler.toml` 的 `[vars]` 區塊。這是 Public 變數（非 Secret），放在 `[vars]` 是正確做法。

---

### 問題 5：Facebook / Meta 社交預覽圖無法顯示

**日期**：2026-05-17

**症狀**：

- Facebook Sharing Debugger 抓取 `https://care.wedopr.com/` 與 `https://care.wedopr.com/terms` 回應 403。
- Debugger 提示可能被 `robots.txt` 擋住，連結預覽沒有圖片。

**根本原因**：

- Cloudflare Managed robots.txt 會在正式站 `robots.txt` 前面插入 Managed content，其中包含 `User-agent: meta-externalagent` / `Disallow: /`。
- 專案原本的社交分享圖為 PNG 且尺寸不是標準 1200x630；雖然可被直接讀取，但社交平台預覽穩定性較差。

**程式層修復**：

1. 新增 `care-wedo-app/public/assets/images/og-care-wedo.jpg`，規格為 1200x630 JPEG。
2. `care-wedo-app/index.html` 將 `og:image`、`og:image:secure_url`、`twitter:image` 改為 JPG。
3. `care-wedo-app/public/robots.txt` 明確允許 `meta-externalagent` 與 `Meta-ExternalAgent`。
4. `care-wedo-app/public/_headers` 對 JPG 分享圖設定 `X-Robots-Tag: all`。
5. `care-wedo-app/src/seo-aio-regression.test.js` 加入回歸測試，避免日後退回 PNG 或漏掉 crawler 規則。

**驗證結果**：

- `npm test`：97/97 passed。
- `npm run build`：成功。
- Cloudflare Pages deploy：成功，deployment URL 為 `https://4ea17039.care-wedo.pages.dev`。
- `curl -A 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' https://care.wedopr.com/assets/images/og-care-wedo.jpg -I` 回 `200 image/jpeg`。
- Facebook Sharing Debugger 重新抓取後回應碼 200，預覽圖片正常顯示。

**Cloudflare Dashboard 後續檢查**：

- 若未來再次出現 Facebook Debugger 403，先檢查 Cloudflare Dashboard：
  - `Security > Bots > Instruct AI bot traffic with robots.txt`
  - 若此功能開啟，Cloudflare 仍可能前置插入 `meta-externalagent Disallow: /`。
- 若要透過 API 修改，需要 Cloudflare API token 具備 Bot Management Write 權限；只具備 Pages deploy 權限的 token 無法讀寫 `/zones/{zone_id}/bot_management`。

### Phase 55 上線備忘（2026-05-29）

**版本**：`phase55_billing_foundation`  
**執行項目**：`supabase/migration_phase55_billing_foundation.sql` 已在 production Supabase SQL Editor 套用。  
**完成時間**：2026-05-29 02:54:17（Asia/Taipei，UTC+8）  
**執行結果**：成功，回傳 `Success. No rows returned`。  
**驗證方式**：確認三張表已建立，且 `service_role` 具備 select/insert/update/delete 權限；API 與頁面金流快照邏輯已生效。

**查核 SQL**：

```sql
select schemaname, tablename
from pg_tables
where schemaname = 'public'
  and tablename in ('billing_subscriptions', 'billing_events', 'invoices');

select
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'service_role'
  and table_name in ('billing_subscriptions', 'billing_events', 'invoices')
order by table_name, privilege_type;

select
  family_group_id,
  care_profile_count,
  paid_collaborator_count,
  estimated_monthly_amount,
  status
from public.billing_subscriptions
order by family_group_id;

select
  event_type,
  count(*) as event_count
from public.billing_events
group by event_type
order by event_type;
```

**版本備註（Phase 55 已上線）**：

- 版本標記：`phase55_billing_foundation`
- 內容：
  - 建立 `billing_subscriptions`、`billing_events`、`invoices`；
  - `recordBillingGroupEvent` 開始可追蹤照護對象新增與邀請協作者；
  - `GET /api/groups` 已回傳 `billing_entitlement`（含 `maxCareProfiles`、`maxPaidCollaborators`、`estimatedMonthlyAmount`）；
  - 協作者管理中心採用後端 entitlement 做人數上限與費用預估顯示，避免前端邏輯漂移。
- 還原步驟（緊急）：

```sql
begin;
drop table if exists public.invoices;
drop table if exists public.billing_events;
drop table if exists public.billing_subscriptions;
commit;
```

回滾前檢查：

1) 無正式收款訂單（`invoices.status != 'paid'`）的資料可直接清空；
2) 已有正式訂單資料請改採「凍結寫入 + 留存稽核資料」後再逐步遷移。

**代碼回滾參考（運維）**：

- Git 回滾基準：`HEAD~1`（當下通常為 `35f77e0`）。
- 緊急回滾：`git checkout HEAD~1`
- 建議建立回滾標記（上線前）：`git tag -f phase55_release_pre`

### LINE 身份流程補充（Phase 55）

- 若使用者在 LINE 對話窗收到登入 callback（有 `code` / `liff.state`），前端會先轉到 `/app/open`。
- `openUrlInExternalBrowser` 會嘗試 `liff.openWindow({ url, external: true })`，並保留 callback query，避免落在 LINE 視窗中重複授權。
- 驗證建議：觀察 `/app/open` 命中率，若偏低請檢查 callback 參數是否被瀏覽器清除或重導向衝突。

---

## 上線驗收清單

### 前置設定

- [ ] LINE Developers：LIFF Endpoint URL = `https://care.wedopr.com/app`
- [ ] Cloudflare Pages：所有後端環境變數已設定
- [ ] GitHub Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 已設定

### 基礎功能

- [ ] `GET /api/health` 回應 `{"status":"ok"}`
- [ ] 首頁 `https://care.wedopr.com/` 正常開啟（Landing Page）
- [ ] Facebook Sharing Debugger 抓取首頁回應 200，且連結預覽顯示 `og-care-wedo.jpg`
- [ ] `https://care.wedopr.com/assets/images/og-care-wedo.jpg` 回應 `200 image/jpeg`
- [ ] `https://care.wedopr.com/app` 未登入時導向 `/login`
- [ ] `https://care.wedopr.com/login` 頁面可正常顯示
- [ ] `https://care.wedopr.com/privacy` 頁面可正常顯示
- [ ] `https://care.wedopr.com/terms` 頁面可正常顯示

### LIFF 登入流程

- [ ] 電腦版：點擊登入 → LINE 授權 → 進入 `/app` Dashboard
- [ ] 手機版：首頁正常顯示，LINE 內建瀏覽器不載入舊版 CSS
- [ ] Dashboard 顯示當前使用者的專屬資料（非 demo 資料）
- [ ] 登出按鈕正常運作

### OCR 解析

- [ ] 上傳門診掛號單，`/api/ocr/` 回應 `success: true`
- [ ] Supabase `appointments` 資料表有新增或更新的紀錄
- [ ] 重複上傳相同日期/科別單據，資料正確 upsert（不重複）
- [ ] Free 方案第 11 次 OCR 收到 429

### Cron 推播

- [ ] 手動觸發 `POST /api/cron/reminders`，LINE 收到早安健康簡報
- [ ] 手動觸發 `POST /api/cron/evening`，LINE 收到晚安空腹提醒
- [ ] 過期預約正確標記為 `expired`

### 家庭群組

- [ ] 建立群組，取得邀請碼
- [ ] 使用邀請碼加入群組
- [ ] admin 可移除成員，member 無法
- [ ] 重新產生邀請碼，舊碼失效

### 資料持久化

- [ ] 點「完成」後重整頁面，狀態維持 `completed`
- [ ] 可新增預約並立即顯示於 Dashboard

---

## 已知取捨

- Cloudflare Pages Functions 不使用 Python Flask，OCR 直接用 Gemini Vision
- Cron 使用 GitHub Actions 外部觸發，而非 Cloudflare Cron Triggers（Pages 不原生支援）
- `SUPABASE_SERVICE_ROLE_KEY` 繞過 RLS，後端所有查詢邏輯必須自行確保不允許跨群組存取
- `_middleware.ts` 已做 CORS 與 protected API LINE idToken 驗證；`/api/dashboard` GET 仍允許無登入回 demo payload，方便公開首頁與開發測試。
- 正式告警平台尚未接入；Beta 期間先依 Cloudflare Logs、GitHub Actions cron 結果與前端結構化 log 追蹤。
