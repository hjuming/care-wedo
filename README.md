# Care WEDO 醫療照護小管家

> **當前版本：V1.0 Beta（2026-05-15）**
> **正式站**：https://care.wedopr.com
> **狀態**：LINE 實機流程已進入測試期；測試期間全功能免費開放。

Care WEDO 是給長輩與家人使用的照護小幫手。長輩可以在 LINE 上傳藥袋、掛號單、處方箋或預約單；系統會用 AI OCR 解析，完整存進資料庫，再用短句提醒長輩重點。

產品原則：

- 長輩端：少字、清楚、安心，不提醒「你重複上傳了」。
- 家人端：可登入後台查看完整資料、今日照護、未來行程、吃藥頁與家庭群組。
- 系統端：資料完整保存，提醒與藥品盡量去重更新。

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
- 使用者先選照護對象，再上傳照片。
- 選好後提供 Quick Reply：`拍照`、`選照片`、`重新選人`。
- OCR 完成後提供 Quick Reply：`再傳一張`、`看清單`。

### 2. OCR 解析與資料歸屬

- 支援藥袋、處方箋、掛號單、預約單與檢查單解析。
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
爸爸／媽媽，請記得領藥：

第一次領藥
2/4（三）
晨新藥局
號碼：3

請記得帶：健保卡

藥：1 筆，已放進吃藥頁。

已存入【日月MING】。
https://care.wedopr.com
```

LINE 不再列出冗長藥名、用途、注意事項長文。完整資料仍會保存到吃藥頁與資料庫。

### 5. Web App 與家庭照護

- `/app` 未登入會導向 `/login`。
- LINE idToken 驗證與 API fail-closed 已完成。
- Dashboard 支援今日照護、未來行程、查詢紀錄、吃藥紀錄、家人協作。
- 支援家庭群組、邀請碼、多位照護對象、照護對象排序。
- 支援手動新增提醒、OCR 校正、確認後正式入庫。
- 支援用藥時段欄位：早、中、晚、睡前、其他。

### 6. 未登入首頁與回饋收集

- 未登入首頁已改為長輩友善產品定位：資料完整保存，LINE 只講重點。
- 首頁清楚界定正式免費版與收費版規劃。
- 測試期間全功能免費開放。
- 新增意見回饋區塊，透過 EmailJS 收集使用者建議。

---

## 免費版與收費版規劃

> 目前測試期間：全功能免費開放。

| 功能 | 正式免費版規劃 | 正式收費版規劃 |
|---|---|---|
| LINE 照護小管家 | 有 | 有 |
| 上傳前選擇照護對象 | 有 | 有 |
| AI 圖片解析 | 基礎額度 | 較高額度 |
| 長輩友善短提醒 | 有 | 有 |
| 吃藥頁與完整資料庫 | 有限 | 有 |
| 多位照護對象 | 有限 | 有 |
| 家庭群組共享 | 有限 | 有 |
| 今日照護與未來行程 | 有限 | 有 |
| 長期健康時間線 | 有限 | 有 |
| 正式月額方案 | 不適用 | 規劃中 |

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
