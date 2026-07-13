# Care WEDO 醫療照護小管家

> **當前版本：V1.0 Beta（2026-06-20）**
> **正式站**：https://care.wedopr.com
> **狀態**：LINE 實機流程已進入測試期；照護圈後台已可查看去識別化提醒送達紀錄；Google OAuth 後台登入 MVP 已完成程式與 Phase 58 migration；protected data API 已統一身分解析，並以 tenant-isolation 測試覆蓋四個核心 PATCH 寫入資源、appointment create、medication taken、dashboard/documents 讀取 scope、文件 Storage 操作阻擋與 upload path namespace。
> **Production 上線紀錄**：2026-06-20（Asia/Taipei）已上線 auth 統一、reminder 正式模式預設、deploy 前 CI gate、GitHub Actions Node 24 runtime 升級。2026-06-05 Phase 57（LINE Push Audit Logs）production migration 已套用；後台 dashboard 已回傳最近提醒送達摘要，不含完整 LINE id 或推播全文。Phase 58 需套用 `supabase/migration_phase58_supabase_auth_identity.sql` 並設定 Supabase Google provider / redirect URL 後啟用。

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
| 登入 | LINE LIFF / LINE Login；Google OAuth（Supabase Auth 後台登入 MVP） |
| API | Cloudflare Pages Functions |
| 資料庫 | Supabase PostgreSQL（schema 啟用 RLS；Functions 目前使用 service role + app-layer ownership filters） |
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

- 藥品去重已補基礎 identity metadata；exact duplicate 會用藥碼或 normalized name 更新同一筆，家人端會提示疑似同藥，低信心候選不自動合併，並在 OCR 審核面板標示需人工確認。

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
| 明日行程提醒（門診、看牙、檢查、領藥等；需空腹時加註） | 前一天 20:00 | `appointments.date = 明天` 且 `status = upcoming` | `receive_evening_alert = true` 的群組成員 |
| 今日行程提醒（門診、看牙、檢查、領藥等） | 當天 08:00 | `appointments.date = 今天` 且 `status = upcoming` | `receive_daily_brief = true` 的群組成員 |
| 上傳資料摘要 | 上傳成功後立即 | 上傳資料完成 OCR 與歸屬後觸發 | 上傳本人收到整理結果；同群組其他 `receive_upload_summary = true` 成員收到摘要 |

上傳摘要補充：

- 上傳本人一定會收到本次整理結果。
- 同群組其他成員若開啟「上傳摘要通知」，會立即收到摘要。
- 系統刻意排除上傳本人，不讓同一個人收到兩次。
- 沒有 LINE user id、`web-mvp` 測試帳號或關閉該通知者，不會收到推播。
- LINE Login 只代表完成網頁身份驗證；若家人要收到 LINE 推播，仍需要加入 Care WEDO LINE 照護小管家。邀請文案需同時提供群組加入網址與 LINE 小管家連結。
- 2026-06-03 production 檢查發現：GitHub Actions schedule 可能延遲 2-4 小時甚至跨日，不適合準點醫療提醒；正式 20:00 / 08:00 觸發改由 Cloudflare Cron Worker `care-wedo-reminder-scheduler` 執行，GitHub workflow 僅保留手動備援。
- 2026-06-04 已固定 production 排程規則：08:00 只送「今日行程提醒」，不主動推播完整用藥清單；用藥仍保存在後台與「給醫生看」總表。
- 2026-06-05 已完成 `line_push_logs` 去識別化推播稽核與後台可視化：只存事件類型、送達狀態、HTTP 狀態、收件者內部 user id、LINE 後四碼、訊息長度與來源 appointment ids，不存完整 LINE id、不存推播全文、不存醫療內容；照護圈可看到最近提醒是否送出。
- 2026-06-05 已完成 Google OAuth 後台登入 MVP：前端使用 Supabase Auth publishable key 啟動 Google social login，後端以 `/auth/v1/user` 驗證 Supabase access token，映射到 `users.auth_user_id` / `auth_provider`；不取代既有 LINE 身分、不自動合併 LINE/Google 帳號。
- 2026-06-20 reminder 測試模式已改成明確 opt-in：只有 `REMINDER_TEST_ONLY=1` 才限制發送給測試帳號；未設定或 `0` 皆為正式模式，避免 production 因漏設環境變數而只送測試收件者。
- 2026-05-29 production 檢查發現：GitHub Actions 排程打 custom domain 時會被 Cloudflare bot challenge 擋下；提醒 workflow 已改為打 `care-wedo.pages.dev/api/cron/*`，並在非 2xx 時直接 fail，避免表面成功但實際沒送出。
- LINE 對話窗中的登入 callback（含 `code` / `liff.state`）會先導向 `/app/open`，再以外部瀏覽器重新開啟同一個 callback URL，完成身分驗證後可直接進入後台，降低留在 LINE 視窗操作困擾。

### 6. Web App 與家庭照護

- `/app` 未登入會導向 `/login`。
- LINE idToken 驗證與 API fail-closed 已完成。
- 2026-06-20 已將 OCR、新增/編輯預約、用藥確認、文件、profile 排序、dashboard、me、groups 等 protected data API 改走 request-scoped `getRequestUser(context)`；middleware 驗過的 LINE / Supabase identity 會被 handler 重用，不再每個 handler 重複驗 token。另以 source guard 鎖住 protected route 不得再直接呼叫 LINE-only `verifyLineIdToken()` 或舊的 `getAuthenticatedUser()`。
- 2026-06-20 已補 functions 跨戶隔離負向測試：medications、appointments、profiles、care_documents 跨群組 PATCH 會回 403 / 404 且不發出寫入；同群組 PATCH 回 200。
- 2026-07-06 已補工程安全網：strict TypeScript typecheck、`npm run verify` 聚合 gate、env schema / `/api/health` readiness、WCAG AA contrast gate、stylelint gate、最小 E2E smoke。首輪 typecheck 抓到 `documents/upload.ts` 寫入 `uploaded_by_user_id` 來源錯誤，已修正為 request-scoped `documentContext.userId`。
- 2026-07-06 已完成長輩友善快修：對比度從最低 2.75:1 修到 11 組 token 全過 WCAG AA，最小字級提高到 14px，加入 `prefers-reduced-motion`，補齊 modal 關閉鈕 `aria-label` 與 UploadGuide `role="dialog"`。
- Dashboard 支援今日照護、未來行程、查詢紀錄、吃藥紀錄、家人協作。
- 支援家庭群組、邀請碼、多位照護對象、照護對象排序。
- 支援手動新增提醒、OCR 校正、確認後正式入庫。
- 支援用藥時段欄位：早、中、晚、睡前、其他。
- 2026-05-27 已將照護圈頁整理為「協作者管理中心」：長輩頁面只保留拍照新增、查看提醒與完成確認；編輯照護對象、手動新增提醒、家庭群組、邀請協作者、家人提醒與費用預估集中在設定頁。
- 照護圈上限已定稿：每個家庭群組最多 4 位主要照護對象、5 位共同協作者、1 位主帳號；超過時建議用其他協作者帳號另外開設家庭群組。
- 首頁、方案頁與後台費用預估改採清楚公式：主要照護對象 `$30 x 人數`，共同協作者 `$10 x 人數`，主帳號不列入協作者費用；單一家庭群組正式收費區間為 `$30-250/月`。
- 新增主要照護對象或邀請共同協作者前會先顯示 Beta 費用確認；測試期間不扣款，正式版加價前需使用者確認，不做靜默升級。
- 照護圈標題列支援切換家庭群組，正在照護者可由頁首快速切換；點選照護者頭像可編輯主要照護者資料。
- 其他頁面標題列已改成 compact 版，搜尋框與今日頁面對齊，避免排程、紀錄、用藥頁第一屏被標題佔滿。
- 用藥總表手機版改為欄位標籤卡片；操作改為 `複製文字` 與 `儲存圖片`，比列印更符合長輩實際使用情境。
- 2026-05-29 已補 Beta observability 基礎：前端 production error 可送入 `/api/telemetry`，Functions log 會帶 `ocr_failed`、`line_push_failed`、`quota_exceeded`、`auth_failed`、`cron_failed` 分類，並新增 Cloudflare tail runbook 與 `CARE_WEDO_ALERT_WEBHOOK_URL` 告警轉發發送端；目前未設定接收端，正式營運前再決定 alert relay。
- 2026-05-29 已建立真實單據回歸包基礎：`test-fixtures/real-receipt-regression/manifest.json` 定義 10 張台灣單據測試案例；真實圖片放在未追蹤的 private-images 目錄，避免醫療資料進 Git。2026-06-20 補 `expected-shapes.json`、`receipt-pack:shapes`、`receipt-pack:private-check` 與 `receipt-pack:hashes`；目前本機缺 10 張 private images，真實 sha256 待圖片到位後寫入。
- 2026-05-29 已建立 Billing Data Foundation 草案：新增 `billing_subscriptions`、`billing_events`、`invoices` migration 與後端 `resolveGroupBillingEntitlement` / `recordBillingGroupEvent` helper；新增照護對象與新協作者加入會寫入可稽核事件、subscription snapshot 與當月 draft invoice。Production Supabase 已套用 `supabase/migration_phase55_billing_foundation.sql`。
- 同一批次後續更新：`/api/groups` 追加回傳 `billing_entitlement`，照護圈頁使用後端實際權益快照做人數上限與 `estimatedMonthlyAmount` 顯示，避免前端硬編碼上限與稽核口徑不同步。
- 2026-06-20 已補 `SUBSCRIPTION_STATE_MACHINE.md` 與 `functions/_shared/subscription_state.ts`，先定義 `beta`、`checkout_pending`、`active`、`past_due`、`grace_period`、`suspended`、`cancel_at_period_end`、`canceled`、side effects 與 webhook idempotency，並以 `functions/_tests/subscription-state.test.ts` 鎖定合法 / 非法 transition。
- 2026-07-07 已補 Care 端中央金流 webhook 與 checkout：`POST /api/billing/webhook` 以 `WEDO_BILLING_GATEWAY_SECRET` 驗 WEDOPR HMAC 簽章，使用 `billing_events(provider, provider_event_id)` 去重，成功付款會把對應家庭群組訂閱推進到 `active`；`POST /api/billing/checkout` 以 `WEDO_BILLING_CHECKOUT_SECRET` 呼叫 WEDOPR 中央金流，前端只送出綠界付款表單，不處理或保存信用卡資料。

### 7. 未登入首頁與回饋收集

- 未登入首頁已改為長輩友善產品定位：資料完整保存，LINE 只講重點。
- 首頁清楚界定 Free 與照護圈升級規劃。
- 測試期間尚未正式收費，介面先讓使用者理解正式版費用與上限。
- 新增意見回饋區塊，透過 EmailJS 收集使用者建議。
- 社交分享、SEO、AIO/GEO 基礎已補齊：OG/Twitter meta、JSON-LD、FAQPage、`robots.txt`、`sitemap.xml`、`llms.txt`，以及不執行 JavaScript 也可讀的 `/faq`、`/guide`、`/pricing` 靜態頁。
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

### 8.1 Production 上線紀錄補充（Phase 55）

**版本**：`phase55_billing_foundation`  
**時間**：2026-05-29 02:54:17（Asia/Taipei，UTC+8）  
**執行結果**：`supabase/migration_phase55_billing_foundation.sql` 在 production SQL Editor 成功執行（`Success. No rows returned`）。

**版本備註（Phase 55 已上線）**

- `billing_subscriptions`、`billing_events`、`invoices` 已成功建立並授權 service_role 使用。
- `GET /api/groups` 回傳每個家庭群組的 `billing_entitlement`：
  - 上限（`maxCareProfiles`、`maxPaidCollaborators`）
  - 計算基礎（`careProfileCount`、`paidCollaboratorCount`）
  - `estimatedMonthlyAmount`
- `/app/settings`（協作者管理中心）改採後端 `billing_entitlement` 作為人數上限與本月估算金額來源，避免前端硬編碼。
- 新增 `billing-foundation` 回歸與安全規則檢查，補齊後端寫入測試與 Group Settings 用量邏輯驗證。

#### 查核 SQL（已驗證）

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

#### 版本備註（Phase 55 已上線）與回滾點

- 版本標識：`phase55_billing_foundation`
- 套用範圍：Billing Data Foundation + `/api/groups` 權益快照回傳 + 設定頁後端來源展示（人數上限、費用預估）
- 回滾 SQL（緊急）：

```sql
begin;
drop table if exists public.invoices;
drop table if exists public.billing_events;
drop table if exists public.billing_subscriptions;
commit;
```

回滾前核對：

1. 是否有正式帳務流程（含 `billing_events`、`invoices`）已開始寫入；
2. 若已進入正式結算，請先備份 `billing_events`、`invoices` 再回滾；
3. 回滾後需補跑權限檢核與 `GET /api/groups` 可用性確認。

版本回滾紀錄（供發版參考）：

- 程式回滾參考點：`HEAD~1`（當下為 `35f77e0`）
- 緊急回滾：

```bash
git checkout HEAD~1
```

- 保留可回退標籤（建議於上線前建立）：

```bash
git tag phase55_release_pre
```

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
- 商轉前置：後端已補 billing entitlement、event helper、pure subscription state machine、Care 端中央金流 webhook fixture test、Care checkout API 與付款 UI；正式公開收費前仍需做一筆小額 live callback 驗收。

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
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_EMAILJS_SERVICE_ID`
- `VITE_EMAILJS_TEMPLATE_ID`
- `VITE_EMAILJS_PUBLIC_KEY`

選用環境變數：

- `REMINDER_TEST_ONLY` — 提醒發送模式。**預設（未設定或 `0`）為正式模式，發送給所有真實收件者。** 僅在設為 `1` 時進入測試模式，只發送給 `REMINDER_TEST_TARGET_NAME`（預設為單一測試帳號）。**Production 部署務必確認此變數不存在或為 `0`。**
- `REMINDER_TEST_TARGET_NAME` — 測試模式下的指定收件者名稱（僅 `REMINDER_TEST_ONLY=1` 時生效）。

---

## 本機開發

```bash
cd care-wedo-app
pnpm install
npm run dev
```

測試與建置：

```bash
pnpm test
pnpm lint
pnpm build
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

CI/CD gate：

- `.github/workflows/deploy.yml` 於 `main` push 後先跑 ESLint、stylelint、前端與 regression 測試、functions tenant-isolation 測試、strict typecheck、env schema example sync、WCAG contrast gate、Phase 59 RLS policy sync、real-receipt regression pack、build，全部通過才部署 Cloudflare Pages。
- `.github/workflows/deploy-reminder-scheduler.yml` 於 reminder scheduler worker 或 workflow 變更時部署 Cloudflare Cron Worker，並同步 `CRON_SECRET`。
- GitHub Actions runtime 已升級到 Node 24 系列 action：`actions/checkout@v7`、`actions/setup-node@v6`；專案 build/test 的 `node-version` 維持 `22`。
- 前端與 functions 測試在 CI 設定 `TZ=Asia/Taipei`，避免 GitHub runner 預設 UTC 造成 todayTasks 類日期斷言偏一天。
- 資料圍堵明文採短期 service-role-only + app-layer ownership filters，細節見 `DATA_CONTAINMENT_CONTRACT.md`；staging smoke 前先跑 `npm run staging:smoke:ready` 檢查必要 env，Google protected write staging 驗收見 `GOOGLE_PROTECTED_WRITE_SMOKE_RUNBOOK.md` 與 `npm run google:protected-write:smoke`；Storage policy staging 驗收見 `STORAGE_POLICY_SMOKE_RUNBOOK.md` 與 `npm run storage:policy:smoke`。
- Phase 0 乾淨家庭 fixture 使用 `npm run staging:fixture:dry` 預覽；只有確認 `SUPABASE_URL`、`CARE_WEDO_STAGING_BASE_URL`、三組測試帳密與 staging service-role secret 均指向受控 staging 後，才可執行 `npm run staging:fixture:apply`。工具固定 staging project ref／host、以穩定 fixture key 重用群組／照護對象／單一行程與單一藥單，絕不把密碼或 secret 寫入報告。
- Phase 61 套用前先跑 `npm run staging:migration:check`；它只讀 staging REST schema，確認 `appointments.idempotency_key` 是否存在，不會執行 migration，也不會宣稱 partial unique index 已建立。
- 三角色 fresh-context 驗收先用 `npm run staging:role-e2e:plan` 檢查設定；只有注入 `SUPABASE_URL`、`CARE_WEDO_STAGING_BASE_URL`、三組 `CARE_WEDO_FIXTURE_*_EMAIL/PASSWORD` 與去識別化 `CARE_WEDO_FIXTURE_GROUP_ID`／`PROFILE_ID`／`MEDICATION_ID` 後，才可執行 `npm run staging:role-e2e`。該 runner 會以三個隔離 browser context 驗證 primary 建立／重試同一行程、collaborator 跨帳號讀取與家庭提醒、elder 的兩條 403 寫入路徑，並只輸出 status／布林結果與暫存截圖路徑。

本機交付前建議：

```bash
npm run verify
```

`npm run verify` 會跑 ESLint、stylelint、前端測試、typecheck、env example sync、functions 測試、contrast、RLS sync 與 receipt pack。若只要檢查本機 env，跑 `npm run env:check`；沒有 `.dev.vars` 時會 fallback 檢查 `.env`，只驗變數名稱存在與非空，不輸出 secret 值。

本機最小瀏覽器 smoke（不進 CI，UI / 路由改動後建議手動跑）：

```bash
npx playwright install chromium # 首次使用才需要
npm run smoke:e2e
```

`smoke:e2e` 會用本地靜態伺服器檢查 `/`、`/login`、`/app`、`/features`、`/privacy`、`/terms` 不白屏且無未捕捉例外；`/app` 會軟性確認預約 / 用藥 / 上傳入口文字。

部署後 health smoke：

```bash
curl https://care-wedo.pages.dev/api/health
curl -H "Authorization: Bearer $CRON_SECRET" https://care-wedo.pages.dev/api/health
```

公開 health 只回 `env_ready`；帶正確 `CRON_SECRET` 才會回缺漏 env「名稱」明細。`CARE_WEDO_ALERT_WEBHOOK_URL` / `CARE_WEDO_ALERT_WEBHOOK_SECRET` 目前刻意不設定，保留為正式營運前的告警 relay 選配。

---

## 後續開發重點

P0：

- 先用 `npm run staging:smoke:ready` 確認 staging smoke 必要 env 齊全；再依 `GOOGLE_PROTECTED_WRITE_SMOKE_RUNBOOK.md` 或 `npm run google:protected-write:smoke` 在 staging 以 Google 帳號實測 OCR、新增預約、用藥確認三條寫入路徑，確認 Supabase/Google 使用者不會落到 LINE-only 或共用測試帳號。
- 資料圍堵防護網已先明文採 service-role-only + app-layer ownership filters，且 tenant-isolation 已覆蓋 medications / appointments / profiles / care_documents PATCH、appointment create、medication taken、dashboard/documents 讀取 scope、foreign document signed URL / storage delete 阻擋與 upload path namespace；DB 層已補 authenticated read-only table / Storage object policies 與 direct write revoke。下一步是 staging Google E2E、`npm run storage:policy:smoke` live verification 與正式 direct-write RLS 設計。
- 用 10 張真實單據完成 LINE 實機回歸測試；目前已建立去識別化 manifest、expected shape、private image hash 工具與驗證工具；本機 dry-run 顯示 10 張 private images 尚未放入，待補真實 sha256 與實測紀錄。
- 完成 390px 手機與 LINE WebView 實機檢查，尤其是照護圈、用藥總表、費用確認 modal。
- 強化藥品去重：已補藥名正規化、商品名/學名/藥碼欄位、疑似重複候選標記、家人端提示與高信心 exact duplicate 合併；下一步補正式藥碼資料源與完整合併管理。
- 已支援 webhook 自動告警的發送端，但目前沒有既有接收端紀錄，Cloudflare Pages 也未設定 `CARE_WEDO_ALERT_WEBHOOK_URL` / `CARE_WEDO_ALERT_WEBHOOK_SECRET`；商轉前若要主動通知，應新建 alert relay（LINE / Slack / Discord / Email 皆可），不要尋找舊設定。
- LINE 推播稽核已補 `line_push_logs` 程式、production migration 與照護圈送達面板；每日/晚間提醒是否實際送出可在後台查看。

P1：

- Env 型別收斂：目前 `Env` / `AlertEnv` 仍有局部重複定義；下次碰 functions 或 env 欄位時一併收斂，不單獨排純重構。
- 元件渲染測試：下次要改今日清單、吃藥打卡、Profile 切換等核心 UI 時，先補一個真渲染測試，再動功能；不要只依賴字串回歸測試。
- `App.jsx` / Knowledge Treasury 巨頁拆分維持需求觸發：碰功能時先拆當次邊界，再加新功能；不專門排純重構時段。
- EmailJS 回饋資料整理成固定欄位，建立回饋分類表。
- 支援長輩稱謂自訂，例如爸爸、媽媽、阿嬤。
- 家人端顯示「本次 OCR 是新增還是更新」供除錯。
- 協作者頭像聯絡能力已補齊：若有可公開加入的 LINE ID 會直接開啟 LINE；若有 email 則改為寄信；若只有內部 `U...` LINE user id 或完全沒有資料，會提示先補聯絡方式。

P2：

- App 結構債已開始拆分：`care-wedo-app/src/features/medications/MedicationView.jsx` 已承接用藥管理 view / 用藥總表 helper；`care-wedo-app/src/features/appointments/AppointmentView.jsx` 已承接手動提醒 modal 與月曆排程 view；`care-wedo-app/src/features/ocr/OcrWorkflow.jsx` 已承接掃描進度、拍照/文字上傳導引與醫療文件上傳 modal；`care-wedo-app/src/features/shared/careFormatters.js` 已承接日期與類型顯示 helper，避免 App 與 appointments module 各自複製。Shared helper 已把 auth/session/token 驗證抽到 `functions/_shared/auth_identity.ts`，billing / quota / plan limit helper 抽到 `functions/_shared/billing.ts`，`functions/_shared/supabase.ts` 目前 783 行；下一步再逐塊拆 records / document detail、`index.css` 與剩餘 Supabase data helper。
- 正式付費方案與金流：已補 `SUBSCRIPTION_STATE_MACHINE.md`、pure transition helper、unit tests、Care 端中央 webhook 驗簽 / 去重 / fixture tests、Care checkout API 與付款 UI；下一步是小額 live callback 驗收。
- Billing Data Foundation 已上線：已補後端 entitlement helper、paid action event、draft invoice snapshot 與 WEDOPR 中央 webhook 接收端；後續再把取消、退款與付款失敗寬限期完整接入 `billing_events` / `invoices`。
- 持續補 AIO 內容：把 Beta 訪談、真實使用教學與資料安全聲明整理進 `/faq`、`/guide`、`/pricing`、`/llms.txt`。
- 照護資料匯出。
- 家人端 OCR 低信心藥物已標示人工確認；下一步補欄位級確認與新增/更新狀態標示。

詳見 [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)。

## Analytics / WEDO Roll-up Tracking

- `care-wedo-app` 保留 Care WEDO 自有 GA4：`G-21LHKNX5C1`。
- 另於 Vite 入口加裝 WEDO roll-up GTM：`GTM-TNM3J7XS`，用於 `*.wedopr.com` 集團級流量彙總。
- 後續新增公開 HTML 入口時，請同步加入 `wedo_rollup_context`，並帶入 `project_name: 'Care WEDO'`。
- 不要在本專案直接重複安裝 WEDO 主站 GA4 measurement `G-GX3PDLKCNC`；主站目的地由 GTM 容器管理。
