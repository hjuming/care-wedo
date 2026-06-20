# Care WEDO — Beta 開發進度與後續計畫

> **最後更新**：2026-06-20
> **當前狀態**：LINE 長輩上傳流程已跑通；後台已收斂成協作者管理中心，並可查看去識別化提醒送達紀錄；Google OAuth 後台登入 MVP 已完成程式與 Phase 58 migration；protected data API 已改用 request-scoped `getRequestUser(context)`，deploy 前 CI gate 已上線。
> **測試政策**：系統測試期間尚未啟用正式收費；介面先呈現照護圈正式計費邏輯與上限。

---

## 1. 產品方向

Care WEDO 不是功能介紹網站，而是長輩與家人打開 LINE 就能使用的照護工具。

核心原則：

- **今日優先**：長輩只需要知道今天或下一次要做什麼。
- **短句提醒**：LINE 不放冗長說明，不列完整藥名與長篇注意事項。
- **家人語氣**：通知要像家人貼心提醒，不像系統公告、客服話術或制式條文。
- **資料完整**：系統完整保存 OCR 結果、上傳文件、藥品與行程資料。
- **家人協作**：家人登入後台查看完整清單、修改錯誤、一起照顧。
- **不讓長輩有錯誤感**：重複上傳時，長輩端不提醒「重複」，系統後台盡量更新同一筆資料。

---

## 2. 總體進度

| 模組 | 狀態 | 說明 |
|---|---|---|
| LINE 登入 / LIFF | ✅ 已完成 | 手機改用 LINE App LIFF deep link，避開手機瀏覽器自動登入卡住 |
| Google OAuth 後台登入 | 🟡 基礎完成 | Supabase Auth token 與 LINE session 已統一到 `verifyCareIdentity`；前端已有 Google 登入與 `/auth/callback`；protected data API 已統一使用 request-scoped `getRequestUser(context)`；待 production 套用 Phase 58 並設定 Google provider / redirect URL |
| LINE Bot OCR | ✅ 已完成 | 支援圖片上傳、文字貼上、AI 解析、Push 摘要、Quick Reply |
| 上傳前選照護對象 | ✅ 已完成 | 多位家人時先顯示姓名標籤，再請使用者上傳 |
| OCR 自動歸屬 | ✅ 已完成 | 姓名/生日可比對照護對象；不確定時詢問 |
| LINE 長輩友善文案 | ✅ 已完成 | 短提醒格式，不塞藥名與長文 |
| 資料入庫 | ✅ 已完成 | `care_documents`、`appointments`、`medications` 關聯存入 |
| 重複上傳基礎防呆 | ✅ 已完成 | 看診/領藥依日期+科別+類型更新；藥品依藥名更新 |
| Dashboard | ✅ 已完成 | 今日照護、未來行程、查詢紀錄、吃藥提醒、家人協作 |
| 家庭群組 | ✅ 已完成 | 建立群組、邀請碼、成員管理、多照護對象；上限為 4 位主要照護對象、5 位協作者、1 位主帳號 |
| 協作者管理中心 | ✅ 已完成 | 設定、邀請、手動新增、資料協助、費用預估集中在照護圈頁 |
| 費用預估 | ✅ 已完成 | 主帳號不列入費用；主要照護對象 $30/位，協作者 $10/位，單一家庭群組 $30-250/月 |
| 手機用藥總表 | ✅ 已完成 | 手機改為欄位標籤卡片，操作改為複製文字與儲存圖片 |
| 未登入首頁 | ✅ 已更新 | 對齊長輩友善定位、方案差異與回饋入口 |
| EmailJS 回饋表單 | ✅ 已完成 | 首頁回饋區塊送出至 EmailJS |
| SEO / AIO / GEO | 🟡 基礎完成 | 社交分享圖、OG/Twitter meta、JSON-LD、FAQPage、sitemap、robots、llms、靜態 `/faq`、`/guide`、`/pricing` 已補齊；仍需持續補 Beta 訪談內容與教學案例 |
| 結構化 log | ✅ 已完成 | 前端與 Functions 皆有安全 log，不記錄 token / 原圖 / 醫療全文 |
| 正式告警 | 🟡 基礎完成 | 已補前端 `/api/telemetry`、事件分類、Cloudflare tail runbook 與 webhook 自動告警；Sentry / Cloudflare Analytics 可作為商轉前增強 |
| LINE 推播稽核 | ✅ 已完成 | Phase 57 migration 已套用；每日/晚間提醒寫入去識別化 `line_push_logs`，照護圈可查看最近送達狀態 |
| Supabase Auth 身分橋接 | 🟡 基礎完成 | Phase 58 migration 新增 `users.auth_user_id` / `auth_provider`；Google 登入建立獨立 Care 使用者，不自動合併 LINE 帳號 |
| API 身份與租戶隔離 | ✅ 已完成 | Protected data API 已統一走 `getRequestUser(context)`；middleware 驗過的 identity 由 handler 重用；新增 source guard 禁止 protected route 直接使用 LINE-only verifier 或舊 auth entry；functions tenant-isolation 測試覆蓋 medications、appointments、profiles、care_documents 跨群組不寫入與同群組可寫入，並覆蓋 dashboard/documents 讀取 scope、foreign document signed URL / storage delete 阻擋與 upload storage path namespace |
| Reminder 發送模式 | ✅ 已完成 | `REMINDER_TEST_ONLY` 改為 `=== "1"` 才進測試模式；未設定或 `0` 為正式模式；cron log 會記錄 `test_only` |
| CI/CD 部署 gate | ✅ 已完成 | `deploy.yml` 部署前跑 lint、前端測試、functions tenant-isolation、Phase 59 RLS policy sync、receipt-pack、build；GitHub Actions 升至 `checkout@v7` / `setup-node@v6` |
| 真實單據回歸包 | 🟡 基礎完成 | 已建立 10 張去識別化 manifest、expected-shapes、私有圖片目錄規則、validator、private image hash 工具、runbook 與 dry-run smoke runner；本機目前缺 10 張 private images，待補私有圖片 hash 與 LINE WebView 實測紀錄 |
| 藥品進階去重 | 🟡 未完成 | 目前仍主要依完整藥名比對 |
| 商轉資料基礎 | 🟡 基礎完成 | 已補 billing schema migration、後端 entitlement helper、paid action event、draft invoice snapshot、`SUBSCRIPTION_STATE_MACHINE.md`、pure transition helper 與 unit tests；`/api/groups` 已回傳 `billing_entitlement`，主控台以後端快照顯示，Production 已套用 phase55。 |
| 付費方案金流 | ⚪ 未開始 | 已先定 subscription state machine 並補 `functions/_shared/subscription_state.ts` / `functions/_tests/subscription-state.test.ts`；正式商轉後再補 migration 欄位、webhook fixture test、checkout API 與 NewebPay / ECPay provider adapter |

---

## 3. 已完成的關鍵流程

### 3.1 LINE 長輩上傳流程

目前建議固定使用這條流程：

1. 使用者輸入「我要上傳」或看到提示。
2. LINE 顯示照護對象姓名標籤。
3. 使用者先點選照護對象。
4. Bot 回覆「好，這次存到【姓名】，請上傳照片，或直接貼上文字。」
5. Bot 提供 `拍照`、`選照片`、`重新選人` 標籤。
6. 使用者上傳藥袋、處方箋、掛號單或預約單照片，或貼上看診、用藥、提醒文字。
7. 系統 AI 解析、存入資料庫、回覆短摘要。
8. 完成後提供 `再傳一張`、`看清單` 標籤。

### 3.2 LINE 回覆文案規則

已採用長輩友善版：

- 只顯示「日期、時間、地點、要做什麼、要帶什麼」。
- 藥袋與處方資料完整存進資料庫，但 LINE 不列長藥名。
- 不重複問候。
- 不說「重複上傳」。
- 連結放最後。
- 排程通知使用 `早安` / `晚安` 獨立開頭，下一行接 `提醒您接下來的注意事項。`
- 結尾固定為 `Care WEDO / 陪你照顧最重要的人 / https://care.wedopr.com`。
- 不在推播放完整地址；若院所名稱已包含醫師姓名，不重複顯示醫師姓名。

範例：

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

排程通知範例：

```text
早安

提醒您接下來的注意事項。

Matt 5/30（六）
下午 3:00 要去看牙。
地點在陳幸妤牙醫診所。

Care WEDO
陪你照顧最重要的人
https://care.wedopr.com
```

### 3.3 LINE 通知排程與收件規則

目前正式規則：

| 通知類型 | 發送時間 | 系統條件 | 收件設定 |
|---|---:|---|---|
| 今日行程提醒（門診、看牙、檢查、領藥） | 當天 08:00 | `appointments.date = 今天` 且 `status = upcoming` | `receive_daily_brief = true` |
| 明日行程提醒（需空腹時加註） | 前一天 20:00 | `appointments.date = 明天` 且 `status = upcoming` | `receive_evening_alert = true` |
| 上傳資料摘要 | 上傳成功後立即 | OCR 完成並歸屬到照護對象後觸發 | 上傳本人 + 同群組其他 `receive_upload_summary = true` 成員 |

上傳摘要細節：

- 上傳本人收到整理結果。
- 同群組其他開啟「上傳摘要通知」的成員會立即收到摘要。
- 系統排除上傳本人，避免同一人收到兩次。
- 沒有 LINE user id、`web-mvp` 測試帳號或關閉通知者不推播。
- LINE Login 與 LINE Bot 可推播是兩件事；家人若要收到推播，必須加入 Care WEDO LINE 照護小管家。邀請文案與家人協作頁需明確提醒這件事。

### 3.4 重複資料處理

目前規則：

| 資料類型 | 去重邏輯 | 長輩端是否提示重複 |
|---|---|---|
| 上傳文件 `care_documents` | 每次上傳都保留一筆 | 否 |
| 看診 / 預約 / 檢查 | 同照護對象、同日期、同科別、同類型則更新 | 否 |
| 領藥提醒 | 同照護對象、同日期、同科別、同類型則更新 | 否 |
| 藥品 | 同照護對象、同藥名則更新 | 否 |

後續要補強：

- 藥品代碼比對。
- 學名 / 商品名拆解。
- OCR 藥名模糊比對。
- 家人後台顯示「新增 / 更新」狀態，長輩端仍維持簡短。

---

## 4. 未登入首頁更新

已完成：

- 首屏文案改成「把醫院單子變成家人看得懂的提醒」。
- CTA 改成兩個明確入口：加入 LINE 小管家、家人登入後台。
- 清楚說明測試期間尚未正式收費，並提前呈現照護圈正式計費邏輯。
- 方案比較改為「Free / 照護圈升級」。
- 新增回饋區塊，使用 EmailJS 送出。

EmailJS 需要的環境變數：

- `VITE_EMAILJS_SERVICE_ID`
- `VITE_EMAILJS_TEMPLATE_ID`
- `VITE_EMAILJS_PUBLIC_KEY`

---

## 5. Free 與照護圈升級功能差異

測試期間：

- 正式收費尚未啟用，但產品介面先呈現正式版上限與費用模型。
- 照護圈升級能力：每位照護對象 100 筆圖片解析/月、4 位主要照護對象、5 位共同協作者、1 位主帳號。
- 內部測試權限不顯示為公開方案，也不放入公開首頁方案。
- 回饋將作為正式版方案設計依據。

正式版規劃：

| 功能 | Free | 照護圈升級 |
|---|---|---|
| LINE 小管家 | 有 | 有 |
| 上傳前選家人 | 有 | 有 |
| 看診單、藥袋、預約單 AI 解析 | 10 筆/月 | 每位照護對象 100 筆/月 |
| 長輩友善短提醒 | 有 | 有 |
| 吃藥提醒與資料保存 | 最近 30 天；不開放歷史查詢 | 完整保存與查詢 |
| 主要照護對象 | 1 位 | 最多 4 位 |
| 共同協作者 | 無 | 最多 5 位；主帳號不計費 |
| 家庭群組共享 | 無 | 多人協作照護 |
| 今日照護與未來行程 | 有 | 有 |
| 完整歷史紀錄與健康時間線 | 無 | 完整保存 |
| 正式版月費訂閱 | $0 | $30-250/月 |

定稿計費公式：

| 項目 | 單價 | 上限 | 最高月費 |
|---|---:|---:|---:|
| 主要照護對象 | $30 / 位 / 月 | 4 位 | $200 |
| 共同協作者 | $10 / 位 / 月 | 5 位 | $50 |
| 主帳號 | $0 | 1 位 | $0 |
| 單一家庭群組 |  | 4 位照護對象 + 5 位協作者 + 1 位主帳號 | $250 |

公開首頁顯示規則：

- 主頁只顯示 Free 與照護圈升級對照。
- 照護圈升級說明以「主要照護對象」與「共同協作者」為第一層，不再用多層方案名稱增加理解成本。
- 超過單一家庭群組上限時，建議由其他協作者帳號另開家庭群組。
- 登入後的照護圈頁顯示目前照護對象數、協作者數與本月費用預估。

---

## 6. 2026-06-20 開發優化紀錄

| 項目 | 狀態 | 實作與驗收 |
|---|---|---|
| Auth 統一 | 已上線 | OCR、新增/編輯預約、用藥確認、文件、profile 排序、dashboard、me、groups 等 protected data API 統一走 `getRequestUser(context)`；保留 LINE session / handoff / callback 的 LINE-only 驗證路徑 |
| Request-scoped auth context | 已上線 | `_middleware.ts` 驗過的 `context.data.identity` 會被 handler 重用；同一 request 的 `requestUser` 會快取，避免 handler 再驗一次 token |
| 跨戶隔離測試 | 已上線 | functions tenant-isolation 測試已覆蓋 medications、appointments、profiles、care_documents：跨群組 PATCH 回 403 / 404 且不寫入；同群組 PATCH 回 200；另覆蓋 dashboard read、documents list、document detail linked records、foreign document signed URL 不外洩、foreign document 不觸發 Storage delete、upload storage path 使用 group/profile namespace |
| Source guard | 已上線 | 新增 regression guard，防止 protected route 再直接 import / call `verifyLineIdToken` |
| Reminder 模式 | 已上線 | `REMINDER_TEST_ONLY=1` 才是測試模式；production 未設定或 `0` 會發送給真實收件者 |
| Deploy gate | 已上線 | `main` push 後，Cloudflare Pages deploy 前必跑 lint、前端測試、functions tenant-isolation、Phase 59 RLS policy sync、receipt-pack、build |
| GitHub Actions runtime | 已上線 | `actions/checkout@v7`、`actions/setup-node@v6`；專案 Node 版本維持 22 |
| Data containment contract | 基礎完成 | `DATA_CONTAINMENT_CONTRACT.md` 明文記錄短期採 service-role-only + app-layer ownership filters；已補 `supabase/migration_phase59_rls_read_policies.sql` 的 authenticated read-only table / Storage object policies、direct write revoke、`scripts/storage-policy-smoke.mjs` 與 runbook，但 Functions 寫入仍以 handler ownership filters / tenant tests 為主 |
| Google protected write smoke | 待 staging 驗收 | `GOOGLE_PROTECTED_WRITE_SMOKE_RUNBOOK.md` 已補 OCR、新增預約、用藥確認三條 Google/Supabase 寫入路徑的實測步驟；`scripts/google-protected-write-smoke.mjs` 可執行 API + DB scope smoke，待 staging Google token 實跑 |
| Frontend feature split | 進行中 | 用藥管理已移到 `care-wedo-app/src/features/medications/MedicationView.jsx`；手動提醒 modal 與月曆排程 view 已移到 `care-wedo-app/src/features/appointments/AppointmentView.jsx`；掃描進度、拍照/文字上傳導引與醫療文件上傳 modal 已移到 `care-wedo-app/src/features/ocr/OcrWorkflow.jsx`；日期與類型顯示 helper 已移到 `care-wedo-app/src/features/shared/careFormatters.js`，避免 App 與 appointments module 重複；`App.jsx` 降到約 3.7k 行，下一步再拆 records / document detail 與 `index.css` |
| Shared auth helper split | 進行中 | 已把 LINE / Supabase / Care session token 驗證抽到 `functions/_shared/auth_identity.ts`；`functions/_shared/supabase.ts` 保留既有 export / re-export 相容，從約 1.6k 行降到約 1.3k 行；下一步再拆剩餘 Supabase data query、group/profile、billing helper |

剩餘風險與優先級修正：

- 仍需先跑 `npm run staging:smoke:ready` 確認必要 env 齊全，再依 `GOOGLE_PROTECTED_WRITE_SMOKE_RUNBOOK.md` 或 `npm run google:protected-write:smoke` 用 staging Google 帳號實測 OCR、新增預約、用藥確認三條寫入路徑。
- Production Cloudflare env 需維持 `REMINDER_TEST_ONLY` 不存在或為 `0`；只有明確測試時才設 `1`。
- 資料圍堵仍是最高風險：目前 repo 內 `supabase/schema.sql` 已啟用 RLS，且補了 authenticated read-only table / Storage object policies；但 Functions 的 `supabaseFetch()` 與 Storage helper 仍使用 service role 呼叫 Supabase，會 bypass RLS。短期合約仍是 service-role-only + app-layer ownership filters，且隔離測試已覆蓋四個核心 PATCH、dashboard/documents 讀取 scope、foreign document signed URL / storage delete 阻擋與 upload path namespace；下一步是 staging Google E2E、`npm run storage:policy:smoke` live verification 與正式 direct-write RLS 設計。

## 7. 後續開發清單

### 版本路線建議

| 版本 | 目標 | 主要交付 |
|---|---|---|
| V1.0 Beta | 已上線，可受控測試 | 長輩 LINE 上傳、協作者管理中心、費用預估、用藥總表 |
| V1.0.1 | 穩定性與信任補強 | 告警、費用確認 modal、真實單據回歸包 |
| V1.0.2 | 醫療資料品質補強 | 藥品去重、OCR 低信心確認、家人端新增/更新標示 |
| V1.1 | Beta 訪談與 AIO 補強 | FAQ、教學、靜態 pricing/guide/faq 頁面 |
| V1.2 | 商轉資料基礎 | billing schema、entitlement helper、帳單快照 |
| V1.3 | 正式訂閱 | LINE Pay / 藍新 / 綠界金流與訂閱流程 |

### 下一階段 PR 建議

| PR | 優先級 | 任務 | 驗收重點 |
|---|---|---|---|
| PR-CARE-P0-001 | P0 | Production Observability & Alerting | 🟡 基礎完成：前端錯誤、Functions/API、LINE push、cron、OCR 失敗可分類追蹤，並可透過 `CARE_WEDO_ALERT_WEBHOOK_URL` 自動通知；待商轉前補 Sentry / Cloudflare Analytics |
| PR-CARE-P0-002 | P0 | Paid Action Confirmation Modal | ✅ 已完成：新增照護對象或共同協作者前顯示目前月費、增加後月費、Beta 不扣款說明 |
| PR-CARE-P0-003 | P0 | Real Receipt Regression Pack | 🟡 基礎完成：已建立 10 張去識別化 manifest、expected-shapes、私有圖片目錄規則、validator、private image hash 工具、runbook 與 dry-run smoke runner；本機目前缺 10 張 private images，待補真實圖片 hash 與 LINE WebView 實測紀錄 |
| PR-CARE-P0-004 | P0 | LINE Push Audit Logs | ✅ 已完成：每日/晚間提醒只保存去識別化推播稽核，不保存完整 LINE id、不保存推播全文；production Phase 57 migration 已套用，照護圈可查看最近送達狀態 |
| PR-CARE-P0-005 | P0 | Google/Supabase Protected Write E2E | 🟡 待 staging 驗收：已補 `GOOGLE_PROTECTED_WRITE_SMOKE_RUNBOOK.md` 與 `scripts/google-protected-write-smoke.mjs`，需以 Google 帳號 token 實測 OCR、新增預約、用藥確認三條寫入路徑 |
| PR-CARE-P0-006 | P0 | Data Containment Contract | 🟡 基礎完成：已補 `DATA_CONTAINMENT_CONTRACT.md`，明文採 service-role-only + app-layer ownership filters；tenant-isolation 已覆蓋四個核心 PATCH、dashboard/documents 讀取 scope、foreign document signed URL / storage delete 阻擋與 upload path namespace；已補 authenticated read-only table / Storage object policies 與 storage smoke，待補 staging Google E2E、Storage policy live verification 與 direct-write RLS 設計 |
| PR-CARE-P1-001 | P1 | Medication Identity Normalization | 🟡 基礎完成：已補 normalized_name、brand/generic/drug code 欄位、OCR 儲存 identity metadata、同藥不同空白/符號更新同一筆、家人端疑似重複提示；待補正式藥碼資料源 |
| PR-CARE-P1-002 | P1 | Billing Data Foundation | 🟡 基礎完成：已完成 `billing_events`、`billing_subscriptions`、`invoices` migration 套用，`/api/groups` 回傳 `billing_entitlement` 並被設定頁作為主要來源；已補 `SUBSCRIPTION_STATE_MACHINE.md`、pure transition helper 與 unit tests；待補 migration 欄位、webhook fixture test、checkout API 與金流 webhook |

### P0：實機穩定性

- 先跑 `npm run staging:smoke:ready`；必要 env 齊全後，依 `GOOGLE_PROTECTED_WRITE_SMOKE_RUNBOOK.md` 或 `npm run google:protected-write:smoke` 用 staging Google 帳號實測 OCR、新增預約、用藥確認三條 protected write path；確認 Google/Supabase 使用者解析到自己的 `userId`，不落到 LINE-only 或共用測試帳號。
- 補資料圍堵第二層防護：目前已明文採 service-role-only + app-layer ownership filters，且 medications / appointments / profiles / care_documents PATCH、dashboard/documents 讀取 scope、foreign document signed URL、foreign document storage delete、upload path namespace 都有負向或合約測試；DB 層已補 authenticated read-only table / Storage object policies、direct write revoke 與 storage smoke。下一步是 staging Google E2E、Storage policy live verification 與 direct-write RLS 設計。
- 用至少 10 張真實台灣醫院單據測試 LINE 上傳流程：已建立 `test-fixtures/real-receipt-regression/manifest.json`、`expected-shapes.json`、`REAL_RECEIPT_REGRESSION_RUNBOOK.md`、`npm run receipt-pack:private-check`、`npm run receipt-pack:hashes`、`npm run receipt-pack:shapes` 與 `npm run receipt-pack:smoke`，真實圖檔不進 Git；目前本機 dry-run 顯示 10 張 private images 尚未放入。
- 測試單張、多張、重複上傳、先選錯人再改人。
- 針對新增照護對象、複製邀請碼、加入群組，補實機測試：1/4、4/4、5/5 協作者、超額提示。
- 補所有 UI 改動的 390px 手機與 LINE WebView 檢查，尤其是照護圈、用藥總表、費用確認。
- Cloudflare tail log 建立常用排查指令：已整理至 `PRODUCTION_OBSERVABILITY_RUNBOOK.md`。
- 補上正式告警：已支援 webhook 自動通知；Sentry 或 Cloudflare Analytics 可作為商轉前增強。
- LINE 推播稽核：已補 `line_push_logs` 程式、migration 與照護圈送達面板；08:00 production 規則固定只送今日行程提醒，不主動推播完整用藥清單。

### P1：OCR 與資料品質

- 強化藥品去重：已補藥名 normalize、商品名/學名/藥碼欄位、疑似同藥候選標記、家人端提示與高信心 exact duplicate 合併；下一步補正式藥碼資料源與完整合併管理。
- OCR 信心不足欄位已在家人審核面板標示需人工確認；下一步補更細的欄位級提示與最終確認紀錄。
- 家人端顯示「本次資料新增 / 更新」。
- 建立 OCR 範例資料集與回歸測試。
- 用藥總表已改為依早／中／晚／睡前排序，且停用藥物不列入「給醫生看」總表；後續補真實案例驗收。

### P1：長輩友善體驗

- 支援稱謂設定：爸爸、媽媽、阿嬤、阿公。
- LINE 文案依單據類型微調：門診、檢查、領藥、藥袋。
- 增加「看不懂，問家人」快捷標籤。
- 今日照護首頁持續減少資訊密度。
- 協作者頭像聯絡能力：✅ 已完成。協作者卡片會優先使用可公開加入的 LINE ID，否則改用 email；若只有內部 `U...` LINE user id 或完全沒有聯絡資料，會明確提示補上聯絡方式，避免無效連結。
- 照護者切換與家庭群組切換持續做手機版可讀性測試，避免頁首資訊過多。

### P2：Beta 回饋與營運

- 前端結構債已開始拆分：用藥管理 view / 用藥總表 helper 已移到 `care-wedo-app/src/features/medications/MedicationView.jsx`；手動提醒 modal 與月曆排程 view 已移到 `care-wedo-app/src/features/appointments/AppointmentView.jsx`；掃描進度、拍照/文字上傳導引與醫療文件上傳 modal 已移到 `care-wedo-app/src/features/ocr/OcrWorkflow.jsx`；日期與類型顯示 helper 已移到 `care-wedo-app/src/features/shared/careFormatters.js`；下一步逐塊拆 records / document detail 與 `index.css`，避免一次大重構。
- Shared helper 結構債已開始拆分：LINE / Supabase / Care session token 驗證已移到 `functions/_shared/auth_identity.ts`，`functions/_shared/supabase.ts` 保留 re-export 相容；下一步拆剩餘資料查詢與 billing helper。
- EmailJS 回饋內容匯整成分類表。
- 建立 Beta 使用者訪談紀錄模板。
- 建立 FAQ 與 LINE 使用教學。
- 靜態 AIO 頁面：`/faq`、`/guide`、`/pricing` 已補，讓不執行 JavaScript 的 AI crawler 也能讀到產品定位、功能限制、價格模型與非醫療診斷聲明。
- 持續強化 `/llms.txt`：後續加入 Beta 訪談摘要、實際教學案例與更完整資料安全聲明。
- 補上正式費用說明頁、付費確認流程與帳務頁。
- 首頁文案可直接使用「每個家庭群組 $30-250/月」作為定價錨點。

### P3：正式商轉

- NewebPay / ECPay 金流。
- 方案升級 / 降級。
- Billing schema、entitlement helper、paid action event、draft invoice snapshot、`SUBSCRIPTION_STATE_MACHINE.md` 與 pure transition helper 已有基礎；下一步補 migration 欄位、webhook fixture test，再把升級、降級、取消、付款失敗寬限期與金流 webhook 接入 `billing_events` / `invoices`。
- 資料匯出與家庭交接。
- 醫療免責聲明與法務再檢查。

---

## 8. 驗證指令

```bash
cd care-wedo-app
pnpm test
pnpm lint
pnpm build
```

目前最後一次驗證狀態：

- 2026-06-20 CI：`Deploy to Cloudflare Pages` passed（lint、前端 + regression、functions tenant-isolation、receipt-pack、build、deploy）。
- 2026-06-20 CI：`Deploy Reminder Scheduler` passed（Cloudflare Cron Worker deploy + secret sync）。
- `npm test`（`care-wedo-app`）：173/173 passed。
- `npm run lint`（`care-wedo-app`）：passed。
- `npm run build`（`care-wedo-app`）：passed。
- `npm run test:functions`：23/23 passed。
- `npm run receipt-pack:check`：OK，含 10 個 expected shapes。
- `npm run rls:policy-sync`：OK，Phase 59 migration 與 `schema.sql` 的 15 個 policy、3 個 helper function、15 個 direct-write revoke 一致。
- Functions import smoke：33 個 `functions/api` / `functions/_shared` TypeScript module 可成功匯入。
- P0-002 費用確認 modal：已用 Chrome DevTools Protocol 模擬 390px 手機寬度檢查，`overflowX = false`
- P0-001 observability 基礎：已補 `/api/telemetry`、事件分類、Cloudflare tail runbook、webhook 自動告警與回歸測試
- P0-003 真實單據回歸包基礎：已補 10 筆 manifest、10 筆 expected-shapes、`npm run receipt-pack:check`、`npm run receipt-pack:private-check`、`npm run receipt-pack:hashes`、`npm run receipt-pack:shapes` 與回歸測試；本機目前缺 10 張 private images
- P1-002 billing foundation 基礎：已補 phase 55 migration、RLS/service-role grant、entitlement helper、paid action event、draft invoice snapshot、subscription state machine、pure transition helper 與回歸測試

---

## 9. 接手提醒

- 不要在回覆或文件中貼出 `.env` 內容。
- LINE webhook 需確認 `https://care.wedopr.com/callback`。
- LIFF Endpoint 需維持 `https://care.wedopr.com/app`。
- 長輩端文案保持短，不教育、不解釋太多。
- 系統資料可完整，但 LINE 對話只放提醒。
