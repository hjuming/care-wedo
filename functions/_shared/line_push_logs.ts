import { supabaseFetch, Env } from "./supabase";
import { logError } from "./logger";

type LinePushStatus = "skipped" | "sent" | "failed";

type RecordLinePushLogInput = {
  eventType: string;
  recipientUserId?: number | null;
  groupId?: number | null;
  profileId?: number | null;
  targetDate?: string | null;
  sourceTable?: string | null;
  sourceIds?: number[];
  lineUserSuffix?: string | null;
  status: LinePushStatus;
  httpStatus?: number | null;
  errorMessage?: string | null;
  messageLength?: number;
  itemCount?: number;
  metadata?: Record<string, unknown>;
};

function trimText(value: string | null | undefined, maxLength: number) {
  const text = (value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function cleanDate(value: string | null | undefined) {
  const text = (value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanSourceIds(value: number[] | undefined) {
  return Array.from(new Set((value || []).filter((id) => Number.isInteger(id) && id > 0)));
}

export async function recordLinePushLog(env: Env, input: RecordLinePushLogInput) {
  try {
    await supabaseFetch(env, "line_push_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        event_type: trimText(input.eventType, 80) || "line_push",
        channel: "line",
        recipient_user_id: input.recipientUserId || null,
        group_id: input.groupId || null,
        profile_id: input.profileId || null,
        target_date: cleanDate(input.targetDate),
        source_table: trimText(input.sourceTable, 60),
        source_ids: cleanSourceIds(input.sourceIds),
        line_user_suffix: trimText(input.lineUserSuffix, 8),
        message_character_count: Math.max(0, input.messageLength || 0),
        item_count: Math.max(0, input.itemCount || 0),
        status: input.status,
        http_status: input.httpStatus || null,
        error_message: trimText(input.errorMessage, 240),
        metadata: input.metadata || {},
      }),
    });
  } catch (error) {
    logError("line_push_log_failed", error, {
      event_type: input.eventType,
      status: input.status,
    });
  }
}
