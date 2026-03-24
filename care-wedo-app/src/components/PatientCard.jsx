export default function PatientCard({ patient }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      borderRadius: 12,
      padding: "12px 16px",
      display: "flex",
      alignItems: "center",
      gap: 14,
      border: "1px solid var(--primary-transparent)",
    }}>
      <div style={{
        width: 40, height: 40,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #667eea, #764ba2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, fontWeight: 700,
      }}>洪</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{patient.name}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{patient.age}歲・{patient.dept}</div>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {patient.diagnoses.map((d, i) => (
          <div key={i} style={{
            fontSize: 10,
            background: i === 0 ? "var(--warning-bg)" : "var(--primary-transparent)",
            color: i === 0 ? "var(--warning)" : "var(--primary)",
            padding: "2px 8px",
            borderRadius: 20,
            border: `1px solid ${i === 0 ? "var(--warning-border)" : "var(--primary-transparent)"}`,
          }}>{d}</div>
        ))}
      </div>
    </div>
  );
}
