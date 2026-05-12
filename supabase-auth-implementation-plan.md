# Care WEDO — Supabase Auth 並行導入開發計畫

> 建立日期：2026-05-10
> 版本目標：在不破壞現有 LINE LIFF / LINE Bot 流程的前提下，新增 Supabase Auth，讓家人可用 Google / Apple / Email 等方式登入 Dashboard。
> 執行原則：先並行、再整合；先 Google MVP、再 Apple / Email；不要一次重寫既有 LINE 身分系統。

## 一句話方向

Care WEDO 的長輩端與 LINE Bot 繼續使用 LINE 身分；家人端 Dashboard 新增 Supabase Auth，讓電腦與手機瀏覽器登入更穩定，並為未來 Apple、Google、Email Magic Link、企業 SSO 留接口。

## 為什麼不是直接取代 LINE LIFF

現有系統已依賴 LINE：

| 現有能力 | 依賴 |
|---|---|
| LINE Bot OCR 上傳 | `line_user_id`、Messaging API |
| LIFF Dashboard | LINE idToken |
| Cron 早安 / 晚安推播 | LINE user id / recipient 設定 |
| 家庭群組與照護對象 | `users`、`user_family_groups`、`care_profiles` |

因此本次導入應採「雙軌身分」：

```txt
LINE LIFF / LINE Bot
  -> LINE idToken
  -> public.users.line_user_id
  -> 現有照護資料與推播

Supabase Auth
  -> Supabase access_token
  -> public.users.auth_user_id
  -> 同一份 family_groups / care_profiles / appointments / medications
```

## 本版範圍

### 本版要做

- 新增 Supabase Auth client 與 Google OAuth MVP。
- 新增 `/auth/callback` SPA route。
- 前端 identity 模型支援 `line` 與 `supabase`。
- Cloudflare Pages Functions middleware 支援 LINE idToken 或 Supabase JWT。
- `public.users` 新增 `auth_user_id`，讓 Supabase Auth user 可對應現有 Care WEDO user。
- 登入頁提供 LINE 與 Google 兩種入口。
- 保留現有 LINE Bot、LIFF、OCR、Cron、群組資料模型。

### 本版不做

- 不移除 LINE 登入。
- 不改寫 LINE Bot webhook。
- 不導入 SAML / Enterprise SSO。
- 不一次啟用所有 provider。
- 不把 service role key 放進前端。
- 不直接開放未經測試的 RLS 全量改造。

## 參考文件

- Supabase Auth Overview：https://supabase.com/docs/guides/auth
- Supabase React Quickstart：https://supabase.com/docs/guides/auth/quickstarts/react
- Supabase Redirect URLs：https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Social Login：https://supabase.com/docs/guides/auth/social-login

## 目標架構

### 統一 identity 物件

後端 middleware 驗證成功後，統一寫入：

```ts
type RequestIdentity =
  | {
      provider: "line";
      lineUserId: string;
      name?: string;
    }
  | {
      provider: "supabase";
      authUserId: string;
      email?: string;
      name?: string;
    };
```

資料存取層不得直接假設只有 `lineUserId`。所有需要 user id 的 helper 應改走：

```ts
getOrCreateUserFromIdentity(env, identity)
```

### users schema

建議先最小擴充 `public.users`：

```sql
alter table public.users
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists auth_provider text;

create unique index if not exists users_auth_user_id_unique
  on public.users(auth_user_id)
  where auth_user_id is not null;

create index if not exists users_line_user_id_idx
  on public.users(line_user_id)
  where line_user_id is not null;
```

後續若要支援多重身份綁定，再新增 `user_identities`：

```sql
create table if not exists public.user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public.users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  email text,
  created_at timestamptz not null default now(),
  unique(provider, provider_user_id)
);
```

## Console 設定

### Supabase Auth URL Configuration

在 Supabase Dashboard：

```txt
Authentication
→ URL Configuration
→ Site URL: https://care.wedopr.com
→ Redirect URLs:
  https://care.wedopr.com/auth/callback
  https://care.wedopr.com/app
  http://localhost:5173/**
```

正式環境避免使用過寬 wildcard；preview / local 才使用 `**`。

### Google Provider

在 Google Cloud Console 建立 OAuth client，並把 callback 設為：

```txt
https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback
```

在 Supabase Dashboard 啟用 Google Provider，填入 Google client id / secret。這些值只放在 Supabase Console，不放在 repo。

### Apple Provider

Apple Auth 留到第二階段。原因：Apple Developer 設定、Service ID、Key ID、Team ID、Private Key 與首次登入姓名行為都比 Google 複雜，不應阻塞 MVP。

## 環境變數

### 前端 Vite

更新 `care-wedo-app/.env.example`：

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

只允許 publishable / anon key。嚴禁放入 service role key。

### Cloudflare Pages Functions

新增 production secret / vars：

```txt
SUPABASE_JWT_SECRET 或 SUPABASE_AUTH_JWKS_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
LINE_LOGIN_CHANNEL_ID
```

實作時優先採 JWKS / 官方 JWT 驗證方式；若使用 JWT secret，必須放在 Cloudflare Secrets，不得寫入 `wrangler.toml`。

## Sprint A：前端 Supabase Auth MVP

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| A-1 安裝 Supabase client | `care-wedo-app/package.json` | 安裝 `@supabase/supabase-js`。 | `npm test` 與 `npm run build` 可執行。 |
| A-2 建立 Auth client | 新增 `care-wedo-app/src/services/supabaseAuth.js` | 使用 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` 建立 client；缺設定時回傳可讀錯誤，不暴露 secrets。 | 單元測試確認缺 env 不會噴不可讀錯誤。 |
| A-3 實作 Google 登入 | `supabaseAuth.js`、`App.jsx` | `signInWithOAuth({ provider: "google", options: { redirectTo: origin + "/auth/callback?next=/app" } })`。 | 點 Google 登入後可導向 Supabase / Google OAuth。 |
| A-4 新增 callback route | `routing.js`、`App.jsx` | 支援 `/auth/callback`，callback 完成後導回 `/app`。 | `/auth/callback?next=/app` 不會落回首頁。 |
| A-5 登入頁雙入口 | `App.jsx`、`index.css` | `/login` 顯示「用 LINE 登入」與「用 Google 登入」。 | 390px 手機版按鈕不重疊，文案清楚區分用途。 |

## Sprint B：前端 identity 統一

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| B-1 擴充 identity state | `App.jsx` | identity 支援 `{ provider, accessToken, idToken, profile, status }`；LINE 使用 `idToken`，Supabase 使用 `accessToken`。 | LINE 登入既有測試不壞。 |
| B-2 API Authorization 改名但相容 | `services/api.js` | 支援 `identity.accessToken || identity.idToken` 組 Authorization header。 | 既有 `buildDashboardRequest` 測試通過，新增 Supabase token 測試。 |
| B-3 Supabase session boot | `App.jsx`、`supabaseAuth.js` | `/app` boot 時先查 LINE callback，再查 Supabase session；兩者都沒有才導 `/login`。 | Google 登入後重整 `/app` 仍維持登入。 |
| B-4 登出雙軌 | `services/liff.js`、`supabaseAuth.js`、`App.jsx` | 依 provider 呼叫 LINE logout 或 Supabase signOut，再回 `/login`。 | Google 登出後重整不再進 Dashboard。 |

## Sprint C：後端雙軌驗證

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| C-1 新增 Supabase JWT verifier | `functions/_shared/supabase.ts` 或新增 `functions/_shared/auth.ts` | 實作 `verifySupabaseAccessToken(env, token)`，回傳 `authUserId/email/name`。 | 用 mock JWT / mock verifier 測試成功與失敗路徑。 |
| C-2 middleware 雙軌驗證 | `functions/api/_middleware.ts` | 先嘗試 LINE idToken；失敗後嘗試 Supabase JWT；兩者都失敗才 401。 | 無 token 仍 401；LINE token 路徑維持；Supabase token 可通過。 |
| C-3 統一 getOrCreate user | `functions/_shared/supabase.ts` | 新增 `getOrCreateUserFromIdentity`，LINE 走 `line_user_id`，Supabase 走 `auth_user_id`。 | Google 新用戶首次進 `/app` 可建立 user row。 |
| C-4 替換 API 內部 user 取得 | `functions/api/dashboard.ts`、`groups.ts`、`ocr/*`、`appointments/*`、`medications/*` | 將直接依賴 `identity.lineUserId` 的地方改用統一 helper。 | LINE 與 Supabase 登入都能讀 dashboard；未登入仍 fail-closed。 |

## Sprint D：資料庫遷移

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| D-1 新增 migration | 新增 `supabase/migration_supabase_auth_identity.sql` | 加 `auth_user_id`、`auth_provider`、partial unique index。 | 在 Supabase SQL Editor 執行無錯。 |
| D-2 更新 schema snapshot | `supabase/schema.sql` | 將新欄位與 index 納入主 schema。 | 新環境套 schema 後包含 auth 欄位。 |
| D-3 建立資料合併策略文件 | 本文件或 README 補充 | 明定同一人 LINE 與 Google 的合併暫不自動執行，避免誤合併醫療資料。 | 工程師與營運知道 MVP 不自動 merge identity。 |

## Sprint E：驗證與回歸

| 任務 | 驗證方式 | 驗收 |
|---|---|---|
| E-1 單元測試 | `npm test` | 全部通過，新增 auth / routing / API header 測試。 |
| E-2 Production build | `npm run build` | Vite build 成功。 |
| E-3 LINE 回歸 | LINE 實機登入 `/app` | LINE 登入後仍可進 Dashboard、OCR、群組流程。 |
| E-4 Google MVP | Chrome / Safari 登入 | Google 登入後可進 `/app`，重整不掉 session。 |
| E-5 API fail-closed | 無 Authorization 呼叫 protected API | 回 401，不回 demo 或敏感資料。 |
| E-6 首次登入 onboarding | 新 Google user 進 `/app` | 會出現建立家庭 / 照護對象流程。 |

## 安全要求

- 不得在 console / structured log 中記錄 access token、refresh token、id token、authorization header。
- Cloudflare Functions 若驗證 JWT 失敗，只回一般錯誤訊息，不回完整 token payload。
- Supabase service role key 僅存在 Cloudflare Secrets。
- 前端只使用 publishable / anon key。
- 新增 provider 前必須逐一確認 Redirect URLs allow list。
- OAuth callback 不接受任意外站 `next`；只允許 `/app`、`/login` 等站內路徑。
- Supabase Auth user 與 LINE user 不自動合併，除非使用者完成明確綁定流程。

## 風險與對策

| 風險 | 影響 | 對策 |
|---|---|---|
| Google user 與 LINE user 是同一人但資料分裂 | 家庭資料看不到 | MVP 先不自動合併；後續做「綁定 LINE 帳號」流程。 |
| callback redirect 設定錯誤 | 登入後回首頁或 400 | Supabase Redirect URLs 與 Google OAuth callback 分開檢查。 |
| middleware 誤把 invalid LINE token 當 Supabase token | 安全風險 | 雙 verifier 都必須嚴格驗 issuer / audience / signature。 |
| Supabase Auth session 與 LIFF session 同時存在 | 登出與 identity 混亂 | identity 明確標記 provider；登入頁可提供「切換帳號」清除 session。 |
| Apple Auth 設定延誤 | 阻塞進度 | 第一階段只做 Google，Apple 排第二階段。 |

## 完成定義

- [ ] `/login` 同時提供 LINE 與 Google 登入。
- [ ] Google OAuth 成功後可進入 `/app`。
- [ ] Google 登入使用者可建立家庭群組與照護對象。
- [ ] LINE LIFF 登入、LINE Bot OCR、Cron 推播沒有回歸。
- [ ] Protected API 對無 token / invalid token 維持 401。
- [ ] `public.users` 可區分 `line_user_id` 與 `auth_user_id`。
- [ ] `npm test` 通過。
- [ ] `npm run build` 通過。
- [ ] 文件未包含任何 key、token、secret。

## 建議執行順序

1. 先完成 Console 設定與 Google provider。
2. 做 Sprint A，確認 OAuth 能完整回 `/auth/callback`。
3. 做 Sprint B，讓前端 identity 與 API header 支援 Supabase token。
4. 做 Sprint C，讓後端 middleware 與資料存取支援雙軌身份。
5. 做 Sprint D，套 migration 並確認新 user 建立流程。
6. 做 Sprint E，全量回歸 LINE 實機與 Google MVP。
