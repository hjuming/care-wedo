# Care WEDO — V1.0 Beta 開發計畫

> **目標**：完成 Sprint 0–4，達到可邀請 20–50 組家庭進行封閉 Beta 測試的標準。  
> **建立日期**：2026-05-05  
> **當前狀態**：Phase 3 完工，V1.0 Beta 開發待啟動

---

## 現況評估

### 已具備（可直接使用）

| 模組 | 狀態 | 關鍵檔案 |
|---|---|---|
| 公開首頁 `/` | 完成 | `App.jsx`（routing 分流）|
| LINE LIFF 身分驗證 | 完成（需設定 env）| `services/liff.js` |
| 家庭群組 | 部分完成 | `functions/api/groups.ts` |
| 照護對象 | 完成 | `functions/api/profiles/[id].ts` |
| OCR 解析 + 入庫 | 完成 | `functions/api/ocr/[[path]].ts` |
| 早安 Cron 推播 | 完成 | `functions/api/cron/reminders.ts` |
| 晚安空腹 Cron 推播 | 完成 | `functions/api/cron/evening.ts` |
| Dashboard API | 完成 | `functions/api/dashboard.ts` |
| 前端 Dashboard UI | 完成 | `care-wedo-app/src/App.jsx` |
| 測試 | 通過 7/7 | `src/services/api.test.js`, `src/routing.test.js` |

### 尚未具備（V1.0 Beta 前必須補齊）

| 優先 | 缺口 | 影響範圍 |
|---|---|---|
| P0 | `/app` 無強制登入閘門 | `routing.js`, `App.jsx` |
| P0 | API 無全域身分驗證 | `functions/api/_middleware.ts` |
| P0 | 待辦完成不持久化 | `App.jsx:handleComplete`, 缺 `PATCH /api/appointments/:id` |
| P0 | 無免費/付費方案限制 | `functions/_shared/supabase.ts`, Schema 缺 `plan` 欄位 |
| P0 | 家庭群組缺角色管理 | `functions/api/groups.ts`（缺 remove_member, regenerate_invite）|
| P0 | LINE 實機閉環未驗證 | 全端流程（LIFF → OCR → 推播）|
| P0 | 法規頁面缺失 | 隱私政策、服務條款、非醫療聲明 |

---

## Sprint 0：登入閘門（1–2 天）

**目標**：確保 `/app` 必須登入才能進入，正式環境消除 demo 後台。

### 任務清單

#### 0-A 前端路由守衛
**檔案**：`care-wedo-app/src/App.jsx`

- 在 boot 流程完成後，若 `identity.status === "demo"` 且當前路由是 `/app`，導向 `/login`
- 移除 demo 模式直接載入後台資料的邏輯（僅保留無 `VITE_LINE_LIFF_ID` 的本機開發 bypass）

```javascript
// 修改前（App.jsx boot 流程）
// LIFF 失敗 → setIdentity demo → 仍然載入後台

// 修改後
// LIFF 失敗 → 若路由是 /app → 導向 /login
// 僅在 import.meta.env.DEV 環境允許 demo bypass
```

#### 0-B demo 模式環境控制
**檔案**：`care-wedo-app/src/services/liff.js`

- 加入環境判斷：`import.meta.env.DEV` 為 true 時才允許 demo fallback
- 正式環境（`import.meta.env.PROD`）若無 LIFF ID，直接返回 `status: "unauthenticated"` 並讓前端導向 `/login`

#### 0-C `/login` 頁面完整化
**檔案**：`care-wedo-app/src/App.jsx`（login route）

- 確認 `/login` 路由顯示 LINE 登入按鈕（目前有雛形，確認可實際觸發 `liff.login()`）
- 加入「等待中」狀態 UI，避免登入跳轉期間閃白頁

### 驗收標準
- [ ] 直接開啟 `https://care.wedopr.com/app`，未登入自動跳 `/login`
- [ ] 本機開發（`npm run dev`）仍可用 demo 模式測試
- [ ] LINE LIFF 登入成功後可進入 `/app`

---

## Sprint 1：資料持久化（2–4 天）

**目標**：前端所有操作都對應真實 API，重整頁面資料不遺失。

### 任務清單

#### 1-A 新增 `PATCH /api/appointments/:id`
**新增檔案**：`functions/api/appointments/[id].ts`

- 接受 `{ status, date, time, hospital, department, notes, ... }` 部分更新
- 驗證 JWT（確認使用者有權限存取該 appointment）
- 回應更新後的完整資料

#### 1-B 新增 `PATCH /api/medications/:id`
**新增檔案**：`functions/api/medications/[id].ts`

- 接受 `{ active, name, dosage, frequency, ... }` 部分更新
- 驗證 JWT

#### 1-C 新增 `POST /api/appointments`（若尚無）
**檔案**：`functions/api/appointments/index.ts`

- 讓前端可以新增單筆預約（OCR 解析之外的手動新增）

#### 1-D 前端接上真實 API
**檔案**：`care-wedo-app/src/App.jsx`、`care-wedo-app/src/services/api.js`

- `handleComplete(aptId)` 改為呼叫 `PATCH /api/appointments/:id`（目前只有 optimistic update）
- 新增 `patchAppointment(id, updates, { idToken })` 到 `api.js`
- 新增 `patchMedication(id, updates, { idToken })` 到 `api.js`

#### 1-E 補充測試
**檔案**：`care-wedo-app/src/services/api.test.js`

- 新增 `patchAppointment`、`patchMedication` 的單元測試

### 驗收標準
- [ ] 點「完成」後重整頁面，狀態維持 `completed`
- [ ] Supabase `appointments` 資料表 `status` 欄位確實更新
- [ ] 手動新增的預約重整後仍存在

---

## Sprint 2：免費 / 付費方案限制（2–4 天）

**目標**：建立基礎 entitlement 機制，為正式付費功能做準備。

### 任務清單

#### 2-A Schema 新增 `plan` 欄位
**檔案**：`supabase/schema.sql`（或新建 migration）

```sql
alter table public.users
  add column if not exists plan text not null default 'free',
  add column if not exists plan_expires_at timestamptz;

-- free: LINE Only，OCR 每月 10 次
-- paid: 完整功能，家庭群組、Dashboard、無限 OCR
```

#### 2-B 後端加入 quota 邏輯
**檔案**：`functions/_shared/supabase.ts`

- 新增 `getUserPlan(env, userId)` 函式
- 新增 `checkOcrQuota(env, userId)` 函式（free 方案計算當月使用次數）

#### 2-C OCR API 加入 quota 檢查
**檔案**：`functions/api/ocr/[[path]].ts`

- 呼叫 OCR 前先呼叫 `checkOcrQuota`
- 超過限額回傳 `429`，附帶 `{ error: "本月 OCR 次數已用完，升級付費方案可無限使用" }`

#### 2-D Dashboard API 回傳方案資訊
**檔案**：`functions/api/dashboard.ts`

- response 加入 `{ plan: "free" | "paid", ocr_used: 3, ocr_limit: 10 }`

#### 2-E 前端顯示方案與用量
**檔案**：`care-wedo-app/src/App.jsx`

- 「家人設定」section 顯示當前方案與本月 OCR 用量
- OCR 用量達上限時，提示升級說明

### 驗收標準
- [ ] free 用戶第 11 次 OCR 收到 429 錯誤
- [ ] Dashboard API 回傳 `plan`、`ocr_used`、`ocr_limit`
- [ ] 前端顯示用量提示

---

## Sprint 3：家庭群組正式化（3–5 天）

**目標**：讓家庭群組功能達到可公開使用的完整程度。

### 任務清單

#### 3-A admin / member 角色判斷
**檔案**：`functions/api/groups.ts`

- `user_family_groups.role` 欄位已存在（`'admin' | 'member'`）
- 建立群組的人自動設為 `admin`，邀請碼加入的人設為 `member`
- admin 才能執行破壞性操作（移除成員、重新產生邀請碼）

#### 3-B `remove_member` action
**檔案**：`functions/api/groups.ts`

```typescript
if (body.action === "remove_member") {
  // 驗證操作者為 admin
  // 移除 user_family_groups 中的記錄
}
```

#### 3-C `regenerate_invite` action
**檔案**：`functions/api/groups.ts`

```typescript
if (body.action === "regenerate_invite") {
  // 驗證操作者為 admin
  // 產生新的 invite_code，取代舊的
}
```

#### 3-D 前端群組管理介面
**檔案**：`care-wedo-app/src/components/GroupSettings.jsx`

- 顯示目前群組成員清單（含角色）
- admin 可看到「移除成員」按鈕
- admin 可看到「重新產生邀請碼」按鈕

#### 3-E API service 更新
**檔案**：`care-wedo-app/src/services/api.js`

- 新增 `removeMember({ idToken, groupId, targetUserId })`
- 新增 `regenerateInvite({ idToken, groupId })`

### 驗收標準
- [ ] 建立群組者自動為 admin
- [ ] admin 可移除成員，member 無法執行此操作
- [ ] 重新產生邀請碼後，舊邀請碼失效
- [ ] 前端群組管理頁顯示成員清單與角色

---

## Sprint 4：LINE 實機閉環驗證（3–5 天）

**目標**：完整跑過長輩與家人的真實使用流程，確保無 bug 才開放 Beta。

### 驗證流程腳本

```
流程 A：長輩 LINE Bot 使用
1. 長輩加 LINE Bot 為好友
2. 傳送門診掛號單圖片
3. Bot 在 30 秒內回覆解析摘要
4. Supabase appointments 資料表確認有新增紀錄
5. 隔天 08:00 收到早安健康簡報
6. 若有空腹需求，20:00 收到晚安空腹提醒

流程 B：家人 LIFF Dashboard 使用
1. 子女從 LINE 點開 LIFF URL
2. 自動完成 LIFF 登入（無帳密）
3. Dashboard 顯示長輩的預約與用藥資料
4. 點「完成」標記一筆待辦
5. 重整頁面，確認狀態維持

流程 C：家庭群組建立與加入
1. 子女 A 建立家庭群組，取得邀請碼
2. 子女 B 用邀請碼加入
3. 子女 A 新增照護對象（長輩）
4. 子女 B 進入 Dashboard 看到相同照護對象的資料
```

### 已知需實機確認的問題點

- Cloudflare `waitUntil()` 在正式環境是否確實讓 LINE Reply 在 10 秒內回應
- Gemini 2.5 Flash 在真實台灣醫院單據的辨識準確率（特別是手寫醫師字跡）
- LIFF 在 LINE App 內建瀏覽器的行為（iOS / Android 差異）
- Cron GitHub Actions 的 UTC 時區與台灣時間差（+8h）是否正確

### 驗收標準
- [ ] 流程 A、B、C 全部無報錯跑完
- [ ] OCR 正確識別 5 張不同醫院的門診單
- [ ] iOS + Android 各至少一台實機測試通過

---

## Sprint 5：正式上線防護（2–3 天）

**目標**：達到可公開 Beta 的法規與監控標準。

### 任務清單

#### 5-A 法規頁面
**新增檔案**：`care-wedo-app/src/pages/Privacy.jsx`、`Terms.jsx`

- 隱私政策（明確說明收集的 LINE 個人資料用途）
- 服務條款
- **非醫療診斷聲明**（重要）：Care WEDO 提供的資訊僅供記錄與提醒，不構成醫療診斷或建議
- 資料刪除申請流程（符合個資法）

#### 5-B 錯誤監控
- 在 Cloudflare Workers Analytics 或 Sentry 設定 error tracking
- 特別監控 OCR API 失敗率（目標 < 5%）
- LINE Webhook 超時率監控

#### 5-C 資料刪除流程
**新增 API**：`DELETE /api/me`

- 使用者申請刪除帳號時，刪除 `users`、`appointments`、`medications` 等所有相關資料
- 回傳確認信（LINE 訊息）

### 驗收標準
- [ ] 隱私政策、服務條款頁面可從首頁連結到達
- [ ] 非醫療聲明在 Dashboard 顯眼位置顯示
- [ ] `DELETE /api/me` 正常運作，Supabase 資料確實清除

---

## V1.0 Beta 定義完成條件

完成以下所有項目後，正式進入 **封閉 Beta（20–50 組家庭）**：

- [x] Phase 1–3 全部功能完工
- [ ] Sprint 0：未登入者無法進入 `/app`
- [ ] Sprint 1：待辦完成、新增、刪除資料持久化
- [ ] Sprint 2：免費方案 OCR 次數限制生效
- [ ] Sprint 3：家庭群組 admin/member 角色可正常運作
- [ ] Sprint 4：LINE 實機流程 A + B + C 全部跑通
- [ ] Sprint 5：隱私政策與非醫療聲明頁面上線

---

## 正式公開 V1.0 定義完成條件（Beta 後）

封閉 Beta 收集回饋後，修復主要問題，才進入：

- [ ] Sprint 5 全部完成（監控、刪除流程）
- [ ] OCR 失敗率 < 5%（連續 2 週監控數據）
- [ ] Cron 推播連續 7 天無漏送
- [ ] 至少 10 組家庭回饋正面（4/5 分以上）
- [ ] 付費方案啟用流程（串接金流，推薦 ECPay 或 NewebPay）

---

## 分工建議（Solo 開發排程）

| 週次 | 工作 |
|---|---|
| 第 1 週 | Sprint 0 + Sprint 1 |
| 第 2 週 | Sprint 2 + Sprint 3 |
| 第 3 週 | Sprint 4 實機驗證 |
| 第 4 週 | Sprint 5 + Beta 邀請啟動 |

> 單人開發建議每個 Sprint 結束後部署至正式環境做一次完整驗收，不要累積到最後一起測試。
