# Care WEDO Cloudflare + Supabase MVP Runbook

## 目標架構

- Frontend：Cloudflare Pages，部署 `care-wedo-app/dist`
- API：Cloudflare Pages Functions，路徑維持 `/api/*`
- Database：Supabase Postgres
- OCR：Gemini Vision API，由 Cloudflare Function 呼叫
- Legacy：原本 Flask/Railway 程式保留作備援，不再是 Cloudflare 上線必要路徑

## Supabase 設定

1. 建立 Supabase project。
2. 到 SQL Editor 執行 `supabase/schema.sql`。
3. 到 Project Settings → API，取得：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

注意：`SUPABASE_SERVICE_ROLE_KEY` 只能放在 Cloudflare 環境變數，不可放進前端 `.env`。

## Cloudflare Pages 設定

連接 GitHub repo 後設定：

| 欄位 | 值 |
|---|---|
| Framework preset | Vite |
| Build command | `cd care-wedo-app && npm ci && npm run build` |
| Build output directory | `care-wedo-app/dist` |
| Root directory | repo root |
| Functions directory | `functions` |

## Cloudflare 環境變數

在 Pages project → Settings → Environment variables 新增：

```bash
GOOGLE_API_KEY=[REDACTED]
GEMINI_MODEL_NAME=gemini-2.0-flash
SUPABASE_URL=https://你的-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=[REDACTED]
LINE_CHANNEL_ACCESS_TOKEN=[REDACTED]
LINE_CHANNEL_SECRET=[REDACTED]
```

前端維持同網域 `/api`，通常不需要設定 `VITE_API_BASE`。

若暫時不用 LINE Bot，只需要前四個變數即可。若要回填 LINE Webhook URL，必須加上 `LINE_CHANNEL_ACCESS_TOKEN` 與 `LINE_CHANNEL_SECRET`。

## LINE Webhook URL

LINE Developers Console → Messaging API → Webhook settings：

```text
https://care.wedopr.com/callback
```

設定後：

1. 開啟 `Use webhook`。
2. 點 `Verify`，成功時會收到 200 回應。
3. 到 LINE 對 Bot 傳文字，應收到 Care WEDO 回覆。

## 上線驗證

部署完成後依序檢查：

1. `GET /api/health` 回 `{"status":"ok"}`
2. 首頁可開啟。
3. 掃描圖片後，`/api/ocr` 回 `success: true`。
4. Supabase `appointments` 或 `medications` 有新增資料。
5. 重新整理首頁，dashboard 讀到 Supabase 資料。

## 已知取捨

- Cloudflare 版不跑 Python Flask，也不使用本機 Tesseract。
- OCR 以 Gemini Vision 直接解析圖片，部署更輕，較適合 MVP。
- LINE Webhook 尚未搬到 Cloudflare Functions；第一版先確保 Web MVP 上線。
