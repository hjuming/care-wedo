const SENSITIVE_KEY_PATTERN = /token|secret|authorization|password|key|idtoken|image|base64|medical|notes|reminder|purpose|warnings/i;
const MAX_STRING_LENGTH = 180;
const TELEMETRY_ENDPOINT = "/api/telemetry";

export const OBSERVABILITY_EVENT_CATEGORIES = Object.freeze({
  OCR_FAILED: "ocr_failed",
  LINE_PUSH_FAILED: "line_push_failed",
  QUOTA_EXCEEDED: "quota_exceeded",
  AUTH_FAILED: "auth_failed",
  CRON_FAILED: "cron_failed",
  FRONTEND_FAILED: "frontend_failed",
  FEEDBACK_FAILED: "feedback_failed",
});

const CATEGORY_RULES = [
  [/ocr|upload/i, OBSERVABILITY_EVENT_CATEGORIES.OCR_FAILED],
  [/quota|plan_upgrade/i, OBSERVABILITY_EVENT_CATEGORIES.QUOTA_EXCEEDED],
  [/auth|login|invite_join/i, OBSERVABILITY_EVENT_CATEGORIES.AUTH_FAILED],
  [/feedback/i, OBSERVABILITY_EVENT_CATEGORIES.FEEDBACK_FAILED],
  [/frontend|render|dashboard|profile|calendar/i, OBSERVABILITY_EVENT_CATEGORIES.FRONTEND_FAILED],
];

function normalizeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return { message: String(error) };
}

export function classifyTelemetryEvent(name = "") {
  const eventName = String(name || "");
  const match = CATEGORY_RULES.find(([pattern]) => pattern.test(eventName));
  return match?.[1] || OBSERVABILITY_EVENT_CATEGORIES.FRONTEND_FAILED;
}

function getCurrentRoute() {
  if (typeof window === "undefined") return "";
  return window.location?.pathname || "";
}

function redact(value, depth = 0) {
  if (depth > 3) return "[TRUNCATED]";
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => redact(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(entry, depth + 1),
      ]),
    );
  }
  return String(value);
}

function sendTelemetryToWorker(payload) {
  if (typeof window === "undefined" || !import.meta.env.PROD) return;
  if (payload.level !== "error" && payload.category !== OBSERVABILITY_EVENT_CATEGORIES.QUOTA_EXCEEDED) return;

  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(TELEMETRY_ENDPOINT, new Blob([body], { type: "application/json" }));
      if (sent) return;
    }
    fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => null);
  } catch {
    // Telemetry must never break the care flow.
  }
}

function emit(level, name, details = {}) {
  const payload = {
    level,
    name,
    category: classifyTelemetryEvent(name),
    at: new Date().toISOString(),
    route: getCurrentRoute(),
    details: redact(details),
  };

  if (level === "error") {
    console.error("[Care WEDO telemetry]", payload);
  } else {
    console.info("[Care WEDO telemetry]", payload);
  }

  window.dispatchEvent(new CustomEvent("carewedo:telemetry", { detail: payload }));
  sendTelemetryToWorker(payload);
  return payload;
}

export function trackEvent(name, details = {}) {
  return emit("info", name, details);
}

export function trackError(name, error, details = {}) {
  return emit("error", name, {
    ...details,
    error: normalizeError(error),
  });
}

export { redact };
