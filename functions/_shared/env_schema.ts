/**
 * Env 就緒檢查（Phase B：啟動前檢查）。
 * 名單來源：根目錄 env.schema.json（單一事實來源，scripts/check-env.mjs 共用）。
 * 只檢查「是否存在且非空」，絕不記錄或回傳變數值。
 */
import schema from "../../env.schema.json";

const REQUIRED = Object.keys(schema.pages_functions.required);
const RECOMMENDED = Object.keys(schema.pages_functions.recommended);
const ALIASES: Record<string, string> = schema.pages_functions.fallback_aliases ?? {};

export type EnvReadiness = {
  ok: boolean;
  missing_required: string[];
  missing_recommended: string[];
};

export function checkEnvReadiness(env: Record<string, unknown>): EnvReadiness {
  const isSet = (name: string) => {
    const value = env[name];
    return typeof value === "string" && value.trim().length > 0;
  };
  const isSatisfied = (name: string) => isSet(name) || (ALIASES[name] ? isSet(ALIASES[name]) : false);
  const missingRequired = REQUIRED.filter((name) => !isSatisfied(name));
  const missingRecommended = RECOMMENDED.filter((name) => !isSatisfied(name));
  return {
    ok: missingRequired.length === 0,
    missing_required: missingRequired,
    missing_recommended: missingRecommended,
  };
}
