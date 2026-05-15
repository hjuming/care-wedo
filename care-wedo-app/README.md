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
- 方案區塊：界定 Free 與 Family Pro 規劃。
- 回饋區塊：使用 EmailJS 收集試用意見。

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
npm test
npm run lint
npm run build
```

## 設計原則

- 長輩可讀：字大、短句、明確按鈕。
- 首頁不做複雜功能教學，只講使用情境。
- LINE 對話只回提醒，不輸出完整醫療解析報告。
- 家人端保留完整資料、查詢、修改與協作。
