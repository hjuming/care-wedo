import { checkEnvReadiness } from "../_shared/env_schema";

type HealthEnv = {
  CRON_SECRET?: string;
} & Record<string, unknown>;

/**
 * 公開回應只給 env_ready 布林（不向未授權者洩露設定狀態）。
 * 帶正確的 CRON_SECRET Bearer 時，回傳缺漏變數「名稱」明細（不含值），
 * 供部署後 smoke check 使用：
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/health
 */
export const onRequestGet: PagesFunction<HealthEnv> = async ({ request, env }) => {
  const readiness = checkEnvReadiness(env);

  const base = {
    status: readiness.ok ? "ok" : "degraded",
    service: "Care WEDO",
    runtime: "cloudflare-pages-functions",
    version: "0.1.0",
    env_ready: readiness.ok,
  };

  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const authorized = Boolean(env.CRON_SECRET) && token === env.CRON_SECRET;

  if (!authorized) {
    return Response.json(base, { status: readiness.ok ? 200 : 503 });
  }

  return Response.json(
    {
      ...base,
      missing_required: readiness.missing_required,
      missing_recommended: readiness.missing_recommended,
    },
    { status: readiness.ok ? 200 : 503 },
  );
};
