# Care WEDO — Antigravity 專案執行指令

> 將此文件貼入 Antigravity Manager View 作為專案總指令，或拆分各段落分派給不同 Agent。

---

## 專案概述

**Care WEDO（小護）** 是一款銀髮族 AI 智慧照護助手，以 LINE Bot 為 MVP 載體，解決高齡者面對醫療單據「看不懂、記不住、怕搞錯」的痛點。

核心流程：長者拍照/貼文字 → AI-OCR + LLM 解析 → 結構化儲存 → 口語化提醒 + 語音回覆

目標用戶場景（真實案例）：一位父親同時在台大醫院看 7 個不同科別（腫瘤科、泌尿科、耳鼻喉科、心臟科、影像醫學部、眼科），橫跨 2026/3 到 2027/2，每次就醫有不同的報到地點（東址/西址/不同樓層）、禁食要求、看診號碼，認知負荷極大。

---

## 技術棧

- **語言**: Python 3.11+
- **框架**: Flask（LINE Bot Webhook）
- **AI 引擎**: Gemini 2.0 Flash（Google AI）— 文字解析 + Vision 圖片辨識（已從 Claude 切換，測試 100% 通過）
- **LINE SDK**: line-bot-sdk v3（Messaging API）
- **排程**: APScheduler（定時提醒）
- **資料儲存**: MVP 階段用 JSON 檔，Phase 2 遷移至 SQLite/PostgreSQL
- **部署目標**: Railway.app 或 Render.com

---

## 現有程式碼（已完成的骨架）

### 檔案結構
```
care-wedo-bot/
├── app.py              # LINE Bot 主程式（Webhook + 圖片/文字處理 + 排程提醒）
├── prompts.py          # LLM 提示詞（醫療單據解析、語音查詢、禁食提醒）
├── test_parse.py       # 本地測試腳本（不需 LINE 即可驗證 AI 解析）
├── sample_data.json    # 8 筆真實預約資料（結構化 JSON）
├── requirements.txt    # Python 依賴
├── .env.example        # 環境變數範本
└── SETUP_GUIDE.md      # 部署指南
```

### 已實現的功能
1. ✅ 圖片接收 → Gemini Vision 解析 → JSON 結構化
2. ✅ 文字貼上 → 關鍵字偵測 → 自動解析為預約資料
3. ✅ 口語化查詢（「明天看什麼科？」→ AI 回答）
4. ✅ 定時檢查明日/當日預約 → 生成提醒文字
5. ✅ 禁食特殊提醒邏輯
6. ✅ 8 筆真實預約的結構化範例資料

### 尚未實現（需要你完成）
1. ❌ Flutter 前端 App（Voice-First UI）
2. ❌ LINE Flex Message 卡片式回覆（大字、視覺化）
3. ❌ 語音輸入/輸出（TTS/STT 整合）
4. ❌ 家人共管功能（多 LINE 帳號同步接收提醒）
5. ❌ Google Calendar 同步
6. ❌ 台大醫院院區導航資料
7. ❌ 防詐騙警示模組
8. ❌ 資料庫遷移（JSON → SQLite/PostgreSQL）
9. ❌ 單元測試與整合測試
10. ❌ CI/CD 部署管線

---

## 真實測試資料（8 筆預約）

以下是系統必須 100% 正確解析的測試案例：

```
原始文字輸入：
3/12（四）核磁共振晚上09：30 報到 東址一樓（台大醫院）磁振掃描三室 不用空腹
3/19（四）廖斌志 上午52號（14：00-14：30到）台大醫院腫瘤科
3/24（二）張尚仁 下午8號（西址2樓-泌尿部1診）台大醫院
4/7（二）陳俊男 上午46號 台大醫院 耳鼻喉科
4/22（三）心臟超音波台大醫院下午15號（東址5樓心臟超音波室）14:30左右到
4/29（三）劉言彬 上午 93號（前幾天要空腹8小時抽血、驗尿）台大醫院 腫瘤科
6/12（五）核磁共振上午09：30 報到 東址磁振正子掃描中心 不用空腹 台大醫院
2027年2/17（三）謝易庭 上午13號（要確認眼科搬去哪）當天要做 光學掃描（眼科門診光學掃描室3）大學眼科
```

預期解析結果的驗證規則：
- 總共 8 筆預約
- 4/29 的 `fasting_required` 必須為 `true`，`fasting_hours` 為 8
- 2027/2/17 的 `notes` 必須包含「眼科搬遷」相關警示
- 所有台大醫院的「東址」「西址」位置必須被正確提取
- `reminder_text` 必須是口語化、溫暖的語氣（用「爸爸」稱呼）

---

## Agent 任務分配指令

以下針對 Antigravity Manager View 的多 Agent 並行架構設計，可同時派遣 3-5 個 Agent：

---

### Agent 1：Flutter 前端開發（Voice-First UI）

```
你是 Care WEDO 的前端開發 Agent。

任務：用 Flutter 建立銀髮族友善的 Mobile App，核心是 Voice-First UI。

技術要求：
- Flutter 3.x + Dart
- 狀態管理：Riverpod 2.0
- HTTP 通訊：dio（與後端 Flask API 溝通）
- 語音：speech_to_text + flutter_tts（中文語音輸入輸出）
- 相機：camera plugin（拍照醫療單據）

UI 設計規範（銀髮族無障礙）：
- 正文字體 ≥ 20sp（比一般 App 大 25%）
- 背景與文字對比度 ≥ 4.5:1（WCAG AA）
- 所有可觸控元素 ≥ 56x56 dp（比標準 48dp 更大）
- 單一任務導向：一個畫面只做一件事
- 底部大按鈕導航（最多 3 個：首頁/拍照/設定）
- 不使用漢堡選單或滑動手勢（長者不熟悉）

核心頁面（共 5 頁）：

1. 首頁（今日提醒）
   - 最上方：大字顯示「今天 X 月 X 日」
   - 中央卡片：今日/明日預約（如有）
   - 若有禁食要求，用紅色醒目提示
   - 底部：大麥克風按鈕（語音查詢入口）

2. 拍照掃描頁
   - 全螢幕相機預覽
   - 底部一個大圓形拍照按鈕
   - 拍照後顯示「小護正在幫您看...」loading 動畫
   - 解析完成後跳轉到結果頁

3. 解析結果頁
   - 用卡片式排列顯示解析出的預約
   - 每張卡片包含：日期、科別、醫師、地點
   - 空腹要求用黃色警告框特別標示
   - 底部按鈕：「儲存」「重新拍」

4. 預約總覽頁
   - 時間軸式排列所有未來預約
   - 依日期排序，過期的自動灰掉
   - 點擊單筆可展開看詳細 + 聽語音播報

5. 設定頁
   - 提醒時間設定（就醫前幾小時提醒）
   - 家人 LINE 帳號綁定
   - 字體大小調整（大/更大/最大）
   - 語音速度調整（慢/正常）

色彩方案：
- 主色：#2E7D32（沉穩綠，代表健康）
- 強調色：#FF6F00（橘色，用於重要提醒）
- 背景：#FAFAFA（微灰白，護眼）
- 危險/警告：#D32F2F（紅色，用於禁食提醒）
- 文字：#212121（深灰，非純黑，減少刺眼）

請建立完整的 Flutter 專案結構，包含：
- lib/main.dart
- lib/screens/（5 個頁面）
- lib/widgets/（共用元件：大按鈕、預約卡片、語音按鈕）
- lib/services/（API 通訊、語音服務、通知服務）
- lib/models/（Appointment、Medication 資料模型）
- lib/providers/（Riverpod state management）
- pubspec.yaml（所有依賴）
```

---

### Agent 2：後端 API 強化 + 資料庫

```
你是 Care WEDO 的後端開發 Agent。

任務：將現有的 Flask MVP 升級為正式後端，加入 RESTful API、資料庫、家人共管功能。

現有程式碼在 app.py（LINE Bot Webhook + Gemini AI 解析），需要重構為模組化架構。

重要：AI 引擎使用 google.generativeai + gemini-2.0-flash，不要改用其他模型。

重構後的檔案結構：
care-wedo-bot/
├── app/
│   ├── __init__.py          # Flask app factory
│   ├── config.py            # 環境設定
│   ├── models/
│   │   ├── __init__.py
│   │   ├── appointment.py   # 預約 model
│   │   ├── medication.py    # 用藥 model
│   │   ├── user.py          # 用戶 model（支援家庭群組）
│   │   └── family_group.py  # 家庭共管群組
│   ├── services/
│   │   ├── __init__.py
│   │   ├── ai_parser.py     # AI 解析服務（從 app.py 抽出）
│   │   ├── reminder.py      # 提醒排程服務
│   │   ├── calendar_sync.py # Google Calendar 同步
│   │   └── notification.py  # LINE 推播服務
│   ├── api/
│   │   ├── __init__.py
│   │   ├── appointments.py  # CRUD API
│   │   ├── medications.py   # 用藥 API
│   │   ├── parse.py         # 上傳解析 API
│   │   └── family.py        # 家庭共管 API
│   └── line_bot/
│       ├── __init__.py
│       ├── webhook.py       # LINE Webhook handler
│       └── flex_messages.py # LINE Flex Message 模板
├── migrations/              # 資料庫遷移
├── tests/
│   ├── test_parser.py       # 解析準確率測試
│   ├── test_api.py          # API 端點測試
│   └── test_reminders.py    # 提醒邏輯測試
├── prompts.py               # LLM 提示詞（保留現有）
├── requirements.txt
├── Dockerfile
└── docker-compose.yml

資料庫設計（SQLite for MVP → PostgreSQL for production）：
- users: id, line_user_id, name, created_at
- family_groups: id, name, created_at
- family_members: id, user_id, group_id, role(admin/member)
- appointments: id, user_id, date, time, hospital, department, doctor, number, location, fasting_required, fasting_hours, notes, reminder_text, status(upcoming/completed/cancelled), created_at
- medications: id, user_id, name, dosage, frequency, purpose, warnings, start_date, end_date, active
- reminders_sent: id, appointment_id, user_id, type(day_before/same_day/fasting), sent_at

LINE Flex Message 設計：
- 預約卡片：大字體日期 + 科別 + 醫師 + 地點，底部有「導航」按鈕
- 用藥提醒：藥名 + 劑量 + 服藥時間，配色鮮明
- 禁食警告：紅色邊框卡片，大字提示「今晚 12 點後不能吃東西」

家人共管邏輯：
- 長者的 LINE 帳號為主帳號
- 子女可透過 6 位數邀請碼加入家庭群組
- 長者收到提醒時，子女同步收到（可設定靜音）
- 若長者連續 3 天未確認服藥，自動通知子女

請使用 Flask-SQLAlchemy + Flask-Migrate，並撰寫完整的 pytest 測試。
```

---

### Agent 3：LINE Flex Message + Rich Menu 設計

```
你是 Care WEDO 的 LINE 介面設計 Agent。

任務：設計銀髮族友善的 LINE Flex Message 模板和 Rich Menu，讓長者在 LINE 中就能完成所有操作。

Rich Menu 設計（底部常駐選單，3 格）：
- 左格：📸「拍照掃描」（觸發相機/相簿選擇）
- 中格：📅「我的預約」（顯示所有未來預約）
- 右格：🎙️「問小護」（觸發語音輸入提示）

每格尺寸建議：833x843 px（總 2500x843 px）
字體要大、圖示要明確、顏色要高對比

Flex Message 模板（用 JSON 格式，符合 LINE Flex Message API spec）：

1. 預約提醒卡片
{
  "type": "bubble",
  "size": "mega",
  "header": { "大字日期 + 科別" },
  "body": {
    "醫師名": "大字",
    "看診號碼": "超大字 + 醒目色",
    "報到地點": "含東址/西址標示",
    "注意事項": "如有空腹要求，用紅色 box 強調"
  },
  "footer": {
    "buttons": ["導航", "加到行事曆", "我知道了"]
  }
}

2. 掃描結果卡片（carousel 多張）
- 每張卡片一筆預約
- 可左右滑動瀏覽
- 底部「全部儲存」按鈕

3. 禁食特別警告卡片
- 紅色漸層背景
- 超大字：「明天要空腹！」
- 說明：「晚上 XX 點後不能吃東西」
- 底部：「我記住了」確認按鈕

4. 每日用藥提醒卡片
- 早/午/晚 分欄顯示
- 每顆藥配簡單圖示 💊
- 底部：「已服藥」打勾按鈕

5. 語音查詢結果卡片
- 顯示查詢問題 + AI 回答
- 底部：「播放語音」按鈕

所有 Flex Message 的文字規範：
- 標題：xl size, bold, color #212121
- 內文：lg size, regular, color #424242
- 強調文字（如空腹）：xl size, bold, color #D32F2F
- 按鈕文字：lg size, bold

請產出完整的 flex_messages.py Python 模組，包含所有模板的建構函式。
每個函式接受預約/用藥 dict 作為參數，回傳 LINE Flex Message JSON。
```

---

### Agent 4：測試 + CI/CD + 部署

```
你是 Care WEDO 的 DevOps Agent。

任務：建立完整的測試套件、CI/CD 管線、以及一鍵部署流程。

1. 測試套件（pytest）

test_parser.py — AI 解析準確率測試：
- 用 8 筆真實預約文字作為 fixture
- 驗證每筆的 date、department、doctor、fasting_required、location 是否正確
- 設定準確率門檻 ≥ 95%（允許 reminder_text 措辭差異）
- Mock Gemini API 回應以加快測試速度

test_api.py — API 端點測試：
- POST /api/parse（文字解析）
- POST /api/parse/image（圖片解析）
- GET /api/appointments（查詢預約）
- POST /api/appointments（新增預約）
- DELETE /api/appointments/{id}（刪除預約）
- POST /api/family/invite（產生邀請碼）
- POST /api/family/join（加入家庭群組）

test_reminders.py — 提醒邏輯測試：
- 明天有預約 → 應觸發提醒
- 明天有空腹預約 → 應觸發禁食提醒（含禁食開始時間計算）
- 過期預約 → 不應觸發提醒
- 連續 3 天未確認服藥 → 應通知家人

2. CI/CD（GitHub Actions）

.github/workflows/ci.yml：
- trigger: push to main, pull request
- steps: lint (ruff) → type check (mypy) → test (pytest) → build docker image
- 測試時 mock 所有外部 API（Gemini、LINE）

.github/workflows/deploy.yml：
- trigger: push tag v*
- steps: build → push to registry → deploy to Railway/Render

3. Docker 部署

Dockerfile：
- python:3.11-slim base
- 安裝 requirements.txt
- 暴露 PORT 環境變數
- gunicorn 作為 production server

docker-compose.yml：
- app service（Flask）
- db service（PostgreSQL，Phase 2 用）
- redis service（未來用於 rate limiting）

4. Railway 部署設定

railway.toml：
- build command: pip install -r requirements.txt
- start command: gunicorn app:app
- 環境變數清單

請產出所有設定檔，確保 git push 後能自動測試、自動部署。
```

---

### Agent 5：台大醫院導航資料 + 防詐模組

```
你是 Care WEDO 的資料與安全 Agent。

任務 A：建立台大醫院院區導航資料庫

台大醫院分為東址與西址，長者經常搞混。請建立結構化的導航資料：

ntuh_navigation.json 結構：
{
  "hospitals": {
    "ntuh": {
      "name": "國立臺灣大學醫學院附設醫院",
      "short_name": "台大醫院",
      "campuses": {
        "east": {
          "name": "東址",
          "address": "台北市中正區中山南路7號",
          "floors": {
            "1F": {
              "departments": ["掛號櫃台", "急診", "磁振掃描室"],
              "landmarks": "正門入口右轉"
            },
            "5F": {
              "departments": ["心臟超音波室", "心臟內科"],
              "landmarks": "搭電梯到5樓右轉"
            }
          },
          "mrt": "台大醫院站2號出口",
          "bus": "0南、15、18、22、208、295"
        },
        "west": {
          "name": "西址",
          "address": "台北市中正區常德街1號",
          "floors": {
            "2F": {
              "departments": ["泌尿部", "皮膚科"],
              "landmarks": "搭手扶梯到2樓"
            }
          },
          "mrt": "台大醫院站4號出口",
          "bus": "0南、15、22、208"
        }
      },
      "special_notes": {
        "磁振正子掃描中心": "東址，獨立入口",
        "眼科": "2027年可能搬遷，就醫前請致電確認：(02)2312-3456"
      }
    }
  }
}

請盡可能補充完整台大醫院各科別的樓層與位置資訊。

任務 B：防詐騙警示模組

scam_guard.py：
- 維護一份常見醫療詐騙話術清單（如「健保卡遭冒用」「需繳保證金」「醫療補助退款」）
- 當長者收到疑似詐騙訊息並轉傳給 Bot 時，AI 分析是否為詐騙
- 若判定為高風險，立即推播警告給長者 + 通知家人
- 提供一鍵撥打 165 反詐騙專線的按鈕

實作方式：
- 用 LLM 做詐騙偵測（prompt engineering）
- 設定信心閾值：>80% 疑似詐騙 → 警告；>95% → 強烈警告 + 通知家人
- 記錄所有偵測結果到 scam_log.json
```

---

## 驗收標準（Definition of Done）

1. 長者能透過 LINE 拍照 → 收到口語化的預約解析結果
2. 8 筆真實預約的解析準確率 ≥ 95%
3. 就醫前一天自動推播提醒（含禁食警告）
4. 子女 LINE 帳號能同步收到提醒
5. 所有 UI 元素符合銀髮無障礙規範（字體 ≥ 16px、對比度 ≥ 4.5:1、觸控 ≥ 44x44px）
6. pytest 測試覆蓋率 ≥ 80%
7. 一鍵部署到 Railway.app 可正常運作

---

## 備註

- 所有 AI 回覆語氣以「小護」為人設，像家人一樣溫暖
- 稱呼長者統一用「爸爸」（可在設定中改為「媽媽」「阿公」「阿嬤」等）
- 醫療資訊僅做整理提醒，不做醫療診斷或建議
- 隱私第一：所有資料僅存本地/用戶授權範圍內，不外傳第三方
- AI 引擎：統一使用 google.generativeai + gemini-2.0-flash（Phase 1 已驗證通過，8 筆預約解析 100%）
- 環境變數：使用 GOOGLE_API_KEY（非 ANTHROPIC_API_KEY）
