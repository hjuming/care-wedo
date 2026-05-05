const SENSITIVE_KEY_PATTERN = /token|secret|authorization|password|key|idtoken|image|base64|medical|notes|reminder|purpose|warnings/i;
const MAX_STRING_LENGTH = 180;

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

function emit(level, name, details = {}) {
  const payload = {
    level,
    name,
    at: new Date().toISOString(),
    details: redact(details),
  };

  if (level === "error") {
    console.error("[Care WEDO telemetry]", payload);
  } else {
    console.info("[Care WEDO telemetry]", payload);
  }

  window.dispatchEvent(new CustomEvent("carewedo:telemetry", { detail: payload }));
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
