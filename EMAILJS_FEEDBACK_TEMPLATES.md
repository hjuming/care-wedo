# Care WEDO EmailJS 意見回饋信件模板

> 用途：首頁「試用回饋」表單送出後，寄一封確認信給使用者。
>
> 你可以在 EmailJS 的 `Cc` 填自己的收件信箱，這樣同一封信也會寄給你留存。

## EmailJS 模板參數

前端會送出以下參數：

| 參數 | 說明 |
|---|---|
| `{{name}}` | 使用者稱呼 |
| `{{email}}` | 使用者 Email |
| `{{title}}` | 回饋標題，例如 `LINE 上傳流程 回饋` |
| `{{topic}}` | 回饋項目 |
| `{{message}}` | 使用者填寫的建議 |
| `{{submitted_at_taipei}}` | 台北時間 |
| `{{submitted_at}}` | ISO 時間 |
| `{{website_url}}` | `https://care.wedopr.com/` |
| `{{logo_url}}` | Care WEDO icon |
| `{{hero_image_url}}` | Care WEDO 社交分享圖片 |
| `{{source}}` | `Care WEDO landing feedback` |

## EmailJS 設定

| 欄位 | 建議值 |
|---|---|
| Subject | `Care WEDO 收到您的回饋了` |
| To Email | `{{email}}` |
| Cc | 你的收件信箱 |
| From Name | `Care WEDO` |
| Reply To | `care@wedopr.com` |

## HTML 內容

```html
<div style="margin:0;background:#F7F3EC;padding:28px 14px;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans TC','PingFang TC','Microsoft JhengHei',Arial,sans-serif;color:#1F2A2C;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #D8D2C8;border-radius:18px;overflow:hidden;box-shadow:0 18px 48px rgba(72,55,33,0.08);">
    <div style="background:#DDEBED;padding:22px 26px;border-bottom:1px solid #C8DADD;">
      <a href="{{website_url}}" target="_blank" style="text-decoration:none;color:#315F68;display:inline-flex;align-items:center;gap:10px;">
        <img src="{{logo_url}}" alt="Care WEDO" width="38" height="38" style="width:38px;height:38px;border-radius:50%;vertical-align:middle;margin-right:10px;" />
        <span style="font-size:24px;font-weight:900;letter-spacing:0;color:#315F68;vertical-align:middle;">Care WEDO</span>
      </a>
      <p style="margin:10px 0 0;color:#4B5B5F;font-size:15px;line-height:1.6;">LINE 醫療照護小管家</p>
    </div>

    <img src="{{hero_image_url}}" alt="Care WEDO 醫療照護小管家" style="display:block;width:100%;height:auto;border:0;" />

    <div style="padding:28px 26px 8px;">
      <p style="margin:0 0 18px;font-size:18px;line-height:1.8;">{{name}} 您好，</p>

      <h1 style="margin:0 0 14px;font-size:26px;line-height:1.35;color:#315F68;">謝謝您的回饋</h1>

      <p style="margin:0 0 18px;font-size:17px;line-height:1.8;color:#4B5B5F;">
        我們已收到您的建議。Care WEDO 仍在測試中，這些回饋會幫助我們把 LINE 上傳、提醒文案、吃藥頁與家人協作流程做得更清楚。
      </p>

      <div style="background:#FFF9EF;border:1px solid #E8D7BC;border-radius:14px;padding:18px;margin:22px 0;">
        <p style="margin:0 0 8px;color:#B97832;font-weight:900;font-size:15px;">回饋項目</p>
        <p style="margin:0;font-size:20px;font-weight:900;color:#1F2A2C;">{{topic}}</p>
      </div>

      <div style="background:#F8FAF8;border:1px solid #D8D2C8;border-radius:14px;padding:18px;margin:0 0 22px;">
        <p style="margin:0 0 8px;color:#315F68;font-weight:900;font-size:15px;">您留下的意見</p>
        <p style="margin:0;white-space:pre-line;font-size:17px;line-height:1.8;color:#1F2A2C;">{{message}}</p>
      </div>

      <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#8A9699;">送出時間：{{submitted_at_taipei}}</p>

      <a href="{{website_url}}" target="_blank" style="display:inline-block;background:#315F68;color:#FFFFFF;text-decoration:none;border-radius:12px;padding:14px 22px;font-size:17px;font-weight:900;">
        前往 Care WEDO 官網
      </a>
    </div>

    <div style="padding:22px 26px 26px;border-top:1px solid #E8E1D8;margin-top:22px;background:#FBF8F2;">
      <p style="margin:0 0 8px;font-size:16px;line-height:1.7;color:#4B5B5F;">Care WEDO 團隊</p>
      <p style="margin:0;font-size:13px;line-height:1.7;color:#8A9699;">
        Care WEDO 協助整理照護資訊，不提供診斷，也不取代醫師或藥師建議。<br />
        © 2026 Care WEDO. All rights reserved.
      </p>
    </div>
  </div>
</div>
```
