export default function Timeline({ items, doneItems, onToggle }) {
  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14, letterSpacing: 1 }}>
        共 {items.length} 個提醒事項
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => onToggle(i)}
          style={{
            display: "flex",
            gap: 14,
            marginBottom: 12,
            opacity: doneItems[i] ? 0.45 : 1,
            cursor: "pointer",
            transition: "opacity 0.2s",
          }}
        >
          {/* Timeline line */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 24 }}>
            <div style={{
              width: 24, height: 24,
              borderRadius: "50%",
              background: doneItems[i] ? "#444" : item.urgent ? "linear-gradient(135deg, #ff6b6b, #ee5a24)" : "var(--primary-gradient)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11,
              flexShrink: 0,
              boxShadow: doneItems[i] ? "none" : item.urgent ? "0 0 12px rgba(255,107,107,0.4)" : "0 0 10px rgba(79,195,247,0.3)",
            }}>
              {doneItems[i] ? "✓" : item.icon}
            </div>
            {i < items.length - 1 && <div className="timeline-line" />}
          </div>

          {/* Card */}
          <div style={{
            flex: 1,
            background: doneItems[i] ? "var(--card-bg-done)" : item.urgent ? "var(--danger-bg)" : "var(--card-bg)",
            borderRadius: 12,
            padding: "12px 14px",
            border: `1px solid ${doneItems[i] ? "var(--card-border)" : item.urgent ? "var(--danger-transparent)" : "var(--card-border)"}`,
            marginBottom: 4,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{
                fontSize: 12,
                color: item.urgent ? "var(--danger)" : "var(--primary)",
                fontWeight: 700,
                letterSpacing: 0.5,
              }}>{item.date}</div>
              {item.urgent && !doneItems[i] && (
                <div style={{
                  fontSize: 9,
                  background: "var(--danger-transparent)",
                  color: "var(--danger)",
                  padding: "2px 6px",
                  borderRadius: 20,
                  border: "1px solid rgba(255,107,107,0.3)",
                  letterSpacing: 1,
                }}>緊急</div>
              )}
              {doneItems[i] && (
                <div style={{ fontSize: 10, color: "#555" }}>已完成</div>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, textDecoration: doneItems[i] ? "line-through" : "none" }}>
              {item.label}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{item.desc}</div>
            {item.location && (
              <div style={{
                marginTop: 8,
                fontSize: 11,
                color: "var(--primary)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}>📍 {item.location}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
