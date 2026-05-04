# Care WEDO 醫療照護小管家

> **當前版本：Phase 3 完工 / V1.0 Beta 開發中**  
> 目標上線網址：`https://care.wedopr.com`

Care WEDO 是一個專為台灣銀髮族與其家屬設計的智慧醫療照護系統。長輩只需透過 LINE 拍照傳送醫院單據（門診掛號單、慢性病連續處方箋），系統自動以 AI OCR 解析並結構化儲存就診與用藥資料，再透過家庭群組讓子女共同協作，並每日主動推播「早安健康簡報」與「晚安空腹提醒」。

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
| 部署 | Cloudflare Pages（`git push` 自動觸發）|

---

## 目前完成模組（Phase 1–3）

### Phase 1：核心 OCR 與推播
- LINE Webhook 接收圖片，以 `waitUntil()` 非同步處理避開 10 秒 Timeout
- Gemini Vision 解析門診單，精準分類 `clinic_visit`、`inspection`、`refill_reminder`
- Upsert 防呆機制，重複上傳同日期/科別單據不產生重複資料

### Phase 2：Serverless 架構遷移
- 全部搬至 Cloudflare Pages + Supabase，移除 Python Flask/Railway
- Cron 排程：☀️ 08:00 早安健康簡報、🌙 20:00 晚安空腹提醒（自動推算禁食時間）
- `appointments_status_date_idx` 等索引建立，查詢效能優化

### Phase 3：LIFF 身分驗證與家庭協作
- **LINE LIFF 登入**：從 LINE 開啟 `/app` 自動取得身分，無 `VITE_LINE_LIFF_ID` 時進 demo 模式
- **家庭群組**：建立群組、邀請碼加入、角色欄位（`role`、`can_manage`）已建立於 Schema
- **照護對象**：可建立多位（爸爸/媽媽/長輩）、切換、編輯、上傳頭像
- **Web Dashboard**：看診日曆、吃藥提醒、家人設定、OCR 掃描上傳
- **通知偏好**：每位群組成員可獨立設定 `receive_daily_brief`、`receive_evening_alert`

---

## API 端點總覽

| 端點 | 方法 | 說明 | 需登入 |
|---|---|---|---|
| `/api/health` | GET | 健康檢查 | 否 |
| `/api/dashboard` | GET | 個人化首頁資料（預約、用藥、照護對象）| 選填 |
| `/api/groups` | GET/POST | 查詢/建立群組、加入、新增照護對象 | 是 |
| `/api/profiles/[id]` | PATCH | 更新照護對象資訊與頭像 | 是 |
| `/api/me` | GET/POST | 查詢使用者資料、初始化家庭 | 是 |
| `/api/ocr/` | POST | 圖片上傳 OCR 解析 | 選填 |
| `/api/cron/reminders` | POST | 早安推播（需 `CRON_SECRET`）| 系統 |
| `/api/cron/evening` | POST | 晚安空腹提醒（需 `CRON_SECRET`）| 系統 |

---

## 資料庫 Schema 摘要

```
users               ─ LINE 使用者，對應 line_user_id
family_groups       ─ 家庭群組，含 invite_code
care_profiles       ─ 照護對象（爸/媽/長輩），屬於 family_group
user_family_groups  ─ 使用者與群組的多對多關係，含角色與通知偏好
appointments        ─ 就診預約，關聯 user / group / profile
medications         ─ 用藥清單，關聯 user / group / profile
```

所有資料表均已啟用 Row Level Security（RLS）。

---

## 已知限制（V1.0 Beta 前必須補齊）

> 詳細工作項目請見 [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)

| 優先 | 問題 | 影響 |
|---|---|---|
| **P0** | `/app` 未強制登入，demo 模式可直接進後台 | 任何人都能看見 demo 後台 |
| **P0** | API 無全域身分驗證閘門（`_middleware.ts` 只做 CORS）| 任何人都可直接打 API |
| **P0** | `handleComplete` 只更新前端 state，不呼叫 API | 重整後「已完成」遺失 |
| **P0** | 無 `PATCH /api/appointments/:id` 與 `PATCH /api/medications/:id` 端點 | 資料無法持久化 |
| **P0** | 無免費/付費方案限制（無 quota、entitlement 欄位）| 無法控管使用量 |
| **P0** | 家庭群組缺少 admin 角色判斷、移除成員、重新產生邀請碼 API | 群組管理不完整 |
| **P0** | LINE LIFF 端到端尚未完整實機驗證 | 正式上線前必須閉環跑過 |
| **P0** | 缺少隱私政策、服務條款、非醫療聲明頁面 | 正式公開前法規必備 |

---

## 本機開發

```bash
# 前端開發伺服器
cd care-wedo-app
npm install
npm run dev

# 執行測試（目前 7/7 通過）
npm test

# 型別與 Lint 檢查
npm run lint
```

詳細環境變數設定請參考 [`CLOUDFLARE_SUPABASE_RUNBOOK.md`](./CLOUDFLARE_SUPABASE_RUNBOOK.md)。

---

## 部署

```bash
# 推送到 main 分支，Cloudflare Pages 自動建置部署
git push origin main
```

建置設定：
- **Build command**：`cd care-wedo-app && npm ci && npm run build`
- **Build output directory**：`care-wedo-app/dist`
- **Functions directory**：`functions`

---

## 下一步：V1.0 Beta 路線圖

目標：完成 Sprint 0–4 後，邀請 20–50 組家庭進行封閉測試。

| Sprint | 內容 | 預估工時 |
|---|---|---|
| Sprint 0 | 登入閘門 + API 身分驗證 | 1–2 天 |
| Sprint 1 | 資料持久化（待辦完成、新增/刪除）| 2–4 天 |
| Sprint 2 | 免費/付費方案限制 | 2–4 天 |
| Sprint 3 | 家庭群組正式化（角色、移除、邀請）| 3–5 天 |
| Sprint 4 | LINE 實機閉環驗證 | 3–5 天 |
| Sprint 5 | 正式上線防護（隱私頁、監控、刪除流程）| 2–3 天 |

詳見 [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)。
