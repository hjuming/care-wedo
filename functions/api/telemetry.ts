import { logError, logEvent } from "../_shared/logger";

type ClientTelemetryPayload = {
  level?: string;
  name?: string;
  category?: string;
  route?: string;
  at?: string;
  details?: Record<string, unknown>;
};

const MAX_BODY_BYTES = 8192;

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

function safeText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, 220);
}

function sanitizeClientDetails(details: Record<string, unknown> = {}) {
  return {
    flow: safeText(details.flow),
    source: safeText(details.source),
    reason: safeText(details.reason),
    status: typeof details.status === "number" ? details.status : undefined,
    profile_id: details.profileId,
    group_id: details.groupId,
    file_count: details.fileCount,
    text_length: details.textLength,
    error_name: typeof details.error === "object" && details.error !== null
      ? safeText((details.error as Record<string, unknown>).name)
      : undefined,
    error_message: typeof details.error === "object" && details.error !== null
      ? safeText((details.error as Record<string, unknown>).message)
      : undefined,
  };
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204 });
};

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_BYTES) {
      logEvent("frontend.telemetry_rejected", { reason: "body_too_large", body_length: bodyText.length });
      return json({ ok: false }, { status: 413 });
    }

    const body = JSON.parse(bodyText || "{}") as ClientTelemetryPayload;
    const name = safeText(body.name, "frontend.unknown");
    const category = safeText(body.category, "frontend_failed");
    const level = body.level === "error" ? "error" : "info";
    const fields = {
      frontend_event_name: name,
      frontend_category: category,
      route: safeText(body.route),
      client_at: safeText(body.at),
      ...sanitizeClientDetails(body.details || {}),
    };

    if (level === "error") {
      logError("frontend.telemetry_error", new Error(name), fields);
    } else {
      logEvent("frontend.telemetry_event", fields);
    }

    return json({ ok: true });
  } catch (error) {
    logError("frontend.telemetry_ingest_failed", error);
    return json({ ok: false }, { status: 400 });
  }
};
