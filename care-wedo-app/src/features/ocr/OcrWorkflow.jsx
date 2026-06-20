import { useState } from "react";

const SCAN_STEPS = ["讀取照片", "辨識文字", "整理提醒"];

export function ScanProgress({ step }) {
  return (
    <section className="ocr-progress" aria-live="polite">
      <div className="ocr-progress-header">
        <p className="ocr-progress-title">正在幫你整理照護資訊…</p>
        <p className="ocr-progress-sub">等等請你再確認一次內容是否正確。</p>
      </div>
      <div className="ocr-progress-steps">
        {SCAN_STEPS.map((label, index) => (
          <div
            key={label}
            className={[
              "ocr-progress-step",
              step === null ? "" : index < step ? "done" : index === step ? "active" : "",
            ].filter(Boolean).join(" ")}
          >
            <span className="ocr-step-dot" aria-hidden="true" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function UploadGuide({ onConfirm, onTextSubmit, onClose }) {
  const [text, setText] = useState("");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>拍照新增照護資料</h2>
          <button type="button" onClick={onClose} className="btn-close">✕</button>
        </div>
        <div className="modal-body upload-guide-body">
          <p className="upload-guide-intro">
            不用先分類。請拍下<strong>藥袋、處方箋、掛號單或提醒單</strong>，系統會先幫你整理。
          </p>
          <div className="upload-guide-types" aria-label="可拍攝的照護資料">
            <span>藥袋</span>
            <span>處方箋</span>
            <span>掛號單</span>
            <span>提醒單</span>
          </div>
          <ul className="upload-guide-tips">
            <li>照片文字清楚、盡量拍完整</li>
            <li>盡量避免反光或模糊</li>
            <li>可以一次上傳多張</li>
          </ul>
          <p className="upload-guide-note">
            上傳後會先顯示整理結果，你可以確認用藥、回診時間與注意事項是否正確。
          </p>
          <label className="upload-text-label" htmlFor="medical-text-upload">也可以直接貼文字</label>
          <textarea
            id="medical-text-upload"
            className="upload-textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="例如：5/29 09:30 復健，生生優動板橋分院..."
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-action" onClick={onClose}>取消</button>
          <button type="button" className="secondary-action" onClick={() => onTextSubmit?.(text)} disabled={!text.trim()}>整理文字</button>
          <button type="button" className="primary-action" onClick={onConfirm}>開始拍照</button>
        </div>
      </div>
    </div>
  );
}

export function CareDocumentUploadModal({ onClose, onSave }) {
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState("medical_record");
  const [preserveOriginalFile, setPreserveOriginalFile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (!file) {
      setError("請先選擇 PDF 或圖片。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ file, preserveOriginalFile, documentType });
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件上傳失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content care-document-upload-modal" onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-labelledby="care-document-upload-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-kicker">醫療文件庫</p>
            <h2 id="care-document-upload-title">上傳病歷或用藥紀錄</h2>
          </div>
          <button type="button" className="btn-close" onClick={onClose} aria-label="關閉">×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="care-document-file">文件</label>
            <input
              id="care-document-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="care-document-type">類型</label>
            <select id="care-document-type" value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
              <option value="medical_record">病歷紀錄</option>
              <option value="medication_record">用藥紀錄</option>
              <option value="lab_report">檢驗報告</option>
              <option value="imaging_report">影像報告</option>
              <option value="prescription">處方箋</option>
              <option value="appointment_slip">預約單</option>
              <option value="other">其他文件</option>
            </select>
          </div>
          <label className="settings-toggle document-preserve-toggle">
            <input
              type="checkbox"
              checked={preserveOriginalFile}
              onChange={(event) => setPreserveOriginalFile(event.target.checked)}
            />
            <span>
              <strong>保存原始檔</strong>
              <small>門診時可開啟 PDF 或圖片給醫師核對。</small>
            </span>
          </label>
          {file && (
            <div className="document-selected-file">
              <strong>{file.name}</strong>
              <span>{file.type || "未知格式"}・{Math.max(file.size / 1024 / 1024, 0.01).toFixed(2)} MB</span>
            </div>
          )}
          {error && <p className="notice-danger">{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-action" onClick={onClose}>取消</button>
          <button type="submit" className="primary-action" disabled={saving}>{saving ? "整理中..." : "上傳並整理"}</button>
        </div>
      </form>
    </div>
  );
}
