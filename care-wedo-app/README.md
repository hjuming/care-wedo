# Care WEDO App

React 19 + Vite 前端，搭配 Cloudflare Pages Functions 與 Supabase。

## 主要頁面

| 路由 | 說明 |
|---|---|
| `/` | 未登入首頁，長輩友善產品說明、方案比較、回饋表單 |
| `/login` | LINE 登入頁 |
| `/app` | 今日照護首頁 |
| `/privacy` | 隱私政策 |
| `/terms` | 服務條款與非醫療聲明 |

## 未登入首頁目前定位

- 測試期間全功能免費開放。
- 首屏主軸：把醫院單子變成家人看得懂的提醒。
- CTA：加入 LINE 小管家、家人登入後台。
- 方案區塊：界定 Free 與照護圈升級規劃；照護圈單一家庭群組收費區間為 $30-250/月。
- 回饋區塊：使用 EmailJS 收集試用意見。

## 2026-05-27 後台與計費模型更新

- 後台照護圈頁已收斂為「協作者管理中心」：設定、邀請協作者、新增主要照護對象、家人提醒、資料協助與費用預估集中在同一頁。
- 長輩主要頁面只保留拍照新增、查看提醒、完成確認；手動新增與設定操作交由協作者處理。
- 每個家庭群組上限：主要照護對象 4 位、共同協作者 5 位、主帳號 1 位。
- 主帳號不列入協作者費用，也不在費用明細顯示 `$0`。
- 正式收費公式：主要照護對象 `$30 x 位數`，共同協作者 `$10 x 位數`，單一家庭群組最高 $250/月。
- 新增照護對象或邀請協作者時，介面會先顯示上限；超過時建議另開家庭群組。
- 2026-05-28 已補 Beta 費用確認 modal：新增主要照護對象或邀請共同協作者前，顯示目前月費、增加後月費、測試期不扣款與禁止靜默升級說明。
- 用藥總表手機版改為欄位標籤卡片，操作改為 `複製文字` 與 `儲存圖片`。

## SEO / 社交分享設定

- 首頁與 SPA 子路徑共用同一組 OG / Twitter meta。
- 社交分享圖：`/assets/images/og-care-wedo.jpg`。
- 圖片規格：1200x630 JPEG，符合 Facebook / LINE / X 常見 large preview 比例。
- `robots.txt` 明確允許 `facebookexternalhit`、`Facebot`、`meta-externalagent`、`Twitterbot`、`LinkedInBot`、`Slackbot-LinkExpanding`、`WhatsApp`、`TelegramBot`。
- `_headers` 對分享圖設定 `X-Robots-Tag: all`，避免 crawler 誤判圖片不可索引。

### 2026-05-17 Facebook Debugger 修復紀錄

- 原症狀：Facebook Sharing Debugger 對首頁與 `/terms` 抓取回 403，提示可能被 `robots.txt` 擋住，預覽圖片無法顯示。
- 修復：OG/Twitter image 從 PNG 改為 1200x630 JPG，新增 Meta crawler allow 規則，分享圖加 `X-Robots-Tag: all`。
- 驗證：`npm test` 97/97 passed、`npm run build` 成功、Cloudflare Pages 已部署，Facebook Debugger 重新抓取後回應碼 200 並正常顯示圖片。

## EmailJS 回饋表單

需要以下 Vite 環境變數：

```text
VITE_EMAILJS_SERVICE_ID
VITE_EMAILJS_TEMPLATE_ID
VITE_EMAILJS_PUBLIC_KEY
```

請將實際值放在 `.env` 或 Cloudflare Pages 環境變數，不要寫進程式碼或文件。

EmailJS template 建議支援欄位：

- `name`
- `email`
- `title`
- `from_name`
- `reply_to`
- `topic`
- `message`
- `source`
- `submitted_at`
- `submitted_at_taipei`
- `website_url`
- `logo_url`
- `hero_image_url`

完整信件 HTML 範本請看專案根目錄的 `EMAILJS_FEEDBACK_TEMPLATES.md`。建議 EmailJS 直接寄給 `{{email}}`，並在 `Cc` 填管理者收件信箱留存副本。

## 開發指令

```bash
npm install
npm run dev
pnpm test
pnpm lint
pnpm build
```

## Production Observability

- 前端 production error 會透過 `/api/telemetry` 送入 Cloudflare Pages Functions logs。
- 前端與 Functions 共同使用事件分類：`ocr_failed`、`line_push_failed`、`quota_exceeded`、`auth_failed`、`cron_failed`。
- 不記錄醫療全文、token、原圖、base64；排查指令與告警門檻請看根目錄 `PRODUCTION_OBSERVABILITY_RUNBOOK.md`。

## 設計原則

- 長輩可讀：字大、短句、明確按鈕。
- 首頁不做複雜功能教學，只講使用情境。
- LINE 對話只回提醒，不輸出完整醫療解析報告。
- 家人端保留完整資料、查詢、修改與協作。
- 設定與管理操作集中在照護圈頁，不分散到今日、排程、紀錄、用藥頁。
- 所有新增 UI 必須做 390px 手機寬度檢查；目標情境包含 LINE WebView。
- 上傳入口同時支援照片與文字；文字貼上後也要經 AI 判讀、寫入資料庫，再回到同一個人工確認流程。
- LINE 通知語氣要像家人貼心提醒，不像系統公告；固定用 `早安` / `晚安` 開頭與 `Care WEDO 陪你照顧最重要的人` 收尾。
- LINE Login 只完成網頁身份驗證；要收到上傳摘要與每日提醒，家人仍需加入 LINE 照護小管家官方帳號。

## AIO / 靜態內容待補

目前 OG/Twitter meta、JSON-LD、FAQPage、sitemap、robots、llms 已有基礎；下一階段仍需補低成本靜態頁，讓不執行 JavaScript 的搜尋摘要器與 AI crawler 也能直接讀到核心內容：

- `/faq`：產品用途、限制、資料保存、非醫療診斷聲明。
- `/guide`：LINE 上傳、家人登入、照護圈協作流程。
- `/pricing`：Free / 照護圈升級、$30-250/月、4 位主要照護對象 + 5 位協作者上限。
- `/llms.txt`：同步產品定位、功能、限制、價格模型、客服信箱。

## LINE 通知語氣與排程

通知格式：

```text
早安

提醒您接下來的注意事項。

Matt 5/30（六）
下午 3:00 要去看牙。
地點在陳幸妤牙醫診所。

Care WEDO
陪你照顧最重要的人
https://care.wedopr.com
```

前端與後台文案需對齊以下原則：

- 不使用公告式字眼，例如「測試通知」、「完整清單在這裡」、「提醒您一下」。
- 不在 LINE 推播放完整地址；地址留在後台清單。
- 院所名稱若已包含醫師姓名，不再重複顯示醫師。
- 一般預約與吃藥簡報是早上 08:00；空腹提醒是前一天晚上 20:00。
- 上傳摘要會立即通知上傳本人與同群組其他有開啟摘要通知的成員；上傳本人不會被重複推播第二次。
