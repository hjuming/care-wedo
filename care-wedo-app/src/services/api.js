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

  const query = identity.profileId ? `?profile_id=${encodeURIComponent(identity.profileId)}` : "";

  return {
    url: `${apiBase}/dashboard${query}`,
    init,
  };
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

export async function fetchDashboard(identity) {
  const { url, init } = buildDashboardRequest(API_BASE, identity);
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
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
    throw new Error(err.error || "無法取得群組資料");
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
    throw new Error(err.error || "建立群組失敗");
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
    throw new Error(err.error || "加入群組失敗");
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
    throw new Error(err.error || "新增照護對象失敗");
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
    throw new Error(err.error || "更新群組通知設定失敗");
  }
  return resp.json();
}
