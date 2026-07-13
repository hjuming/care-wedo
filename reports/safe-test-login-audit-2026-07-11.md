# Care WEDO 安全測試登入唯讀稽核

日期：2026-07-11  
範圍：`care-wedo-app/src`、`functions`、auth / tenant 測試、env schema、Supabase schema / RLS  
狀態：設計完成；未修改產品程式碼、未建立帳號、未讀寫 secrets、未套 migration、未部署

## 1. 任務解讀

- 目標：讓三位 persona 審查員可登入同一個隔離的測試家庭，分別扮演主要照護者、家庭協作者、長輩觀看者，並完成照護資料、行程、掛號、藥單與家庭協作實測。
- 約束：不能以固定 user id、未簽章 header、query string 角色、共用万能密碼或 production 可啟用的 auth bypass 達成；前端不可持有 service role；測試資料不得混入真實醫療資料。
- 交付物：登入與 session SSOT、family / role enforcement、既有 fixture pattern、最小安全設計、TDD 順序、設定需求、威脅模型與 fail-closed 條件。
- 驗收：三個獨立帳號可進同一 staging 家庭；主要照護者與協作者可依現行權限操作，長輩預設唯讀；任何錯誤環境、缺設定、錯帳密、跨家庭或角色竄改皆拒絕。
- 主要風險：目前後端多數寫入只檢查「是群組成員」，尚未普遍 enforcement `can_manage`；直接把長輩加入現有群組並不會自然得到唯讀權限。

## 2. 結論（建議方案）

採用「**staging 專用的三個正常 Supabase Auth email/password 帳號 + staging 專用家庭 fixture + 只在明確 review build 顯示的測試登入選擇器**」。不要新增會簽發合成 LINE session、接受 master password、指定 user id，或跳過 `verifyCareIdentity()` 的測試 API。

原因：後端已能驗證正常 Supabase access token，前端也已有 Supabase OAuth session 保存與 bearer 傳遞。最小安全改動只需補 email/password sign-in helper 與 review UI；登入後仍完整走既有 middleware、`getRequestUser()`、Supabase `/auth/v1/user` 驗證及 tenant ownership filters，沒有第二套信任鏈。

部署邊界：**只在獨立 staging / preview 網域與獨立 staging Supabase 專案使用**。正式站 build 必須沒有入口；即使有人竄改瀏覽器 UI flag，也只能呼叫 Supabase 的正常密碼登入，不能繞過後端驗證。不要在 production Supabase 建這三個 fixture 身分。

## 3. 登入與 session 真相來源

### 3.1 後端身份驗證

1. `functions/api/_middleware.ts:19-29,42-59`：protected API 的總閘門。public allowlist 很窄；其餘路由先取 bearer / cookie，再呼叫 `verifyCareIdentity()`，成功後把 identity 放入 `context.data`。
2. `functions/_shared/auth_identity.ts:58-68`：token 來源為 `Authorization: Bearer`，沒有時才讀 `care_wedo_session` cookie。
3. `functions/_shared/auth_identity.ts:111-123,295-342`：JWT 外觀符合 Supabase 時，後端向 Supabase `/auth/v1/user` 驗證；否則走 LINE token / Care WEDO session 驗證。這是身份真偽 SSOT。
4. `functions/_shared/auth_context.ts:26-48`：handler 入口 `getRequestUser()` 重用 middleware identity，再以 `getOrCreateUserFromIdentity()` 對應應用層 `users.id`。
5. `functions/_shared/supabase.ts:300-345`：Supabase identity 以 `auth_user_id` 唯一對應／建立 app user；不能讓測試 UI自行指定 app user id。

### 3.2 LINE server session

- `functions/_shared/auth_identity.ts:30-34,125-171,192-235`：LINE session 是 HMAC 簽章的 `cw_session.*`，cookie 為 HttpOnly / Secure / SameSite=Lax，預設 60 天。
- `functions/api/session.ts:39-63`：只有經 LINE verifier 驗證成功的 bearer 才能換 server cookie。
- `functions/api/session/handoff.ts:15-44`：handoff token 只有 5 分鐘，但仍是 LINE 身分接手機制，不適合拿來當 persona test login。

### 3.3 前端 Supabase session

- `care-wedo-app/src/services/supabaseAuth.js:1-5,48-89`：Supabase access / refresh token 存於 localStorage；access token 解析只供 UI 顯示，真正授權仍由後端 `/auth/v1/user` 驗證。
- `care-wedo-app/src/services/api.js:10-19`（由測試與呼叫面確認）：protected API 送 `identity.accessToken || identity.idToken` bearer。
- `care-wedo-app/src/services/liff.js:121-155`：boot 先找 server session / Supabase session；production 不允許本機 demo identity。
- `care-wedo-app/src/App.jsx:1622-1660`：Dashboard boot 的 production demo fail-closed、登入後 invite join 與 dashboard 初始化。

## 4. Family / tenant / role 權限 enforcement

### 4.1 tenant / family 隔離

- `functions/_shared/supabase.ts:392-433`：先查 `user_family_groups`，再用 membership group ids 查 groups / profiles。
- `functions/api/dashboard.ts:407-449,483-503`：requested group 必須存在於使用者 groups；後續 appointments / medications / documents 以 active group + profile 查詢。
- `functions/api/appointments.ts:39-48,61-87`：新增行程的 `group_id` 取自 accessible profile，不信任 request body。
- `functions/api/appointments/[id].ts:12-18,33-59`、`functions/api/medications/[id].ts:12-18,33-56`：更新先取得使用者 membership group ids，再由 shared patch helper 做 ownership filter。
- `functions/api/groups.ts:195-223,241-302`：建立 profile、家庭提醒、成員列表皆先確認 membership。
- `functions/_tests/tenant-isolation.test.ts:15-24,233-412`：真實驅動 handlers 的跨戶／同戶行為測試，證明 service-role 寫入前仍有 app-layer ownership filter。
- `DATA_CONTAINMENT_CONTRACT.md:19-43`：明文 SSOT：Functions 使用 service role 會 bypass RLS，因此寫入隔離責任目前在 app layer。

### 4.2 role 與能力欄位

- `supabase/schema.sql:151-162`：membership 有 `role`、`can_manage`、`can_pay`；但 `can_manage` schema 預設為 `true`。
- `functions/_shared/supabase.ts:528-589`：建立群組者是 `role=admin, can_manage=true`；邀請碼加入者是 `role=member`，未顯式指定 `can_manage`，因 DB default 因而會是 true。
- `functions/api/groups.ts:36-44,305-335`：只有移除成員、重生邀請碼明確要求 `role=admin`。
- `functions/api/groups.ts:195-223,241-292` 與 appointments / medications handlers：建立照護對象、改家庭提醒、增改行程／藥物目前主要只檢查 membership，不檢查 `can_manage`。

**關鍵判斷**：目前資料模型雖有 `can_manage`，但它不是完整 RBAC enforcement。要讓第三位「長輩」真正唯讀，不能只把 fixture membership 設 `can_manage=false` 就宣稱安全；必須先補後端 mutation gate 與行為測試。否則長輩只要直接呼叫 API，仍可能修改同家庭資料。

### 4.3 RLS 的邊界

- `supabase/migration_phase59_rls_read_policies.sql:1-5,78-92`：authenticated 只有 direct read，所有 direct writes 被 revoke；Functions service role bypass RLS。
- `supabase/migration_phase59_rls_read_policies.sql:23-54,108-158`：direct read 以 `auth.uid()` → `users.auth_user_id` → membership group access 判斷。
- 因此一般 Supabase email/password test user 能沿用 direct-read policy，但產品寫入仍必須通過 Functions 的 app-layer role gate。

## 5. 現有 test mode / fixture pattern

1. 前端本機 demo：`care-wedo-app/src/services/liff.js:139-155`；僅非 production 且無 LIFF ID 時回 `status=demo`。這是靜態展示，不是可協作的真實家庭 fixture。
2. Dashboard demo：`functions/api/dashboard.ts:395-399`；未登入 GET 回靜態資料、零 DB query。production 前端在 `App.jsx:1521-1525,1638-1643` 主動拒絕把 demo 當登入。
3. Internal plan fixture：`supabase/schema.sql:74-87` 已有 `internal / Test` 方案，可給 staging 測試家庭使用，不需新 plan schema。
4. Mocked auth / tenant tests：`functions/_tests/auth-context.test.ts:16-37` 與 `tenant-isolation.test.ts:38-73` 以 mock LINE verify + Supabase REST 驅動真 handler。
5. Staging smoke pattern：`care-wedo-app/src/supabase-auth-regression.test.js:86-129` 鎖定 staging access token / group / profile prerequisites 且禁止輸出 token。
6. 提醒測試模式：`env.schema.json:23-28` 的 `REMINDER_TEST_ONLY=1` 是顯式 opt-in；可借鏡「預設關閉」語意，但不可拿來當 auth bypass。

## 6. 最小變更設計

### 6.1 Product code（建議）

1. `care-wedo-app/src/services/supabaseAuth.js`
   - 新增 `signInWithSupabasePassword({ email, password })`，呼叫 `${SUPABASE_URL}/auth/v1/token?grant_type=password`。
   - header 只使用 `VITE_SUPABASE_PUBLISHABLE_KEY`；成功後沿用 `storeSupabaseAuthSession()`。
   - 統一錯誤，不回傳帳號是否存在；不記錄 request / response token。
2. `care-wedo-app/src/App.jsx`
   - `/login` 只在 `import.meta.env.VITE_CARE_WEDO_REVIEW_LOGIN === "1"` 且 hostname 符合 review host allowlist 時顯示「安全測試入口」。
   - 三個 persona 按鈕只預填／選擇 email alias；密碼仍由審查員輸入或由可信 password manager 取得。**不可把密碼或 token 編進 bundle。**
   - 成功後導向 `/app`；不新增 bypass route。
3. `care-wedo-app/.env.example`
   - 只新增空白公開旗標與 review host，例如 `VITE_CARE_WEDO_REVIEW_LOGIN=`、`VITE_CARE_WEDO_REVIEW_HOST=`；不放帳號／密碼。
4. `care-wedo-app/src/safe-review-login-regression.test.js`（新）
   - 覆蓋 helper、UI gate、production host fail-closed、bundle source 無 secret。

### 6.2 RBAC（長輩唯讀所需；仍屬最小安全範圍）

1. `functions/_shared/supabase.ts` 或新小型 `functions/_shared/group_permissions.ts`
   - 新增單一 `assertGroupWriteAccess(env,userId,groupId)`；僅 `role=admin` 或 `can_manage=true` 可寫。
2. 所有同家庭 mutation handler
   - 最少覆蓋 `groups:create_profile/update_family_notes`、appointments POST/PATCH/DELETE、medications PATCH/taken、profiles PATCH/order、documents upload/PATCH/DELETE、OCR confirm。
   - 先由 ownership 解析可信 `group_id`，再做 capability check；不可使用 body 傳入的 role/can_manage。
3. `functions/_tests/role-permissions.test.ts`（新）
   - 驅動真 handler，確認 elder membership `can_manage=false` 對每個 mutation 為 403 且不發 write；同家庭讀取仍 200；collaborator `can_manage=true` 可寫；admin 可管理邀請／移除成員。

> 若本輪只想先解鎖兩位照護者操作，可先提供 owner + collaborator 兩帳號；第三位長輩帳號必須等 RBAC gate 通過才稱為「安全唯讀」。不要用「UI 隱藏按鈕」替代後端 enforcement。

### 6.3 Staging fixture（一次性受控操作，不放入產品 runtime）

- 三個 staging Supabase Auth 帳號：`primary`、`collaborator`、`elder`；各自有獨立高熵密碼／可輪替。
- `public.users.auth_user_id` 分別對應三個 auth user。
- 一個 staging-only family group，plan 可用既有 `internal`；三筆 membership：primary admin + manage，collaborator member + manage，elder member + `can_manage=false`。
- 一個完全虛構的長輩 profile 與虛構醫院／掛號／藥單資料；不得複製真實病歷。
- fixture script 應 idempotent、鎖定 staging project ref、dry-run 預設、apply 需人工確認；資料重置不得碰非 fixture namespace。

這些是資料寫入／credential 操作，依 process guard 必須另輪取得人工確認。建議放 `scripts/seed-review-family.ts`，但本次未建立。

## 7. 先寫的 failing tests（TDD 順序）

1. `supabaseAuth` password helper：缺 public config fail closed；錯帳密回通用錯誤；成功只保存 token，不 log；request 僅帶 publishable key。
2. Review UI gate：flag 缺失、值非 `1`、host 不符都不渲染；三條件同時成立才顯示。
3. Secret source guard：`care-wedo-app/src` 不得出現測試密碼、service role、固定 access token、master password。
4. Auth unification：測試登入取得的 Supabase bearer 仍經 middleware `verifyCareIdentity()` + `getRequestUser()`，不得新增 public data route。
5. Elder fail-closed：同群組 `can_manage=false` 對 appointment create / patch / delete 都 403 且零 write。
6. 擴充 elder fail-closed 到 medications、profile、document、OCR、family notes。
7. Collaborator / admin positive cases：`can_manage=true` 可操作一般照護資料；只有 admin 可重生邀請／移除成員。
8. Tenant negative cases：三個測試 persona 都不能存取第二個 foreign fixture family。
9. Fixture validator：剛好三 auth ids、同一 group、elder false、無真實識別欄位；錯 project ref 直接 exit 1。
10. E2E：三個 browser context 各自登入；A 建資料、B 看見並協作、C 看見但所有 mutation UI 與 API 均拒絕。

## 8. Schema / migration / secret / production config 需求

| 類別 | 是否需要 | 說明 |
|---|---:|---|
| 新 auth schema / migration | 否 | 已有 `users.auth_user_id` / `auth_provider` 與唯一索引。 |
| 新 family / role schema | 原則上否 | 已有 `role` / `can_manage`；問題在後端 enforcement。建議另案評估把 `can_manage` default 由 true 改 false，但這會影響既有 join 行為且屬 migration，本輪禁止。 |
| 新 product auth secret | 否 | 正常 Supabase Auth 使用 public publishable key；測試密碼不應成為 Cloudflare runtime secret。 |
| 測試帳密 | 是 | 三組 staging-only credentials，應存 password manager／私密交付，不進 git、bundle、報告或 log。 |
| staging DB fixture | 是 | 需要受控建立三 users / memberships / family / profile；只在 staging project。 |
| production config | 否，且禁止 | production 不應設定 review flag、不應建立 fixture 帳號、不應接 staging Supabase。 |
| frontend build flag | 是 | staging build 設 `VITE_CARE_WEDO_REVIEW_LOGIN=1` 及精確 review host；production 缺值即關閉。 |

## 9. 威脅模型

1. 攻擊者找到隱藏入口：UI gate 不是 auth；真正防線是正常 Supabase password auth + 後端 token verification。
2. 攻擊者修改 `role` / `user_id` / `group_id` request：後端只信 token 對應 user，group 取自 membership / owned resource；body role 一律忽略。
3. 測試密碼被 bundle 或 repo 洩漏：禁止預埋密碼；source regression + secret scan；憑證只透過私密通道。
4. credential stuffing / 暴力嘗試：沿用 Supabase Auth rate limits；帳號使用不可猜 alias + 高熵密碼；測試結束立即 rotate / disable。
5. test account 進到 production data：staging 使用獨立 Supabase project；production 無帳號、無 review flag；不得只靠資料名稱隔離。
6. elder 透過 DevTools 直接呼叫 mutation：後端 `can_manage=false` gate，而非 UI 隱藏。
7. collaborator 越權成 admin：一般 mutation 能力與 admin-only member / invite 能力分開 enforcement。
8. 跨家庭 IDOR：保留並擴充 tenant-isolation tests；所有 service-role write 前先 ownership / membership check。
9. token 外洩：access token 不寫 log；測試用短 session / 受控瀏覽器；測試後清 localStorage 並撤銷／重設密碼。
10. fixture 含醫療個資：只用明顯虛構資料，檔名與 OCR 內容不含真實姓名、電話、病歷號、處方。
11. production 誤開 review build：host allowlist + build flag 雙條件；CI 應對 production artifact 斷言 review UI 字串／flag 不啟用。
12. Supabase Auth 與 LINE 帳號錯誤 merge：三個測試 auth ids 為獨立 app users；不自動綁 LINE，不以 email 猜測 merge。

## 10. Fail-closed 條件

- `VITE_CARE_WEDO_REVIEW_LOGIN !== "1"`：不顯示入口。
- hostname 與精確 staging allowlist 不符：不顯示入口；不要用 suffix `endsWith()` 接受攻擊者子網域。
- Supabase URL / publishable key 缺少：測試登入不可用，不 fallback demo／LINE 合成 session。
- 帳密錯誤、回應格式異常、token 缺少：保持未登入，通用錯誤，不建立 app user。
- backend token 無法由 Supabase `/auth/v1/user` 驗證：401。
- auth user 未對應 fixture / 無 membership：只進 needs_setup 或 403，不自動加入預設測試家庭。
- requested group / profile 不屬 membership：403/404，且不得發 write。
- `can_manage !== true`：所有照護資料 mutation 403；缺欄位也視為 false（不依 schema default 猜權限）。
- admin-only 操作：`role !== "admin"` 一律 403。
- fixture script project ref / environment 不是明確 staging：直接退出；不接受 `production`、空值或模糊 host。
- production artifact 偵測到 review flag=1、測試帳號 alias、固定 token 或密碼：CI 失敗、禁止部署。

## 11. 建議實作與驗收順序

1. 先補 role permission failing tests 與後端 enforcement。
2. 補 password auth helper 與 review UI gate tests，再做最小 UI。
3. 人工確認後，在獨立 staging Supabase 建三帳號與 fixture；不需 migration。
4. 跑 `npm run test:functions`、前端 `npm test`、lint、typecheck、完整 `npm run verify`。
5. staging E2E 用三個隔離 browser context 驗證 A 建立、B 協作、C 唯讀，以及 foreign family 拒絕。
6. 審查結束：撤銷／rotate 帳密、清測試 session，保留無個資的 fixture 或依 SOP 重置。

## 12. 未完成與剩餘風險

- 未建立三個 Supabase Auth 帳號或 staging fixture（credential / DB 寫入需另行確認）。
- 未確認目前是否已有獨立 staging Supabase project 與 preview domain；因此 host / project ref 尚未查證。
- 未實作 `can_manage` mutation enforcement；在完成前，長輩角色不能被視為真正唯讀。
- 未檢視線上 Cloudflare / Supabase 實際 env 值，也未查 production 是否已開 Google Auth；本報告只依 repo 證據。
- 現有 LINE server cookie 60 天，不適合作測試帳號 session；建議方案刻意不走該 cookie。

