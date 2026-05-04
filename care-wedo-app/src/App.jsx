import { useEffect, useState } from "react";
import "./index.css";
import Header from "./components/Header";
import PatientCard from "./components/PatientCard";
import ScanButton from "./components/ScanButton";
import OcrResult from "./components/OcrResult";
import TabNav from "./components/TabNav";
import Timeline from "./components/Timeline";
import MedsList from "./components/MedsList";
import TodayChecklist from "./components/TodayChecklist";
import { patientData, medicines, timeline as initialTimeline, checklist as initialChecklist } from "./data/patient";
import { fetchDashboard, ocrAnalyze } from "./services/api";

export default function App() {
  const [activeTab, setActiveTab] = useState("timeline");
  const [doneItems, setDoneItems] = useState({});
  const [checkDone, setCheckDone] = useState({});

  // OCR 狀態
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [ocrData, setOcrData] = useState(null);
  const [ocrError, setOcrError] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardError, setDashboardError] = useState(null);

  const loadDashboard = async () => {
    try {
      const data = await fetchDashboard();
      setDashboard(data);
      setDashboardError(null);
    } catch (err) {
      setDashboardError(err.message);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const toggleDone = (i) => setDoneItems((p) => ({ ...p, [i]: !p[i] }));
  const toggleCheck = (i) => setCheckDone((p) => ({ ...p, [i]: !p[i] }));

  const handleFilesSelected = async (files) => {
    setScanning(true);
    setOcrError(null);
    setOcrData(null);

    try {
      const result = await ocrAnalyze(files);
      if (result.success && result.data) {
        setOcrData(result.data);
        setScanCount(files.length);
        setScanned(true);
        await loadDashboard();
      } else {
        setOcrError(result.error || "解析失敗");
        setScanned(false);
      }
    } catch (err) {
      setOcrError(err.message);
      setScanned(false);
    } finally {
      setScanning(false);
    }
  };

  const tabs = [
    { id: "timeline", label: "⏰ 提醒時間軸" },
    { id: "meds", label: "💊 藥物清單" },
    { id: "today", label: "📋 今日待辦" },
  ];

  const patient = dashboard?.patient?.name ? dashboard.patient : patientData;
  const timelineItems = dashboard?.appointments?.length
    ? dashboard.appointments.map((apt) => ({
      date: [apt.date, apt.time].filter(Boolean).join(" "),
      label: apt.department || apt.hospital || "醫療預約",
      desc: apt.reminder_text || [apt.hospital, apt.doctor && `${apt.doctor}醫師`, apt.number && `${apt.number}號`].filter(Boolean).join(" · "),
      icon: apt.fasting_required ? "!" : "+",
      urgent: Boolean(apt.fasting_required),
      location: apt.location,
    }))
    : initialTimeline;
  const medicineItems = dashboard?.medications?.length
    ? dashboard.medications.map((med, index) => ({
      name: med.name,
      use: med.purpose || med.warnings || "用藥提醒",
      freq: med.frequency || med.dosage || "依醫囑",
      qty: med.dosage || "用藥",
      days: "",
      color: ["#e74c3c", "#e67e22", "#9b59b6", "#3498db", "#1abc9c", "#27ae60"][index % 6],
    }))
    : medicines;
  const checklistItems = dashboard?.checklist?.length ? dashboard.checklist : initialChecklist;

  return (
    <>
      <Header date="2026/03/19">
        <div style={{ marginTop: 14 }}>
          <PatientCard patient={patient} />
        </div>
      </Header>

      <ScanButton
        scanning={scanning}
        scanned={scanned}
        scanCount={scanCount}
        onFilesSelected={handleFilesSelected}
      />

      {/* OCR 錯誤訊息 */}
      {ocrError && (
        <div style={{
          margin: "12px 20px 0", padding: "10px 14px", borderRadius: 8,
          background: "rgba(231,76,60,0.15)", color: "#e74c3c", fontSize: 13,
        }}>
          {ocrError}
        </div>
      )}

      {dashboardError && (
        <div style={{
          margin: "12px 20px 0", padding: "10px 14px", borderRadius: 8,
          background: "rgba(79,195,247,0.12)", color: "var(--primary)", fontSize: 12,
        }}>
          目前顯示示範資料。後端連線訊息：{dashboardError}
        </div>
      )}

      {/* OCR 解析結果 */}
      {ocrData && (
        <OcrResult data={ocrData} onClose={() => setOcrData(null)} />
      )}

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "timeline" && (
        <Timeline items={timelineItems} doneItems={doneItems} onToggle={toggleDone} />
      )}

      {activeTab === "meds" && (
        <MedsList medicines={medicineItems} />
      )}

      {activeTab === "today" && (
        <TodayChecklist items={checklistItems} checkDone={checkDone} onToggle={toggleCheck} />
      )}
    </>
  );
}
