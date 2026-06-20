# Care WEDO Storage Policy Smoke Runbook

> 最後更新：2026-06-20
> 目的：在 staging 驗證 `care-documents` private bucket 的 authenticated read-only Storage policy。
> 注意：不要把 access token、publishable key、object path 或醫療檔名貼進 issue / PR / 對話。

## 要驗什麼

這支 smoke 只驗 Storage provider-level policy：

1. 使用 authenticated user access token 讀取自己可存取 group 的 object，應該成功。
2. 同一 token 讀取另一個 group 的 object，應該失敗。
3. 測試時不得使用 service role key，避免繞過 RLS。

它不取代 API handler 測試；Functions 仍使用 service role，寫入隔離仍由 handler ownership filters 與 `functions/_tests/tenant-isolation.test.ts` 驗證。

## 必要環境變數

```bash
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
CARE_WEDO_STORAGE_ACCESS_TOKEN=
CARE_WEDO_STORAGE_OWNED_PATH=
CARE_WEDO_STORAGE_FOREIGN_PATH=
```

可選：

```bash
CARE_WEDO_STORAGE_BUCKET=care-documents
```

路徑格式必須是：

```text
group-{id}/profile-{id}/YYYY-MM/{uuid}.{pdf|jpg|png|webp}
```

## Dry Run

```bash
npm run storage:policy:smoke:dry
```

Dry-run 只檢查 env key 是否存在，不會印出 token 或 object path。

## Live Smoke

```bash
npm run storage:policy:smoke
```

成功條件：

- `owned_object_read` 為 `pass`。
- `foreign_object_denied` 為 `pass`。
- 報告不包含 token 或完整 object path。

失敗判讀：

| 失敗 | 意義 | 處理 |
|---|---|---|
| owned object 401 / 403 / 404 | 使用者 token、path 或 RLS policy 沒對上 | 確認 token 屬於 owned path 的 group member，且 phase 59 migration 已套 staging |
| foreign object 200 | Storage policy 太寬，跨 group object 可讀 | 立即停止 direct client access，檢查 `care_wedo_can_access_storage_object()` |
| missing env | staging smoke 必要資料未備齊 | 補齊 env 後再跑 |

## 不要做

- 不要用 `SUPABASE_SERVICE_ROLE_KEY` 跑這支 smoke。
- 不要把真實醫療檔名放進 Storage path。
- 不要提交 private object、圖片或 token。
