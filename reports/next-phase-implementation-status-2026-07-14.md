# Care WEDO 下一階段實作狀態

日期：2026-07-14  
基準計畫：[care-wedo-next-phase-development-optimization-plan.md](../care-wedo-next-phase-development-optimization-plan.md)

## 本輪已完成

| 工作單 | 狀態 | 證據 |
| --- | --- | --- |
| P0 長輩權限與 403 回饋 | 已完成程式修正 | `care-wedo-app/src/App.jsx`、`functions/_shared/group_permissions.ts`、前端 403 regression |
| P0 UTF-8／canonical 名稱 | 已完成程式與測試 | Supabase Auth identity regression、dashboard profile display name |
| P0 家庭提醒 persistence | 已完成可靠性修正 | 先寫入、封存舊列、read-back、不一致回滾；`functions/_tests/family-notes.test.ts` |
| P1 行程冪等與去重 | 已完成程式與測試 | `functions/api/appointments.ts`、`supabase/migration_phase61_appointment_idempotency.sql`、dedupe tests |
| P1 協作 audit | 已完成 read-only UI/API | `functions/_shared/activity_audit.ts`、dashboard `activity_audit`、前端共同紀錄面板 |
| P1/P2 手機與長輩 IA | 已完成程式與 regression | 412px/safe-area/bottom-nav、今天用藥、四分區設定、服藥操作者／時間 |
| Phase 0 clean fixture | 已建立安全工具 | `npm run staging:fixture:dry`；apply 預設關閉且鎖定 staging ref／host |

## 驗證結果

- 前端測試：192/192 通過。
- Functions 測試：51/51 通過。
- staging fixture 測試：3/3 通過。
- TypeScript、ESLint、Vite build、`git diff --check` 通過。
- Git：`6e62e8e feat: harden family reminder persistence and staging fixture` 已推送 `origin/main`。
- staging deployment：`https://d0cf98af.care-wedo-staging.pages.dev`，alias `https://main.care-wedo-staging.pages.dev`。
- staging 首頁：HTTP 200。
- staging `/api/health`：HTTP 503、`env_ready:false`；符合「未就緒不得誤報 production-ready」的 gate。

## 尚未達成的出口

1. `migration_phase61_appointment_idempotency.sql` 尚未套用 staging；目前跨請求／並發唯一約束仍待資料庫 migration。
2. 三組 fixture 帳密尚未在本輪重新取得，因此尚未執行 `staging:fixture:apply`、三角色 fresh-context、跨帳號提醒 read-back 與乾淨 fixture live 重跑。
3. staging Pages runtime 缺少 LINE、Google、billing 等必要整合設定；OCR、LINE、掛號、推播與 billing 仍維持另案範圍。
4. 未部署 production、未修改 production secrets。

## 下一個安全施工順序

1. 由具備 staging DB 權限的人員先確認 migration history，再只套用 Phase 61 migration。
2. 以私密環境變數提供三組 staging 測試帳密，執行 `npm run staging:fixture:apply`，保存去識別化 IDs。
3. 以三個 fresh browser context 重跑建立一次／重登入／跨帳號讀取／長輩 403，保存 JSON、PNG、status code。
4. 只有 Phase 1–3 出口與 Phase 5 evidence 全部回讀後，才進行產品與資安簽核；本報告不構成 production-ready 宣告。
