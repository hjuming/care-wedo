/**
 * Care WEDO — API 服務層
 * 前端與 Cloudflare Pages Functions 的溝通橋樑
 */

const API_BASE = import.meta.env?.VITE_API_BASE || "/api";

export function buildDashboardRequest(apiBase = API_BASE, identity = {}) {
  const init = {};
  if (identity.idToken) {
    init.headers = {
      Authorization: `Bearer ${identity.idToken}`,
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
    throw new Error(error.error || "無法新增提醒");
  }
  return response.json();
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
