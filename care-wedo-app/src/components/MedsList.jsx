export default function MedsList({ medicines }) {
  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{
        background: "var(--warning-bg)",
        border: "1px solid var(--warning-border)",
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 16,
        fontSize: 12,
        color: "var(--warning)",
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}>
        ⚠️ 第2次領藥期：<strong>2026/04/09–04/15</strong>（有效期至 5/13）
      </div>
      {medicines.map((med, i) => (
        <div key={i} style={{
          background: "var(--card-bg)",
          borderRadius: 12,
          padding: "14px",
          marginBottom: 10,
          border: "1px solid var(--card-border)",
          borderLeft: `3px solid ${med.color}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{med.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{med.use}</div>
            </div>
            <div style={{
              background: `${med.color}22`,
              color: med.color,
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 700,
              border: `1px solid ${med.color}44`,
            }}>{med.qty}</div>
          </div>
          <div style={{
            marginTop: 10,
            display: "flex",
            gap: 8,
          }}>
            <div style={{
              fontSize: 11,
              background: "rgba(255,255,255,0.07)",
              padding: "3px 10px",
              borderRadius: 20,
              color: "#ccc",
            }}>⏱ {med.freq}</div>
            {med.days && (
              <div style={{
                fontSize: 11,
                background: "rgba(255,255,255,0.07)",
                padding: "3px 10px",
                borderRadius: 20,
                color: "#ccc",
              }}>📅 {med.days}天份</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
