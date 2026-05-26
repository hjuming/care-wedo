# Care WEDO 醫療照護小管家

> **當前版本：V1.0 Beta（2026-05-27）**
> **正式站**：https://care.wedopr.com
> **狀態**：LINE 實機流程已進入測試期；照護圈後台改為長輩友善的協作者管理中心。

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
- 2026-05-27 已將照護圈頁整理為「協作者管理中心」：長輩頁面只保留拍照新增、查看提醒與完成確認；編輯照護對象、手動新增提醒、家庭群組、邀請協作者、家人提醒與費用預估集中在設定頁。
- 照護圈上限已定稿：每個家庭群組最多 4 位主要照護對象、5 位共同協作者、1 位主帳號；超過時建議用其他協作者帳號另外開設家庭群組。
- 首頁、方案頁與後台費用預估改採清楚公式：主要照護對象 `$30 x 人數`，共同協作者 `$10 x 人數`，主帳號不列入協作者費用；單一家庭群組正式收費區間為 `$30-250/月`。
- 照護圈標題列支援切換家庭群組，正在照護者可由頁首快速切換；點選照護者頭像可編輯主要照護者資料。
- 其他頁面標題列已改成 compact 版，搜尋框與今日頁面對齊，避免排程、紀錄、用藥頁第一屏被標題佔滿。
- 用藥總表手機版改為欄位標籤卡片；操作改為 `複製文字` 與 `儲存圖片`，比列印更符合長輩實際使用情境。

### 7. 未登入首頁與回饋收集

- 未登入首頁已改為長輩友善產品定位：資料完整保存，LINE 只講重點。
- 首頁清楚界定 Free 與照護圈升級規劃。
- 測試期間尚未正式收費，介面先讓使用者理解正式版費用與上限。
- 新增意見回饋區塊，透過 EmailJS 收集使用者建議。
- 社交分享、SEO、AIO/GEO 基礎已補齊：OG/Twitter meta、JSON-LD、FAQPage、`robots.txt`、`sitemap.xml`、`llms.txt`。
- 所有路徑共用 `/assets/images/og-care-wedo.jpg` 作為社交分享圖片；圖片為 1200x630 JPEG，符合 Facebook / LINE / X 常見 large preview 規格。
- 2026-05-17 已修復 Facebook Debugger 抓取 403 與預覽圖不顯示問題：`robots.txt` 明確允許 `facebookexternalhit`、`Facebot`、`meta-externalagent`，OG/Twitter meta 改指向 JPG，並對分享圖加上 `X-Robots-Tag: all`。

### 8. 社交分享修復紀錄（2026-05-17）

**症狀**

- Facebook Sharing Debugger 抓取 `https://care.wedopr.com/` 與 `/terms` 回應 403。
- Debugger 顯示可能被 `robots.txt` 擋住，連結預覽只顯示網域與標題，沒有圖片。

**修復內容**

- 新增標準尺寸分享圖：`care-wedo-app/public/assets/images/og-care-wedo.jpg`（1200x630 JPEG）。
- `care-wedo-app/index.html` 的 `og:image`、`og:image:secure_url`、`twitter:image` 改指向 JPG。
- `care-wedo-app/public/robots.txt` 增加 `meta-externalagent` / `Meta-ExternalAgent` allow 規則。
- `care-wedo-app/public/_headers` 對 JPG 分享圖設定 `X-Robots-Tag: all`。
- `care-wedo-app/src/seo-aio-regression.test.js` 加入回歸測試，鎖定 JPG、尺寸與 crawler allow 規則。

**部署與驗證**

- 測試：`npm test` 97/97 passed。
- 建置：`npm run build` 成功。
- 部署：`npx wrangler@4 pages deploy care-wedo-app/dist --project-name=care-wedo --branch=main`。
- 線上驗證：Facebook Debugger 回應碼 200，連結預覽圖片正常顯示。

**Cloudflare 注意事項**

- Cloudflare Managed robots.txt 可能會在正式站 `robots.txt` 前置插入 AI crawler 規則；若日後再次出現 Meta / Facebook crawler 被擋，請檢查 Cloudflare Dashboard 的 `Security > Bots > Instruct AI bot traffic with robots.txt`。
- 目前程式層已明確允許社交預覽 crawler，若要修改 Cloudflare Bot Management，需要具備 Bot Management Write 權限的 Cloudflare API token。

---

## 方案、權限與建議月費

> 目前測試期間：正式收費尚未啟用；介面先讓使用者理解正式版計費方式。

| 功能 | Free | 照護圈升級 |
|---|---|---|
| LINE 照護小管家 | 有 | 有 |
| 上傳前選擇照護對象 | 有 | 有 |
| 看診單、藥袋、預約單 AI 解析 | 10 筆/月 | 每位照護對象 100 筆/月 |
| 長輩友善短提醒 | 有 | 有 |
| 吃藥提醒與資料保存 | 最近 30 天；不開放歷史查詢 | 完整保存與查詢 |
| 主要照護對象 | 1 位 | 最多 4 位 |
| 共同協作者 | 無 | 最多 5 位，主帳號不計費 |
| 家庭群組共享 | 無 | 多人協作照護 |
| 今日照護與未來行程 | 有 | 有 |
| 完整歷史紀錄與健康時間線 | 無 | 完整保存 |
| 正式版月費訂閱 | $0 | $30-250/月 |

公開首頁先顯示 Free 與照護圈升級對照；完整方案說明收在費用說明視窗。測試期間新建立的家庭群組預設為照護圈升級能力。

正式版計費公式：

| 項目 | 單價 | 上限 | 最高月費 |
|---|---:|---:|---:|
| 主要照護對象 | $30 / 位 / 月 | 4 位 | $200 |
| 共同協作者 | $10 / 位 / 月 | 5 位 | $50 |
| 主帳號 | 不計費 | 1 位 | $0 |
| 單一家庭群組 |  | 4 位照護對象 + 5 位協作者 + 1 位主帳號 | $250 |

方案設計重點：

- 照護圈升級標準能力是 1 個家庭群組、1 位主帳號、最多 5 位共同協作者、最多 4 位主要照護對象。
- 多家庭群組不是照護圈升級標準能力；只透過 `multiple_family_groups` feature flag 做內部測試。
- Care Team 先保留在資料表與內部規劃，不放入公開首頁，不對一般測試帳號開放。
- 超過單一家庭群組上限時，不再把同一群組做得更複雜；建議由其他協作者帳號另開家庭群組，避免資料載入與操作認知負擔過高。

權限規則：

- 一般測試帳號：照護圈升級能力，登入後照護圈頁顯示實際上限與費用預估。
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
npm --prefix care-wedo-app run build
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
- 照護圈新增照護對象、邀請協作者前補正式費用確認 modal，避免未來接金流後出現靜默升級疑慮。
- 強化藥品去重：藥品代碼、學名、商品名、前綴模糊比對。
- 建立 production tail / Cloudflare Analytics / Sentry 告警。

P1：

- EmailJS 回饋資料整理成固定欄位，建立回饋分類表。
- 支援長輩稱謂自訂，例如爸爸、媽媽、阿嬤。
- 家人端顯示「本次 OCR 是新增還是更新」供除錯。
- 協作者頭像聯絡能力補齊：若有 LINE user id 或聯絡資訊，點選頭像可直接聯絡；沒有資料時導向協作者管理中心。

P2：

- 正式付費方案與金流。
- 建立 `billing_events`、`billing_subscriptions`、`invoices` 草案，讓 $30-250/月模型可被後端核算與稽核。
- 照護資料匯出。
- OCR 低信心欄位人工確認。

詳見 [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)。

## Analytics / WEDO Roll-up Tracking

- `care-wedo-app` 保留 Care WEDO 自有 GA4：`G-21LHKNX5C1`。
- 另於 Vite 入口加裝 WEDO roll-up GTM：`GTM-TNM3J7XS`，用於 `*.wedopr.com` 集團級流量彙總。
- 後續新增公開 HTML 入口時，請同步加入 `wedo_rollup_context`，並帶入 `project_name: 'Care WEDO'`。
- 不要在本專案直接重複安裝 WEDO 主站 GA4 measurement `G-GX3PDLKCNC`；主站目的地由 GTM 容器管理。
