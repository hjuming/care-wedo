# Care WEDO 醫療照護小管家

Care WEDO 是一個專為台灣銀髮族與其家屬設計的智慧醫療輔助系統。透過拍照上傳醫院單據（如台大門診掛號單、慢性病連續處方箋），系統能自動利用 AI OCR 解析單據內容，轉化為結構化的就診與用藥資料，並透過 LINE 主動推播「早安健康簡報」與「晚安空腹提醒」，協助長輩不再錯過回診或吃錯藥。

## 📍 目前開發進度 (Phase 2 完工)

系統已完成核心的「資料擷取」與「主動照護防呆」閉環，並成功轉移至 Serverless 架構（Cloudflare + Supabase）。

### 1. 架構與基礎設施
* **無伺服器部署**：前端與 API 皆運行於 Cloudflare Pages (Vite + Pages Functions)，實現極低延遲與高擴充性。
* **資料庫**：使用 Supabase (PostgreSQL) 儲存結構化的 `users`, `appointments`, `medications` 等資料。
* **AI 辨識**：串接 Gemini 2.5 Flash 處理影像 OCR 解析。

### 2. 智慧單據解析與防呆儲存
* **非同步 LINE Webhook**：實作 `waitUntil()` 背景處理與 `LINE Push API`，解決複雜 OCR 造成的 10 秒 Timeout 回覆失敗問題。
* **自動分類**：Prompt 升級，能精準區分 `clinic_visit` (回診)、`inspection` (檢驗/抽血) 與 `refill_reminder` (慢箋領藥)。
* **防呆覆蓋機制 (Upsert)**：長輩若重複上傳相同日期/科別的單據，或同名藥物，系統會自動使用 PATCH 覆蓋舊資料，不會產生重複行程。

### 3. 自動化排程推播 (Cron Jobs)
透過 GitHub Actions 排程每日觸發 Cloudflare Functions：
* **☀️ 早安健康簡報 (08:00)**：每日上午 8 點，自動推播「今日用藥清單」與「明日行程預告」給長輩。並自動將過期的預約標記為 `expired`，保留歷史紀錄。
* **🌙 晚安空腹提醒 (20:00)**：每日晚上 8 點，針對「明天需空腹」的檢查，自動推算禁食時間（例如凌晨 1 點起禁食），並發送專屬的晚安提醒。

---

## 🛠️ 開發環境與部署指令

詳細的環境變數設定與資料庫 Schema 請參考 [CLOUDFLARE_SUPABASE_RUNBOOK.md](./CLOUDFLARE_SUPABASE_RUNBOOK.md)。

* **本機啟動前端**：
  ```bash
  cd care-wedo-app
  npm install
  npm run dev
  ```
* **一鍵部署**：
  只需執行 `git push origin main`，Cloudflare Pages 即會自動建置與更新 API。

---

## 🚀 下一階段開發建議 (Phase 3)

目前的系統在「後端與 LINE 推播」已經達到了專屬化，但 Web 網頁端仍是 MVP 的全域展示。建議後續的開發重心移至**使用者身分驗證**與**家屬協作**：

### 1. 導入 LINE LIFF (前端身分驗證)
* **目標**：讓使用者從 LINE 點開網址時，能夠免帳密自動登入。
* **實作建議**：在 React 前端導入 `@line/liff` 套件，取得 `liff.getProfile()` 後與後端 API 進行身分交換。讓網頁版 Dashboard 能精準只顯示「當前使用者」的專屬用藥與回診清單。

### 2. 家屬群組協作 (Family Groups)
* **目標**：讓子女（照護者）能遠端查看父母的行程，或代為上傳單據。
* **實作建議**：活化 Supabase 中已建立的 `family_groups` 與 `user_family_groups` 資料表。在前端實作「邀請碼機制」，讓子女加入長輩的群組，實現資料共享與共同提醒。

### 3. 對話式健康助理 (Chatbot)
* **目標**：除了單向推播，讓長輩可以直接用文字或語音在 LINE 詢問「我明天幾點看醫生？」或「這顆紅色的藥是做什麼的？」。
* **實作建議**：在 Webhook 的處理邏輯中，若判斷使用者傳送的是「文字」而非圖片，則將使用者的歷史資料（Appointments & Medications）抓出，交由 Gemini 進行語意問答，並以溫暖口語化的文字回覆。
