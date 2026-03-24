import { useState } from "react";

const patientData = {
  name: "洪永吉",
  age: 75,
  dept: "腫瘤醫學部",
  doctor: "廖斌志醫師",
  diagnoses: ["C13.9 下咽癌", "E11.9 第二型糖尿病"],
};

const medicines = [
  { name: "UFUR (Tegafur)", use: "化療口服藥", freq: "每日2次", qty: "56粒", days: 28, color: "#e74c3c" },
  { name: "Mopride 5mg", use: "腸胃蠕動", freq: "每日3次", qty: "84粒", days: 28, color: "#e67e22" },
  { name: "Imovane 7.5mg", use: "安眠藥（管4）", freq: "睡前", qty: "28粒", days: 28, color: "#9b59b6" },
  { name: "Fudecough 15mg", use: "止咳", freq: "飯後每日3次", qty: "84粒", days: 28, color: "#3498db" },
  { name: "Musco 30mg", use: "化痰", freq: "飯後每日3次", qty: "84粒", days: 28, color: "#1abc9c" },
  { name: "Megest 40mg/ml", use: "食慾促進劑", freq: "每日2次 4ml", qty: "2瓶", days: 28, color: "#27ae60" },
];

const timeline = [
  {
    date: "3/22 前",
    label: "抽血",
    desc: "無需空腹，回診前7天完成",
    icon: "🩸",
    urgent: true,
    location: "",
    done: false,
  },
  {
    date: "4/09–4/15",
    label: "第2次領藥",
    desc: "領藥號 D-444，總院一樓藥局D窗口，帶健保卡+處方箋",
    icon: "💊",
    urgent: true,
    location: "台大總院一樓藥局D窗口",
    done: false,
  },
  {
    date: "5/07",
    label: "抽血提醒",
    desc: "回診前7天，無需空腹",
    icon: "🩸",
    urgent: false,
    location: "",
    done: false,
  },
  {
    date: "5/13 前",
    label: "處方箋到期",
    desc: "有效期截止，未領完需重新掛號",
    icon: "⚠️",
    urgent: false,
    location: "",
    done: false,
  },
  {
    date: "5/14 (四) 08:00",
    label: "腫瘤科門診",
    desc: "廖斌志醫師，診30號，預計來診 11:00–12:00",
    icon: "🏥",
    urgent: false,
    location: "西址1樓腫瘤醫學部",
    done: false,
  },
  {
    date: "9/12",
    label: "MRI前準備",
    desc: "確認禁食規定（說明書第73號），前兩天先至檢醫部抽血",
    icon: "📋",
    urgent: false,
    location: "",
    done: false,
  },
  {
    date: "9/14 (一) 07:50",
    label: "頭頸部MRI",
    desc: "含/不含顯影劑，提前10分鐘報到，帶健保IC卡+預約單",
    icon: "🧲",
    urgent: false,
    location: "西址舊大樓一樓磁振造影掃描室(二)",
    done: false,
  },
];

const checklist = [
  "3日內領第1次藥（D-444，D窗口）",
  "胸部X光：先結帳繳費再至影醫部報到",
  "確認抽血日期（回診前7天）",
  "確認手機號碼 093564**** 是否正確（MRI簡訊通知用）",
];

export default function CareWedo() {
  const [activeTab, setActiveTab] = useState("timeline");
  const [doneItems, setDoneItems] = useState({});
  const [checkDone, setCheckDone] = useState({});
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(true);

  const toggleDone = (i) => setDoneItems((p) => ({ ...p, [i]: !p[i] }));
  const toggleCheck = (i) => setCheckDone((p) => ({ ...p, [i]: !p[i] }));

  const simulateScan = () => {
    setScanned(false);
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      setScanned(true);
    }, 2200);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f1117",
      fontFamily: "'Noto Sans TC', 'PingFang TC', sans-serif",
      color: "#f0f0f0",
      padding: "0 0 80px 0",
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1a2744 0%, #0d1f3c 100%)",
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
            background: "linear-gradient(135deg, #4fc3f7, #0288d1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22,
          }}>🌿</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>Care WEDO</div>
            <div style={{ fontSize: 11, color: "#7ecbf7", letterSpacing: 2 }}>銀髮智慧照護助手</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 13, color: "#aaa" }}>就診日期</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#4fc3f7" }}>2026/03/19</div>
          </div>
        </div>

        {/* Patient card */}
        <div style={{
          background: "rgba(255,255,255,0.05)",
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          border: "1px solid rgba(79,195,247,0.2)",
        }}>
          <div style={{
            width: 40, height: 40,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #667eea, #764ba2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 700,
          }}>洪</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{patientData.name}</div>
            <div style={{ fontSize: 12, color: "#aaa" }}>{patientData.age}歲・{patientData.dept}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {patientData.diagnoses.map((d, i) => (
              <div key={i} style={{
                fontSize: 10,
                background: i === 0 ? "rgba(231,76,60,0.2)" : "rgba(52,152,219,0.2)",
                color: i === 0 ? "#e74c3c" : "#3498db",
                padding: "2px 8px",
                borderRadius: 20,
                border: `1px solid ${i === 0 ? "rgba(231,76,60,0.4)" : "rgba(52,152,219,0.4)"}`,
              }}>{d}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Scan button */}
      <div style={{ padding: "16px 20px 0" }}>
        <button
          onClick={simulateScan}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: 12,
            background: scanning
              ? "linear-gradient(135deg, #1a3a2a, #0d2a1a)"
              : "linear-gradient(135deg, #00c853, #00695c)",
            border: "none",
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "all 0.3s",
            letterSpacing: 1,
          }}
        >
          {scanning ? (
            <>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
              AI 解析中…
            </>
          ) : scanned ? (
            <><span>✅</span> 已解析 4 張單據・點此重新掃描</>
          ) : (
            <><span>📷</span> 掃描醫療單據</>
          )}
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex",
        padding: "16px 20px 0",
        gap: 8,
      }}>
        {[
          { id: "timeline", label: "⏰ 提醒時間軸" },
          { id: "meds", label: "💊 藥物清單" },
          { id: "today", label: "📋 今日待辦" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: "10px 4px",
              borderRadius: 10,
              border: "none",
              background: activeTab === tab.id
                ? "linear-gradient(135deg, #4fc3f7, #0288d1)"
                : "rgba(255,255,255,0.07)",
              color: activeTab === tab.id ? "#fff" : "#888",
              fontSize: 11,
              fontWeight: activeTab === tab.id ? 700 : 400,
              cursor: "pointer",
              transition: "all 0.2s",
              letterSpacing: 0.5,
            }}
          >{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "16px 20px" }}>

        {/* Timeline */}
        {activeTab === "timeline" && (
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 14, letterSpacing: 1 }}>
              共 {timeline.length} 個提醒事項
            </div>
            {timeline.map((item, i) => (
              <div
                key={i}
                onClick={() => toggleDone(i)}
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
                    background: doneItems[i] ? "#444" : item.urgent ? "linear-gradient(135deg, #ff6b6b, #ee5a24)" : "linear-gradient(135deg, #4fc3f7, #0288d1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11,
                    flexShrink: 0,
                    boxShadow: doneItems[i] ? "none" : item.urgent ? "0 0 12px rgba(255,107,107,0.4)" : "0 0 10px rgba(79,195,247,0.3)",
                  }}>
                    {doneItems[i] ? "✓" : item.icon}
                  </div>
                  {i < timeline.length - 1 && (
                    <div style={{ width: 1, flex: 1, background: "rgba(255,255,255,0.08)", minHeight: 20, marginTop: 4 }} />
                  )}
                </div>

                {/* Card */}
                <div style={{
                  flex: 1,
                  background: doneItems[i] ? "rgba(255,255,255,0.03)" : item.urgent ? "rgba(255,107,107,0.08)" : "rgba(255,255,255,0.05)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  border: `1px solid ${doneItems[i] ? "rgba(255,255,255,0.05)" : item.urgent ? "rgba(255,107,107,0.25)" : "rgba(255,255,255,0.08)"}`,
                  marginBottom: 4,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{
                      fontSize: 12,
                      color: item.urgent ? "#ff8a80" : "#4fc3f7",
                      fontWeight: 700,
                      letterSpacing: 0.5,
                    }}>{item.date}</div>
                    {item.urgent && !doneItems[i] && (
                      <div style={{
                        fontSize: 9,
                        background: "rgba(255,107,107,0.2)",
                        color: "#ff8a80",
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
                  <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>{item.desc}</div>
                  {item.location && (
                    <div style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "#4fc3f7",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}>📍 {item.location}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Medicines */}
        {activeTab === "meds" && (
          <div>
            <div style={{
              background: "rgba(231,76,60,0.1)",
              border: "1px solid rgba(231,76,60,0.3)",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 12,
              color: "#e74c3c",
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}>
              ⚠️ 第2次領藥期：<strong>2026/04/09–04/15</strong>（有效期至 5/13）
            </div>
            {medicines.map((med, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.04)",
                borderRadius: 12,
                padding: "14px",
                marginBottom: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                borderLeft: `3px solid ${med.color}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{med.name}</div>
                    <div style={{ fontSize: 12, color: "#aaa" }}>{med.use}</div>
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
                  <div style={{
                    fontSize: 11,
                    background: "rgba(255,255,255,0.07)",
                    padding: "3px 10px",
                    borderRadius: 20,
                    color: "#ccc",
                  }}>📅 {med.days}天份</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Today checklist */}
        {activeTab === "today" && (
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 14, letterSpacing: 1 }}>
              今日 (3/19) 離院前必做
            </div>
            {checklist.map((item, i) => (
              <div
                key={i}
                onClick={() => toggleCheck(i)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px",
                  background: checkDone[i] ? "rgba(39,174,96,0.08)" : "rgba(255,255,255,0.04)",
                  borderRadius: 12,
                  marginBottom: 10,
                  border: `1px solid ${checkDone[i] ? "rgba(39,174,96,0.3)" : "rgba(255,255,255,0.08)"}`,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                <div style={{
                  width: 22, height: 22,
                  borderRadius: 6,
                  border: `2px solid ${checkDone[i] ? "#27ae60" : "#444"}`,
                  background: checkDone[i] ? "#27ae60" : "transparent",
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
              background: "rgba(79,195,247,0.07)",
              border: "1px solid rgba(79,195,247,0.2)",
              borderRadius: 12,
              padding: "14px",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#4fc3f7", marginBottom: 8 }}>
                📞 台大醫院總機
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2, color: "#fff" }}>
                02-2312-3456
              </div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                磁振造影室: 轉 262636
              </div>
            </div>

            <div style={{
              marginTop: 12,
              background: "rgba(155,89,182,0.07)",
              border: "1px solid rgba(155,89,182,0.2)",
              borderRadius: 12,
              padding: "14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <span style={{ fontSize: 24 }}>👨‍👩‍👧</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#ce93d8" }}>家人同步通知</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>提醒已同步至家庭群組 LINE</div>
              </div>
              <div style={{
                marginLeft: "auto",
                width: 10, height: 10,
                borderRadius: "50%",
                background: "#27ae60",
                boxShadow: "0 0 8px #27ae60",
              }} />
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
