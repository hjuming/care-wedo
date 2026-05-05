# Care WEDO — V1.0 Beta 開發計畫

> **建立日期**：2026-05-05  
> **最後更新**：2026-05-05  
> **當前狀態**：Sprint 0–5 程式碼已完成，驗證階段（LINE 登入流程確認中）

---

## 總體進度

| Sprint | 內容 | 狀態 |
|---|---|---|
| Sprint 0 | 登入閘門 + 登入頁 | ✅ 程式碼完成 |
| Sprint 1 | 資料持久化（PATCH API + 前端串接）| ✅ 程式碼完成 |
| Sprint 2 | 免費 / 付費方案限制（quota）| ✅ 程式碼完成 |
| Sprint 3 | 家庭群組正式化（角色、移除、邀請）| ✅ 程式碼完成 |
| Sprint C | LINE Bot OCR 互動升級（快速切換、歸屬修正）| ✅ 程式碼完成 |
| Sprint 4 | LINE 實機閉環驗證 | 🟡 **驗證中** |
| Sprint 5 | 正式上線防護（法規頁、帳號刪除）| ✅ 程式碼完成 |
| Beta Observability | 實測結構化 log（前端、OCR、LINE、cron）| ✅ 程式碼完成 |

---

## 🔴 目前最高優先：LINE 登入問題

在 Sprint 4 實機驗證前，以下問題必須先解決。

### 問題 1：電腦版 LINE 登入後回到首頁

**描述**：使用者點擊登入按鈕 → LINE 授權畫面 → 授權後回到 `https://care.wedopr.com/`（首頁），而非預期的 `/app`（Dashboard）。

**根本原因**：LINE OAuth 的 redirect URI 必須與 LINE Developers Console 設定的 **LIFF Endpoint URL** 完全相符。若 Endpoint URL 設為根路徑（`https://care.wedopr.com/`）而非 `/app`，LINE 會把使用者導回根路徑。

**必做修復（非程式碼）**：
```
LINE Developers Console
→ Care WEDO Login Channel
→ LIFF App（照護小管家）
→ Endpoint URL 改為：https://care.wedopr.com/app
→ 儲存 → 重新測試
```

**程式碼已修復**（commit `6cf6e0c` 後，再加 LIFF callback 偵測）：
- `App.jsx`：若 URL 含 `liff.state` 或 `code` 參數且路由不是 `/app`，自動 `replaceState` 到 `/app`，作為雙重保險
- `liff.js`：`loginWithLine()` 與 `initLineIdentity()` 的 `redirectUri` 統一用 `APP_URL` 常數（`window.location.origin + "/app"`）

### ✅ 已修復：手機版型跑掉 / 首頁空白
**已完成修復**：新增 `care-wedo-app/public/_headers` 檔案，設定 `Cache-Control: no-cache`。這確保了 LINE 內建瀏覽器不會快取舊的 `index.html`，進而避免載入已不存在的舊版 CSS 檔案。

---

## Sprint 0：登入閘門（✅ 完成）

**目標**：確保 `/app` 必須登入才能進入，正式環境消除 demo 後台。

### 完成項目

| 任務 | 檔案 | 狀態 |
|---|---|---|
| 0-A 路由守衛：未登入導向 `/login` | `App.jsx` | ✅ |
| 0-B PROD 環境無 LIFF_ID 回傳 `unauthenticated` | `liff.js` | ✅ |
| 0-C 登入頁加入 LINE 登入按鈕 | `App.jsx` | ✅ |
| 0-D 加入登出按鈕 | `App.jsx` | ✅ |
| 0-E LIFF callback 偵測（雙重保險）| `App.jsx` | ✅ |

### 驗收標準
- [x] 直接開啟 `https://care.wedopr.com/app`，未登入自動跳 `/login`
- [x] `/login` 頁顯示 LINE 登入按鈕
- [x] 本機開發（`npm run dev`）仍可用 demo 模式
- [ ] LINE LIFF 登入成功後可進入 `/app` ← **待 LINE Endpoint URL 修正後驗證**

---

## Sprint 1：資料持久化（✅ 完成）

**目標**：前端所有操作都對應真實 API，重整頁面資料不遺失。

### 完成項目

| 任務 | 檔案 | 狀態 |
|---|---|---|
| 1-A `PATCH /api/appointments/:id` | `functions/api/appointments/[id].ts` | ✅ |
| 1-B `PATCH /api/medications/:id` | `functions/api/medications/[id].ts` | ✅ |
| 1-C supabase.ts 加入 patchAppointment / patchMedication | `functions/_shared/supabase.ts` | ✅ |
| 1-D 前端 `handleComplete` 接上真實 API（含 optimistic update 回滾）| `App.jsx` | ✅ |
| 1-E api.js 新增 patchAppointment / patchMedication | `services/api.js` | ✅ |

### 驗收標準
- [ ] 點「完成」後重整頁面，狀態維持 `completed` ← **待實機驗證**
- [ ] Supabase `appointments` 資料表 `status` 欄位確實更新

---

## Sprint 2：免費 / 付費方案限制（✅ 完成）

**目標**：建立基礎 entitlement 機制，為正式付費功能做準備。

### 完成項目

| 任務 | 檔案 | 狀態 |
|---|---|---|
| 2-A Schema 新增 `plan`、`plan_expires_at` 欄位 | `supabase/schema.sql` | ✅ |
| 2-B getUserPlan / checkOcrQuota helpers | `functions/_shared/supabase.ts` | ✅ |
| 2-C OCR API 加入 quota 檢查 | `functions/api/ocr/[[path]].ts` | ✅ |
| 2-D Dashboard API 回傳 plan / ocr_used / ocr_limit | `functions/api/dashboard.ts` | ✅ |

### 驗收標準
- [ ] free 用戶第 11 次 OCR 收到 429 錯誤 ← **待實機驗證**
- [ ] Dashboard API 回傳 `plan`、`ocr_used`、`ocr_limit`

---

## Sprint C：LINE Bot OCR 互動升級（✅ 完成）

**目標**：解決單一使用者有多個照護對象時，OCR 資料歸屬不明確的問題。

### 完成項目
| 任務 | 檔案 | 狀態 |
|---|---|---|
| C-A `medical_ocr.ts` 加入 profile_id 與名稱回傳 | `functions/_shared/medical_ocr.ts` | ✅ |
| C-B LINE Webhook 支援 Quick Reply | `functions/callback.ts` | ✅ |
| C-C 實作 Postback 事件處理（一鍵轉移資料）| `functions/callback.ts` | ✅ |
| C-D 歷史資料 SQL 遷移（修正 `profile_id` 遺失）| `artifacts/migration_fix_profile_id.sql` | ✅ |

### 驗收標準
- [x] OCR 後 Bot 會列出「這筆資料屬於誰？」的快速按鈕
- [x] 點擊按鈕後，後台資料確實更新，且 Bot 回覆確認訊息

---

## Sprint 4：LINE 實機閉環驗證（🔴 待執行）

**目標**：完整跑過長輩與家人的真實使用流程，確保無 bug 才開放 Beta。

> **前提**：Sprint 4 必須在「LINE 登入問題」解決後才能執行。

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
1. 子女從瀏覽器或 LINE 開啟 https://care.wedopr.com/app
2. 出現 LINE 登入按鈕 → 點擊 → LINE 授權 → 進入 Dashboard
3. Dashboard 顯示長輩的預約與用藥資料
4. 點「完成」標記一筆待辦
5. 重整頁面，確認狀態維持

流程 C：家庭群組建立與加入
1. 子女 A 建立家庭群組，取得邀請碼
2. 子女 B 用邀請碼加入
3. 子女 A 新增照護對象（長輩）
4. 子女 B 進入 Dashboard 看到相同照護對象的資料
```

### 需要特別注意

- Cloudflare `waitUntil()` 在正式環境是否讓 LINE Reply 在 10 秒內回應
- Gemini 2.5 Flash 在真實台灣醫院單據的辨識準確率（尤其手寫醫師字跡）
- LIFF 在 LINE App 內建瀏覽器的行為（iOS / Android 差異）
- Cron GitHub Actions UTC 時區與台灣時間差（+8h）是否正確

### 驗收標準
- [ ] 流程 A、B、C 全部無報錯跑完
- [ ] OCR 正確識別 5 張不同醫院的門診單
- [ ] iOS + Android 各至少一台實機測試通過

---

## Sprint 5：正式上線防護（✅ 完成）

**目標**：達到可公開 Beta 的法規與監控標準。

### 完成項目

| 任務 | 檔案 | 狀態 |
|---|---|---|
| 5-A 隱私政策頁面（同首頁版型）| `components/PrivacyPage.jsx` | ✅ |
| 5-B 服務條款 + 非醫療聲明（同首頁版型）| `components/TermsPage.jsx` | ✅ |
| 5-C `DELETE /api/me` 帳號刪除 | `functions/api/me.ts` | ✅ |
| 5-D routing.js 新增 privacy / terms 路由 | `src/routing.js` | ✅ |
| 5-E Beta 結構化 log | `services/telemetry.js`, `functions/_shared/logger.ts` | ✅ |

### 尚未完成

| 任務 | 說明 |
|---|---|
| 5-F 正式告警平台 | Sentry 或 Cloudflare Analytics 尚未接入；目前已有安全結構化 log 可支援 Beta 實測 |
| 5-G 生產部署後安全驗證 | 程式碼已改為 JWT fail-closed，仍需部署後用正式 URL 驗證 401 / authenticated 流程 |

---

## 技術債清單

以下問題不阻擋 Beta，但正式公開前應處理：

| 優先 | 問題 | 影響 |
|---|---|---|
| P0 | 生產安全驗證尚未跑完 | 程式碼已修補 API fail-closed、OCR 必須登入、Groups 必須登入、Postback 權限檢查；仍需部署後實測 |
| P1 | 無正式告警平台 | 已有結構化 log，但尚未接 Sentry / Cloudflare Analytics 告警 |
| P1 | OCR 結果人工校正需實機驗證 | Dashboard 已可校正 OCR 結果，仍需用真實單據確認流程 |
| P2 | 付費方案升級流程（金流）| 目前 quota 機制設計好，但無付費入口 |
| P2 | 資料刪除回覆（LINE 訊息確認）| `DELETE /api/me` 尚未推播 LINE 確認訊息 |
| P3 | 前端 bundle size 未分析 | 未做 code splitting，首次載入可能慢 |

---

## V1.0 Beta 定義完成條件

進入封閉 Beta（20–50 組家庭）前，以下全部必須打勾：

- [x] Phase 1–3 全部功能完工
- [x] Sprint 0：未登入者無法進入 `/app`
- [x] Sprint 1：資料持久化（PATCH API 實作）
- [x] Sprint 2：免費方案 OCR 次數限制生效
- [x] Sprint 3：家庭群組 admin/member 角色可正常運作
- [x] Sprint 5：隱私政策與非醫療聲明頁面上線
- [x] LINE Developers LIFF Endpoint URL 修正為 `https://care.wedopr.com/app`
- [ ] Sprint 4：LINE 實機流程 A + B + C 全部跑通
- [x] 手機首頁空白問題解決

---

## 正式公開 V1.0 定義完成條件（Beta 後）

封閉 Beta 收集回饋後，修復主要問題，才進入：

- [ ] Sprint 4 + 5 全部完成（監控、刪除流程、錯誤追蹤）
- [ ] OCR 失敗率 < 5%（連續 2 週監控數據）
- [ ] Cron 推播連續 7 天無漏送
- [ ] 至少 10 組家庭回饋正面（4/5 分以上）
- [ ] 付費方案啟用流程（串接金流，推薦 ECPay 或 NewebPay）
- [x] `_middleware.ts` JWT 驗證完成

---

## 分工建議（下一位開發者接手）

### 最優先任務（1–2 天）

### 最優先任務（1–3 天）

1. **Sprint 4 實機閉環驗證**：
   * 測試 LINE Bot 傳圖 -> OCR 解析 -> Quick Reply 切換身分。
   * 測試 LIFF 登入後，Dashboard 是否能即時反映身分切換後的資料。
2. **API 安全性驗證**：
   * 程式碼已修補 `functions/_middleware.ts`、OCR、Groups、Postback 權限檢查。
   * 下一步需部署後用正式 URL 驗證：未登入寫入回 401、登入後流程正常、LINE Postback 只能重分派自己的群組資料。

### 之後的任務（第 1–2 週）

3. **錯誤監控整合**：
   * 在前端 `main.jsx` 與 `ErrorBoundary` 中整合 Sentry。
   * 在 Cloudflare Functions 中加入結構化 Log 紀錄，方便追蹤 OCR 失敗原因。
4. **OCR 人工校正介面**：
   * 目前 OCR 若辨識錯誤（如日期抓錯），使用者無法在 Dashboard 修正。建議增加「編輯」按鈕。
5. **通知頻率設定**：
   * 讓使用者可以自訂「早安健康簡報」的發送時間，或關閉特定通知。
