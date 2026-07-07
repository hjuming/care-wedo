/**
 * Care WEDO — API 服務層
 * 前端與 Cloudflare Pages Functions 的溝通橋樑
 */

const API_BASE = import.meta.env?.VITE_API_BASE || "/api";
const CARE_WEDO_URL = "https://care.wedopr.com";
const TAIPEI_OFFSET_HOURS = 8;

function getIdentityBearerToken(identity = {}) {
  return identity.accessToken || identity.idToken || null;
}

export function buildDashboardRequest(apiBase = API_BASE, identity = {}) {
  const init = {};
  const token = identity.accessToken || identity.idToken || null;
  if (token) {
    init.headers = {
      Authorization: `Bearer ${token}`,
    };
  }

  const query = new URLSearchParams();
  if (identity.profileId) query.set("profile_id", identity.profileId);
  if (identity.groupId) query.set("group_id", identity.groupId);
  const queryString = query.toString() ? `?${query.toString()}` : "";

  return {
    url: `${apiBase}/dashboard${queryString}`,
    init,
  };
}

export function buildAppointmentCalendarRequest(apiBase = API_BASE, appointmentId, identity = {}) {
  const init = {};
  const token = getIdentityBearerToken(identity);
  if (token) {
    init.headers = {
      Authorization: `Bearer ${token}`,
    };
  }

  return {
    url: `${apiBase}/appointments/${encodeURIComponent(appointmentId)}/calendar.ics`,
    init,
  };
}

export function buildSessionRequest(apiBase = API_BASE, method = "GET", identity = {}) {
  const init = { method, credentials: "same-origin" };
  const token = getIdentityBearerToken(identity);
  if (token) {
    init.headers = {
      Authorization: `Bearer ${token}`,
    };
  }
  return {
    url: `${apiBase}/session`,
    init,
  };
}

export function buildSessionHandoffRequest(apiBase = API_BASE, token) {
  return {
    url: `${apiBase}/session/handoff`,
    init: {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  };
}

function appointmentTypeLabel(type) {
  if (type === "family_note") return "家庭提醒";
  if (type === "inspection") return "檢查";
  if (type === "refill_reminder") return "領藥";
  if (type === "medication") return "用藥";
  if (type === "measurement") return "量測";
  if (type === "document") return "文件";
  if (type === "rehab") return "復健";
  if (type === "exercise") return "運動";
  if (type === "other" || type === "reminder") return "提醒";
  return "回診提醒";
}

function escapeIcsText(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line) {
  const maxLength = 75;
  if (line.length <= maxLength) return line;

  const chunks = [];
  let remaining = line;
  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  chunks.push(remaining);
  return chunks.join("\r\n ");
}

function buildIcs(lines) {
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function parseDateParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseTimeParts(value) {
  const text = String(value || "").trim().replace(/：/g, ":").replace(/\s+/g, "");
  const match = text.match(/^(上午|下午|晚上|早上)?(\d{1,2}):(\d{2})/);
  if (!match) return null;

  let hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;

  const meridiem = match[1] || "";
  if ((meridiem === "下午" || meridiem === "晚上") && hour < 12) hour += 12;
  if ((meridiem === "上午" || meridiem === "早上") && hour === 12) hour = 0;

  return { hour, minute };
}

function formatIcsDate(parts) {
  return `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
}

function nextCalendarDate(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatUtcIcsDateTime(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildAppointmentSummary(appointment, profileName = "") {
  const title = appointment?.title
    || appointment?.department
    || appointment?.hospital
    || appointmentTypeLabel(appointment?.type);
  return `Care WEDO：${[profileName, title].filter(Boolean).join(" ")}`;
}

function buildAppointmentDescription(appointment = {}) {
  const lines = [
    appointment.department && `科別：${appointment.department}`,
    appointment.doctor && `醫師：${appointment.doctor}`,
    appointment.number && `號碼：${appointment.number}`,
    appointment.fasting_required && `請記得空腹，前 ${appointment.fasting_hours || 8} 小時先不要吃東西。`,
    appointment.notes || appointment.reminder_text,
    "",
    `Care WEDO：${CARE_WEDO_URL}`,
  ];
  return lines.filter((line) => line !== null && line !== undefined && line !== "").join("\n");
}

function calendarFilename(id) {
  const safeId = String(id || "local").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "local";
  return `care-wedo-appointment-${safeId}.ics`;
}

export function buildLocalAppointmentCalendarFile(appointment, { profileName = "" } = {}) {
  const dateParts = parseDateParts(appointment?.date);
  if (!dateParts) throw new Error("行程日期格式不完整，無法產生行事曆檔。");

  const timeParts = parseTimeParts(appointment?.time);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Care WEDO//Appointment Export//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:care-wedo-appointment-${appointment?.id || "local"}@care.wedopr.com`,
    `DTSTAMP:${formatUtcIcsDateTime(new Date())}`,
    `SUMMARY:${escapeIcsText(buildAppointmentSummary(appointment, profileName))}`,
  ];

  if (timeParts) {
    const start = new Date(Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hour - TAIPEI_OFFSET_HOURS,
      timeParts.minute,
    ));
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${formatUtcIcsDateTime(start)}`);
    lines.push(`DTEND:${formatUtcIcsDateTime(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(dateParts)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(nextCalendarDate(dateParts))}`);
  }

  const location = appointment?.location || appointment?.hospital || "";
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);

  lines.push(`DESCRIPTION:${escapeIcsText(buildAppointmentDescription(appointment))}`);
  lines.push(`URL:${CARE_WEDO_URL}`);
  lines.push("STATUS:CONFIRMED");
  lines.push("TRANSP:OPAQUE");
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return buildIcs(lines);
}

export function buildGoogleCalendarEventUrl(appointment, { profileName = "" } = {}) {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", buildAppointmentSummary(appointment, profileName));

  const dateParts = parseDateParts(appointment?.date);
  if (dateParts) {
    const timeParts = parseTimeParts(appointment?.time);
    if (timeParts) {
      const start = new Date(Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        timeParts.hour - TAIPEI_OFFSET_HOURS,
        timeParts.minute,
      ));
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      url.searchParams.set("dates", `${formatUtcIcsDateTime(start)}/${formatUtcIcsDateTime(end)}`);
    } else {
      url.searchParams.set("dates", `${formatIcsDate(dateParts)}/${formatIcsDate(nextCalendarDate(dateParts))}`);
    }
  }

  const details = buildAppointmentDescription(appointment);
  if (details) url.searchParams.set("details", details);

  const location = appointment?.location || appointment?.hospital || "";
  if (location) url.searchParams.set("location", location);

  return url.toString();
}

export function isAuthFailureMessage(message = "") {
  return /請先登入|登入失敗|unauthorized|auth_required|id[ _-]?token|token|oauth|line/i.test(String(message || ""));
}

function createApiError(message, status) {
  const error = new Error(message);
  if (status === 401 || isAuthFailureMessage(message)) error.code = "AUTH_REQUIRED";
  return error;
}

/**
 * 上傳圖片進行 OCR 解析
 * @param {File[]} files - 圖片檔案陣列
 * @returns {Promise<object>} 解析結果
 */
export async function ocrAnalyze(files, options = {}) {
  const formData = new FormData();
  files.forEach((file) => formData.append("images", file));
  if (options.profileId) {
    formData.append("profile_id", String(options.profileId));
  }

  const res = await fetch(`${API_BASE}/ocr/`, {
    method: "POST",
    headers: options.idToken ? { Authorization: `Bearer ${options.idToken}` } : undefined,
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API 錯誤 (${res.status})`);
  }

  return res.json();
}

/**
 * 貼上文字進行 AI 解析
 * @param {string} text - 使用者貼上的看診、用藥或提醒內容
 * @returns {Promise<object>} 解析結果
 */
export async function ocrAnalyzeText(text, options = {}) {
  const formData = new FormData();
  formData.append("medical_text", text);
  if (options.profileId) {
    formData.append("profile_id", String(options.profileId));
  }

  const res = await fetch(`${API_BASE}/ocr/`, {
    method: "POST",
    headers: options.idToken ? { Authorization: `Bearer ${options.idToken}` } : undefined,
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API 錯誤 (${res.status})`);
  }

  return res.json();
}

export async function confirmOcrDocument(documentId, { idToken }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const res = await fetch(`${API_BASE}/ocr/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({ document_id: documentId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "無法確認文件");
  }

  return res.json();
}

export async function fetchDocuments({ idToken, profileId, type, q } = {}) {
  const query = new URLSearchParams();
  if (profileId) query.set("profile_id", profileId);
  if (type) query.set("type", type);
  if (q) query.set("q", q);
  const res = await fetch(`${API_BASE}/documents${query.toString() ? `?${query.toString()}` : ""}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw createApiError(err.error || "無法取得文件", res.status);
  }
  return res.json();
}

export async function uploadCareDocument(file, { idToken, profileId, preserveOriginalFile = true, documentType = "other" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  if (profileId) formData.append("profile_id", String(profileId));
  formData.append("preserve_original_file", preserveOriginalFile ? "true" : "false");
  formData.append("document_type", documentType);

  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: "POST",
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw createApiError(err.error || "文件上傳失敗", res.status);
  }
  return res.json();
}

export async function fetchDocumentDetail(documentId, { idToken } = {}) {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(documentId)}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw createApiError(err.error || "無法取得文件", res.status);
  }
  return res.json();
}

export async function fetchDocumentFileUrl(documentId, { idToken } = {}) {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(documentId)}/file-url`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw createApiError(err.error || "無法開啟原始文件", res.status);
  }
  return res.json();
}

export async function deleteCareDocument(documentId, { idToken } = {}) {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw createApiError(err.error || "無法刪除文件", res.status);
  }
  return res.json();
}

export async function fetchDashboard(identity) {
  const { url, init } = buildDashboardRequest(API_BASE, identity);
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401 || isAuthFailureMessage(err.error)) {
      const authError = new Error(err.error || "請先登入");
      authError.code = "AUTH_REQUIRED";
      throw authError;
    }
    throw new Error(err.error || `API 錯誤 (${res.status})`);
  }
  return res.json();
}

export async function fetchSessionIdentity() {
  const { url, init } = buildSessionRequest(API_BASE, "GET");
  const res = await fetch(url, init);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.authenticated) return null;
  return {
    status: "authenticated",
    idToken: null,
    profile: data.profile || null,
    message: null,
  };
}

export async function createServerSession(idToken) {
  if (!idToken) return null;
  const { url, init } = buildSessionRequest(API_BASE, "POST", { idToken });
  const res = await fetch(url, init);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.authenticated) return null;
  return {
    status: "authenticated",
    idToken,
    profile: data.profile || null,
    message: null,
  };
}

export async function issueBrowserHandoffToken(idToken) {
  if (!idToken) return null;
  const { url, init } = buildSessionHandoffRequest(API_BASE, idToken);
  const res = await fetch(url, init);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.handoffToken || null;
}

export async function exchangeBrowserHandoffToken(handoffToken) {
  if (!handoffToken) return null;
  const { url, init } = buildSessionHandoffRequest(API_BASE, handoffToken);
  const res = await fetch(url, init);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.authenticated) return null;
  return {
    status: "authenticated",
    idToken: null,
    profile: data.profile || null,
    message: null,
  };
}

export async function clearServerSession() {
  const { url, init } = buildSessionRequest(API_BASE, "DELETE");
  await fetch(url, init).catch(() => null);
}

/**
 * 取得使用者的照護群組
 */
export async function fetchGroups(identity) {
  const resp = await fetch(`${API_BASE}/groups`, {
    headers: identity.idToken ? { Authorization: `Bearer ${identity.idToken}` } : {},
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "無法取得群組資料", resp.status);
  }
  return resp.json();
}

/**
 * 建立新的照護群組
 */
export async function createGroup({ idToken, name }) {
  const resp = await fetch(`${API_BASE}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ action: "create", name }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "建立群組失敗", resp.status);
  }
  return resp.json();
}

/**
 * 使用邀請碼加入群組
 */
export async function joinGroup({ idToken, code }) {
  const resp = await fetch(`${API_BASE}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ action: "join", code }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "加入群組失敗", resp.status);
  }
  return resp.json();
}

/**
 * 在家人群組中新增一位照護對象，例如爸爸、媽媽或阿嬤
 */
export async function createCareProfile({ idToken, groupId, displayName, relationship = "family" }) {
  const resp = await fetch(`${API_BASE}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      action: "create_profile",
      group_id: groupId,
      display_name: displayName,
      relationship,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "新增照護對象失敗", resp.status);
  }
  return resp.json();
}

export async function createBillingCheckout({ idToken, groupId, actionType, returnPath = "/app/settings?billing=return" }) {
  const resp = await fetch(`${API_BASE}/billing/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      group_id: groupId,
      action_type: actionType,
      return_path: returnPath,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "無法建立付款連結", resp.status);
  }
  return resp.json();
}

/**
 * 取得群組成員清單
 */
export async function getGroupMembers({ idToken, groupId }) {
  const resp = await fetch(`${API_BASE}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ action: "get_members", group_id: groupId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "無法取得成員清單", resp.status);
  }
  return resp.json();
}

/**
 * 移除群組成員（僅 admin 可執行）
 */
export async function removeMember({ idToken, groupId, targetUserId }) {
  const resp = await fetch(`${API_BASE}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ action: "remove_member", group_id: groupId, target_user_id: targetUserId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "移除成員失敗", resp.status);
  }
  return resp.json();
}

/**
 * 重新產生邀請碼（僅 admin 可執行）
 */
export async function regenerateInvite({ idToken, groupId }) {
  const resp = await fetch(`${API_BASE}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ action: "regenerate_invite", group_id: groupId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "重新產生邀請碼失敗", resp.status);
  }
  return resp.json();
}

export async function updateMembership({ idToken, groupId, updates }) {
  const resp = await fetch(`${API_BASE}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      action: "update_membership",
      group_id: groupId,
      ...updates,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "更新群組通知設定失敗", resp.status);
  }
  return resp.json();
}

export async function updateFamilyNotes({ idToken, groupId, notes }) {
  const resp = await fetch(`${API_BASE}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      action: "update_family_notes",
      group_id: groupId,
      notes,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "更新家庭提醒失敗", resp.status);
  }
  return resp.json();
}

export async function fetchCurrentUser({ idToken }) {
  const resp = await fetch(`${API_BASE}/me`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw createApiError(err.error || "無法取得用戶資訊", resp.status);
  }
  return resp.json();
}

export async function initFamily({ idToken, familyName, primaryCareName }) {
  const resp = await fetch(`${API_BASE}/me`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      action: "init_family",
      family_name: familyName,
      primary_care_name: primaryCareName,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || "初始化家庭失敗");
  }
  return resp.json();
}

/**
 * 更新預約狀態或內容（例如標記為已完成）
 */
export async function patchAppointment(id, updates, { idToken }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const response = await fetch(`${API_BASE}/appointments/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw new Error(error.error || "無法更新預約");
  }
  return response.json();
}

export async function deleteAppointment(id, { idToken }) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const response = await fetch(`${API_BASE}/appointments/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw new Error(error.error || "無法刪除預約");
  }
  return response.json();
}

export async function createAppointment(payload, { idToken }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const response = await fetch(`${API_BASE}/appointments`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw new Error(error.error || "無法新增排程");
  }
  return response.json();
}

function filenameFromContentDisposition(header, fallback) {
  const match = String(header || "").match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

async function shareCalendarFileIfAvailable(blob, filename) {
  if (
    typeof navigator === "undefined"
    || typeof File === "undefined"
    || typeof navigator.canShare !== "function"
    || typeof navigator.share !== "function"
  ) {
    return false;
  }

  const file = new File([blob], filename, { type: "text/calendar" });
  if (!navigator.canShare({ files: [file] })) return false;

  try {
    await navigator.share({
      files: [file],
      title: "Care WEDO 行事曆",
    });
    return true;
  } catch (error) {
    if (error?.name === "AbortError") return true;
    return false;
  }
}

export async function downloadAppointmentCalendarFile(id, { idToken } = {}) {
  const { url, init } = buildAppointmentCalendarRequest(API_BASE, id, { idToken });
  const response = await fetch(url, init);
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw new Error(error.error || "無法產生行事曆檔");
  }

  const blob = await response.blob();
  const filename = filenameFromContentDisposition(
    response.headers.get("Content-Disposition"),
    `care-wedo-appointment-${id}.ics`,
  );

  await saveCalendarBlob(blob, filename);
}

async function saveCalendarBlob(blob, filename) {
  if (await shareCalendarFileIfAvailable(blob, filename)) return;

  if (
    typeof document === "undefined"
    || typeof window === "undefined"
    || typeof URL === "undefined"
    || typeof URL.createObjectURL !== "function"
  ) {
    throw new Error("目前瀏覽器無法下載行事曆檔");
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  if ("download" in link) {
    link.click();
  } else {
    window.open(objectUrl, "_blank", "noopener,noreferrer");
  }
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function downloadLocalAppointmentCalendarFile(appointment, options = {}) {
  const ics = buildLocalAppointmentCalendarFile(appointment, options);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  await saveCalendarBlob(blob, calendarFilename(appointment?.id));
}

/**
 * 更新藥物資訊（例如停用藥物）
 */
export async function patchMedication(id, updates, { idToken }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const response = await fetch(`${API_BASE}/medications/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw new Error(error.error || "無法更新藥物");
  }
  return response.json();
}

export async function markMedicationSlotStatus({ medicationIds, status, idToken, takenDate, timeSlot } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const response = await fetch(`${API_BASE}/medications/taken`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      medication_ids: medicationIds,
      status,
      taken_date: takenDate,
      time_slot: timeSlot,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw createApiError(error.error || "無法記錄吃藥狀態", response.status);
  }
  return response.json();
}

/**
 * 更新照護對象的資訊（如：名稱、頭像、附註）
 */
export async function updateProfile(profileId, updates, { idToken }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(`${API_BASE}/profiles/${profileId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw new Error(error.error || "無法更新資料");
  }
  return response.json();
}

export async function updateProfileOrder(profileIds, { idToken }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(`${API_BASE}/profiles/order`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ profile_ids: profileIds }),
  });
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw new Error(error.error || "無法更新照護對象排序");
  }
  return response.json();
}

export async function updateActiveProfilePreference(profileId, { idToken }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(`${API_BASE}/me/active-profile`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ profile_id: profileId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(async () => ({ error: await response.text() }));
    throw createApiError(error.error || "無法更新目前照護對象", response.status);
  }
  return response.json();
}
