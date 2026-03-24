export default function Header({ date }) {
  return (
    <div style={{
      background: "var(--header-gradient)",
      padding: "24px 20px 20px",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 44, height: 44,
          borderRadius: "12px",
          background: "var(--primary-gradient)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22,
        }}>🌿</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>Care WEDO</div>
          <div style={{ fontSize: 11, color: "#7ecbf7", letterSpacing: 2 }}>銀髮智慧照護助手</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>就診日期</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--primary)" }}>{date}</div>
        </div>
      </div>
      {/* PatientCard 將被放在外部傳入 children 或直接在 App 組合 */}
    </div>
  );
}
