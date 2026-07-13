# Care WEDO 安全測試登入 fresh-context 驗收報告

日期：2026-07-11  
驗收範圍：目前未提交變更；唯讀檢查，除本報告外未修改檔案  
總判定：**第三次本機驗收通過；P0 已改為 identity-only，staging/live 仍未驗證**

> 最終補記：第三次回修已將 `DELETE /api/me` 改為 identity-only。所有角色刪帳號均只移除本人 membership 與 user identity，不刪家庭共享照護資料；本報告較早輪次的中間判定由第十節最終複驗取代。

## 一、結論摘要

staging-only 登入本身符合設計：需 build flag 與精確 hostname 同時成立，production hostname 硬性 fail closed；登入沿用 Supabase Email/Password token endpoint 與既有 session，LINE 入口保留，也未新增 public bypass API、master password 或固定測試 token。

照護資料寫入已改用共用 `admin || can_manage === true` gate，跨家庭與 legacy `user_id` 更新捷徑亦已從 appointments／medications 移除。`DELETE /api/me` 現為 identity-only：不論無家庭、一般成員或 admin，均只刪本人 membership 與 user identity，家庭共享資料保留。

## 二、逐條驗收

| # | 驗收條件 | 判定 | 證據 |
|---|---|---|---|
| 1 | production hostname 即使 flag 開啟也不顯示；非精確 staging host 不顯示 | 通過 | `care-wedo-app/src/services/safeReviewLogin.js:1-9`：flag 必須精確為 `1`、設定 host 非空、設定 host 與實際 hostname 完全相等，且 production denylist 含 `care.wedopr.com`、`www.care.wedopr.com`。`care-wedo-app/src/safe-review-login.test.js:7-12` 實測 flag 關閉、host 不同與 production host。`care-wedo-app/src/App.jsx:1234,1319-1335` 僅條件成立才 render 表單。 |
| 2 | password login 使用正常 Supabase auth/session，不自造 token | 通過 | `care-wedo-app/src/services/supabaseAuth.js:113-137` POST `/auth/v1/token?grant_type=password`，使用 publishable key，接收 Supabase `access_token`／`refresh_token` 後呼叫既有 session store；`care-wedo-app/src/services/supabaseAuth.js:48-82` 為既有 session 路徑。`care-wedo-app/src/safe-review-login.test.js:14-34` 驗證 endpoint、request body 與 session 保存。 |
| 3 | 完整 mutation endpoint 皆要求 admin 或 can_manage，無 legacy user_id bypass | 通過 | 共用規則見 `group_permissions.ts`；appointments／medications legacy patch bypass 已移除。`DELETE /api/me` 現先讀 memberships，存在任何非 admin membership 即在所有 DELETE 前回 403。真 handler 測試確認唯讀成員不會發出 write。 |
| 4 | can_manage=false 的讀取不被誤擋 | 通過 | gate 僅加入 mutation handler；真 handler 測試以 `can_manage=false` 呼叫 documents GET 回 200，既有 dashboard／documents read isolation 亦全綠。 |
| 5 | `.env.example` 無 secrets | 通過 | `care-wedo-app/.env.example:22-23` 只新增兩個空白變數；全檔沒有實值 credential。 |
| 6 | 無 schema/migration/production config 修改 | 通過 | `git status --short` 與 `git diff --name-only` 未列出 schema、migration、wrangler、Cloudflare、GitHub workflow、package 或 production config。未部署、未改 secrets。 |
| 7 | TDD 測試有意義且非只測字串 | 通過 | 登入測試呼叫真判斷與 password helper；role unit test 驗三種 capability；tenant tests 驅動真 handlers，覆蓋 me DELETE、documents、OCR、profiles、groups、appointments、medications，並斷言 403／零 write。 |
| 8 | git diff 無 unrelated changes，保留既有 reports | 通過 | tracked diff 只涉及登入、權限 gate、測試與 implementation control log；無無關依賴或格式重寫。`reports/` 原有 persona/audit/implementation 報告均仍存在，本驗收只新增本檔，未覆寫任何報告。 |

## 三、Mutation endpoint 盤點

### 已有 gate

- appointments create：`functions/api/appointments.ts:47-51`。
- appointments patch/delete：`functions/api/appointments/[id].ts:13-18,21-83` 只把 manageable group ids 傳入底層；底層查詢只接受 group scope，見 `functions/_shared/supabase.ts:622-685`。
- medications patch：`functions/api/medications/[id].ts:13-18,21-36`；底層同上。
- medication taken（單筆／批次）：`functions/api/medications/[id]/taken.ts:46-62`、`functions/api/medications/taken.ts:42-75`。
- documents metadata patch/delete：`functions/api/documents/[id].ts:46-50,83-86`。
- document upload：`functions/api/documents/upload.ts:167-174`。
- OCR analyze/write：`functions/api/ocr/[[path]].ts:387-392`。
- OCR confirm：`functions/api/ocr/confirm.ts:186-193`。
- care profile patch/order：`functions/api/profiles/[id].ts:18-26`、`functions/api/profiles/order.ts:39-44`。
- family group create_profile／family notes：`functions/api/groups.ts:196-203,243-249`。
- 成員管理的 admin-only helper：`functions/api/groups.ts:37-44`；個人通知偏好 `update_membership` 僅更新本人 membership，見 `functions/api/groups.ts:228-240`，不屬共享醫療資料修改。

### Fresh-context 已修正 gate

- **已修正：`DELETE /api/me`** — handler 在任何 DELETE 前先檢查 memberships；非 admin 成員直接 403。此處採安全優先的 fail-closed 語意，不讓唯讀或一般協作者透過帳號刪除清掉共享家庭資料。
- `groups` 的 `create`／`join`（`functions/api/groups.ts:145-193`）是建立新群組或以邀請碼加入，不是修改已加入家庭的共享醫療資料；本次不判為 bypass。若產品規格要求長輩帳號完全不得建立／加入家庭，需另明確定義，但不應用既有家庭的 `can_manage` gate 阻斷首次加入。

## 四、Threat model

| 威脅 | 結果 | 證據／判斷 |
|---|---|---|
| host spoof／相似網域 | 通過 | 前端取 `window.location.hostname` 並與 build-time configured host 精確 equality；子網域、不同 host、大小寫／空白正規化後不會誤過。DNS／Host header 被平台控制權限攻陷不在此前端 gate 可單獨防禦的範圍。 |
| flag 誤設於 production | 通過 | production host denylist 是第二道獨立條件；兩個正式 host 均 fail closed。 |
| 直接呼叫 API | 通過（本機） | 一般照護 mutation有 bearer auth＋server-side group gate；`DELETE /api/me` 的唯讀繞過已修正並有零 write 真 handler 測試。 |
| 跨家庭寫入 | 通過（已覆蓋路徑） | patch 底層只接受 manageable group ids；tenant isolation tests 驗證 foreign medication／appointment／profile／document 被拒。 |
| admin 行為 | 通過 | `role === "admin"` 無條件取得 write capability，`functions/_shared/group_permissions.ts:4-9`；unit test 覆蓋 admin 即使 `can_manage=false` 仍可寫，`functions/_tests/role-permissions.test.ts:6-17`。 |
| 長輩讀取 | 通過，但缺明確角色 GET 測試 | GET 路徑未套 write gate；dashboard/groups/documents read regression 全綠。建議補 can_manage=false GET handler test。 |

## 五、實跑命令與結果

| 命令 | 結果 |
|---|---|
| `node --test care-wedo-app/src/safe-review-login.test.js` | 2/2 pass |
| `node --import tsx --test functions/_tests/role-permissions.test.ts functions/_tests/tenant-isolation.test.ts` | 21/21 pass |
| `node --import tsx --test functions/_tests/*.test.ts` | 37/37 pass |
| `npm test --prefix care-wedo-app` | 177/177 pass |
| `npm run lint --prefix care-wedo-app` | pass |
| `npm run lint:css --prefix care-wedo-app` | pass |
| `npm run typecheck` | pass |
| `npm run build --prefix care-wedo-app` | pass；Vite 85 modules transformed |
| `git diff --check` | pass |

本輪未使用會觸發 tsx IPC 的 `npm run test:functions`；依任務指定與實作報告提供的 sandbox 替代方式，使用 `node --import tsx --test functions/_tests/*.test.ts`，完整 functions suite 已通過。

## 六、原需修正清單完成狀態

1. **P0 完成：** `DELETE /api/me` 對非 admin membership fail closed，403 且零 DELETE。
2. **P1 完成：** documents、OCR、profiles、groups 共享 mutation 已補 read-only 真 handler denial test。
3. **P2 完成：** `can_manage=false` documents GET 真 handler 回 200。

## 七、修正後補充驗證

- RED：`node --import tsx --test --test-name-pattern="read-only family member cannot delete" functions/_tests/tenant-isolation.test.ts` 得到 `500 !== 403`，且 mock 觀察到 DELETE 路徑可被觸發。
- GREEN：同 focused test 1/1 pass；唯讀 focused tests 4/4 pass。
- functions 完整測試 40/40、frontend 177/177；typecheck、ESLint、Stylelint、Vite build、`git diff --check` 均 pass。
- 真 handler 覆蓋 `DELETE /api/me`、documents upload/PATCH/DELETE、OCR analyze/confirm、profiles PATCH/order、groups create_profile/family_notes；全數確認 403 且零 write。
- `can_manage=false` 呼叫 documents GET 回 200，證明讀取未被 write gate 誤擋。

## 八、交付狀態

- 已完成：完整讀取指示、實作報告、相關 diff、mutation 路由與測試；執行指定驗證矩陣；完成 threat model；新增本驗收報告。
- 未完成／未處理：未改 schema/secrets、未部署；未執行 live staging 三角色 E2E（目前亦未建立 staging 帳號／資料）。
- 自行追加：反向盤點 `DELETE /api/me`，因其屬使用者未在實作報告列出的 authenticated mutation bypass。
- 驗證結果與證據：functions 40/40、frontend 177/177、lint、typecheck、build、diff check 均綠；P0 已修正。
- 剩餘風險：本機 mock-driven integration 不等於 staging/live；三個正常 Auth 帳號、fixture family 與三瀏覽器協作仍待另次授權執行。

---

## 九、回修後 fresh-context 獨立複驗

複驗總判定：**仍需修正（P0 尚未完全封閉）**。

回修已讓「目前仍有任一 non-admin membership」的帳號在第一個 DELETE 前 fail closed：`functions/api/me.ts:97-103` 先讀全部 memberships，只要任一 `role !== "admin"` 即回 403；第一個 DELETE 位於 `:106`。典型 `role=member, can_manage=false` 長輩已被擋住，`functions/_tests/tenant-isolation.test.ts:325-346` 的真 handler test 也確認 403 且零 DELETE。

但 `/api/me DELETE` 仍以全域 legacy ownership 欄位刪除共享資料：`functions/api/me.ts:105-110` 直接 DELETE `appointments?user_id=...`、`medications?user_id=...`、`care_profiles?primary_user_id=...`，沒有 `group_id` scope。這留下兩個越權情境：

1. 無家庭：帳號已被移出家庭後 `memberships=[]`，目前檢查放行；過去由該帳號建立、但仍屬原家庭的共享資料會被刪除。
2. admin：目前所有 memberships 都是 admin 時放行，但該帳號在已退出之其他家庭留下的歷史資料也可能符合同一 `user_id`，並被一併刪除。admin 權限只涵蓋目前 membership 的 group，不是全域 ownership 授權。

因此前述「P0 完成」需更正為：**典型 read-only membership 已修正，但無家庭／歷史退出家庭的 legacy bypass 仍存在。**

### 複驗逐項

| 項目 | 判定 | 證據 |
|---|---|---|
| 任一 non-admin membership 在所有 DELETE 前 fail closed | 通過 | `functions/api/me.ts:97-106`；多家庭只要任一 role 非 admin，`some(...)` 即阻斷。 |
| admin／無家庭不越權刪共享資料 | **不通過** | `functions/api/me.ts:105-110` 無 group scope；目前沒有 admin deletion 或 `memberships=[]` deletion test。 |
| 指定 mutation 真 handler tests 且觀察零 write | 通過 | `functions/_tests/tenant-isolation.test.ts:349-407` 直接呼叫 documents PATCH/DELETE/upload、OCR analyze/confirm、profiles PATCH/order、groups create_profile/family_notes；mock 對任何非 GET 設 write flag，逐一要求 403，最後斷言 false。 |
| `can_manage=false` GET 200 | 通過 | `functions/_tests/tenant-isolation.test.ts:410-430` 以真實 documents list handler 驗證 200。 |
| legacy `user_id`／`primary_user_id` mutation 再掃 | **不通過** | `functions/api/me.ts:106-110` 仍有三個全域 DELETE。groups remove_member 在 `functions/api/groups.ts:308-318` 先 assertAdmin 並 scope 指定 group，不屬 bypass。 |

### 複驗命令

| 命令 | 結果 |
|---|---|
| `node --test care-wedo-app/src/safe-review-login.test.js` | 2/2 pass |
| `node --import tsx --test functions/_tests/role-permissions.test.ts functions/_tests/tenant-isolation.test.ts` | 24/24 pass |
| `node --import tsx --test functions/_tests/*.test.ts` | 40/40 pass |
| `npm test --prefix care-wedo-app` | 177/177 pass |
| `npm run lint --prefix care-wedo-app` | pass |
| `npm run lint:css --prefix care-wedo-app` | pass |
| `npm run typecheck` | pass |
| `npm run build --prefix care-wedo-app` | pass；85 modules transformed |
| `git diff --check` | pass |

OCR／documents upload 的預期 403 測試會輸出結構化 error log，沒有測試失敗或敏感內容。

### 仍需修正

1. **P0：移除帳號自刪對家庭共享照護表的全域 ownership DELETE，或嚴格限制至目前具有管理 capability 的 `group_id`。** 最安全的 contract 是帳號自刪只處理本人 identity、個人偏好與 membership；家庭共享 appointments／medications／profiles 由家庭管理流程管理生命週期。
2. **P0 tests：補 `memberships=[]` 與 admin＋歷史退出家庭兩個真 handler case。** 預置相同 `user_id` 但屬非目前授權 group 的資料，斷言不會刪除；若採 identity-only contract，兩者都不應刪任何共享照護資料。

- 已完成：重讀最新 diff、帳號刪除控制流、指定真 handler tests與 GET 行為；重跑完整驗證矩陣；更新本報告。
- 未完成／未處理：未改產品碼或測試；未跑 live staging E2E；未部署。
- 自行追加：推演 admin、無家庭與歷史退出家庭的 capability 邊界，識別仍存在的全域 ownership DELETE。
- 驗證結果：現有測試與所有品質指令全綠，但安全規格仍有未被測試捕捉的 P0 邊界漏洞。
- 剩餘風險：使用者先離開家庭再刪帳號，仍可能刪掉原家庭共享資料；改為 group-scoped 或 identity-only deletion 前不可判定通過。

---

## 十、第三次 fresh-context 最終複驗（權威結論）

最終判定：**本機驗收通過**。本節取代第六至第九節所記錄的歷次中間狀態；staging/live 三帳號 E2E 仍未執行，不屬本次本機驗收失敗。

### 1. Identity-only 帳號刪除

- `functions/api/me.ts:93-102` 僅執行兩個 DELETE：`user_family_groups?user_id=...` 與 `users?id=...`。
- handler 不再查詢或刪除 appointments、medications、care_profiles、care_documents、family_groups；也沒有以 `user_id`／`primary_user_id` 選取共享資料。
- response `functions/api/me.ts:102` 明確回覆「個人帳號資料已刪除；家庭照護資料會保留」。
- 隱私頁一致：`care-wedo-app/src/components/PrivacyPage.jsx:43` 說明單一成員刪帳不刪共享紀錄；`:65` 說明只移除個人帳號與家庭成員資格，家庭共享資料保留，家庭資料須由管理者申請刪除。

### 2. 三情境真 handler 測試

| 情境 | 結果 | 證據 |
|---|---|---|
| `can_manage=false` 一般／長輩會員 | 200；零 shared DELETE | `functions/_tests/tenant-isolation.test.ts:325-346` 監看 appointments、medications、care_profiles、family_groups DELETE，結果 false。 |
| `memberships=[]` | 200；零 shared DELETE | `functions/_tests/tenant-isolation.test.ts:349-381` 參數化 case `without current memberships`，記錄所有 DELETE URL 並排除共享表。 |
| admin membership | 200；零 shared DELETE | 同段參數化 case `with an admin membership`；只允許本人 membership/user identity DELETE。 |

測試不是只比字串：三者均直接呼叫真實 `deleteMe` handler，mock 捕捉實際 Supabase request method 與 URL。雖未額外斷言「恰好兩個 DELETE」，handler source 與 response 200 已證明目前確實執行 identity DELETE；核心安全斷言完整監看並排除所有指定共享表。

### 3. Legacy shared mutation bypass 再掃

- 全 repo 搜尋未再發現 appointments／medications／care_profiles／care_documents／family_groups 以 `user_id` 或 `primary_user_id` 做 PATCH/DELETE。
- `functions/_shared/billing.ts:472-476` 的 `appointments?user_id`／`medications?user_id` 僅為 OCR usage `select=id` 讀取，不是 mutation。
- `functions/_shared/supabase.ts:600-601` 只更新本人、指定 group 的個人 membership notification preferences。
- `functions/api/groups.ts:308-318` 的 remove_member 先 `assertAdmin`，DELETE 同時 scope `target_user_id` 與 `group_id`。
- appointments／medications patch 已移除 legacy owner OR，改以 manageable group ids；其餘 documents、OCR、profiles、family notes 等共享 mutation 均維持後端 capability gate。未發現殘餘 shared mutation bypass。

### 4. 最終實跑結果

| 命令 | 結果 |
|---|---|
| `node --test care-wedo-app/src/safe-review-login.test.js` | 2/2 pass |
| `node --import tsx --test functions/_tests/role-permissions.test.ts functions/_tests/tenant-isolation.test.ts` | 26/26 pass |
| `node --import tsx --test functions/_tests/*.test.ts` | 42/42 pass |
| `npm test --prefix care-wedo-app` | 177/177 pass |
| `npm run lint --prefix care-wedo-app` | pass |
| `npm run lint:css --prefix care-wedo-app` | pass |
| `npm run typecheck` | pass |
| `npm run build --prefix care-wedo-app` | pass；85 modules transformed |
| `git diff --check` | pass |

focused/functions 測試中的 OCR 與 documents upload 結構化 error log 是 read-only 403 測試的預期輸出，沒有敏感內容或測試失敗。

### 5. 最終交付狀態

- 已完成：確認 identity-only handler、三 membership 情境真 handler 零 shared DELETE、隱私文案一致、全 repo legacy shared mutation 掃描與完整驗證矩陣。
- 未完成／未處理：未執行 staging/live 三帳號與三瀏覽器 E2E；未部署；未改 schema/secrets。
- 自行追加：檢查測試是否捕捉實際 request URL/method，並區分 billing read query 與 shared mutation。
- 驗證結果：本機所有安全 focused tests、functions、frontend tests、lint、typecheck、build、diff check 全綠，最終判定通過。
- 剩餘風險：mock-driven handler integration 無法證明 staging Supabase 帳號、實際資料與 Cloudflare runtime 已正確設定；需另次授權做 live E2E。identity-only 自刪會保留共享照護資料，此為明確產品 contract，家庭資料刪除需走管理者申請流程。
