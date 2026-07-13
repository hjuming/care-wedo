# Care WEDO staging 部署前稽核

日期：2026-07-11（Asia/Taipei）  
狀態：**BLOCKED — 未找到可確證且與 production 隔離的 Care WEDO staging target；未執行任何外部寫入**

## 1. 結論

目前不可部署。Cloudflare 帳號只找到既有 `care-wedo` Pages 專案，沒有 Care WEDO staging 專案；Supabase CLI 可見專案只有 Signal WEDO 兩個專案，沒有 Care WEDO staging。Care 本機環境指向另一個 Supabase ref，但目前 CLI 身分看不到該專案，repo 也未 link。依「target 無法確證就停」規則，本輪在建立帳號、fixture、設定 secrets 與部署前停止。

不得把 `care-wedo` 的 production branch 或目前 `.env` 指向的 Care Supabase 當成 staging，也不得把 `signal-wedo-staging` 挪作 Care 測試。

## 2. 已確認的 targets

| 系統 | 環境 | target | 證據與判定 |
| --- | --- | --- | --- |
| Cloudflare Pages | production | project `care-wedo`；domains `care-wedo.pages.dev`, `care.wedopr.com`；account `7f62a5bc86f62578367c93b8a1e0f131` | `wrangler.toml`、本機 Wrangler cache、`wrangler pages project list --json` 一致。`main` push workflow 及 README 都部署至此。|
| Cloudflare Pages | staging | **不存在／至少目前帳號清單無此 target** | Pages project list 沒有 `care-wedo-staging` 或其他可歸屬 Care 的 staging project。|
| Supabase | Care 現行環境（視為 production，禁止操作） | ref `kjivwcqoordwjmhacvps`；host `kjivwcqoordwjmhacvps.supabase.co` | 僅從本機 `.env` 的 `SUPABASE_URL` 解析公開 host；README 記載 production migrations。CLI 無法列到該 project，故 ownership／名稱未以控制面確證。|
| Supabase | staging | **不存在／未查證** | 當前 CLI 身分只列到 `Signal-WEDO` (`trdnoexumhjwyydpmnij`) 與 `signal-wedo-staging` (`ekdbmihiasgeeznnydkw`)；兩者都不是 Care。repo 沒有 `supabase/.temp/project-ref`，CLI 回報未 link。|

## 3. 部署來源與工作樹

- branch：`main`；HEAD：`789feb7b876f72238f820c9f44bb743ed18817f4`（`ci: add cron failure watchdog`）。
- 工作樹已髒：20 個 tracked 檔有修改，另有安全登入、權限測試及 reports 等 untracked 檔。
- 安全登入實作**不在 HEAD commit**。若現在執行 `pages deploy care-wedo-app/dist`，來源會是 dirty working tree 產生的本機 build，不是可重現 commit。
- staging 部署前必須先由主代理確認 intentional diff、完整 gate 通過，建立專用 commit／branch；不可 push `main`，因 `.github/workflows/deploy.yml` 會自動部署 production project `care-wedo` 的 `main` branch。

## 4. staging 環境鍵（只列 key/status）

目前沒有獨立 staging target，所以下列所有 target-side 狀態均為「未設定／無法查證」。本機 `.env` 有同名 key 不代表 staging 可用，也不可複用 production 值。

| Key | 位置 | staging 狀態 | 用途 |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Pages Functions runtime | 未查證 | 必須是新 Care staging ref。|
| `SUPABASE_SERVICE_ROLE_KEY` | Pages Functions secret | 未查證 | staging-only；不可進前端或報告。|
| `GOOGLE_API_KEY` | Pages Functions secret | 未查證 | OCR／藥單實測需要；可先用 staging 限額 key。|
| `GEMINI_MODEL_NAME` | Pages Functions var | 未查證 | OCR model；可沿用非敏感名稱。|
| `VITE_SUPABASE_URL` | Vite build | 未查證 | staging public URL。|
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vite build | 未查證 | staging publishable key；不是 service role。|
| `VITE_CARE_WEDO_REVIEW_LOGIN` | Vite build | 未查證 | 必須精確為 `1`。|
| `VITE_CARE_WEDO_REVIEW_HOST` | Vite build | 未查證 | 必須等於最終 staging hostname。|
| `VITE_LINE_LIFF_ID` | Vite build | 非必要於 password reviewer flow | 現行 repo 有 production 公開值；staging 不應因此啟動 production LINE 流程。|
| `CARE_WEDO_PUBLIC_BASE_URL` | Pages Functions runtime | 未查證 | 若通知／callback 會產生 URL，必須是 staging host。|
| `REMINDER_TEST_ONLY` | Pages Functions runtime | 未查證 | 若測提醒，應為 `1` 並設定虛構 target；否則不執行提醒測試。|
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_LOGIN_CHANNEL_ID`, `CRON_SECRET`, billing/webhook keys | Pages Functions secrets | 本次 reviewer flow 不需要 | 不設定較安全；禁止複用 production，避免通知或金流外送。|

本機 key inventory：`.env` 有 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、Cloudflare credential keys、Google/LINE/金流 keys；`care-wedo-app/.env.example` 有四個 reviewer/Supabase build key。此處僅確認 key 存在，未讀回或記錄值。

## 5. 建立 staging 後的精確施工順序（目前不得執行）

### Gate A — 先建立並回報兩個明確 target

1. 建立 Cloudflare Pages project，建議固定名 `care-wedo-staging`，預期 host `care-wedo-staging.pages.dev`。
2. 在持有 Care 組織權限的 Supabase 帳號建立 project，固定顯示名 `care-wedo-staging`，取得全新 project ref。
3. 用 project list 控制面再次證明兩個 target；把 ref、project name、host 寫入部署記錄。若任一名稱／ref 不一致，停。
4. 新 Supabase project 依 repo 既有 schema/migrations 建立等價 schema。這不是新增 migration，但仍是 staging schema 寫入；執行前由主代理另做清單與驗證。

### Gate B — build 與部署（每一命令的寫入 target）

以下為範本；只有在 `<STAGING_…>` 已由 Gate A 實值取代並二次確認後才可執行。

| 命令／操作 | 寫入 target |
| --- | --- |
| Cloudflare dashboard/CLI 建立 `care-wedo-staging` Pages project | **Cloudflare account `7f62…f131` / 新 project `care-wedo-staging`**；不碰 `care-wedo`。|
| Supabase dashboard 建立 `care-wedo-staging` | **新 Supabase staging ref**；不碰 `kjivwcqoordwjmhacvps` 或 Signal projects。|
| 對新 ref 執行 repo 既有 schema/migrations | **新 Supabase staging ref database only**。|
| 在新 Pages project 設 runtime vars/secrets | **Cloudflare `care-wedo-staging` preview/production env only**。|
| `VITE_SUPABASE_URL=… VITE_SUPABASE_PUBLISHABLE_KEY=… VITE_CARE_WEDO_REVIEW_LOGIN=1 VITE_CARE_WEDO_REVIEW_HOST=care-wedo-staging.pages.dev npm run build --prefix care-wedo-app` | 只寫本機 `care-wedo-app/dist`；build values 指向新 staging Supabase。|
| `npx wrangler@4 pages deploy care-wedo-app/dist --project-name care-wedo-staging --branch reviewer-e2e --commit-message "reviewer staging <SHA>"` | **Cloudflare project `care-wedo-staging`, branch `reviewer-e2e` only**。|

禁止命令：任何 `--project-name care-wedo`、`--branch main`、push `main`、或使用 Care production ref 的 SQL/Auth Admin 呼叫。

## 6. 三帳號與同一家庭 fixture（不用新增 migration）

fixture 全部在**新 Supabase staging ref**與**新 Pages staging host**完成：

1. 用 Supabase Auth Admin（Dashboard 或 `POST /auth/v1/admin/users`）建立三個 email/password 帳號：`primary`、`collaborator`、`elder`；email/password 只放密碼管理器，不寫 repo/report。設定 email confirmed，記下三個 auth user UUID（不記 password）。
2. 三帳號各自從 staging reviewer form 正常 password login，呼叫 `GET /api/me`。既有 identity path 會建立／映射 `public.users.auth_user_id`，不直接偽造 session。
3. `primary` 呼叫 `POST /api/me`：`{"action":"init_family","family_name":"王家照護測試家庭","primary_care_name":"王伯伯（虛構）"}`。既有 API 會建立 `family_groups`、admin membership 與 default `care_profiles`。
4. 從回應／`GET /api/groups` 取得 invite code；`collaborator` 與 `elder` 各呼叫 `POST /api/groups`：`{"action":"join","code":"<INVITE_CODE>"}`。
5. `join` 預設 `role=member, can_manage=true`。現有公開 API 只允許本人更新通知偏好，沒有 admin 設定他人 `can_manage` 的 action。因此用 staging service role 對既有 `user_family_groups` 精確 PATCH：collaborator `role=member, can_manage=true`；elder `role=member, can_manage=false`。條件必須同時帶 `user_id=eq.<ELDER_APP_USER_ID>&group_id=eq.<FIXTURE_GROUP_ID>`，並要求回傳恰好一筆；0 或 >1 立即停。
6. `primary` 透過 UI／既有 API 建立虛構照護資料、預約、掛號與藥單；不使用真實姓名、電話、病歷或處方影像。`collaborator` 驗證可讀寫；`elder` 驗證 GET 可讀、所有 shared mutation 回 403。

清理識別需保存：三個 Auth UUID、三個 app user id、family group id、care profile id、建立的 appointment/medication/document ids；只存 staging deployment audit 的受控 artifact，不進 git。

## 7. 驗證與 rollback

部署後 gate：確認 URL host 精確符合 `VITE_CARE_WEDO_REVIEW_HOST`；production `care.wedopr.com` 與 `care-wedo.pages.dev` 不出現 reviewer form；三角色登入、跨帳號同步、elder 讀取／403；Functions logs 無跨 tenant 或 production outbound；`npm run staging:smoke:ready:report` 的 base URL/ref 必須都指 staging。

Rollback（只對已確認 staging target）：

1. 立即把 `VITE_CARE_WEDO_REVIEW_LOGIN` 改為 `0` 後重建／重部署 `care-wedo-staging`，使入口 fail closed。
2. 列出 staging deployments，取得本次 deployment id；執行 `npx wrangler@4 pages deployment delete <DEPLOYMENT_ID> --project-name care-wedo-staging`。若 alias active，不先用 `--force`；先切回上一個綠色 deployment，再刪。
3. Supabase Auth 先 revoke/delete 三個 staging Auth users，再依保存 ids 精確刪除 fixture family（FK cascade 僅限該 group）；刪除前 SELECT 計數並確認 ref 是新 staging ref。禁止對 Care production ref 執行。
4. 若整個 staging project 要下線，先停用／移除 `care-wedo-staging` Pages custom aliases，再由人工 Dashboard 刪除 staging Pages/Supabase project。Project delete 為高風險破壞操作，需另次 PROCESS GUARD 確認，不納入自動 rollback。

## 8. 本輪證據與未完成事項

- 已執行：git status/log/diff、設定與 workflow read-back、env key-name inventory、Wrangler/Supabase CLI help、兩個控制面的 project list；全部唯讀。
- 未完成：沒有建立 staging projects、沒有設定 vars/secrets、沒有建立 Auth users/fixture、沒有 build/deploy、沒有 live E2E。
- 自行追加：辨識 `main` push 會自動部署 production 的誤觸風險；指出現有 API 無法將 elder 設為 read-only，fixture 必須用 staging-only 精確 membership PATCH。
- 剩餘風險：Care production Supabase 未能由目前 CLI 身分在控制面列出；任何新 staging Supabase 的組織 ownership、schema parity、Auth redirect settings 都仍未驗證。
