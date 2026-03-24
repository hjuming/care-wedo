import { useState } from "react";
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
import { ocrAnalyze } from "./services/api";

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

  return (
    <>
      <Header date="2026/03/19">
        <div style={{ marginTop: 14 }}>
          <PatientCard patient={patientData} />
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

      {/* OCR 解析結果 */}
      {ocrData && (
        <OcrResult data={ocrData} onClose={() => setOcrData(null)} />
      )}

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "timeline" && (
        <Timeline items={initialTimeline} doneItems={doneItems} onToggle={toggleDone} />
      )}

      {activeTab === "meds" && (
        <MedsList medicines={medicines} />
      )}

      {activeTab === "today" && (
        <TodayChecklist items={initialChecklist} checkDone={checkDone} onToggle={toggleCheck} />
      )}
    </>
  );
}
