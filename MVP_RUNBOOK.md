# Care WEDO MVP 上線手冊

## MVP 範圍

第一版上線目標是「可實際使用的醫療單據整理助手」：

- 家人或長者上傳醫療單據圖片
- Gemini Vision 解析掛號、檢查、用藥資訊
- 後端儲存解析結果
- 前端 dashboard 顯示預約、用藥與待辦
- LINE Bot 可接收圖片/文字並回覆 Flex Message
- 單一 Docker 服務同時提供前端與 Flask API

暫不納入第一版：Google Calendar 同步、完整家人權限、藥物連續未確認通知、防詐模組。

## 本地啟動

### 後端

```bash
cd care-wedo-bot
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/gunicorn wsgi:app --bind 0.0.0.0:5000 --reload
```

必填環境變數：

| 變數 | 用途 |
|---|---|
| `SECRET_KEY` | Flask session/signing secret |
| `GOOGLE_API_KEY` | Gemini OCR 解析 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE 推播/回覆 |
| `LINE_CHANNEL_SECRET` | LINE webhook 驗簽 |

### 前端

```bash
cd care-wedo-app
npm install
npm run dev
```

本地 Vite 會把 `/api` proxy 到 `http://127.0.0.1:5000`。

## 單一服務部署

專案根目錄已提供：

- `Dockerfile`
- `railway.toml`
- `care-wedo-bot/runtime.txt`

Docker 會先 build React 前端，再把 `dist` 複製到 Flask 容器，由 `gunicorn wsgi:app` 提供 API 與前端頁面。

Railway/Render 環境變數至少設定：

```bash
FLASK_CONFIG=prod
SECRET_KEY=[REDACTED]
GOOGLE_API_KEY=[REDACTED]
LINE_CHANNEL_ACCESS_TOKEN=[REDACTED]
LINE_CHANNEL_SECRET=[REDACTED]
AUTO_CREATE_DB=true
```

若使用 PostgreSQL，額外設定：

```bash
DATABASE_URL=postgresql://...
```

## 上線驗證

部署後檢查：

1. `GET /api/health` 回傳 `{"status":"ok"}`
2. 打開首頁可看到 Care WEDO 前端
3. 上傳一張醫療單據，前端顯示 AI 解析結果
4. 重新整理後，解析出的預約仍出現在時間軸
5. LINE Developers webhook URL 設為 `https://你的網域/callback`
6. 在 LINE 傳圖片後，先收到處理中訊息，再收到解析卡片

## Rollback

若部署後出現服務不可用：

- Railway/Render：回滾到上一個成功 deploy
- 若只是 AI OCR 失敗：先確認 `GOOGLE_API_KEY`
- 若 LINE 失敗：先確認 webhook URL、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`
- 若資料庫失敗：先切回 SQLite 或檢查 `DATABASE_URL`
