# Care WEDO 小護 — 部署指南

## 第一步：本地測試 AI 解析（10 分鐘）

不需要 LINE，先確認 AI 能正確解析爸爸的預約單。

```bash
# 1. 安裝 Python 套件
pip install anthropic python-dotenv

# 2. 設定 API Key
#    到 https://console.anthropic.com 取得 key
export ANTHROPIC_API_KEY=sk-ant-xxxxx

# 3. 跑測試
cd care-wedo-bot
python test_parse.py
```

看到 8 筆預約都正確解析出來，就可以進入下一步。

---

## 第二步：建立 LINE Bot（30 分鐘）

### 2.1 建立 LINE 官方帳號

1. 到 [LINE Developers](https://developers.line.biz/) 登入
2. 建立 Provider → 建立 Messaging API Channel
3. Channel 名稱填「Care WEDO 小護」
4. 取得兩個重要值：
   - **Channel Secret**（在 Basic settings）
   - **Channel Access Token**（在 Messaging API，按 Issue）

### 2.2 設定環境變數

```bash
cp .env.example .env
# 編輯 .env，填入剛才取得的值
```

### 2.3 本地啟動

```bash
pip install -r requirements.txt
python app.py
```

伺服器會在 `http://localhost:5000` 啟動。

---

## 第三步：用 ngrok 讓 LINE 連到你的電腦（5 分鐘）

開發階段用 ngrok 做內網穿透，免架伺服器。

```bash
# 1. 安裝 ngrok（https://ngrok.com/download）
# 2. 啟動穿透
ngrok http 5000

# 3. 複製產生的 https 網址，例如：
#    https://abc123.ngrok.io
```

到 LINE Developers Console → Messaging API → Webhook URL，填入：
```
https://abc123.ngrok.io/callback
```

按 Verify 確認連線成功。

---

## 第四步：測試！

1. 用手機掃描 LINE Bot 的 QR Code 加好友
2. 拍一張爸爸的掛號單或預約單 → 傳送
3. 等幾秒，小護會回覆解析結果
4. 打字問「明天要看什麼科？」→ 小護會回答

---

## 正式部署選項

MVP 驗證完畢後，推薦用以下方式正式部署：

| 方案 | 費用 | 適合 |
|------|------|------|
| Railway.app | 免費額度 $5/月 | 最簡單，git push 就部署 |
| Render.com | 免費方案可用 | 穩定，自動休眠省錢 |
| Google Cloud Run | 免費額度充足 | 正式產品推薦 |

### Railway 部署（最簡單）

```bash
# 1. 安裝 Railway CLI
npm install -g @railway/cli

# 2. 登入 & 部署
railway login
railway init
railway up

# 3. 設定環境變數
railway variables set LINE_CHANNEL_ACCESS_TOKEN=xxx
railway variables set LINE_CHANNEL_SECRET=xxx
railway variables set ANTHROPIC_API_KEY=xxx
```

---

## 專案結構

```
care-wedo-bot/
├── app.py              # LINE Bot 主程式
├── prompts.py          # AI 解析用的提示詞
├── test_parse.py       # 本地測試腳本
├── sample_data.json    # 爸爸的預約資料範例
├── appointments.json   # 實際儲存的預約資料（自動生成）
├── requirements.txt    # Python 套件
├── .env.example        # 環境變數範本
└── SETUP_GUIDE.md      # 本文件
```

## 下一步開發方向

- [ ] 加入圖片 OCR（目前支援文字貼上 + 圖片直傳）
- [ ] LINE Flex Message 美化回覆格式（大字、卡片式）
- [ ] 串接 Google Calendar 自動建立行事曆事件
- [ ] 加入用藥提醒（每日定時推播）
- [ ] 家人共管功能（多人接收提醒）
