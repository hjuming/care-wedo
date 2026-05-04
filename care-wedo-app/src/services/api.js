/**
 * Care WEDO — API 服務層
 * 前端與後端 Flask API 的溝通橋樑
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

/**
 * 上傳圖片進行 OCR 解析
 * @param {File[]} files - 圖片檔案陣列
 * @returns {Promise<object>} 解析結果
 */
export async function ocrAnalyze(files) {
  const formData = new FormData();
  files.forEach((file) => formData.append("images", file));

  const res = await fetch(`${API_BASE}/ocr/`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API 錯誤 (${res.status})`);
  }

  return res.json();
}

export async function fetchDashboard() {
  const res = await fetch(`${API_BASE}/dashboard`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API 錯誤 (${res.status})`);
  }
  return res.json();
}
