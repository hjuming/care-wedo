import { classifyLogEvent, redact } from "./logger";

export type AlertEnv = {
  CARE_WEDO_ALERT_WEBHOOK_URL?: string;
  CARE_WEDO_ALERT_WEBHOOK_SECRET?: string;
  CARE_WEDO_ENV?: string;
  CF_PAGES_BRANCH?: string;
  CF_PAGES_COMMIT_SHA?: string;
};

type AlertFields = Record<string, unknown>;

function normalizeAlertFields(fields: AlertFields = {}) {
  const normalized: AlertFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) {
      normalized[key] = {
        name: value.name,
        message: value.message,
      };
    } else {
      normalized[key] = value;
    }
  }
  return redact(normalized) as AlertFields;
}

export async function sendProductionAlert(
  env: AlertEnv,
  event: string,
  fields: AlertFields = {},
  severity: "warning" | "error" = "error",
) {
  const webhookUrl = env.CARE_WEDO_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const headers = new Headers({ "Content-Type": "application/json" });
  if (env.CARE_WEDO_ALERT_WEBHOOK_SECRET) {
    headers.set("X-Care-WEDO-Alert-Secret", env.CARE_WEDO_ALERT_WEBHOOK_SECRET);
  }

  const payload = {
    service: "care-wedo",
    severity,
    event,
    category: classifyLogEvent(event),
    at: new Date().toISOString(),
    environment: env.CARE_WEDO_ENV || env.CF_PAGES_BRANCH || "production",
    commit: env.CF_PAGES_COMMIT_SHA?.slice(0, 12),
    fields: normalizeAlertFields(fields),
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn(JSON.stringify({
      level: "error",
      event: "alert.webhook_failed",
      category: "alert_failed",
      at: new Date().toISOString(),
      error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
    }));
  }
}
