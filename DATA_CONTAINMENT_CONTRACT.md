# Care WEDO Data Containment Contract

> 最後更新：2026-06-20
> 狀態：短期仍採 service-role-only + app-layer ownership filters；已補 authenticated read-only RLS policy 與 Storage object read policy 作為 direct-read 防呆，但資料庫 RLS 尚未作為 Functions 寫入保護層。
> 適用範圍：Cloudflare Pages Functions 透過 Supabase REST 存取 Care WEDO 多租戶資料。

## 1. 親眼看到的事實

| 事實 | 依據 |
|---|---|
| Core tables 已在 schema 啟用 RLS | `supabase/schema.sql` 對 `users`、`family_groups`、`care_profiles`、`user_family_groups`、`appointments`、`medications`、`medication_logs`、`care_documents`、`usage_quotas`、billing tables、`line_push_logs` 使用 `alter table ... enable row level security`；schema 也已註明目前 Functions 仍是 service-role-only 過渡合約 |
| Repo 內已有 authenticated read-only RLS policy | `supabase/migration_phase59_rls_read_policies.sql` 與 `supabase/schema.sql` 定義 `care_wedo_current_user_id()`、`care_wedo_has_group_access()` 與核心表 `for select to authenticated` policy |
| Repo 內已有 care-documents Storage object read policy | `care_wedo_can_access_storage_object(bucket_id, name)` 只允許 authenticated 使用者讀取 `care-documents` bucket 內符合 `group-{id}/profile-{id}/YYYY-MM/uuid.ext` 格式、且 group 可存取的 object |
| Functions REST helper 使用 service role | `functions/_shared/supabase.ts` 的 `supabaseFetch()` 將 `SUPABASE_SERVICE_ROLE_KEY` 放進 `apikey` 與 `Authorization` |
| service role 會繞過 RLS | Supabase service role key 具備 bypass RLS 語意；因此 authenticated read policy 不能視為目前 Functions 寫入 API 的主要資料隔離保護 |
| protected handlers 已統一 request auth entry | `functions/_shared/auth_context.ts` 提供 `getRequestUser(context)`，handler 可重用 middleware 的 `context.data.identity` 與 request cache |
| CI 目前有行為型與 source guard 隔離測試 | `functions/_tests/tenant-isolation.test.ts` 真實驅動 medications、appointments、profiles、care_documents handlers，驗證跨戶 PATCH 不寫入、同群組 PATCH 可成功；另覆蓋 appointment create 只能寫 owned profile/group、medication taken 只能為 owned medication 寫 log、dashboard/documents 讀取 scope、foreign document 不得產生 signed URL、foreign document 不得觸發 Storage delete、upload storage path 必須用 group/profile namespace。`care-wedo-app/src/data-containment-regression.test.js` 鎖定核心表與 Storage object read-only policies，且不得 grant anon/authenticated writes |

## 2. 明確決策

短期決策：維持 Cloudflare Functions 使用 `service_role` 呼叫 Supabase REST / Storage REST，但把 Functions 寫入資料隔離責任明確放在 app layer。資料庫層已先補 authenticated read-only RLS policy 與 Storage object read policy，作為未來 direct read 或誤授權時的防呆。

這不是理想終局。這只是目前架構下可控、可測、可部署的過渡合約。

不可再模糊描述為「Supabase RLS 已保護資料」。目前更準確的描述是：

```text
Schema 已啟用 RLS 並有 authenticated read-only table / Storage object policies；目前 Cloudflare Functions 使用 service role，Functions 寫入隔離仍由後端 ownership filters 與 CI 隔離測試執行。
```

## 3. 必守規則

| 規則 | 做法 |
|---|---|
| 所有 protected data API 必須用 `getRequestUser(context)` | 不得在 protected route 直接呼叫 LINE-only `verifyLineIdToken()`；不得使用舊 `getAuthenticatedUser(env, request)` 作為 handler 入口 |
| 所有讀寫 user / group / profile scoped data 必須帶 ownership filter | 至少以 `user_id` 或 `group_id in (accessibleGroupIds)` 限縮；文件、照護對象、預約、用藥皆適用 |
| 跨戶失敗不得發出 write | handler 在權限確認前不可 PATCH / POST / DELETE 目標 row |
| 跨戶 response 不洩漏資料存在性 | 可回 403 或 404；文件類資源優先 404 |
| 新增 protected read/write endpoint 必須補 tenant-isolation test | 測試需真實呼叫 handler，mock Supabase REST，驗證 foreign record 不可讀、不可寫、不可產生 signed URL |
| 不得對 anon / authenticated 開 direct write | 核心表只能保留 read policy；insert/update/delete 仍由 service-role Functions 控制，除非另開設計審查與測試 |
| care-documents Storage object path 必須維持 namespace | object name 必須符合 `group-{id}/profile-{id}/YYYY-MM/uuid.ext`；Storage read policy 依 group prefix 判斷權限 |
| CI 失敗不得部署 | `deploy.yml` 必須在部署前跑 functions 隔離測試與 Phase 59 RLS policy sync |
| staging live smoke 前必須先跑 readiness gate | 用 `npm run staging:smoke:ready` 確認 Google protected-write 與 Storage policy smoke 必要 env 齊全；若只要缺口報告用 `npm run staging:smoke:ready:report`；只跑單支 dry-run 不算 Phase 1 完成 |

## 4. 已覆蓋的隔離測試

| Resource | Handler | Cross-tenant expected | Same-tenant expected |
|---|---|---|---|
| medications | `functions/api/medications/[id].ts` PATCH | 403，不發 PATCH write | 200，發 PATCH write |
| medication_logs | `functions/api/medications/[id]/taken.ts` / `functions/api/medications/taken.ts` | mixed / foreign medication ids 回 403，不發 log write | 只允許 owned medication 產生 log，且 log 帶 owned `group_id` / `confirmed_by_user_id` |
| appointments | `functions/api/appointments/[id].ts` PATCH | 403，不發 PATCH write | 200，發 PATCH write |
| appointments | `functions/api/appointments.ts` POST | foreign profile 回 403，不發 appointment insert | owned profile 才可新增，insert payload 使用 owned `group_id` / `profile_id` / `created_by_user_id` |
| care_profiles | `functions/api/profiles/[id].ts` PATCH | 403，不發 PATCH write | 200，發 PATCH write |
| care_documents | `functions/api/documents/[id].ts` PATCH | 404，不發 PATCH write | 200，發 PATCH write |
| dashboard read | `functions/api/dashboard.ts` GET | 查詢必須帶 active group/profile scope | 只回 active group/profile records |
| documents list | `functions/api/documents.ts` GET | 查詢必須帶 `group_id=in.(accessibleGroupIds)` | 只回可存取 group documents |
| document detail links | `functions/_shared/care_documents.ts` | linked appointments/medications 必須帶 document group scope | 只回同 group linked records |
| document file URL | `functions/api/documents/[id]/file-url.ts` GET | foreign document 回 404，且不呼叫 Storage signed URL | owned document 才可進 signed URL flow |
| document delete | `functions/api/documents/[id].ts` DELETE | foreign document 回 404，且不呼叫 Storage delete / row soft-delete | owned document 先刪 storage path，再 soft-delete row |
| document upload path | `functions/_shared/care_documents.ts` | Storage path 必須以 `group-{id}/profile-{id}/` 開頭 | 不保留原始醫療檔名，不允許 traversal segment |
| authenticated RLS read policy | `supabase/migration_phase59_rls_read_policies.sql` | 只能看到 self / accessible group rows | 不授予 anon/authenticated direct write |
| care-documents Storage read policy | `supabase/migration_phase59_rls_read_policies.sql` | 只能讀取 accessible group namespace objects | 不授予 anon/authenticated direct upload / delete |

本機驗證：

```bash
TZ=Asia/Taipei npm run test:functions
```

目前預期結果：`27/27 pass`（同一套 functions 測試包含 auth-context、tenant-isolation 與 subscription-state；不要把它誤讀成 staging live smoke）。

## 5. 未覆蓋但不得忽略

以下仍是推論與待補，不要當成已完成：

| 項目 | 風險 | 下一步 |
|---|---|---|
| List / GET endpoints 的完整跨戶測試 | 已覆蓋 dashboard 與 documents 主要讀取面；其他新增 read endpoint 若未補測仍可能回歸 | 新增 appointments / medications 獨立 list endpoint 時同步補 foreign group 不出現測試 |
| Google protected-write live verification | repo 已補 `scripts/google-protected-write-smoke.mjs` 與 readiness gate；但尚未在 staging 以 Google/Supabase Auth token 實際跑 OCR、appointment、medication taken | 先跑 `npm run staging:smoke:ready`，再跑 `npm run google:protected-write:smoke`，確認寫入 row scope 屬於 expected user/group/profile |
| Storage provider-level live verification | repo 已補 Storage object read policy source guard、`scripts/storage-policy-smoke.mjs` 與 readiness gate；但尚未在 staging Supabase 實際查 `storage.objects` policy 行為 | 先跑 `npm run staging:smoke:ready`，再跑 `npm run storage:policy:smoke` 驗 accessible object 可讀、foreign group object 不可讀；再決定是否開 direct upload policy |
| RLS policy 終局 | 目前只補 authenticated read-only policies；Functions 寫入仍由 service_role bypass RLS | 若要開 direct writes，必須補 insert/update/delete policies、column/privilege 設計、staging 資料回歸 |
| Account merge | Google 與 LINE 同一人暫不自動合併，資料分裂是產品風險 | 做「綁定 LINE 帳號」前不可自動 merge 醫療資料 |

## 6. 什麼情況必須升級到更完整 DB-level RLS

任一條成立，就不能只靠目前 read-only RLS + app-layer 合約：

- 前端要直接用 Supabase client 查 protected tables。
- 第三方或外部服務需要 user-scoped API token。
- Cloudflare Functions 不再是唯一資料存取入口。
- 商轉後需要更強的稽核或合規說明。
- 團隊無法保證每個新 handler 都補 tenant-isolation test。

## 7. RLS policy 現況與下一步

目前已實作 read-only policy：

- `public.care_wedo_current_user_id()`：用 `auth.uid()` 對應 `public.users.auth_user_id`。
- `public.care_wedo_has_group_access(group_id)`：用 `user_family_groups` 判斷使用者可存取的家庭群組。
- 核心表只建立 `for select to authenticated` policy。
- `storage.objects` 只建立 `care-documents` bucket 的 authenticated read policy，且依 `group-{id}/profile-{id}/...` prefix 判斷 group access。
- `anon` / `authenticated` 的 direct insert / update / delete 已被 revoke；寫入仍走 service-role Functions。

若要把 direct write 也納入 DB-level RLS，方向如下：

```sql
-- 概念草案，不能直接套 production。
-- 需要先定義每個 role 可寫入的欄位、狀態與 with check 條件。
create policy care_wedo_appointments_group_insert
on public.appointments
for insert
to authenticated
with check (
  (select public.care_wedo_has_group_access(group_id))
  and created_by_user_id = (select public.care_wedo_current_user_id())
);
```

正式導入 direct write 前必須補：

- LINE session / Google Supabase Auth 的 claims 對齊策略。
- `insert` / `update` / `delete` policy，不只 `select`。
- 欄位級權限與 direct client 可見欄位盤點，尤其 `care_documents.ocr_text`、`ai_summary`、Storage path。
- Storage direct upload / delete policy，若未來不再由 Functions service_role 代理。
- migration rollback plan。
- staging 資料回歸與跨戶測試。

## 8. Code Review 檢查問題

每次 touching protected data API，reviewer 必問：

1. 這個 endpoint 是否使用 `getRequestUser(context)`？
2. 任何 Supabase REST path 是否在 write 前先查 ownership？
3. 目標 row 的 `group_id` 是否來自可存取群組，而不是 request body？
4. Cross-tenant case 是否不發 write？
5. 有沒有新增或更新 `functions/_tests/tenant-isolation.test.ts`？
6. Error response 是否避免洩漏不該知道的資料？
7. 若宣稱 staging 已驗證，有沒有 `npm run staging:smoke:ready`、`npm run google:protected-write:smoke`、`npm run storage:policy:smoke` 三項證據？
