# Care WEDO 醫療照護小管家

> **當前版本：V1.0 Beta（2026-05-15）**
> **正式站**：https://care.wedopr.com
> **狀態**：LINE 實機流程已進入測試期；測試期間一般測試帳號開放 Family Pro 權限。

Care WEDO 是給長輩與家人使用的照護小幫手。長輩可以在 LINE 上傳藥袋、掛號單、處方箋或預約單照片，也可以直接貼上看診、用藥或提醒文字；系統會用 AI 解析，完整存進資料庫，再用短句提醒長輩重點。

產品原則：

- 長輩端：少字、清楚、安心，不提醒「你重複上傳了」。
- 家人端：可登入後台查看完整資料、今日照護、未來行程、吃藥提醒與家庭群組。
- 系統端：資料完整保存，提醒與藥品盡量去重更新。
- 品牌語氣：像家人貼心提醒，不像系統公告；LINE 只放必要資訊，完整資料留在後台。

---

## 技術架構

| 層級 | 技術 |
|---|---|
| 前端 | React 19 + Vite |
| 登入 | LINE LIFF / LINE Login |
| API | Cloudflare Pages Functions |
| 資料庫 | Supabase PostgreSQL + RLS |
| OCR | Gemini Vision |
| LINE Bot | LINE Messaging API Reply / Push / Quick Reply |
| 回饋收集 | EmailJS |
| 部署 | Cloudflare Pages + Wrangler |

---

## 已完成的實作成果

### 1. LINE 長輩上傳流程

- 手機版登入改走 LINE App LIFF deep link，避開手機瀏覽器 `access-auto.line.me` 卡住問題。
- 使用者先輸入「我要上傳」或看到預設提示後，LINE 會顯示姓名標籤。
- 使用者先選照護對象，再上傳照片或貼上文字。
- 選好後提供 Quick Reply：`拍照`、`選照片`、`重新選人`。
- 若使用者貼上含日期、時間與醫療關鍵字的文字，LINE 會進入同一套 AI 解析、入庫與回報流程。
- OCR 完成後提供 Quick Reply：`再傳一張`、`看清單`。

### 2. OCR 解析與資料歸屬

- 支援藥袋、處方箋、掛號單、預約單與檢查單解析；圖片走 Gemini Vision，文字走 Gemini 文字解析。
- 若 OCR 解析出姓名與生日，可自動比對照護對象。
- 若不確定歸屬，先詢問使用者選擇照護對象。
- 預選流程會把下一張圖片直接存入指定照護對象。
- 每次上傳都保留 `care_documents` 紀錄，方便追蹤來源。

### 3. 重複上傳處理

- 掛號、看診、檢查、領藥提醒：同一位照護對象、同一天、同科別、同類型會更新原本資料。
- 藥品：同一位照護對象、同藥名會更新原本資料。
- 長輩端不顯示「重複上傳」訊息，避免造成操作壓力。

目前限制：

- 藥品去重仍主要依賴完整藥名；若 OCR 把同一顆藥讀成不同字串，可能新增成另一筆。

### 4. 長輩友善 LINE 文案

LINE 回覆已改成短提醒格式：

```text
已為您新增一筆看診提醒

5/29（五） 上午 9:30
生生優動-板橋分院
新北市板橋區文化路一段142號
復健門診
林煒醫師

請記得帶：健保卡

已存入【洪爸爸】。
https://care.wedopr.com
```

LINE 不再列出冗長藥名、用途、注意事項長文。完整資料仍會保存到吃藥提醒與資料庫。

### 5. LINE 通知規則與品牌語氣

固定原則：

- LINE 通知要像家人提醒，不像公告、客服或條文。
- 不使用 `【測試通知】`、`親愛的家人，早安`、`提醒您一下`、`完整清單在這裡` 等制式語。
- 一則通知只放「誰、何時、要做什麼、地點或注意事項」。
- 地址預設不放在推播中，避免 LINE 訊息過長；完整地址與原始資料留在 Care WEDO 後台。
- 若院所名稱已包含醫師姓名，不重複顯示醫師姓名。
- 結尾固定使用品牌簽名：

```text
Care WEDO
陪你照顧最重要的人
https://care.wedopr.com
```

早安通知範例：

```text
早安

提醒您接下來的注意事項。

Matt 5/30（六）下午 3:00 要去看牙。
地點在陳幸妤牙醫診所。

Care WEDO
陪你照顧最重要的人
https://care.wedopr.com
```

排程與收件規則：

| 通知類型 | 發送時間 | 篩選邏輯 | 收件人 |
|---|---:|---|---|
| 一般門診、看牙、檢查、領藥 | 當天 08:00 | `appointments.date = 今天` 且 `status = upcoming` | `receive_daily_brief = true` 的群組成員 |
| 吃藥簡報 | 每天 08:00 | `medications.active = true` | `receive_daily_brief = true` 的群組成員 |
| 空腹提醒 | 前一天 20:00 | `appointments.date = 明天` 且 `fasting_required = true` | `receive_evening_alert = true` 的群組成員 |
| 上傳資料摘要 | 上傳成功後立即 | 上傳資料完成 OCR 與歸屬後觸發 | 上傳本人收到整理結果；同群組其他 `receive_upload_summary = true` 成員收到摘要 |

上傳摘要補充：

- 上傳本人一定會收到本次整理結果。
- 同群組其他成員若開啟「上傳摘要通知」，會立即收到摘要。
- 系統刻意排除上傳本人，不讓同一個人收到兩次。
- 沒有 LINE user id、`web-mvp` 測試帳號或關閉該通知者，不會收到推播。
- LINE Login 只代表完成網頁身份驗證；若家人要收到 LINE 推播，仍需要加入 Care WEDO LINE 照護小管家。邀請文案需同時提供群組加入網址與 LINE 小管家連結。

### 6. Web App 與家庭照護

- `/app` 未登入會導向 `/login`。
- LINE idToken 驗證與 API fail-closed 已完成。
- Dashboard 支援今日照護、未來行程、查詢紀錄、吃藥紀錄、家人協作。
- 支援家庭群組、邀請碼、多位照護對象、照護對象排序。
- 支援手動新增提醒、OCR 校正、確認後正式入庫。
- 支援用藥時段欄位：早、中、晚、睡前、其他。

### 7. 未登入首頁與回饋收集

- 未登入首頁已改為長輩友善產品定位：資料完整保存，LINE 只講重點。
- 首頁清楚界定 Free 與 Family Pro 規劃。
- 測試期間一般測試帳號開放 Family Pro 權限。
- 新增意見回饋區塊，透過 EmailJS 收集使用者建議。
- 社交分享、SEO、AIO/GEO 基礎已補齊：OG/Twitter meta、JSON-LD、FAQPage、`robots.txt`、`sitemap.xml`、`llms.txt`。
- 所有路徑先共用 `/assets/images/og-care-wedo.png` 作為社交分享圖片。

---

## 方案、權限與建議月費

> 目前測試期間：所有測試帳號暫時開放 Family Pro 權限。

| 功能 | Free | Family Pro |
|---|---|---|
| LINE 照護小管家 | 有 | 有 |
| 上傳前選擇照護對象 | 有 | 有 |
| 看診單、藥袋、預約單 AI 解析 | 10 筆/月 | 100 筆/月 |
| 長輩友善短提醒 | 有 | 有 |
| 吃藥提醒與資料保存 | 10 筆 | 完整保存 |
| 主要照護對象 | 1 位 | 多位 |
| 家庭群組共享 | 測試期開放 | 多人協作照護 |
| 今日照護與未來行程 | 有 | 有 |
| 完整歷史紀錄與健康時間線 | 測試期開放 | 完整保存 |
| 正式版月費訂閱 | 不適用 | 依方案級距 |

公開首頁先顯示 Free 與 Family Pro 對照；完整方案級距收在 Family Pro 小視窗中。測試期間新建立的家庭群組預設為 Family Pro。

| 方案 | 圖片解析 | 家庭群組 | 家人協作 | 照護對象 | 建議月費 | 公開狀態 |
|---|---:|---:|---:|---:|---:|---|
| Free 免費版 | 10筆/月 | 1 | 1位 | 1位 | 暫未規劃 | 公開 |
| Family Basic 基礎版 | 30筆/月 | 1 | 2位 | 1位 | 暫未規劃 | 公開 |
| Family Plus 進階版 | 50筆/月 | 1 | 5位 | 2位 | 暫未規劃 | 公開 |
| Family Pro 超級版 | 100筆/月 | 1 | 8位 | 4位 | 暫未規劃 | 公開；測試期預設 |
| Care Team | 200筆/月 | 1 | 15位 | 8位 | 暫未規劃 | 先隱藏；不放首頁 |

方案設計重點：

- Family Pro 標準能力是 1 個家庭群組、8 位成員、4 位照護對象。
- 多家庭群組不是 Family Pro 標準能力；只透過 `multiple_family_groups` feature flag 做內部測試。
- Care Team 先保留在資料表與內部規劃，不放入公開首頁，不對一般測試帳號開放。
- 目前暫未規劃收費方式，正式商轉前會依 Beta 使用量與回饋調整。

權限規則：

- 一般測試帳號：Family Pro，登入後家人協作頁標示 `Family Pro`。
- 內部測試權限不顯示為公開方案，不放入公開方案介紹。

---

## 主要 API

| 端點 | 方法 | 說明 | 需登入 |
|---|---|---|---|
| `/callback` | POST | LINE Webhook | LINE signature |
| `/api/health` | GET | 健康檢查 | 否 |
| `/api/dashboard` | GET | 今日照護與照護資料 | 選填 |
| `/api/ocr/` | POST | Web OCR 上傳解析 | 是 |
| `/api/groups` | GET/POST | 家庭群組與邀請碼 | 是 |
| `/api/profiles/[id]` | PATCH | 更新照護對象 | 是 |
| `/api/appointments/[id]` | PATCH | 更新看診/領藥紀錄 | 是 |
| `/api/medications/[id]` | PATCH | 更新用藥紀錄 | 是 |
| `/api/me` | GET/POST/DELETE | 使用者初始化與刪除 | 是 |
| `/api/cron/reminders` | POST | 早安提醒 | `CRON_SECRET` |
| `/api/cron/evening` | POST | 晚間提醒 | `CRON_SECRET` |

---

## 環境變數

請勿將任何 key 或 token 寫入文件或 commit。

必要環境變數：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_API_KEY`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_LOGIN_CHANNEL_ID`
- `VITE_LINE_LIFF_ID`
- `VITE_EMAILJS_SERVICE_ID`
- `VITE_EMAILJS_TEMPLATE_ID`
- `VITE_EMAILJS_PUBLIC_KEY`

---

## 本機開發

```bash
cd care-wedo-app
npm install
npm run dev
```

測試與建置：

```bash
npm test
npm run lint
npm run build
```

---

## 部署

```bash
cd /Users/hjuming/網站專案/care-wedo
set -a; source .env; set +a
npx wrangler pages deploy care-wedo-app/dist --project-name=care-wedo --branch=main
```

正式站 webhook：

```text
https://care.wedopr.com/callback
```

---

## 後續開發重點

P0：

- 用 5–10 張真實單據完成 LINE 實機回歸測試。
- 強化藥品去重：藥品代碼、學名、商品名、前綴模糊比對。
- 建立 production tail / Cloudflare Analytics / Sentry 告警。

P1：

- EmailJS 回饋資料整理成固定欄位，建立回饋分類表。
- 支援長輩稱謂自訂，例如爸爸、媽媽、阿嬤。
- 家人端顯示「本次 OCR 是新增還是更新」供除錯。

P2：

- 正式付費方案與金流。
- 照護資料匯出。
- OCR 低信心欄位人工確認。

詳見 [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)。
