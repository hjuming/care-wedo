const SENSITIVE_KEY_PATTERN = /token|secret|password|credential|apikey|api_key|service_role|image|base64|medical|notes|reminder|purpose|warnings/i;
const MAX_STRING_LENGTH = 220;

export const OBSERVABILITY_EVENT_CATEGORIES = {
  OCR_FAILED: "ocr_failed",
  LINE_PUSH_FAILED: "line_push_failed",
  QUOTA_EXCEEDED: "quota_exceeded",
  AUTH_FAILED: "auth_failed",
  CRON_FAILED: "cron_failed",
  FRONTEND_FAILED: "frontend_failed",
  FEEDBACK_FAILED: "feedback_failed",
} as const;

type LogFields = Record<string, unknown>;

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/line\..*push_failed|cron\..*push_failed/i, OBSERVABILITY_EVENT_CATEGORIES.LINE_PUSH_FAILED],
  [/cron\..*(failed|missing_secret|unauthorized)/i, OBSERVABILITY_EVENT_CATEGORIES.CRON_FAILED],
  [/quota/i, OBSERVABILITY_EVENT_CATEGORIES.QUOTA_EXCEEDED],
  [/auth|unauthenticated|unauthorized|invalid_signature/i, OBSERVABILITY_EVENT_CATEGORIES.AUTH_FAILED],
  [/ocr|gemini|medical/i, OBSERVABILITY_EVENT_CATEGORIES.OCR_FAILED],
  [/feedback/i, OBSERVABILITY_EVENT_CATEGORIES.FEEDBACK_FAILED],
  [/frontend/i, OBSERVABILITY_EVENT_CATEGORIES.FRONTEND_FAILED],
];

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return { message: String(error) };
}

export function classifyLogEvent(event: string) {
  const eventName = String(event || "");
  const match = CATEGORY_RULES.find(([pattern]) => pattern.test(eventName));
  return match?.[1] || eventName;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[TRUNCATED]";
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }
  if (typeof value === "object") {
    const safe: LogFields = {};
    for (const [key, entry] of Object.entries(value as LogFields)) {
      safe[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(entry, depth + 1);
    }
    return safe;
  }
  return String(value);
}

function write(level: "info" | "error", event: string, fields: LogFields = {}) {
  const payload = {
    level,
    event,
    category: classifyLogEvent(event),
    at: new Date().toISOString(),
    ...(redact(fields) as LogFields),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
  return payload;
}

export function logEvent(event: string, fields: LogFields = {}) {
  return write("info", event, fields);
}

export function logError(event: string, error: unknown, fields: LogFields = {}) {
  return write("error", event, {
    ...fields,
    error: normalizeError(error),
  });
}
