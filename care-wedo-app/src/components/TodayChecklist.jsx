export default function TodayChecklist({ items, checkDone, onToggle }) {
  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14, letterSpacing: 1 }}>
        今日 (3/19) 離院前必做
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          onClick={() => onToggle(i)}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "14px",
            background: checkDone[i] ? "var(--success-transparent)" : "var(--card-bg)",
            borderRadius: 12,
            marginBottom: 10,
            border: `1px solid ${checkDone[i] ? "rgba(39,174,96,0.5)" : "var(--card-border)"}`,
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <div style={{
            width: 22, height: 22,
            borderRadius: 6,
            border: `2px solid ${checkDone[i] ? "var(--success)" : "#444"}`,
            background: checkDone[i] ? "var(--success)" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            marginTop: 1,
            transition: "all 0.2s",
          }}>
            {checkDone[i] && <span style={{ color: "#fff", fontSize: 13 }}>✓</span>}
          </div>
          <div style={{
            fontSize: 14,
            lineHeight: 1.5,
            color: checkDone[i] ? "#555" : "#ddd",
            textDecoration: checkDone[i] ? "line-through" : "none",
          }}>{item}</div>
        </div>
      ))}

      <div style={{
        marginTop: 20,
        background: "var(--primary-transparent)",
        border: "1px solid rgba(79,195,247,0.4)",
        borderRadius: 12,
        padding: "14px",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", marginBottom: 8 }}>
          📞 台大醫院總機
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2, color: "#fff" }}>
          02-2312-3456
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          磁振造影室: 轉 262636
        </div>
      </div>

      <div style={{
        marginTop: 12,
        background: "var(--purple-bg)",
        border: "1px solid var(--purple-border)",
        borderRadius: 12,
        padding: "14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{ fontSize: 24 }}>👨‍👩‍👧</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#ce93d8" }}>家人同步通知</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>提醒已同步至家庭群組 LINE</div>
        </div>
        <div style={{
          marginLeft: "auto",
          width: 10, height: 10,
          borderRadius: "50%",
          background: "var(--success)",
          boxShadow: "0 0 8px var(--success)",
        }} />
      </div>
    </div>
  );
}
