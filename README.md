# Care WEDO 醫療照護小管家

> **當前版本：V1.0 Beta 開發中（2026-05-05）**  
> **部署狀態：已上線** → `https://care.wedopr.com`  
> **封閉 Beta：尚未開放**（LINE 登入流程仍在驗證中）

Care WEDO 是一個專為台灣銀髮族與其家屬設計的智慧醫療照護系統。長輩透過 LINE 拍照傳送醫院單據，系統以 AI OCR 自動解析並結構化儲存，再透過家庭群組讓子女共同協作，並每日推播健康提醒。

---

## 技術架構

| 層級 | 技術 |
|---|---|
| 前端 | React 18 + Vite，LINE LIFF (`@line/liff`) |
| API | Cloudflare Pages Functions (TypeScript) |
| 資料庫 | Supabase (PostgreSQL + RLS) |
| AI OCR | Gemini 2.5 Flash Vision API |
| 通知推播 | LINE Messaging API (Push + Reply) |
| Cron 排程 | GitHub Actions → Cloudflare Functions |
| 部署 | GitHub Actions + `wrangler v4`（繞過 Cloudflare 原生 CI 的 bug）|

---

## 目前完成功能

### ✅ Phase 1–3（已完工）
- **LINE Webhook OCR**：長輩傳送門診單，Gemini Vision 解析，自動 Upsert 至 Supabase
- **Serverless 架構**：Cloudflare Pages + Functions + Supabase，無 Python Flask
- **Cron 推播**：08:00 早安健康簡報、20:00 晚安空腹提醒（GitHub Actions 觸發）
- **LIFF 登入**：LINE OAuth 身分驗證，取得 `idToken` 驗證身分
- **Dashboard UI**：看診日曆、吃藥提醒、家人設定、OCR 掃描上傳
- **家庭群組**：建立群組、邀請碼加入、角色管理（admin/member）

### ✅ V1.0 Beta Sprint 0–5（已實作，驗證中）
- **登入閘門**：`/app` 未登入自動導向 `/login`
- **登出按鈕**：Dashboard 右上角可登出
- **資料持久化**：`PATCH /api/appointments/:id`、`PATCH /api/medications/:id`
- **方案限制**：free 方案 OCR 月限 10 次，超過回傳 429
- **群組管理**：移除成員、重新產生邀請碼、成員清單顯示
- **法規頁面**：隱私政策、服務條款、非醫療聲明（同首頁版型）
- **帳號刪除**：`DELETE /api/me` 清除所有個人資料
- **SPA 路由**：全站 client-side navigation，`functions/[[path]].ts` catch-all 兜底

---

## 已知問題與開發瓶頸

> **⚠️ 後續開發者必讀** — 以下是目前阻礙封閉 Beta 開放的主要問題

### 🔴 P0：LINE 登入流程未完整閉環驗證

**症狀**：
1. 電腦版：點擊「用 LINE 帳號登入」→ LINE 授權畫面出現 → 授權後回到首頁（應進 `/app`）
2. 手機版：首頁空白，無法渲染

**根本原因（已分析）**：

| 問題 | 原因 | 對應修復 |
|---|---|---|
| 電腦版授權後回首頁 | LINE Developers LIFF Endpoint URL 未設為 `https://care.wedopr.com/app`，LINE OAuth 將使用者導回錯誤位址 | 詳見下方「LIFF 設定步驟」|
| commit `6cf6e0c` 加入 LIFF callback 偵測 | 若使用者意外落在根路由且 URL 含 `liff.state` 或 `code` 參數，自動 `replaceState` 到 `/app` | 已修復，待部署驗證 |
| 手機首頁空白 | 疑為 JavaScript 執行期錯誤（需開啟手機 console 確認），或 hero 背景圖載入逾時 | 待實機 debug |

**必做修復步驟（非程式碼）**：

```
LINE Developers Console → Care WEDO Login Channel → LIFF 應用程式
→ Endpoint URL 改為：https://care.wedopr.com/app
→ 儲存後重新測試登入流程
```

### 🔴 P0：API 無全域身分驗證閘門

`functions/api/_middleware.ts` 目前只做 CORS，沒有驗證 JWT。任何人知道 API 路徑都可以直接呼叫。雖然 Supabase RLS 保護資料安全，但 `SUPABASE_SERVICE_ROLE_KEY` 繞過 RLS，存在風險。

**建議修復**：在 `_middleware.ts` 加入 JWT 驗證邏輯，`/api/cron/*` 和 `/api/health` 豁免。

### 🟡 P1：LINE 實機閉環尚未完整跑過

Sprint 4 的驗證流程 A（長輩 Bot）、B（家人 LIFF）、C（群組建立）都尚未完整實機驗證。OCR 在真實台灣醫院單據的辨識準確率未知。

### 🟡 P1：錯誤監控缺失

目前沒有 Sentry 或 Cloudflare Analytics 錯誤追蹤。生產環境出錯只能靠 Cloudflare Pages 的有限 log 查詢。

---

## 部署架構說明

### 為何使用 GitHub Actions 而非 Cloudflare 原生 CI

Cloudflare Pages 原生 CI 使用的 `wrangler 3.x` 在部署含 Pages Functions 的專案時，出現 **"Unknown internal error occurred"**（Cloudflare server-side bug），本地 `wrangler 4.x` 則無此問題。

**解決方案**：使用 `.github/workflows/deploy.yml`，以 `npx wrangler@4` 手動部署，完全繞過 Cloudflare 原生 CI。

### SPA 路由機制

React 是 SPA，但所有路由（`/app`、`/login`、`/privacy`、`/terms`）在瀏覽器直接輸入 URL 時，Cloudflare 會找不到對應靜態檔案。

**解決方案**：
1. `functions/[[path]].ts`：catch-all Worker，靜態資源找不到時改回傳 `index.html`（200）
2. `care-wedo-app/src/App.jsx`：全站 client-side navigation，用 `pushState` 攔截內部連結

舊方案（`_redirects`、`404.html`、`_routes.json`）已棄用。

---

## API 端點總覽

| 端點 | 方法 | 說明 | 需登入 |
|---|---|---|---|
| `/api/health` | GET | 健康檢查 | 否 |
| `/api/dashboard` | GET | 個人化首頁資料 + 方案用量 | 選填 |
| `/api/groups` | GET/POST | 查詢/建立群組、加入、成員管理 | 是 |
| `/api/profiles/[id]` | PATCH | 更新照護對象資訊與頭像 | 是 |
| `/api/appointments/[id]` | PATCH | 更新預約狀態 | 是 |
| `/api/medications/[id]` | PATCH | 更新用藥狀態 | 是 |
| `/api/me` | GET/POST/DELETE | 查詢/初始化/刪除使用者資料 | 是 |
| `/api/ocr/` | POST | 圖片上傳 OCR 解析（quota 限制）| 選填 |
| `/api/cron/reminders` | POST | 早安推播（需 `CRON_SECRET`）| 系統 |
| `/api/cron/evening` | POST | 晚安空腹提醒（需 `CRON_SECRET`）| 系統 |

---

## 資料庫 Schema 摘要

```
users               ─ LINE 使用者，含 plan / plan_expires_at
family_groups       ─ 家庭群組，含 invite_code
care_profiles       ─ 照護對象（爸/媽/長輩），屬於 family_group
user_family_groups  ─ 使用者與群組的多對多關係，含角色與通知偏好
appointments        ─ 就診預約，關聯 user / group / profile
medications         ─ 用藥清單，關聯 user / group / profile
```

所有資料表均已啟用 Row Level Security（RLS）。

---

## 本機開發

```bash
# 前端開發伺服器
cd care-wedo-app
npm install
npm run dev

# 執行測試
npm test

# 型別與 Lint 檢查
npm run lint
```

詳細環境變數設定請參考 [`CLOUDFLARE_SUPABASE_RUNBOOK.md`](./CLOUDFLARE_SUPABASE_RUNBOOK.md)。

---

## 部署

推送到 `main` 分支，GitHub Actions 自動觸發部署：

```bash
git push origin main
```

建置設定：
- **Build command**：`cd care-wedo-app && npm ci && npm run build`
- **Build output directory**：`care-wedo-app/dist`
- **Functions directory**：`functions`
- **部署工具**：`npx wrangler@4 pages deploy`（GitHub Actions，非 Cloudflare 原生 CI）

---

## V1.0 Beta 上線前必做清單

- [ ] **LINE Developers Console**：LIFF Endpoint URL 改為 `https://care.wedopr.com/app`
- [ ] 實機驗證 LINE 登入流程（電腦版 + 手機版）
- [ ] 手機首頁空白問題 debug（開啟手機 console 查看 JS 錯誤）
- [ ] API `_middleware.ts` 加入 JWT 驗證閘門
- [ ] Sprint 4 實機閉環驗證（Bot OCR、LIFF Dashboard、群組流程）
- [ ] 設定錯誤監控（Sentry 或 Cloudflare Analytics）

詳見 [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)。
