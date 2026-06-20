# 任務執行控制日誌

> 這份文件用來管理 AI 協作開發。請在任務進行中持續更新，不把未驗證事項包裝成完成。

## 0. 語言與讀者設定

| 欄位 | 值 |
|---|---|
| 輸出語言 | zh-TW |
| 讀者 | 創辦人 / 產品負責人 / 工程師 |
| 語氣 | 技術、直接、可驗收 |
| 技術名詞是否翻成人話 | 必要時補充 |

## 1. 任務目標

| 欄位 | 值 |
|---|---|
| 任務開始時間 | 2026-06-20 18:09:26 CST |
| 最後更新時間 | 2026-06-20 19:40:00 CST |

### 目標

- 依目前 active goal 繼續推進 Care WEDO 的 auth-context 收斂、資料圍堵證明、結構債拆分、receipt regression 與 subscription state machine。
- 明確修正優先級：auth-context 是 clarity/perf 清理；最高風險是資料隔離與缺少 live staging Google E2E 證明。
- 本輪只做能用本機證據驗證的改動，不能把缺少 token 的 live smoke 說成完成。
- 接續 Phase 3：把 `SUBSCRIPTION_STATE_MACHINE.md` 從文件合約推進到 pure transition helper + unit tests，但不接 provider、webhook、checkout UI 或 production schema。

### 不做什麼 / 範圍外

- 不手動部署 production、不手動套 production DB migration。
- 完成本機驗收後可依使用者要求 commit / push；push 只走既有 CI/CD gate，不手動跳過 gate。
- 不輸出任何 token、service role key、醫療個資或測試帳號敏感值。
- 不修改 production config、Cloudflare secrets、Supabase production schema。
- 不把 mock / unit 測試當成 live E2E 或 production 驗證。
- 不接正式付款按鈕、不新增金流 provider adapter、不處理 webhook payload、不變更 production billing data。

### 成功標準

- [x] 對目前 worktree 做現況盤點，分清已驗證、部分驗證、未驗證。
- [x] 若本機缺少 Google staging smoke 必要環境，明確標記未驗證。
- [x] 至少推進一項不依賴外部 token 的剩餘工作，並跑對應本機驗證。
- [x] 文件與測試敘述不得誇大 auth-context 的安全價值，也不得掩蓋 service-role-only 的資料防線邊界。
- [x] 補 pure subscription state transition helper，輸入 current state + event，輸出 next state / side effects / 是否需 idempotency key。
- [x] 補 functions unit tests 覆蓋合法 transition、非法 transition、idempotent webhook replay 合約。
- [x] 補記 shared formatter extraction 與文件進度，避免 README / DEVELOPMENT_PLAN / data contract 和目前 worktree 不一致。
- [x] 補 auth/public-boundary guard，鎖住 middleware public allowlist 不得包含 protected data APIs，且 cron endpoints 必須以 `CRON_SECRET` fail closed。
- [x] 將 Phase 59 migration ↔ `schema.sql` 一致性檢查從人工比對升級成 `npm run rls:policy-sync` 與 deploy gate。
- [x] 新增 staging smoke readiness gate，聚合 Google protected-write 與 Storage policy smoke 必要 env，避免 live smoke 開始後才發現缺 token / path。
- [x] 將 staging readiness gate 寫回資料圍堵合約與兩份 smoke runbook，避免只在 README / 開發計畫提到。
- [x] 追加 appointment create 與 medication taken 的行為型 tenant-isolation 測試，補上 staging protected-write smoke 對應的本機負向證據。

## 2. 使用者明確要求

- 工程分析要修正優先級：資料圍堵是最高風險，auth-context 是便宜清理。
- Phase 0：新增 request-scoped auth context，避免同一 request 重複驗證，CI guard 防止入口混用。
- Phase 1：跑 staging Google E2E smoke、補滿四類資源隔離測試、RLS policy 或明文 service-role-only 決策。
- Phase 2：拆大檔，優先 `features/{ocr,appointments,medications}/`，每次小拆、保持測試綠；receipt hash / expected shape 補實。
- Phase 3：金流先寫 subscription state machine，不先接付款按鈕。

## 3. 待釐清問題與假設

| 問題 / 模糊處 | 目前假設 | 如果假設錯了，修改成本 | 是否需要使用者確認 |
|---|---|---:|---|
| 最新訊息要求驗收後 Git 推上線 | 本輪完成本機 gate 後允許 commit / push；但不手動改 production DB / secrets / config | 低 | 否 |
| 本機 `.env` 是否有 staging Google token 與測試資料 | 目前只看到 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`，沒有 smoke 所需 Google token/profile/group/user id | 低 | 否，先標未驗證 |
| 是否現在實作 RLS policy | 本輪只新增 repo 內 authenticated read-only table / Storage object policy migration/schema，不套 production、不開 direct write grant | 中 | Direct-write RLS / Storage direct upload/delete policy 需另行設計與 staging 驗證 |

## 4. AI 自行決定

| 決定 | 為什麼這樣做 | 考慮過的替代方案 | 風險 |
|---|---|---|---|
| 先檢查 env key，不讀出 value | 避免 secrets 外洩，同時確認 live smoke 是否可跑 | 直接 source `.env` 跑 smoke | 若 key 掃描格式漏判，會低估可驗證範圍 |
| 本輪先做本機可驗證的 Phase 2 拆分 | live E2E 缺 Google token；結構債仍是 active goal 明確項目 | 等使用者補 token | 可能使資料隔離 live 證明仍停留未驗證 |
| 把 auth/session/token verifier 從 `supabase.ts` 抽出，但保留 re-export | `supabase.ts` 同時放 DB helper 與身份驗證，維護邊界過寬；保留 re-export 可避免 handler 大量 import churn | 直接改所有 import 指向新檔 | 大範圍 import churn 會提高回歸風險 |
| 補 authenticated read-only RLS policy，不開 direct write grant | 最高風險是資料圍堵；目前 Functions 仍用 service_role，直接開 authenticated write 會新增攻擊面 | 只維持 service-role-only 文件決策，不補 DB policy | 只能提供 direct authenticated read 的 DB 防呆；service_role 仍會 bypass RLS，不能取代 handler isolation tests / staging E2E |
| 補 care-documents Storage object read policy，不開 direct upload/delete | 原始醫療文件在 private bucket；只靠 handler signed URL 仍缺 provider-level 防呆 | 等 staging 再補 Storage policy | source guard 可先鎖住 path namespace 與 direct write revoke，但仍需 staging live verification |
| 補 Storage policy smoke 腳本，但不在缺 env 時硬跑 live | staging policy 行為需要 user token + owned/foreign object 才能證明；dry-run 可先鎖住驗收步驟 | 等 env 到位再寫腳本 | 本輪仍不能宣稱 staging Storage policy 已驗證 |
| 補 receipt private-image hash 工具，但不偽造 hash | 本機缺 10 張 private images；不能把 placeholder 說成完成 | 手動 shasum 後人工填 manifest | 腳本可降低填錯風險，但實際 hash 仍待 private images 到位 |
| 驗證通過後才 git push，不手動跳過 CI | 使用者要求推上線；但資料圍堵仍缺 live staging smoke，因此只能推 repo/CI，不能宣稱 staging/prod DB 已驗收 | 直接手動部署或套 production migration | CI 可能自動部署前端/functions；DB migration、secrets、live smoke 仍需人工憑證與 staging 證據 |
| Phase 3 只補 pure helper，不接 provider/webhook/checkout | 使用者要求「金流先寫狀態機，別先接付款按鈕」；pure helper 可用本機單元測試驗證，且沒有外部副作用 | 直接做 checkout API 或 provider adapter | 仍不能宣稱正式金流可用；只把狀態轉移規則從文件變成可測合約 |
| 本輪只補文件與控制日誌，不再擴大應用程式拆分 | 最新問題是「還有哪些未施作優化」，目前最需要的是把已做/未做/已驗證/未驗證對齊 | 繼續拆 records / document detail | 會延後結構債實作，但降低交付文件錯誤 |
| 採用使用者補充的 6 批 commit 分組，但先修正本機新增 guard 帶來的測試數字 | 分批 commit 才能 review / bisect；我剛新增兩個 regression guard，文件若仍寫 169/169 會失真 | 直接照附件 commit，不更新數字 | 需要更仔細 staging，避免檔案被放錯批 |
| 先補 protected-write 對應的本機 tenant tests，而不是新增不存在的 list endpoint 測試 | repo 目前沒有 appointments / medications 獨立 list endpoint；dashboard 已覆蓋列表 scope。appointment create 與 medication taken 剛好是 staging smoke 要驗的兩條寫入路徑 | 硬寫 source guard 或測不存在 endpoint | 仍不能取代 staging Google E2E，但能防止 app-layer ownership filter 回歸 |

## 5. 規格偏離

| 偏離項目 | 原因 | 使用者是否同意 | 是否需要後續處理 |
|---|---|---|---|
| staging Google E2E 尚未實跑 | 本機缺少 smoke 必要 Google token、profile/group/user 測試資料 | 未確認 | 需要補環境後執行 `npm run google:protected-write:smoke` |

## 6. Surgical Change 追溯

| 檔案 / 區域 | 改了什麼 | 對應哪個需求 | 是否必要 | 備註 |
|---|---|---|---|---|
| `implementation-control-log.md` | 新增本輪任務邊界、風險與驗證紀錄 | 非 trivial / 高風險 AI 開發任務需可審查 | 是 | 依 `ai-development-control-log` |
| `care-wedo-app/src/features/appointments/AppointmentView.jsx` | 新增 appointments feature module，承接手動提醒 modal、月曆排程 view、Google/Apple calendar UI 與提醒文字複製 | Phase 2 拆大檔：`features/{ocr,appointments,medications}/` | 是 | 只搬 UI/前端 helper，不改 API contract |
| `care-wedo-app/src/App.jsx` | 改為 import appointments / OCR workflow feature modules，刪除搬出的 UI 區塊 | 降低 App.jsx 結構債 | 是 | App 約 4,328 行降至 3,728 行 |
| `care-wedo-app/src/features/ocr/OcrWorkflow.jsx` | 新增 OCR workflow module，承接掃描進度、拍照/文字上傳導引、醫療文件上傳 modal | Phase 2 拆大檔：`features/{ocr,appointments,medications}/` | 是 | 只搬 UI/本地表單狀態，不改 OCR API / confirm / tenant scope |
| `care-wedo-app/src/ocr-correction-regression.test.js` | 文字上傳 source guard 改讀 OCR workflow module | 保留 OCR 文字上傳行為驗收 | 是 | App 仍驗 handler 接線 |
| `care-wedo-app/src/document-library-regression.test.js` | 文件上傳 modal source guard 改讀 OCR workflow module | 保留醫療文件上傳 UI 驗收 | 是 | 文件 detail modal 暫留 App |
| `care-wedo-app/src/security-regression.test.js` | source guard 改讀 appointments / OCR feature module | 保留原測試意圖，避免測試鎖死大檔結構 | 是 | 行為期待不降級 |
| `functions/_shared/auth_identity.ts` | 新增 LINE / Supabase / Care session token 驗證 module | Phase 2 shared helper 拆分 | 是 | 純結構拆分；不改 token verification contract |
| `functions/_shared/supabase.ts` | 移除內嵌 auth/session verifier，改 import 並 re-export `auth_identity.ts` API | 降低 shared helper 職責混雜 | 是 | 既有 import 路徑仍相容 |
| `care-wedo-app/src/supabase-auth-regression.test.js` | auth source guard 改讀 `auth_identity.ts`，並確認 `supabase.ts` 保留 re-export | 保留 Supabase/LINE unified identity guard | 是 | 避免測試錯鎖舊大檔 |
| `care-wedo-app/src/security-regression.test.js` | session cookie / HMAC source guard 改讀 `auth_identity.ts`，並確認 `supabase.ts` 保留 re-export | 保留 session cookie 安全期待 | 是 | 行為期待不降級 |
| `supabase/migration_phase59_rls_read_policies.sql` | 新增 Care WEDO authenticated read-only table / Storage object RLS helper functions 與 select policies | Phase 1：RLS policy 或明文決策；補 DB / Storage provider-level 防呆 | 是 | 不 grant authenticated write；不套 production |
| `supabase/schema.sql` | 同步 phase 59 table / Storage RLS read policies 到完整 schema | 保持 schema 與 migration 方向一致 | 是 | service_role bypass 註解仍保留 |
| `care-wedo-app/src/data-containment-regression.test.js` | 新增 source guard：核心表與 Storage object 需有 authenticated read-only policies，且不得 grant anon/authenticated writes | 防止 RLS policy 再退回零 policy 或誤開 direct writes | 是 | 靜態 guard，不等於 staging DB / Storage policy 實測 |
| `scripts/storage-policy-smoke.mjs` | 新增 Storage policy live smoke / dry-run 腳本，使用 publishable key + authenticated access token 驗 owned object 可讀、foreign object 不可讀 | Phase 1：Storage policy live verification 可執行化 | 是 | 不使用 service role；不輸出 token / object path |
| `STORAGE_POLICY_SMOKE_RUNBOOK.md` | 新增 Storage policy staging 驗收 SOP | 讓 live verification 可以直接照做 | 是 | 只列 env key，不列值 |
| `package.json` | 新增 `storage:policy:smoke` / `storage:policy:smoke:dry` | 將 Storage policy smoke 納入可執行 script | 是 | 不放 CI，因為需要 staging token/object |
| `scripts/validate-real-receipt-private-images.mjs` | 新增 private image hash 檢查 / 寫入工具 | Phase 2：receipt hash 補實流程可執行化 | 是 | dry-run 不印私有路徑或 sha256；本機目前缺 10 張圖 |
| `REAL_RECEIPT_REGRESSION_RUNBOOK.md` | 改用 `receipt-pack:private-check` / `receipt-pack:hashes` 取代手動 shasum | 降低人工填錯 hash 的風險 | 是 | 圖片仍不可 commit |
| `scripts/validate-real-receipt-pack.mjs` | 檢查 manifest 中的 sha256 必須是 64 位 hex，placeholder 只能是固定字串 | 防止 hash 欄位格式漂移 | 是 | 不要求 CI 必須有私有圖 |
| `care-wedo-app/src/real-receipt-regression.test.js` | 鎖定 private hash script、runbook 與 package scripts | 防止 receipt hash 工具被移除 | 是 | 不跑私有圖 live OCR |
| `README.md` | 更新結構債拆分進度 | 紀錄開發優化進度 | 是 | 標明 records / document detail、CSS / Supabase helper 待拆 |
| `DEVELOPMENT_PLAN.md` | 更新 Frontend feature split 進度列與後續待辦 | 紀錄開發優化進度 | 是 | 不宣稱 Phase 2 完成 |
| `functions/_shared/subscription_state.ts` | 新增 pure subscription state transition helper，定義狀態、事件、side effects、invoice status 與 idempotency key contract | Phase 3：金流先寫狀態機，不先接付款按鈕 | 是 | 不呼叫 provider、不寫 DB、不改前端權益 |
| `functions/_tests/subscription-state.test.ts` | 新增合法 transition、非法 transition、checkout pending 不擴權、provider webhook idempotency key、entitlement/retry no-op 測試 | Phase 3：狀態機需可測 | 是 | functions tests 從 17 增至 23 |
| `care-wedo-app/src/billing-foundation-regression.test.js` | Source guard 追加檢查 state helper 與 unit test 存在，並確認前端仍沒有 checkout/paymentIntent/信用卡付款 | 防止 subscription state machine 退回 doc-only 或前端先開付款 | 是 | 不測 live 金流 |
| `SUBSCRIPTION_STATE_MACHINE.md` | 更新狀態為設計合約 + pure helper/unit tests；明列 provider/webhook/checkout/schema 仍待做 | 避免把 pure helper 誤讀成金流完成 | 是 | `refund_confirmed` 刻意拒絕直到退款政策定稿 |
| `README.md` / `DEVELOPMENT_PLAN.md` | 同步 billing / 金流進度為 pure state machine + tests 已完成，migration/webhook/checkout 待做 | 開發優化進度紀錄 | 是 | 不宣稱金流可用 |
| `care-wedo-app/src/features/shared/careFormatters.js` | 承接日期、類型 label/icon、日期 normalize / format helper | Phase 2 拆大檔與 shared helper 收斂 | 是 | 從 App / appointments module 移出重複 helper |
| `care-wedo-app/src/App.jsx` | 改 import shared formatter，移除本地日期/類型 helper 定義 | Phase 2：降低 App.jsx 重複與責任範圍 | 是 | 行為不變，已用 frontend tests/build 驗證 |
| `care-wedo-app/src/features/appointments/AppointmentView.jsx` | 改 import shared formatter，移除本地日期/類型 helper 定義 | Phase 2：避免 appointments module 與 App 複製邏輯 | 是 | 行為不變，已用 frontend tests/build 驗證 |
| `DATA_CONTAINMENT_CONTRACT.md` | 更新 functions 本機測試預期數字，並標註不等於 live smoke | 文件與目前測試範圍對齊 | 是 | 避免把過期數字或本機測試誤讀成 staging 驗證 |
| `README.md` / `DEVELOPMENT_PLAN.md` | 補記 `features/shared/careFormatters.js` 與 shared formatter 拆分進度；同步 functions 測試數字 | 開發優化進度紀錄 | 是 | 不宣稱 Phase 2 完成 |
| `care-wedo-app/src/auth-unification-regression.test.js` | 新增 middleware public allowlist guard 與 cron `CRON_SECRET` guard | Phase 1：資料圍堵邊界防回歸 | 是 | 防止 protected data APIs 被加入 public allowlist；cron 仍可在 middleware 公開但 handler 必須驗 secret |
| `scripts/validate-phase59-policy-sync.mjs` | 新增 Phase 59 migration 與 `schema.sql` policy/helper/revoke drift validator | Phase 1：安全規則 fresh-install / incremental 兩條路一致 | 是 | 不連線資料庫，只做 repo 內 source-of-truth 一致性檢查 |
| `package.json` | 新增 `rls:policy-sync` script | 讓 policy sync 可手動與 CI 重跑 | 是 | Root npm tooling 已由 deploy workflow 安裝 |
| `.github/workflows/deploy.yml` | 在 receipt-pack/build 前新增 Phase 59 RLS policy sync gate | 防止安全 policy drift 仍部署 | 是 | 任一 drift 會阻擋 deploy |
| `care-wedo-app/src/data-containment-regression.test.js` | 新增 validator / package script / deploy workflow wiring guard | 防止 policy sync gate 被移除 | 是 | 靜態 guard，不等於 staging DB live verification |
| `README.md` / `DEVELOPMENT_PLAN.md` | 更新 CI gate 與驗證紀錄，加入 Phase 59 RLS policy sync | 開發優化進度紀錄 | 是 | 不宣稱 staging policy 已套用 |
| `scripts/staging-smoke-readiness.mjs` | 新增 Google protected-write + Storage policy smoke readiness gate | Phase 1：staging E2E 前置檢查可執行化 | 是 | 不打 live endpoint；缺 env 時 strict mode exit 1 |
| `package.json` | 新增 `staging:smoke:ready` / `staging:smoke:ready:report` | 讓 staging smoke readiness 可一鍵檢查 | 是 | report mode 不會失敗，strict mode 缺 env 會 fail closed |
| `care-wedo-app/src/supabase-auth-regression.test.js` | 新增 staging readiness script source guard | 防止 readiness gate 被移除或輸出 token/path | 是 | 靜態 guard，不等於 live smoke |
| `DATA_CONTAINMENT_CONTRACT.md` | 新增 staging live smoke 前必跑 readiness 的合約規則，並明列 Google / Storage live verification 仍待補 | Phase 1：資料圍堵 SSOT 對齊實際 gate | 是 | 不宣稱 staging 已驗證 |
| `GOOGLE_PROTECTED_WRITE_SMOKE_RUNBOOK.md` / `STORAGE_POLICY_SMOKE_RUNBOOK.md` | 在各自 dry-run 前補合併 readiness gate | Phase 1：避免只檢查單支 smoke env | 是 | readiness 不打 live endpoint |
| `care-wedo-app/src/data-containment-regression.test.js` | 新增合約 / runbook 必須提到 `staging:smoke:ready` 的 source guard | 防止 runbook 與資料圍堵合約漂移 | 是 | 靜態 guard |
| `functions/_tests/tenant-isolation.test.ts` | 新增 appointment create foreign profile 不 insert / owned profile insert 帶 scope；新增 medication taken mixed/foreign ids 不寫 log / owned meds 寫 owned group logs | Phase 1：補強 staging protected-write smoke 對應的本機隔離證據 | 是 | mock fetch 驅動真 handler，不等於 live staging smoke |
| `DATA_CONTAINMENT_CONTRACT.md` / `README.md` / `DEVELOPMENT_PLAN.md` | 更新資料圍堵覆蓋範圍與 functions 測試數字 | 文件與測試現況對齊 | 是 | 不宣稱 production DB 或 staging live 已驗證 |

## 7. 取捨

| 選擇 | 好處 | 成本 / 代價 | 什麼時候要重新檢查 |
|---|---|---|---|
| 先補 authenticated read-only table / Storage object policies，不開 direct write | 能消除「RLS 零 policy」與 Storage provider-level 空窗，同時不新增 authenticated direct write 攻擊面 | 一次補完整 insert/update/delete / direct upload/delete policy | 寫入仍由 service-role Functions 與 handler ownership filters 負責；service_role bypass 仍需 tenant tests / staging E2E |
| 不把 dry-run / mock 測試寫成 live 驗證 | 驗收可信度清楚 | 報告會保留未完成項 | 補齊 staging token 與測試資料後 |

## 8. 高風險 / 不可逆操作檢查

- [ ] 刪除或覆寫使用者資料
- [x] 修改資料庫 schema 或 migration（repo 內新增 authenticated read-only table / Storage object RLS policy migration/schema；未連線套用 production）
- [ ] 部署到 production 或修改 production config
- [x] 修改付款、金流、訂閱、財務邏輯（僅新增 pure subscription state transition helper / unit tests；不接 provider、不改 schema、不部署）
- [x] 修改登入、權限、授權、secret（僅 auth/session verifier 檔案邊界拆分；保留 re-export 與既有驗證 contract，未改 secret/config）
- [ ] 修改核心計算或商業邏輯
- [ ] 執行不可逆外部副作用
- [ ] 超出需求的大範圍重構
- [ ] 以上皆無（本輪包含 auth/session verifier 結構拆分，因此不得標成「皆無」）

## 9. 驗證結果

### 回報可信度

- [ ] ✅ 已真實驗證：有真實工具輸出、測試、live smoke 或 production check 支撐
- [x] ⚠️ 部分驗證：只驗證一部分，或缺少 live / production 證據
- [ ] ❌ 未驗證：只是推論、閱讀文件，或尚未實際執行檢查

### 測試類型標籤

- [x] mock：隔離測試屬 mock fetch 驅動
- [x] unit：前端 / functions 測試可本機執行
- [ ] integration
- [ ] live smoke
- [ ] production verified

### 已驗證

| 檢查 | 指令 / 方法 | 結果 |
|---|---|---|
| smoke env key 掃描 | 只列 `.env` key 名 | 只看到 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`；缺 Google smoke token 與測試 id |
| 前端 regression | `TZ=Asia/Taipei npm test`（`care-wedo-app`） | 174/174 pass |
| auth/public-boundary regression | `node --test care-wedo-app/src/auth-unification-regression.test.js` | 7/7 pass；包含 protected data API auth entry、middleware public allowlist、cron secret guard |
| data containment source guard | `node --test care-wedo-app/src/data-containment-regression.test.js` | 5/5 pass，涵蓋 table / Storage object read-only policies、Storage smoke wiring、Phase 59 sync deploy gate、staging readiness contract/runbook guard |
| Storage policy smoke dry-run | `set -a; source .env; set +a; node scripts/storage-policy-smoke.mjs --dry-run` | pass；Supabase URL 可載入，但缺 publishable key、user access token、owned/foreign object path |
| 前端 lint | `npm run lint`（`care-wedo-app`） | pass |
| 前端 build | `npm run build`（`care-wedo-app`） | pass，Vite 產出 `dist/` |
| receipt regression pack | `npm run receipt-pack:check` | pass，10 cases / 10 expected shapes |
| receipt private image hash dry-run | `node scripts/validate-real-receipt-private-images.mjs --dry-run` | pass；回報 10 張 private images 缺失，不印私有路徑或 sha256 |
| Google protected write smoke dry-run | `set -a; source .env; set +a; node scripts/google-protected-write-smoke.mjs --dry-run` | pass；Supabase env 可載入，但缺 staging base URL、Google token、profile/group/expected user id，live steps 未執行 |
| whitespace check | `git diff --check` | pass |
| functions auth / tenant isolation / subscription state | `env TZ=Asia/Taipei npm run test:functions` | 27/27 pass |
| shared auth import smoke | `node --import tsx -e 'await import("./functions/_shared/supabase.ts"); await import("./functions/_shared/auth_identity.ts"); console.log("shared imports ok")'` | pass |
| doc sync guard | `rg -n "1[7]/1[7]\|2[3]/2[3]" DATA_CONTAINMENT_CONTRACT.md README.md DEVELOPMENT_PLAN.md implementation-control-log.md` | pass；無舊 functions 測試數字殘留 |
| duplicate formatter guard | `rg -n "function (todayInTaipei\|isDateTodayOrFuture\|typeLabel\|typeIcon\|normalizeDateInput\|formatDateLabel)" care-wedo-app/src/App.jsx care-wedo-app/src/features/appointments/AppointmentView.jsx care-wedo-app/src/features/shared/careFormatters.js` | 只剩 `careFormatters.js` 有 helper 定義 |
| Phase 59 policy sync | `npm run rls:policy-sync` | pass；15 個 policy、3 個 helper function、15 個 direct-write revoke 一致 |
| staging smoke readiness report | `set -a; source .env; set +a; npm run staging:smoke:ready:report` | partial；輸出 redacted missing env，不打 live endpoint；目前 `ready:false` |
| data containment contract guard | `node --test care-wedo-app/src/data-containment-regression.test.js` | pass；合約與兩份 smoke runbook 都要求先跑 readiness gate |
| control log schema | `python3 /Users/hjuming/網站專案/skills-wedo/skills/ai-development-control-log/scripts/validate-control-log.py implementation-control-log.md` | pass |

### 未驗證

| 區域 | 為什麼未驗證 | 風險 |
|---|---|---|
| staging Google protected write E2E | 缺 `CARE_WEDO_GOOGLE_ACCESS_TOKEN` / profile / group / expected user id | 仍不能證明 Google/Supabase provider/token audience/redirect 在 staging 全通 |
| staging Storage policy live verification | 尚未把 phase 59 套到 staging，也缺 publishable key、authenticated token、owned/foreign test object path | 只能證明 repo migration/source guard/dry-run，不代表 staging Storage policy 已生效 |
| real receipt private hashes / LINE WebView | 本機缺 10 張 private images；尚未跑實機 LINE WebView | 只能證明 manifest/expected-shapes/hash 工具，不代表真實 OCR 回歸完成 |
| production DB / secrets / live smoke | 本輪未手動套 migration、未改 secrets、未跑 live smoke | 只能保證 repo / CI gate 可驗證，不代表 staging/prod DB policy 或 Google/Storage live path 已生效 |

## 10. 回滾計畫

- Commit / branch：本輪 follow-up 驗證通過後 commit / push；若需回滾，用 `git revert <follow-up commit>`。
- 要還原的檔案：回滾本輪新增 / 修改檔案即可。
- 資料恢復步驟：本輪不改外部資料。
- 設定回滾步驟：本輪不改 production config / secrets。

## 11. 給人類審查的最終摘要

| 項目 | 摘要 |
|---|---|
| 改了什麼 | Auth context / tenant isolation / receipt / subscription 文件化之外，本輪再拆 appointments / OCR workflow feature、shared frontend formatter、shared auth identity helper，補 authenticated read-only table / Storage object RLS policy migration/schema、Storage policy smoke 腳本、receipt private-image hash 工具，並追加 appointment create / medication taken 行為隔離測試 |
| 沒改什麼 | 不手動部署、不改 production schema/secrets；不改 tenant isolation handler 行為 |
| AI 自行決定 | 先做可本機驗證的 appointments / OCR workflow feature split 與 auth identity helper split，live E2E 保持未驗證 |
| 規格偏離 | staging Google E2E 尚未實跑 |
| 已驗證 | 前端 test/lint/build、functions test 27/27、Phase 59 policy sync、data-containment source guard、receipt-pack、staging readiness report、google/storage smoke dry-run、diff whitespace |
| 未驗證 | staging live smoke、staging Storage policy、real receipt private hashes / LINE WebView、production |
| 回滾方式 | 還原本輪檔案變更 |
