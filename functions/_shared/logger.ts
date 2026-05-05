const SENSITIVE_KEY_PATTERN = /token|secret|password|credential|apikey|api_key|service_role|image|base64|medical|notes|reminder|purpose|warnings/i;
const MAX_STRING_LENGTH = 220;

type LogFields = Record<string, unknown>;

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return { message: String(error) };
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
