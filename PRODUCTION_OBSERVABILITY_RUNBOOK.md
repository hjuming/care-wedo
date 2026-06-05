# Care WEDO Production Observability Runbook

> 最後更新：2026-05-29  
> 目標：Beta 期間能快速知道 LINE、OCR、登入、cron 與前端是否壞掉；所有 log 必須避免醫療全文、token、原圖與 base64。

## 1. 事件分類

| category | 代表問題 | 主要來源 |
|---|---|---|
| `ocr_failed` | OCR / Gemini / 上傳整理失敗 | `/api/ocr`、LINE 圖片與文字上傳、前端 OCR 流程 |
| `line_push_failed` | LINE reply / push 失敗 | LINE webhook、每日提醒 cron、晚間提醒 cron |
| `quota_exceeded` | OCR 額度用完或升級提示 | `/api/ocr`、前端升級提示 |
| `auth_failed` | LINE Login、session、JWT、邀請加入失敗 | API middleware、前端登入流程 |
| `cron_failed` | 每日提醒或晚間提醒排程失敗 | `/api/cron/reminders`、`/api/cron/evening` |

## 2. 安全紀錄原則

- 不記錄醫療全文、藥名全文、注意事項長文、原圖、base64、LINE token、Supabase key。
- 使用 `line_user_suffix` 追查 LINE 推播問題，不記錄完整 LINE user id。
- 前端 telemetry 只上送已清理欄位：事件名稱、分類、路由、流程、狀態碼、數量、錯誤名稱與短錯誤訊息。
- 若 log 中出現疑似個資或醫療全文，先移除該欄位，再重新部署。

## 3. Cloudflare Pages Functions 即時排查

先載入環境變數：

```bash
set -a
source .env
set +a
```

追正式環境全部 Functions log：

```bash
npx wrangler pages deployment tail --project-name=care-wedo --environment=production --format=json
```

只看錯誤 invocation：

```bash
npx wrangler pages deployment tail --project-name=care-wedo --environment=production --status=error --format=json
```

依事件分類搜尋：

```bash
npx wrangler pages deployment tail --project-name=care-wedo --environment=production --search='"category":"ocr_failed"' --format=json
npx wrangler pages deployment tail --project-name=care-wedo --environment=production --search='"category":"line_push_failed"' --format=json
npx wrangler pages deployment tail --project-name=care-wedo --environment=production --search='"category":"auth_failed"' --format=json
npx wrangler pages deployment tail --project-name=care-wedo --environment=production --search='"category":"cron_failed"' --format=json
```

## 4. 自動告警設定

Beta 期間可先用 webhook 接 Slack、Discord、Make、Zapier、Google Chat 或自有告警服務。未設定時系統維持 no-op，不影響照護流程。

Cloudflare Pages production environment variables：

| 變數 | 必填 | 說明 |
|---|---|---|
| `CARE_WEDO_ALERT_WEBHOOK_URL` | 選填 | 告警接收端 URL；未設定則不送出自動告警 |
| `CARE_WEDO_ALERT_WEBHOOK_SECRET` | 選填 | 送出 `X-Care-WEDO-Alert-Secret` header，供接收端驗證來源 |
| `CARE_WEDO_ENV` | 選填 | 建議設為 `production`，會出現在告警 payload |

目前自動告警來源：

| 來源 | 事件 |
|---|---|
| 前端 telemetry | `frontend.telemetry_error`、`frontend.quota_exceeded` |
| API middleware | `auth.verify_failed` |
| Web OCR | `ocr.request_failed`、`ocr.quota_exceeded` |
| LINE webhook | `line.ocr_failed`、`line.text_ocr_failed`、`line.push_failed` |
| Cron | `cron.reminders_failed`、`cron.evening_failed`、LINE push failed |

告警 payload 只送事件分類、短錯誤、路由、狀態碼、數量與 suffix 類排查欄位；不記錄醫療全文、token、原圖與 base64。

## 5. Beta 告警門檻

Beta 期間已可用 webhook 做自動通知，Cloudflare tail / dashboard 作為人工排查。正式商轉前仍可再補 Sentry 或 Cloudflare Analytics 通知。

| 門檻 | 建議動作 |
|---|---|
| 15 分鐘內 `ocr_failed` >= 3 次 | 檢查 Gemini key、模型回應、OCR endpoint、上傳檔案大小與 content-type |
| 15 分鐘內 `line_push_failed` >= 5 次 | 檢查 LINE channel token、LINE API 狀態、使用者是否封鎖官方帳號 |
| 15 分鐘內 `auth_failed` >= 5 次 | 檢查 LIFF endpoint、LINE Login channel id、session cookie、OAuth callback |
| 任一 `cron_failed` | 立即手動 tail cron endpoint，確認 `CRON_SECRET`、Supabase 查詢與 LINE push |
| `quota_exceeded` 明顯升高 | 確認是否為真實使用增加；若是，檢查升級提示與費用確認 modal 是否正常 |

## 6. 快速健康檢查

```bash
curl -I https://care.wedopr.com
curl -sS https://care.wedopr.com/api/health
curl -sS https://care.wedopr.com/llms.txt | head
```

## 6.1 單人提醒驗證

當我們只想驗證某一位測試戶，不要重送整批 `Daily Medical Reminders` 時，改用單人提醒腳本：

```bash
set -a
source .env
set +a
pnpm manual:reminder -- --user-id 1 --dry-run
pnpm manual:reminder -- --user-id 1
```

- `--dry-run`：只輸出提醒摘要預覽，不發送 LINE。
- `--user-id`：指定 Care WEDO `users.id`。
- `--line-user-id`：若只知道 LINE user id，也可直接指定。
- `--date YYYY-MM-DD`：可重建指定日期的提醒內容，預設為台灣時間今天。

> 這支腳本會直接查 production Supabase 並走正式 LINE Push API，只適合內部驗證，不要拿來取代排程 workflow。

## 6.2 LINE 推播稽核查詢

Phase 57 起，每日與晚間提醒會寫入 `line_push_logs`。這張表只保存去識別化營運資料，不保存完整 LINE user id、不保存推播全文、不保存醫療內容。

照護圈後台會顯示最近提醒送達摘要，供家人確認今日/明日提醒是否送出；工程排查或大量查核時再使用下列 SQL。

檢查今天實際送出的提醒：

```sql
select
  event_type,
  status,
  target_date,
  recipient_user_id,
  group_id,
  profile_id,
  line_user_suffix,
  item_count,
  message_character_count,
  http_status,
  created_at
from public.line_push_logs
where created_at >= now() - interval '1 day'
order by created_at desc;
```

檢查失敗或略過的推播：

```sql
select
  event_type,
  status,
  http_status,
  error_message,
  metadata,
  created_at
from public.line_push_logs
where status <> 'sent'
order by created_at desc
limit 50;
```

預期事件類型：

| event_type | 說明 |
|---|---|
| `daily_appointment_reminder` | 08:00 今日行程提醒，不包含完整用藥清單 |
| `evening_appointment_reminder` | 20:00 明日行程提醒，需空腹時加註 |

## 7. 下一步

- 接 Sentry React / Vite production error，source map 只上傳程式碼映射，不上傳醫療資料。
- 接 Cloudflare Web Analytics，追首頁、登入、方案頁與回饋表單。
- 若 webhook 告警量變多，再補 15 分鐘滑動視窗彙整，避免單點錯誤洗版。
