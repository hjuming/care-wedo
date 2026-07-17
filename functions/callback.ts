import { parseMedicalImages, parseMedicalText, saveParsedData, saveParsedDataToSelectedProfile, savePendingParsedDataToProfile, Env as OcrEnv } from "./_shared/medical_ocr";
import { checkGroupOcrQuota, incrementGroupOcrQuota } from "./_shared/billing";
import { assertGroupWriteAccess, manageableGroupIds } from "./_shared/group_permissions";
import { logError, logEvent } from "./_shared/logger";
import { sendProductionAlert } from "./_shared/alerts";
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
const ASSIGNMENT_ACK_TEXT = "收到。\n我來存檔。";
const LINE_NEXT_UPLOAD_PROFILE_PREFIX = "line_next_upload_profile:";
const CARE_WEDO_OPEN_URL = "https://care.wedopr.com/app/open";

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
    await sendProductionAlert(env, "line.push_failed", {
      line_user_suffix: userId.slice(-4),
      status: response.status,
      detail,
    });
    return false;
  }
  return true;
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

function takeFirstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function formatLineDate(value: unknown) {
  const text = takeFirstText(value);
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return text;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getUTCDay()];
  return `${Number(month)}/${Number(day)}（${weekday}）`;
}

function formatLineTime(value: unknown) {
  const text = takeFirstText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text;
  const hour = Number(match[1]);
  const minute = match[2];
  const period = hour < 12 ? "上午" : "下午";
  const displayHour = hour % 12 || 12;
  return `${period} ${displayHour}:${minute}`;
}

function formatLineDateTime(date?: unknown, time?: unknown) {
  return [formatLineDate(date), formatLineTime(time)].filter(Boolean).join(" ");
}

function isRefillAppointment(apt: Record<string, any>) {
  const type = takeFirstText(apt.type);
  return type === "refill_reminder" || takeFirstText(apt.department, apt.notes, apt.reminder_text).includes("領藥");
}

function appendVisitSummary(lines: string[], apt: Record<string, any>) {
  const dateTime = formatLineDateTime(apt.date, apt.time);
  if (dateTime) lines.push(dateTime);

  const hospital = takeFirstText(apt.hospital);
  if (hospital) lines.push(hospital);

  const location = takeFirstText(apt.location);
  if (location && location !== hospital) lines.push(location);

  const department = takeFirstText(apt.department);
  if (department && !department.includes("藥局")) lines.push(department);

  const doctor = formatDoctorLabel(apt.doctor);
  if (doctor) lines.push(doctor);

  const number = takeFirstText(apt.number);
  if (number) lines.push(`號碼：${number}`);

  if (apt.fasting_required) lines.push(`要空腹：${apt.fasting_hours || 8} 小時`);
}

function formatDoctorLabel(value: unknown) {
  const doctor = takeFirstText(value);
  if (!doctor) return "";
  if (doctor.endsWith("藥師")) return doctor;
  if (doctor.endsWith("醫師")) return doctor;
  if (doctor.endsWith("醫生")) return `${doctor.slice(0, -2)}醫師`;
  if (doctor.endsWith("院長")) return `${doctor.slice(0, -2)}醫師`;
  return `${doctor}醫師`;
}

function appendRefillSummary(lines: string[], appointments: Array<Record<string, any>>) {
  const labels = ["第一次領藥", "第二次領藥", "第三次領藥"];
  appointments.slice(0, 3).forEach((apt, index) => {
    lines.push(labels[index] || `第 ${index + 1} 次領藥`);
    const dateTime = formatLineDateTime(apt.date, apt.time);
    if (dateTime) lines.push(dateTime);

    if (index === 0) {
      const place = [apt.hospital, apt.location].map((value) => takeFirstText(value)).filter(Boolean).join(" ");
      if (place) lines.push(place);
      const number = takeFirstText(apt.number);
      if (number) lines.push(`號碼：${number}`);
    }
    lines.push("");
  });
}

function appendBringCard(lines: string[]) {
  lines.push("");
  lines.push("請記得帶：健保卡");
}

/** 將解析結果格式化成長輩友善摘要 */
function formatResultSummary(parsed: import("./_shared/medical_ocr").ParsedMedicalData, profileName: string): string {
  const lines: string[] = [];
  const appointments = parsed.appointments || [];
  const refillAppointments = appointments.filter(isRefillAppointment);
  const visitAppointment = appointments.find((apt) => !isRefillAppointment(apt));

  if (refillAppointments.length) {
    lines.push("已為您新增領藥提醒");
    lines.push("");
    appendRefillSummary(lines, refillAppointments);
    appendBringCard(lines);
  } else if (visitAppointment) {
    lines.push("已為您新增一筆看診提醒");
    lines.push("");
    appendVisitSummary(lines, visitAppointment);
    appendBringCard(lines);
  } else if (parsed.medications?.length) {
    lines.push("已為您新增用藥提醒");
    lines.push("");
    lines.push(`藥：${parsed.medications.length} 筆`);
    lines.push("請照藥袋時間吃。");
  }

  if (parsed.medications?.length && appointments.length) {
    lines.push("");
    lines.push(`藥：${parsed.medications.length} 筆，已放進吃藥提醒。`);
  }

  if (lines.length === 0) lines.push("已為您整理好這筆照護資料。");
  lines.push("");
  lines.push(`已存入【${profileName}】。`);
  lines.push(CARE_WEDO_OPEN_URL);
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

function lineTextQuickReply(label: string, text: string) {
  return {
    type: "action",
    action: { type: "message", label, text },
  };
}

function lineUriQuickReply(label: string, uri: string) {
  return {
    type: "action",
    action: { type: "uri", label, uri },
  };
}

function uploadPhotoQuickReply() {
  return {
    items: [
      { type: "action", action: { type: "camera", label: "拍照" } },
      { type: "action", action: { type: "cameraRoll", label: "選照片" } },
      lineTextQuickReply("重新選人", "我要上傳"),
    ],
  };
}

function afterSummaryQuickReply() {
  return {
    items: [
      lineTextQuickReply("再傳一張", "我要上傳"),
      lineUriQuickReply("看清單", CARE_WEDO_OPEN_URL),
    ],
  };
}

function summaryQuickReply(extraQuickReply?: { items?: any[] }) {
  return {
    items: [
      ...(extraQuickReply?.items || []),
      ...afterSummaryQuickReply().items,
    ].slice(0, 13),
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

function looksLikeMedicalTextUpload(value: string) {
  const text = value.trim();
  if (text.length < 24) return false;

  const hasCareKeyword = /醫院|診所|門診|看診|回診|看牙|牙醫|復健|檢查|檢驗|領藥|藥袋|處方|醫師|掛號|預約|空腹|院區|地址|地點|科|治療/.test(text);
  const hasDateOrTime = /(\d{4}[/-]\d{1,2}[/-]\d{1,2}|民國\s*\d{2,3}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*[日號]?|\d{1,2}[:：]\d{2}|上午|下午|早上|晚上)/.test(text);
  return hasCareKeyword && hasDateOrTime;
}

function looksLikePreparedTextUpload(value: string) {
  const text = value.trim();
  if (text.length < 12) return false;
  return /醫院|診所|門診|看診|回診|看牙|牙醫|復健|檢查|檢驗|領藥|藥袋|處方|醫師|掛號|預約|空腹|疼痛|血壓|血糖|地址|地點|治療/.test(text);
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

async function hasNextUploadTargetProfile(env: Env, lineUserId: string) {
  const userId = await getOrCreateDefaultUser(env, lineUserId);
  const rows = await supabaseFetch<Array<{ feature_key: string }>>(
    env,
    `user_feature_flags?user_id=eq.${userId}&feature_key=like.${LINE_NEXT_UPLOAD_PROFILE_PREFIX}*&enabled=eq.true&select=feature_key&limit=1`,
  );
  return Boolean(rows[0]?.feature_key);
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
    : `已存入【${saved.profileName}】。\n${CARE_WEDO_OPEN_URL}`;

  await pushText(env, lineUserId, reply, summaryQuickReply());
  const familySummary = `家人上傳了【${saved.profileName}】的資料。\n已整理好。\n\n${reply}`;
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
    await pushText(env, lineUserId, "暫時存不了。\n請稍後再試。");
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
    const ok = await pushText(env, lineId, text);
    if (ok) {
      sent++;
    } else {
      logEvent("line.upload_summary_recipient_unreachable", {
        group_id: groupId,
        line_user_suffix: lineId.slice(-4),
      });
    }
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
    await replyText(env, event.replyToken, "請先建立家人資料。", {
      items: [lineUriQuickReply("打開 Care WEDO", CARE_WEDO_OPEN_URL)],
    });
    return true;
  }

  if (profiles.length === 1) {
    const profile = profiles[0];
    await setNextUploadTargetProfile(env, userId, profile.id);
    await replyText(env, event.replyToken, `好。\n這次存到【${profile.display_name}】。\n請上傳照片，或直接貼上文字。`, uploadPhotoQuickReply());
    return true;
  }

  await replyText(
    env,
    event.replyToken,
    "這次要存給誰？",
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
    `好。\n這次存到【${targetProfile.display_name}】。\n請上傳照片，或直接貼上文字。`,
    uploadPhotoQuickReply(),
  );
}

async function replyDefaultUploadHelp(env: Env, event: LineEvent) {
  if (!event.replyToken) return;

  const userId = await getOrCreateDefaultUser(env, event.source.userId);
  const profiles = await getAccessibleProfiles(env, userId);
  if (profiles.length === 0) {
    await replyText(
      env,
      event.replyToken,
      "可以拍照或貼文字給我。\n我會幫您整理。",
      { items: [lineUriQuickReply("打開 Care WEDO", CARE_WEDO_OPEN_URL)] },
    );
    return;
  }

  if (profiles.length === 1) {
    const profile = profiles[0];
    await setNextUploadTargetProfile(env, userId, profile.id);
    await replyText(
      env,
      event.replyToken,
      `可以拍照或貼文字給我。\n這次存到【${profile.display_name}】。`,
      uploadPhotoQuickReply(),
    );
    return;
  }

  await replyText(
    env,
    event.replyToken,
    "可以拍照或貼文字給我。\n請先選家人。",
    prepareUploadProfileQuickReply(profiles),
  );
}

function buildReassignQuickReply(
  profiles: Array<{ id: number; display_name: string }>,
  savedProfileName: string,
  appointmentIds: string,
  medicationIds: string,
) {
  if (profiles.length <= 1 || (!appointmentIds && !medicationIds)) return undefined;

  const otherProfiles = profiles.filter(p => p.display_name !== savedProfileName).slice(0, 5);
  if (!otherProfiles.length) return undefined;

  return {
    items: otherProfiles.map(p => {
      const actionData = new URLSearchParams();
      actionData.set("action", "reassign");
      actionData.set("p", String(p.id));
      if (appointmentIds) actionData.set("a", appointmentIds);
      if (medicationIds) actionData.set("m", medicationIds);

      return {
        type: "action",
        action: {
          type: "postback",
          label: `改到${p.display_name}`.slice(0, 20),
          data: actionData.toString().slice(0, 300),
          displayText: `這是 ${p.display_name} 的紀錄`
        }
      };
    })
  };
}

async function resolveLineOcrAccess<T extends { id: number; group_id: number | null }>(
  env: Env,
  userId: number,
  profiles: T[],
  nextUploadTarget: T | null,
) {
  const memberships = await getUserMemberships(env, userId);
  if (memberships.length === 0) {
    throw new Error("請先建立照護空間與照護對象，再上傳醫療文件。");
  }

  const writableGroupIds = manageableGroupIds(memberships);
  const groupId = nextUploadTarget?.group_id
    ?? writableGroupIds.find((id) => profiles.some((profile) => profile.group_id === id))
    ?? null;
  if (!groupId) {
    throw new Error("您沒有修改權限，此家庭資料目前為唯讀");
  }

  assertGroupWriteAccess(memberships, groupId);
  const scopedProfiles = profiles.filter((profile) => profile.group_id === groupId);
  if (scopedProfiles.length === 0) {
    throw new Error("請先建立照護對象，再上傳醫療文件。");
  }

  const plan = await checkGroupOcrQuota(env, groupId);
  return { groupId, plan, profiles: scopedProfiles };
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
    const access = await resolveLineOcrAccess(env, userId, profiles, nextUploadTarget);
    const base64Image = await fetchLineContent(env, event.message!.id!);
    const parsedData = await parseMedicalImages(env, [{ data: base64Image, media_type: "image/jpeg" }]);
    const saved = nextUploadTarget
      ? await saveParsedDataToSelectedProfile(env, parsedData, lineUserId, nextUploadTarget.id)
      : await saveParsedData(env, parsedData, lineUserId, access.groupId);
    await incrementGroupOcrQuota(env, access.groupId, access.plan);

    if (nextUploadTarget) {
      await clearNextUploadTargetProfile(env, userId);
    }

    if (saved.needsProfileSelection && saved.pendingDocumentId) {
      await pushText(
        env,
        lineUserId,
        "這張要存給誰？",
        pendingProfileQuickReply(saved.pendingDocumentId, access.profiles),
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

    const aptIds = saved.appointment_ids.join(",");
    const medIds = saved.medication_ids.join(",");
    const quickReply = buildReassignQuickReply(access.profiles, saved.profileName, aptIds, medIds);

    await pushText(env, lineUserId, reply, summaryQuickReply(quickReply));
    const familySummary = `家人上傳了【${saved.profileName}】的資料。\n已整理好。\n\n${reply}`;
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
    await sendProductionAlert(env, "line.ocr_failed", {
      line_user_suffix: lineUserId.slice(-4),
      duration_ms: Date.now() - startedAt,
      error,
    });
    const msg = error instanceof Error ? error.message : "未知錯誤";
    await pushText(env, lineUserId, `這張看不清楚。\n請再拍一次。\n\n${msg}`);
  }
}

/** 處理 LINE 貼上的文字資料（背景執行，用 Push API 回傳結果） */
async function processTextOCR(env: Env, event: LineEvent, incomingText: string) {
  const lineUserId = event.source.userId;
  const startedAt = Date.now();
  try {
    if (incomingText.trim().length > 12000) {
      throw new Error("文字太長了，請先保留看診、用藥或提醒相關段落。");
    }

    logEvent("line.text_ocr_started", {
      line_user_suffix: lineUserId.slice(-4),
      text_length: incomingText.trim().length,
    });
    const userId = await getOrCreateDefaultUser(env, lineUserId);
    const profiles = await getAccessibleProfiles(env, userId);
    const nextUploadTarget = await getNextUploadTargetProfile(env, userId, profiles);
    const access = await resolveLineOcrAccess(env, userId, profiles, nextUploadTarget);
    const parsedData = await parseMedicalText(env, incomingText);
    const saved = nextUploadTarget
      ? await saveParsedDataToSelectedProfile(env, parsedData, lineUserId, nextUploadTarget.id)
      : await saveParsedData(env, parsedData, lineUserId, access.groupId);
    await incrementGroupOcrQuota(env, access.groupId, access.plan);

    if (nextUploadTarget) {
      await clearNextUploadTargetProfile(env, userId);
    }

    if (saved.needsProfileSelection && saved.pendingDocumentId) {
      await pushText(
        env,
        lineUserId,
        "這段資料要存給誰？",
        pendingProfileQuickReply(saved.pendingDocumentId, access.profiles),
      );
      logEvent("line.text_ocr_pending_profile_selection", {
        line_user_suffix: lineUserId.slice(-4),
        profile_count: profiles.length,
        pending_document_id: saved.pendingDocumentId,
        duration_ms: Date.now() - startedAt,
      });
      return;
    }

    const reply = formatResultSummary(parsedData, saved.profileName);
    const aptIds = saved.appointment_ids.join(",");
    const medIds = saved.medication_ids.join(",");
    const quickReply = buildReassignQuickReply(access.profiles, saved.profileName, aptIds, medIds);

    await pushText(env, lineUserId, reply, summaryQuickReply(quickReply));
    const familySummary = `家人上傳了【${saved.profileName}】的資料。\n已整理好。\n\n${reply}`;
    const uploadSummaryCount = await notifyUploadSummaryRecipients(env, saved.groupId, lineUserId, familySummary);
    logEvent("line.text_ocr_completed", {
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
    logError("line.text_ocr_failed", error, {
      line_user_suffix: lineUserId.slice(-4),
      duration_ms: Date.now() - startedAt,
    });
    await sendProductionAlert(env, "line.text_ocr_failed", {
      line_user_suffix: lineUserId.slice(-4),
      duration_ms: Date.now() - startedAt,
      error,
    });
    const msg = error instanceof Error ? error.message : "未知錯誤";
    await pushText(env, lineUserId, `這段文字我暫時整理不了。\n請再貼一次重點段落。\n\n${msg}`);
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
  if (!targetProfile.group_id) {
    throw new Error("照護對象尚未加入照護空間");
  }
  assertGroupWriteAccess(memberships, targetProfile.group_id);

  const groupIds = manageableGroupIds(memberships);
  const accessQuery = `group_id=in.(${groupIds.join(",")})`;

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
          await pushText(env, event.source.userId, "暫時不能選。\n請稍後再試。");
        }));
      } catch (err) {
        logError("line.prepare_ocr_upload_failed", err, {
          line_user_suffix: event.source.userId.slice(-4),
          target_profile_id: targetProfileId,
        });
        waitUntil(pushText(env, event.source.userId, "暫時不能選。\n請稍後再試。"));
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
        waitUntil(pushText(env, event.source.userId, "暫時存不了。\n請稍後再試。"));
      }
      return;
    }

    if (params.get("action") === "reassign") {
      if (!event.replyToken) return;
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
        await replyText(env, event.replyToken, "已改好了。");
      } catch (err) {
        logError("line.reassign_failed", err, {
          line_user_suffix: event.source.userId.slice(-4),
          target_profile_id: targetProfileId,
          appointment_count: appointmentIds.length,
          medication_count: medicationIds.length,
        });
        await replyText(env, event.replyToken, "暫時改不了。\n請稍後再試。");
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
    await replyText(env, event.replyToken, "收到照片。\n我先幫您看。");

    // 2. 背景處理 OCR，完成後用 Push API 推送結果
    waitUntil(processImageOCR(env, event));
    return;
  }

  const incomingText = event.message?.text || "";
  const isMedicalTextUpload = incomingText ? looksLikeMedicalTextUpload(incomingText) : false;
  const hasPreparedUploadTarget = incomingText && !isMedicalTextUpload && looksLikePreparedTextUpload(incomingText)
    ? await hasNextUploadTargetProfile(env, event.source.userId)
    : false;
  if (incomingText && !isMedicalTextUpload && !hasPreparedUploadTarget && await assignPendingOcrByText(env, event, incomingText, waitUntil)) return;
  if (incomingText && (isMedicalTextUpload || hasPreparedUploadTarget)) {
    await replyText(env, event.replyToken, "收到文字。\n我先幫您整理。");
    waitUntil(processTextOCR(env, event, incomingText));
    return;
  }
  if (incomingText && await prepareUploadByText(env, event, incomingText)) return;

  if (incomingText.includes("網址") || incomingText.toLowerCase().includes("url")) {
    await replyText(env, event.replyToken, `這裡可以看完整清單：${CARE_WEDO_OPEN_URL}`);
    return;
  }

  await replyDefaultUploadHelp(env, event);
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
        "收到好幾張照片。\n我先看第一張。",
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
