# Google Protected Write Staging Smoke Runbook

> 最後更新：2026-06-20
> 目的：驗證 Google / Supabase Auth 登入者在 staging 能走 protected write path，且資料歸屬到自己的 `users.id` / family group。
> 安全原則：不要在測試紀錄貼 token、cookie、access token、service role key、醫療全文、原始單據或完整個資。

## 範圍

這份 runbook 只驗證 Google 登入後的三條 P0 寫入路徑：

| 路徑 | 前端操作 | 後端 API | 驗收重點 |
|---|---|---|---|
| Web OCR | 上傳測試文件並確認入庫 | `/api/ocr/`、`/api/ocr/confirm` | `care_documents`、`appointments` / `medications` 歸屬到 Google 使用者可存取的 group |
| 新增預約 | 手動新增一筆看診或提醒 | `/api/appointments` | 新增 row 的 `user_id` / `group_id` 不落到 `web-mvp` 或其他帳號 |
| 用藥確認 | 今日照護點選用藥狀態 | `/api/medications/taken` 或 `/api/medications/[id]/taken` | 寫入狀態只影響該 Google 使用者可見的用藥 |

## 前置條件

- Staging 已部署本次 auth / isolation 變更。
- Supabase Phase 58 已套用，`users.auth_user_id` / `auth_provider` 欄位存在。
- Supabase Authentication Google provider 已啟用，redirect URL 指向 staging `/auth/callback`。
- 測試 Google 帳號不是 production 個人帳號；測試資料不得含真實醫療全文。
- Cloudflare staging secrets 已設定 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、Google OAuth 前端 publishable config、`GOOGLE_API_KEY`。

## 可執行 Smoke 腳本

本 runbook 可手動執行，也可以用 repo 內腳本跑同一組 P0 寫入驗收。腳本不會輸出 token；report 只包含 staging URL、測試 row id 與 redacted 狀態。

先檢查設定，不打 staging：

```bash
npm run google:protected-write:smoke:dry
```

完整 smoke 需要以下環境變數：

```bash
CARE_WEDO_STAGING_BASE_URL="https://<staging-host>"
CARE_WEDO_GOOGLE_ACCESS_TOKEN="<google/supabase access token>"
CARE_WEDO_SMOKE_PROFILE_ID="<staging test profile id>"
CARE_WEDO_SMOKE_GROUP_ID="<staging test group id>"
CARE_WEDO_SMOKE_EXPECTED_USER_ID="<staging google user id>"
SUPABASE_URL="<staging supabase url>"
SUPABASE_SERVICE_ROLE_KEY="<staging service role key>"
```

執行：

```bash
npm run google:protected-write:smoke
```

若只想先驗 API response，不查 DB row scope，可加：

```bash
node scripts/google-protected-write-smoke.mjs --api-only
```

腳本會依序執行：

1. `POST /api/ocr/`：以去識別化文字跑 OCR，並 `POST /api/ocr/confirm`。
2. `POST /api/appointments`：建立一筆未來測試預約。
3. `POST /api/medications/taken`：使用 OCR 產生的 medication id，或 `CARE_WEDO_SMOKE_MEDICATION_ID` 指定的既有測試用藥。
4. Full mode 會用 Supabase REST 查核 `care_documents`、`appointments`、`medication_logs` 的 `user_id` / `group_id` / `profile_id`。

通過條件：三條 API 成功，DB 查核 row 皆屬於 `CARE_WEDO_SMOKE_EXPECTED_USER_ID` / `CARE_WEDO_SMOKE_GROUP_ID` / `CARE_WEDO_SMOKE_PROFILE_ID`。

## 測試紀錄模板

```txt
測試日期：
Staging URL：
Git commit：
Google 測試帳號代號：
測試 family_group_id：
測試 profile_id：
測試者：

結果：
- Google 登入：
- Web OCR：
- 新增預約：
- 用藥確認：
- Supabase 查核：
- Cloudflare log：
- P0/P1 問題：
```

## 1. Google 登入與身份查核

| 步驟 | 預期 | 結果 |
|---|---|---|
| 開啟 staging `/login`，點 Google 登入 | 導向 Supabase / Google OAuth | [ ] |
| 完成授權後回到 `/app` | 不回 `/login`，不顯示 Google 登入失敗 | [ ] |
| 開啟帳號或設定區 | 顯示 Google 帳號身份，不是 LINE 帳號 | [ ] |
| 建立或確認 family group / care profile | Dashboard 可看到測試照護對象 | [ ] |

Supabase 查核時只記錄 row id，不貼 email 全文：

```sql
select id, auth_provider, left(email, 3) || '***' as email_hint, line_user_id, active_profile_id
from users
where auth_provider = 'google'
order by id desc
limit 5;
```

失敗判定：

- `users.id` 落到共用 `web-mvp`。
- Google 登入後 API 回 `請先登入`。
- `auth_provider` 或 `auth_user_id` 未寫入，且不是既有測試帳號預期狀態。

## 2. Web OCR 寫入

使用去識別化測試圖片或 PDF；不要使用真實個資或原始病歷全文。

| 步驟 | 預期 | 結果 |
|---|---|---|
| 在 `/app` 上傳測試文件 | OCR 解析完成並進入待確認狀態 | [ ] |
| 點「正確，存起來」 | 產生或更新正式看診 / 用藥資料 | [ ] |
| 重新整理 Dashboard | 剛確認的資料仍存在 | [ ] |

Supabase 查核：

```sql
select id, group_id, profile_id, uploaded_by_user_id, status, created_at
from care_documents
where group_id = :test_group_id
order by id desc
limit 5;

select id, user_id, group_id, profile_id, source_document_id, status, created_at
from appointments
where group_id = :test_group_id
order by id desc
limit 5;

select id, user_id, group_id, profile_id, source_document_id, active
from medications
where group_id = :test_group_id
order by id desc
limit 5;
```

失敗判定：

- OCR API 成功但 `care_documents.group_id` 不在測試帳號可存取群組。
- 確認後產生的 `appointments` / `medications` 沒有 `source_document_id` 或歸屬到別的 group。
- Cloudflare log 出現 `auth.verify_failed`、`ocr.request_failed` 且不是測試資料格式問題。

## 3. 新增預約寫入

| 步驟 | 預期 | 結果 |
|---|---|---|
| 在測試照護對象手動新增一筆未來看診 | UI 顯示新增成功 | [ ] |
| 重新整理 `/app` | 該預約仍出現在行程或今日照護對應位置 | [ ] |
| 切換到其他測試照護對象 | 不顯示前一位照護對象的資料 | [ ] |

Supabase 查核：

```sql
select id, user_id, group_id, profile_id, title, date, status, created_at
from appointments
where group_id = :test_group_id
order by id desc
limit 5;
```

失敗判定：

- `user_id` 是共用帳號或非 Google 測試帳號。
- `group_id` 為 null，且不是設計上允許的個人資料模式。
- 其他測試照護對象或其他帳號可看到該資料。

## 4. 用藥確認寫入

先準備一筆測試用藥，可由 OCR 測試產生，或用既有測試資料。

| 步驟 | 預期 | 結果 |
|---|---|---|
| 在今日照護點「已吃」或等價狀態 | UI 狀態立即更新 | [ ] |
| 重新整理 `/app` | 狀態仍維持 | [ ] |
| 切換照護對象 | 不影響其他照護對象用藥狀態 | [ ] |

Supabase 查核依實際 schema 選用：

```sql
select id, user_id, group_id, profile_id, taken_status, active
from medications
where group_id = :test_group_id
order by id desc
limit 10;
```

失敗判定：

- API 成功但 row 歸屬到別的 group 或 user。
- 同 group 外的照護對象狀態被改到。
- Google 登入者被要求重新 LINE 登入才可完成寫入。

## 5. Cloudflare Log 查核

測試期間 tail staging / preview 對應部署，不保存 token 或 request body。

```bash
npx wrangler pages deployment tail --project-name=care-wedo --environment=preview --format=json
```

通過條件：

- 三條流程沒有 401 / 403 / 500。
- 沒有 `auth.verify_failed`。
- 沒有落到 `web-mvp` 或共用測試帳號的跡象。
- 測試資料只存在測試 group / profile。

## 6. 清理

測試完成後刪除或標記測試資料，避免污染後續驗收。

```sql
-- 依測試資料 id 精準刪除或標記，不要用寬鬆條件批次刪 production 資料。
-- 若在 production-like staging，優先用 UI 刪除或 status='deleted'。
```
