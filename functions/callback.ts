import { parseMedicalImages, saveParsedData, saveParsedDataToSelectedProfile, savePendingParsedDataToProfile, Env as OcrEnv } from "./_shared/medical_ocr";
import { logError, logEvent } from "./_shared/logger";
import { getAccessibleProfiles, getOrCreateDefaultUser, getUserMemberships, supabaseFetch } from "./_shared/supabase";

type Env = OcrEnv & {
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
};

type LineEvent = {
  type: string;
  replyToken?: string;
  source: { userId: string };
  message?: {
    type: string;
    text?: string;
    id?: string;
  };
  postback?: {
    data: string;
  };
};

type LineWebhookBody = {
  events?: LineEvent[];
};

const encoder = new TextEncoder();
const DEFAULT_RECIPIENT = "親愛的家人";
const ASSIGNMENT_ACK_TEXT = `${DEFAULT_RECIPIENT}，收到，我正在把這張單子存到您選的照護對象。\n\n整理好後，我會再回報摘要給您。`;
const LINE_NEXT_UPLOAD_PROFILE_PREFIX = "line_next_upload_profile:";

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function createLineSignature(body: string, channelSecret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const bytes = new Uint8Array(signature);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function verifyLineSignature(request: Request, body: string, env: Env) {
  if (!env.LINE_CHANNEL_SECRET) return false;
  const signature = request.headers.get("x-line-signature");
  if (!signature) return false;
  const expected = await createLineSignature(body, env.LINE_CHANNEL_SECRET);
  return timingSafeEqual(signature, expected);
}

/** 用 replyToken 回覆（只能用一次） */
async function replyText(env: Env, replyToken: string, text: string, quickReply?: any) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured.");
  }

  const message: any = { type: "text", text };
  if (quickReply) {
    message.quickReply = quickReply;
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages: [message],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE reply failed (${response.status}): ${detail}`);
  }
}

/** 用 Push API 主動推送訊息給使用者（不需要 replyToken） */
async function pushText(env: Env, userId: string, text: string, quickReply?: any) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured.");
  }

  const message: any = { type: "text", text };
  if (quickReply) {
    message.quickReply = quickReply;
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: userId,
      messages: [message],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    logError("line.push_failed", new Error(`LINE push failed (${response.status})`), {
      line_user_suffix: userId.slice(-4),
      status: response.status,
      detail,
    });
  }
}

async function fetchLineContent(env: Env, messageId: string): Promise<string> {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!response.ok) throw new Error("無法從 LINE 下載圖片");
  
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 將解析結果格式化成易讀的摘要 */
function formatResultSummary(parsed: import("./_shared/medical_ocr").ParsedMedicalData, profileName: string): string {
  const lines: string[] = [`${DEFAULT_RECIPIENT}，我幫您把單子整理好了。\n`];

  if (parsed.appointments?.length) {
    lines.push(`要記得的時間（${parsed.appointments.length} 筆）：`);
    for (const apt of parsed.appointments) {
      const parts: string[] = [];
      if (apt.date) parts.push(apt.time ? `${apt.date} ${apt.time}` : apt.date);
      if (apt.hospital) parts.push(apt.hospital);
      if (apt.department) parts.push(apt.department);
      if (apt.doctor) parts.push(`${apt.doctor}醫師`);
      if (apt.number) parts.push(`${apt.number}號`);
      lines.push(`• ${parts.join(" ｜ ")}`);
      if (apt.location) lines.push(`  地點：${apt.location}`);
      if (apt.fasting_required) lines.push(`  記得：前 ${apt.fasting_hours || 8} 小時先不要吃東西。`);
      if (apt.reminder_text) lines.push(`  ${apt.reminder_text}`);
    }
    lines.push("");
  }

  if (parsed.medications?.length) {
    lines.push(`藥的提醒（${parsed.medications.length} 筆）：`);
    for (const med of parsed.medications) {
      const parts: string[] = [];
      if (med.name) parts.push(med.name);
      if (med.dosage) parts.push(med.dosage);
      if (med.frequency) parts.push(med.frequency);
      lines.push(`• ${parts.join(" ｜ ")}`);
      if (med.purpose) lines.push(`  用來：${med.purpose}`);
      if (med.warnings) lines.push(`  注意：${med.warnings}`);
      if (med.reminder_text) lines.push(`  ${med.reminder_text}`);
    }
    lines.push("");
  }

  lines.push(`💡 這筆資料已存入【${profileName}】的紀錄中。`);
  lines.push("想看完整清單或修改，請點這裡：https://care.wedopr.com");
  return lines.join("\n");
}

function pendingProfileQuickReply(documentId: number, profiles: Array<{ id: number; display_name: string }>) {
  return {
    items: profiles.slice(0, 13).map((profile) => {
      const actionData = new URLSearchParams();
      actionData.set("action", "assign_pending_ocr");
      actionData.set("d", String(documentId));
      actionData.set("p", String(profile.id));

      return {
        type: "action",
        action: {
          type: "postback",
          label: profile.display_name.slice(0, 20),
          data: actionData.toString(),
          displayText: `這是 ${profile.display_name} 的紀錄`,
        },
      };
    }),
  };
}

function prepareUploadProfileQuickReply(profiles: Array<{ id: number; display_name: string }>) {
  return {
    items: profiles.slice(0, 13).map((profile) => {
      const actionData = new URLSearchParams();
      actionData.set("action", "prepare_ocr_upload");
      actionData.set("p", String(profile.id));

      return {
        type: "action",
        action: {
          type: "postback",
          label: profile.display_name.slice(0, 20),
          data: actionData.toString(),
          displayText: `我要上傳 ${profile.display_name} 的資料`,
        },
      };
    }),
  };
}

function normalizeProfileAnswer(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "")
    .replace(/[　,，.。・．·]/g, "")
    .toLowerCase();
}

function isUploadIntent(value: string) {
  const text = normalizeProfileAnswer(value);
  return /上傳|拍照|傳照片|藥袋|藥單|處方|掛號|預約|醫院單|單子|檢查單|檢驗單|領藥/.test(text);
}

function parseNextUploadProfileId(featureKey: string) {
  if (!featureKey.startsWith(LINE_NEXT_UPLOAD_PROFILE_PREFIX)) return null;
  const profileId = Number(featureKey.slice(LINE_NEXT_UPLOAD_PROFILE_PREFIX.length));
  return Number.isInteger(profileId) && profileId > 0 ? profileId : null;
}

async function clearNextUploadTargetProfile(env: Env, userId: number) {
  await supabaseFetch(env, `user_feature_flags?user_id=eq.${userId}&feature_key=like.${LINE_NEXT_UPLOAD_PROFILE_PREFIX}*`, {
    method: "DELETE",
  });
}

async function setNextUploadTargetProfile(env: Env, userId: number, profileId: number) {
  await clearNextUploadTargetProfile(env, userId);
  await supabaseFetch(env, "user_feature_flags", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: userId,
      feature_key: `${LINE_NEXT_UPLOAD_PROFILE_PREFIX}${profileId}`,
      enabled: true,
    }),
  });
}

async function getNextUploadTargetProfile<T extends { id: number }>(
  env: Env,
  userId: number,
  profiles: T[],
): Promise<T | null> {
  const rows = await supabaseFetch<Array<{ feature_key: string }>>(
    env,
    `user_feature_flags?user_id=eq.${userId}&feature_key=like.${LINE_NEXT_UPLOAD_PROFILE_PREFIX}*&enabled=eq.true&select=feature_key,created_at&order=created_at.desc&limit=1`,
  );
  const profileId = rows[0]?.feature_key ? parseNextUploadProfileId(rows[0].feature_key) : null;
  return profileId ? profiles.find((profile) => profile.id === profileId) || null : null;
}

function resolveProfileFromSelectionText<T extends { display_name: string }>(profiles: T[], incomingText: string): T | null {
  const normalizedText = normalizeProfileAnswer(incomingText);
  const matches = profiles.filter((profile) => {
    const normalizedName = normalizeProfileAnswer(profile.display_name);
    return normalizedName && (normalizedText === normalizedName || normalizedText.includes(normalizedName));
  });
  return matches.length === 1 ? matches[0] : null;
}

async function pushAssignmentSummary(
  env: Env,
  lineUserId: string,
  saved: Awaited<ReturnType<typeof savePendingParsedDataToProfile>>,
) {
  const reply = saved.parsed
    ? formatResultSummary(saved.parsed, saved.profileName)
    : `已經幫您存入【${saved.profileName}】的紀錄中。想看完整清單或修改，請點這裡：https://care.wedopr.com`;

  await pushText(env, lineUserId, reply);
  const familySummary = `家人剛上傳了一筆 ${saved.profileName} 的照護資料，已經歸類完成。\n\n${reply}`;
  await notifyUploadSummaryRecipients(env, saved.groupId, lineUserId, familySummary);
}

async function completePendingOcrAssignment(
  env: Env,
  lineUserId: string,
  documentId: number,
  targetProfileId: number,
  eventName: "line.pending_ocr_assigned" | "line.pending_ocr_assigned_by_text",
) {
  try {
    const saved = await savePendingParsedDataToProfile(env, documentId, lineUserId, targetProfileId);
    logEvent(eventName, {
      line_user_suffix: lineUserId.slice(-4),
      document_id: documentId,
      target_profile_id: targetProfileId,
      appointment_count: saved.appointment_ids.length,
      medication_count: saved.medication_ids.length,
    });
    await pushAssignmentSummary(env, lineUserId, saved);
  } catch (err) {
    logError("line.pending_ocr_assign_failed", err, {
      line_user_suffix: lineUserId.slice(-4),
      document_id: documentId,
      target_profile_id: targetProfileId,
    });
    await pushText(env, lineUserId, `抱歉，歸類時發生錯誤，請稍後再試。`);
  }
}

async function notifyUploadSummaryRecipients(env: Env, groupId: number | null, uploaderLineUserId: string, text: string) {
  if (!groupId) return 0;

  const rows = await supabaseFetch<Array<{ users: { line_user_id: string | null } | null }>>(
    env,
    `user_family_groups?group_id=eq.${groupId}&receive_upload_summary=eq.true&select=users(line_user_id)`,
  );

  let sent = 0;
  for (const row of rows) {
    const lineId = row.users?.line_user_id;
    if (!lineId || lineId === "web-mvp" || lineId === uploaderLineUserId) continue;
    await pushText(env, lineId, text);
    sent++;
  }
  return sent;
}

async function assignPendingOcrByText(env: Env, event: LineEvent, incomingText: string, waitUntil: (promise: Promise<any>) => void) {
  const userId = await getOrCreateDefaultUser(env, event.source.userId);
  const profiles = await getAccessibleProfiles(env, userId);
  const targetProfile = resolveProfileFromSelectionText(profiles, incomingText);
  if (!targetProfile) return false;

  const documents = await supabaseFetch<Array<{ id: number }>>(
    env,
    `care_documents?uploaded_by_user_id=eq.${userId}&status=eq.pending_profile_selection&select=id&order=captured_at.desc.nullslast,created_at.desc&limit=1`,
  );
  const documentId = documents[0]?.id;
  if (!documentId) return false;

  waitUntil(pushText(env, event.source.userId, ASSIGNMENT_ACK_TEXT));
  waitUntil(completePendingOcrAssignment(env, event.source.userId, documentId, targetProfile.id, "line.pending_ocr_assigned_by_text"));
  return true;
}

async function prepareUploadByText(env: Env, event: LineEvent, incomingText: string) {
  if (!event.replyToken || !isUploadIntent(incomingText)) return false;

  const userId = await getOrCreateDefaultUser(env, event.source.userId);
  const profiles = await getAccessibleProfiles(env, userId);
  if (profiles.length === 0) {
    await replyText(env, event.replyToken, `${DEFAULT_RECIPIENT}，請先到 Care WEDO 建立照護對象，再把醫院單子拍照傳給我。`);
    return true;
  }

  if (profiles.length === 1) {
    const profile = profiles[0];
    await setNextUploadTargetProfile(env, userId, profile.id);
    await replyText(env, event.replyToken, `${DEFAULT_RECIPIENT}，了解，這次我會先存到【${profile.display_name}】。\n\n請您現在上傳藥袋、處方箋或預約單照片。`);
    return true;
  }

  await replyText(
    env,
    event.replyToken,
    `${DEFAULT_RECIPIENT}，這次要先存到哪位照護對象？\n\n請點下面的姓名標籤，選好後我會再請您上傳照片。`,
    prepareUploadProfileQuickReply(profiles),
  );
  return true;
}

async function prepareUploadForProfile(env: Env, lineUserId: string, targetProfileId: number) {
  const userId = await getOrCreateDefaultUser(env, lineUserId);
  const profiles = await getAccessibleProfiles(env, userId);
  const targetProfile = profiles.find((profile) => profile.id === targetProfileId);
  if (!targetProfile) {
    throw new Error("您沒有這個照護對象的權限");
  }

  await setNextUploadTargetProfile(env, userId, targetProfile.id);
  await pushText(
    env,
    lineUserId,
    `${DEFAULT_RECIPIENT}，了解，這次我會先存到【${targetProfile.display_name}】。\n\n請您現在上傳藥袋、處方箋或預約單照片。`,
  );
}

/** 處理圖片 OCR（背景執行，用 Push API 回傳結果） */
async function processImageOCR(env: Env, event: LineEvent) {
  const lineUserId = event.source.userId;
  const startedAt = Date.now();
  try {
    logEvent("line.ocr_started", {
      line_user_suffix: lineUserId.slice(-4),
      message_id_suffix: event.message?.id?.slice(-4),
    });
    const userId = await getOrCreateDefaultUser(env, lineUserId);
    const profiles = await getAccessibleProfiles(env, userId);
    const nextUploadTarget = await getNextUploadTargetProfile(env, userId, profiles);
    const base64Image = await fetchLineContent(env, event.message!.id!);
    const parsedData = await parseMedicalImages(env, [{ data: base64Image, media_type: "image/jpeg" }]);
    const saved = nextUploadTarget
      ? await saveParsedDataToSelectedProfile(env, parsedData, lineUserId, nextUploadTarget.id)
      : await saveParsedData(env, parsedData, lineUserId);

    if (nextUploadTarget) {
      await clearNextUploadTargetProfile(env, userId);
    }

    if (saved.needsProfileSelection && saved.pendingDocumentId) {
      await pushText(
        env,
        lineUserId,
        `${DEFAULT_RECIPIENT}，我已經看完這張單子，但還不確定要存到哪位照護對象。\n\n請點下面按鈕選擇，選好後我才會正式存入資料庫。`,
        pendingProfileQuickReply(saved.pendingDocumentId, profiles),
      );
      logEvent("line.ocr_pending_profile_selection", {
        line_user_suffix: lineUserId.slice(-4),
        profile_count: profiles.length,
        pending_document_id: saved.pendingDocumentId,
        duration_ms: Date.now() - startedAt,
      });
      return;
    }

    const reply = formatResultSummary(parsedData, saved.profileName);

    let quickReply = undefined;
    const aptIds = saved.appointment_ids.join(",");
    const medIds = saved.medication_ids.join(",");
    
    if (profiles.length > 1 && (aptIds.length > 0 || medIds.length > 0)) {
      const otherProfiles = profiles.filter(p => p.display_name !== saved.profileName).slice(0, 5); // LINE limit is 13, but let's take 5
      
      quickReply = {
        items: otherProfiles.map(p => {
          const actionData = new URLSearchParams();
          actionData.set("action", "reassign");
          actionData.set("p", String(p.id));
          if (aptIds) actionData.set("a", aptIds);
          if (medIds) actionData.set("m", medIds);

          return {
            type: "action",
            action: {
              type: "postback",
              label: p.display_name,
              data: actionData.toString().slice(0, 300), // Ensure max 300 chars
              displayText: `這是 ${p.display_name} 的紀錄`
            }
          };
        })
      };
    }

    await pushText(env, lineUserId, reply, quickReply);
    const familySummary = `家人剛上傳了一筆 ${saved.profileName} 的照護資料。\n\n${reply}`;
    const uploadSummaryCount = await notifyUploadSummaryRecipients(env, saved.groupId, lineUserId, familySummary);
    logEvent("line.ocr_completed", {
      line_user_suffix: lineUserId.slice(-4),
      appointment_count: parsedData.appointments?.length || 0,
      medication_count: parsedData.medications?.length || 0,
      profile_count: profiles.length,
      has_quick_reply: Boolean(quickReply),
      upload_summary_count: uploadSummaryCount,
      preselected_profile: Boolean(nextUploadTarget),
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    logError("line.ocr_failed", error, {
      line_user_suffix: lineUserId.slice(-4),
      duration_ms: Date.now() - startedAt,
    });
    const msg = error instanceof Error ? error.message : "未知錯誤";
    await pushText(env, lineUserId, `${DEFAULT_RECIPIENT}，這張照片我暫時看不清楚。\n\n可以再拍一次嗎？盡量讓整張單子平放、字清楚一點。\n\n系統訊息：${msg}`);
  }
}

function parseIdList(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function reassignRecordsToProfile(
  env: Env,
  lineUserId: string,
  targetProfileId: number,
  appointmentIds: number[],
  medicationIds: number[],
) {
  const userId = await getOrCreateDefaultUser(env, lineUserId);
  const [profiles, memberships] = await Promise.all([
    getAccessibleProfiles(env, userId),
    getUserMemberships(env, userId),
  ]);

  const targetProfile = profiles.find((profile) => profile.id === targetProfileId);
  if (!targetProfile) {
    throw new Error("您沒有這個照護對象的權限");
  }

  const groupIds = memberships.map((membership) => membership.group_id);
  const accessFilters = [`user_id.eq.${userId}`];
  if (groupIds.length > 0) accessFilters.push(`group_id.in.(${groupIds.join(",")})`);
  const accessQuery = `or=(${accessFilters.join(",")})`;

  if (appointmentIds.length > 0) {
    const rows = await supabaseFetch<Array<{ id: number }>>(
      env,
      `appointments?id=in.(${appointmentIds.join(",")})&${accessQuery}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ group_id: targetProfile.group_id, profile_id: targetProfile.id }),
      },
    );
    if (rows.length !== appointmentIds.length) {
      throw new Error("部分看診紀錄沒有修改權限");
    }
  }

  if (medicationIds.length > 0) {
    const rows = await supabaseFetch<Array<{ id: number }>>(
      env,
      `medications?id=in.(${medicationIds.join(",")})&${accessQuery}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ group_id: targetProfile.group_id, profile_id: targetProfile.id }),
      },
    );
    if (rows.length !== medicationIds.length) {
      throw new Error("部分用藥紀錄沒有修改權限");
    }
  }
}

async function handleEvent(env: Env, event: LineEvent, waitUntil: (promise: Promise<any>) => void) {
  if (event.type === "postback" && event.postback?.data) {
    const params = new URLSearchParams(event.postback.data);
    if (params.get("action") === "prepare_ocr_upload") {
      const targetProfileId = Number(params.get("p"));

      try {
        if (!Number.isInteger(targetProfileId) || targetProfileId <= 0) {
          throw new Error("照護對象資料不正確");
        }
        waitUntil(prepareUploadForProfile(env, event.source.userId, targetProfileId).catch(async (err) => {
          logError("line.prepare_ocr_upload_failed", err, {
            line_user_suffix: event.source.userId.slice(-4),
            target_profile_id: targetProfileId,
          });
          await pushText(env, event.source.userId, `抱歉，暫時無法設定上傳對象，請稍後再試。`);
        }));
      } catch (err) {
        logError("line.prepare_ocr_upload_failed", err, {
          line_user_suffix: event.source.userId.slice(-4),
          target_profile_id: targetProfileId,
        });
        waitUntil(pushText(env, event.source.userId, `抱歉，暫時無法設定上傳對象，請稍後再試。`));
      }
      return;
    }

    if (params.get("action") === "assign_pending_ocr") {
      const documentId = Number(params.get("d"));
      const targetProfileId = Number(params.get("p"));

      try {
        if (!Number.isInteger(documentId) || documentId <= 0 || !Number.isInteger(targetProfileId) || targetProfileId <= 0) {
          throw new Error("照護對象資料不正確");
        }
        waitUntil(pushText(env, event.source.userId, ASSIGNMENT_ACK_TEXT));
        waitUntil(completePendingOcrAssignment(env, event.source.userId, documentId, targetProfileId, "line.pending_ocr_assigned"));
      } catch (err) {
        logError("line.pending_ocr_assign_failed", err, {
          line_user_suffix: event.source.userId.slice(-4),
          document_id: documentId,
          target_profile_id: targetProfileId,
        });
        waitUntil(pushText(env, event.source.userId, `抱歉，歸類時發生錯誤，請稍後再試。`));
      }
      return;
    }

    if (params.get("action") === "reassign") {
      const targetProfileId = Number(params.get("p"));
      const appointmentIds = parseIdList(params.get("a"));
      const medicationIds = parseIdList(params.get("m"));
      
      try {
        if (!Number.isInteger(targetProfileId) || targetProfileId <= 0) {
          throw new Error("照護對象資料不正確");
        }
        await reassignRecordsToProfile(env, event.source.userId, targetProfileId, appointmentIds, medicationIds);
        logEvent("line.reassign_completed", {
          line_user_suffix: event.source.userId.slice(-4),
          target_profile_id: targetProfileId,
          appointment_count: appointmentIds.length,
          medication_count: medicationIds.length,
        });
        await replyText(env, event.replyToken, `沒問題，已經幫您歸類好了！`);
      } catch (err) {
        logError("line.reassign_failed", err, {
          line_user_suffix: event.source.userId.slice(-4),
          target_profile_id: targetProfileId,
          appointment_count: appointmentIds.length,
          medication_count: medicationIds.length,
        });
        await replyText(env, event.replyToken, `抱歉，歸類時發生錯誤，請稍後再試。`);
      }
      return;
    }
  }

  if (event.type !== "message" || !event.replyToken) return;

  if (event.message?.type === "image" && event.message.id) {
    logEvent("line.image_received", {
      line_user_suffix: event.source.userId.slice(-4),
      message_id_suffix: event.message.id.slice(-4),
    });
    // 1. 立即回覆「解析中」讓使用者安心
    await replyText(env, event.replyToken, `${DEFAULT_RECIPIENT}，收到照片了。\n我正在幫您看單子，等一下整理好給您。`);

    // 2. 背景處理 OCR，完成後用 Push API 推送結果
    waitUntil(processImageOCR(env, event));
    return;
  }

  const incomingText = event.message?.text || "";
  if (incomingText && await assignPendingOcrByText(env, event, incomingText, waitUntil)) return;
  if (incomingText && await prepareUploadByText(env, event, incomingText)) return;

  const reply =
    incomingText.includes("網址") || incomingText.toLowerCase().includes("url")
      ? "這裡可以看完整清單：https://care.wedopr.com"
      : `${DEFAULT_RECIPIENT}，您可以直接把醫院單子拍照傳給我。\n我會幫您整理成看診、領藥和吃藥提醒。`;

  await replyText(env, event.replyToken, reply);
}

export const onRequestGet: PagesFunction = async () => {
  return Response.json({
    status: "ok",
    service: "Care WEDO LINE Webhook",
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const bodyText = await request.text();
  const isValid = await verifyLineSignature(request, bodyText, env);

  if (!isValid) {
    logEvent("line.invalid_signature");
    return Response.json({ error: "Invalid LINE signature" }, { status: 401 });
  }

  const body = JSON.parse(bodyText) as LineWebhookBody;
  const events = body.events || [];

  // 偵測同一批 webhook 中是否有多張圖片
  const imageEvents = events.filter((e) => e.type === "message" && e.message?.type === "image");
  logEvent("line.webhook_received", {
    event_count: events.length,
    image_count: imageEvents.length,
  });

  if (imageEvents.length > 1) {
    // 多張圖片：只處理第一張，提醒使用者一次傳一張
    const firstImage = imageEvents[0];
    if (firstImage.replyToken) {
      await replyText(
        env,
        firstImage.replyToken,
        `${DEFAULT_RECIPIENT}，我收到好幾張照片。\n為了看得更準，建議一次傳一張。\n\n我先幫您看第一張。`,
      );
    }
    waitUntil(processImageOCR(env, firstImage));

    // 處理非圖片事件（如文字訊息）
    const otherEvents = events.filter((e) => !(e.type === "message" && e.message?.type === "image"));
    await Promise.all(
      otherEvents.map((event) =>
        handleEvent(env, event, waitUntil).catch((err) => {
          logError("line.event_failed", err, { event_type: event.type });
        }),
      ),
    );
  } else {
    // 單張或無圖片：正常處理所有事件
    await Promise.all(
      events.map((event) =>
        handleEvent(env, event, waitUntil).catch((err) => {
          logError("line.event_failed", err, { event_type: event.type });
        }),
      ),
    );
  }

  return Response.json({ success: true });
};
