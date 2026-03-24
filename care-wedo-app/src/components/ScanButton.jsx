import { useRef } from "react";

export default function ScanButton({ scanning, scanned, scanCount, onFilesSelected }) {
  const inputRef = useRef(null);

  const handleClick = () => {
    if (scanning) return;
    inputRef.current?.click();
  };

  const handleChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }
    e.target.value = "";
  };

  return (
    <div style={{ padding: "16px 20px 0" }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: "none" }}
        onChange={handleChange}
      />
      <button
        onClick={handleClick}
        disabled={scanning}
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: 12,
          background: scanning
            ? "linear-gradient(135deg, #1a3a2a, #0d2a1a)"
            : "var(--success-gradient)",
          border: "none",
          color: "#fff",
          fontSize: 15,
          fontWeight: 700,
          cursor: scanning ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          transition: "all 0.3s",
          letterSpacing: 1,
          opacity: scanning ? 0.8 : 1,
        }}
      >
        {scanning ? (
          <>
            <span className="spin-animation">⟳</span>
            AI 解析中…
          </>
        ) : scanned && scanCount > 0 ? (
          <>
            <span>✅</span> 已解析 {scanCount} 張單據・點此重新掃描
          </>
        ) : (
          <>
            <span>📷</span> 掃描醫療單據
          </>
        )}
      </button>
    </div>
  );
}
