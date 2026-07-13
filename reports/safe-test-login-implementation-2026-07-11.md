# Care WEDO 安全測試登入實作報告

日期：2026-07-11  
狀態：本機實作與回歸完成；未建立 staging 帳號、未改 secrets、未部署

## 結論

已新增 staging-only Supabase Email/Password 登入入口，入口必須同時符合明確旗標與精確 hostname，且正式網域硬性拒絕。所有已盤點的家庭醫療資料寫入改由後端 `role=admin` 或 `can_manage=true` 才能執行；`can_manage=false` 的長輩會員仍可讀取，但無法透過直接 API 修改資料。

## 安全設計

- 沿用 Supabase `/auth/v1/token?grant_type=password` 與既有 bearer session；沒有 bypass API、master password、固定 token 或 service-role 前端暴露。
- `VITE_CARE_WEDO_REVIEW_LOGIN=1` 與 `VITE_CARE_WEDO_REVIEW_HOST=<exact-host>` 必須同時成立。
- `care.wedopr.com`、`www.care.wedopr.com` 即使誤設旗標仍不顯示入口。
- Email 與密碼由審查員手動輸入，不編入 bundle、不寫入範例設定。
- 共用 `group_permissions.ts` 是 mutation capability SSOT；admin 或 `can_manage=true` 才取得可寫 group id。
- appointments 與 medications 更新移除 legacy `user_id` 寫入捷徑，避免唯讀長輩以本人建立者身分繞過家庭權限。

## 寫入端點覆蓋

- 預約：create、patch、soft-delete。
- 藥物：patch、單筆／批次服藥確認；OCR 建立藥單沿用 OCR gate。
- 家庭：建立照護對象、家庭提醒；成員個人通知偏好仍可自行更新。
- 照護對象：資料 patch、排序。
- 文件：upload、metadata patch、soft-delete、OCR confirm。
- OCR：圖片／文字解析後寫入。
- 讀取端點未加入 `can_manage` 限制，長輩唯讀瀏覽不受影響。

## TDD 證據

### RED

```text
node --test care-wedo-app/src/safe-review-login.test.js
ERR_MODULE_NOT_FOUND: services/safeReviewLogin.js
```

functions RED 首次以 `npx tsx --test` 執行時，sandbox 禁止 tsx IPC socket 而得到 `listen EPERM`；後續測試統一使用功能等價且不開 IPC 的 `node --import tsx --test`。

### GREEN

- `node --test care-wedo-app/src/safe-review-login.test.js`：2/2 pass。
- `node --import tsx --test functions/_tests/role-permissions.test.ts`：1/1 pass。
- `node --import tsx --test functions/_tests/*.test.ts`：37/37 pass，含真 handler 的 tenant/RBAC 行為測試。
- `npm test --prefix care-wedo-app`：177/177 pass。
- `npm run typecheck`：pass。
- `npm run lint --prefix care-wedo-app`：pass。
- `npm run lint:css --prefix care-wedo-app`：pass。
- `npm run build --prefix care-wedo-app`：pass。
- `git diff --check`：pass。

## 尚未完成與風險

- 尚未在獨立 staging Supabase 建立 primary／collaborator／elder 三個正常 Auth 帳號及同一虛構家庭；這涉及 credentials 與外部資料寫入，需另次 PROCESS GUARD 確認。
- 尚未設定 staging build flag／hostname 或部署，因此三位審查員現在仍不能從線上入口登入。
- 尚未跑三個獨立 browser context 的 live 協作 E2E；目前證據為本機 unit、mock-driven handler integration 與 build。
- `npm run test:functions` 在目前 sandbox 因 tsx CLI IPC `EPERM` 無法直接執行；等價的 `node --import tsx --test functions/_tests/*.test.ts` 已全綠，不是產品失敗。

## 回滾

本輪沒有 schema、secret、線上帳號或外部資料變更。還原本報告列出的產品與測試檔即可完整回滾；未來若以 commit 交付，使用 `git revert <commit>`。

## Fresh-context P0 修正

- 驗收發現 `DELETE /api/me` 仍可能按歷史 `user_id` 刪共享照護資料。
- RED 真 handler 測試得到 `500 !== 403`，並觀察到 DELETE 可被觸發。
- 最小修正：帳號刪除先讀 memberships；存在任何非 admin membership 時直接 403，且不發出共享資料或 identity DELETE。
- 補齊 documents、OCR、profiles、groups 的唯讀真 handler mutation 測試，以及 `can_manage=false` documents GET 200 測試。
- 修正後 functions 40/40、frontend 177/177，其餘 typecheck／lint／build／diff check 全綠。

## 第二次複驗：identity-only 帳號自刪

第一次修正只依「目前 membership 是否 admin」判斷，仍無法排除 memberships 空白或目前全 admin、但歷史 `user_id` 指向其他家庭共享資料的情境，因此已由以下契約取代：

- `DELETE /api/me` 不再刪除 appointments、medications、care_profiles、family_groups 或任何家庭共享資料。
- 端點只移除本人 `user_family_groups` membership 與應用層 `users` identity；既有端點沒有刪除 Supabase／LINE provider auth identity 的能力，本輪不新增 admin credential 路徑。
- 家庭共享資料若要刪除，必須走各資源既有的 group-scoped mutation／另行管理流程，不能由帳號自刪推論資料所有權。
- PrivacyPage 文案同步說明單一成員刪除帳號時家庭共享資料仍保留。

TDD 證據：

- RED：memberships=[] 與 admin membership 兩個真 handler 測試皆偵測到 shared DELETE，斷言 `true !== false`。
- GREEN：上述兩情境加 read-only membership 共 3/3 pass，均不發 appointments／medications／care_profiles／family_groups DELETE。
- 完整驗證：functions 42/42、frontend 177/177、typecheck、ESLint、Stylelint、Vite build、`git diff --check` 全數通過。
