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

## 4. Beta 告警門檻

Beta 期間先用 Cloudflare tail / dashboard 人工監看；正式商轉前再接 Sentry 或 Cloudflare Analytics 通知。

| 門檻 | 建議動作 |
|---|---|
| 15 分鐘內 `ocr_failed` >= 3 次 | 檢查 Gemini key、模型回應、OCR endpoint、上傳檔案大小與 content-type |
| 15 分鐘內 `line_push_failed` >= 5 次 | 檢查 LINE channel token、LINE API 狀態、使用者是否封鎖官方帳號 |
| 15 分鐘內 `auth_failed` >= 5 次 | 檢查 LIFF endpoint、LINE Login channel id、session cookie、OAuth callback |
| 任一 `cron_failed` | 立即手動 tail cron endpoint，確認 `CRON_SECRET`、Supabase 查詢與 LINE push |
| `quota_exceeded` 明顯升高 | 確認是否為真實使用增加；若是，檢查升級提示與費用確認 modal 是否正常 |

## 5. 快速健康檢查

```bash
curl -I https://care.wedopr.com
curl -sS https://care.wedopr.com/api/health
curl -sS https://care.wedopr.com/llms.txt | head
```

## 6. 下一步

- 接 Sentry React / Vite production error，source map 只上傳程式碼映射，不上傳醫療資料。
- 接 Cloudflare Web Analytics，追首頁、登入、方案頁與回饋表單。
- 把上表門檻接成自動通知，避免 Beta 測試時只能靠手動 tail。
