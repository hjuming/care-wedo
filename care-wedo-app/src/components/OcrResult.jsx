import aiAvatar from '../assets/ai-avatar.png';

/**
 * OCR 解析結果顯示元件
 * 顯示 Claude 解析出的醫療單據結構化資訊
 */
export default function OcrResult({ data, onClose }) {
  if (!data) return null;

  const { patient, department, visit_date, diagnoses, medications, appointments, exams, reminders, next_visit } = data;

  return (
    <div style={{ padding: "0 20px 20px" }}>
      {/* 標題列 */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        margin: "16px 0 12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src={aiAvatar} alt="AI Avatar" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            AI 照護管家解析結果
          </p>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", fontSize: 12, color: "var(--text-secondary)",
          cursor: "pointer", padding: "4px 8px",
        }}>
          收起
        </button>
      </div>

      {/* 患者資訊 */}
      {patient?.name && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "linear-gradient(135deg, #2d6a4f, #40916c)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 500, color: "#fff",
            }}>
              {patient.name.charAt(0)}
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 500, fontSize: 15, color: "var(--text-primary)" }}>
                {patient.name}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
                {[patient.age, department, visit_date].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          {diagnoses?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {diagnoses.map((dx, i) => (
                <span key={i} style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 20,
                  background: "rgba(231,76,60,0.15)", color: "#e74c3c",
                  border: "0.5px solid rgba(231,76,60,0.3)",
                }}>
                  {dx}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 藥物清單 */}
      {medications?.length > 0 && (
        <Card>
          <SectionTitle>藥物清單 ({medications.length} 種)</SectionTitle>
          {medications.map((m, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              padding: "10px 0",
              borderBottom: i < medications.length - 1 ? "0.5px solid var(--border-color, rgba(255,255,255,0.08))" : "none",
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                  {m.name}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>
                  {[m.use, m.freq].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}>
                {m.qty && <div>{m.qty}</div>}
                {m.days > 0 && <div>{m.days} 天</div>}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* 預約 / 檢查 */}
      {appointments?.length > 0 && (
        <Card>
          <SectionTitle>預約門診 ({appointments.length} 筆)</SectionTitle>
          {appointments.map((apt, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: i < appointments.length - 1 ? "0.5px solid var(--border-color, rgba(255,255,255,0.08))" : "none" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                {apt.date} {apt.time && `${apt.time}`} — {apt.department || apt.hospital}
              </p>
              {apt.doctor && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>{apt.doctor} 醫師</p>}
              {apt.location && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>📍 {apt.location}</p>}
              {apt.fasting_required && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#e74c3c", fontWeight: 500 }}>⚠️ 需空腹 {apt.fasting_hours || 8} 小時</p>}
            </div>
          ))}
        </Card>
      )}

      {/* 檢查項目 */}
      {exams?.length > 0 && (
        <Card>
          <SectionTitle>檢查項目 ({exams.length} 項)</SectionTitle>
          {exams.map((ex, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: i < exams.length - 1 ? "0.5px solid var(--border-color, rgba(255,255,255,0.08))" : "none" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                {ex.type} {ex.date && `— ${ex.date}`} {ex.time && ex.time}
              </p>
              {ex.location && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>📍 {ex.location}</p>}
              {ex.notes && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>{ex.notes}</p>}
            </div>
          ))}
        </Card>
      )}

      {/* 提醒事項 */}
      {reminders?.length > 0 && (
        <Card>
          <SectionTitle>提醒事項 ({reminders.length} 個)</SectionTitle>
          {reminders.map((r, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              padding: "8px 0",
              borderBottom: i < reminders.length - 1 ? "0.5px solid var(--border-color, rgba(255,255,255,0.08))" : "none",
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                background: r.urgent ? "#e74c3c" : "#3498db",
              }} />
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: r.urgent ? "#e74c3c" : "#3498db" }}>
                  {r.date}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text-primary)" }}>{r.label}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>{r.desc}</p>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* 下次回診 */}
      {next_visit?.date && (
        <Card>
          <SectionTitle>下次回診</SectionTitle>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-primary)" }}>
            {next_visit.date} {next_visit.dept && `— ${next_visit.dept}`}
          </p>
          {next_visit.doctor && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>{next_visit.doctor}</p>}
          {next_visit.note && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)" }}>{next_visit.note}</p>}
        </Card>
      )}
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{
      background: "var(--card-bg, rgba(255,255,255,0.04))",
      border: "0.5px solid var(--border-color, rgba(255,255,255,0.08))",
      borderRadius: 12, padding: "12px 16px", marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
      {children}
    </p>
  );
}
