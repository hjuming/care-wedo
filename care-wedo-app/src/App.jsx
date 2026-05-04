import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import GroupManager from "./components/GroupManager";
import GroupSettings from "./components/GroupSettings";
import LoginSetup from "./components/LoginSetup";
import OcrResult from "./components/OcrResult";
import { patientData, medicines, timeline as initialTimeline, checklist as initialChecklist } from "./data/patient";
import { fetchDashboard, ocrAnalyze } from "./services/api";
import { initLineIdentity } from "./services/liff";
import heroImage from "./assets/hero-bg.png";
import aiAvatar from "./assets/ai-avatar.png";

const SECTIONS = [
  { id: "overview", label: "今天重點", icon: "⌂" },
  { id: "calendar", label: "看診日曆", icon: "□" },
  { id: "meds", label: "吃藥提醒", icon: "○" },
  { id: "records", label: "看過什麼", icon: "≡" },
  { id: "settings", label: "家人設定", icon: "⚙" },
];

const paidFeatureGroups = [
  {
    title: "家人一起看",
    items: ["邀請子女一起管理", "有人上傳單據，全家都看得到", "重要提醒一起收到"],
  },
  {
    title: "爸媽專屬資料",
    items: ["設定稱呼與頭像", "記下常去醫院與常看科別", "記下過敏、空腹、帶卡等提醒"],
  },
  {
    title: "找資料更快",
    items: ["搜尋藥名、醫院、科別", "查以前看過什麼", "整理給家人看的簡單摘要"],
  },
];

function typeLabel(type) {
  if (type === "inspection") return "檢查";
  if (type === "refill_reminder") return "領藥";
  return "回診";
}

function typeIcon(type) {
  if (type === "inspection") return "驗";
  if (type === "refill_reminder") return "藥";
  return "診";
}

function formatDateLabel(value) {
  if (!value) return "日期待確認";
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function normalizeAppointment(apt, index) {
  return {
    id: apt.id || `demo-${index}`,
    type: apt.type || (apt.label?.includes("領藥") ? "refill_reminder" : "clinic_visit"),
    date: apt.date || "",
    time: apt.time || "",
    hospital: apt.hospital || "",
    department: apt.department || apt.label || "看診安排",
    doctor: apt.doctor || "",
    number: apt.number || "",
    location: apt.location || "",
    notes: apt.notes || "",
    reminder_text: apt.reminder_text || apt.desc || "",
    fasting_required: Boolean(apt.fasting_required || apt.urgent),
    fasting_hours: apt.fasting_hours || null,
  };
}

function normalizeMedication(med, index) {
  return {
    id: med.id || `demo-med-${index}`,
    name: med.name || "藥物名稱待確認",
    purpose: med.purpose || med.use || "這顆藥的用途待確認",
    frequency: med.frequency || med.freq || "照單子上的時間吃",
    dosage: med.dosage || med.qty || "份量待確認",
    warnings: med.warnings || "",
    color: med.color || ["#b7791f", "#2f855a", "#2b6cb0", "#805ad5"][index % 4],
  };
}

function matchSearch(item, query) {
  if (!query) return true;
  return Object.values(item).join(" ").toLowerCase().includes(query.toLowerCase());
}

export default function App() {
  const fileInputRef = useRef(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [ocrData, setOcrData] = useState(null);
  const [ocrError, setOcrError] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardError, setDashboardError] = useState(null);
  const [identity, setIdentity] = useState({ status: "loading", idToken: null, profile: null, message: null });
  const [activeProfileId, setActiveProfileId] = useState(null);

  const loadDashboard = useCallback(async (lineIdentity, profileId = null) => {
    try {
      const data = await fetchDashboard({ idToken: lineIdentity?.idToken, profileId });
      setDashboard(data);
      setDashboardError(null);
      if (!profileId && data.active_profile_id) {
        setActiveProfileId(data.active_profile_id);
      }
      return data;
    } catch (err) {
      setDashboardError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const lineIdentity = await initLineIdentity();
        if (!active || lineIdentity.status === "redirecting") return;
        setIdentity(lineIdentity);
        await loadDashboard(lineIdentity);
      } catch (err) {
        if (!active) return;
        setIdentity({
          status: "demo",
          idToken: null,
          profile: null,
          message: err instanceof Error ? err.message : "暫時還沒連上 LINE，先用範例畫面給您看。",
        });
        await loadDashboard({ idToken: null });
      }
    }

    boot();
    return () => {
      active = false;
    };
  }, [loadDashboard]);

  const patient = dashboard?.patient?.name ? dashboard.patient : patientData;
  const appointments = useMemo(() => {
    const source = dashboard?.appointments?.length ? dashboard.appointments : initialTimeline;
    return source.map(normalizeAppointment).filter((item) => matchSearch(item, searchQuery));
  }, [dashboard, searchQuery]);

  const medications = useMemo(() => {
    const source = dashboard?.medications?.length ? dashboard.medications : medicines;
    return source.map(normalizeMedication).filter((item) => matchSearch(item, searchQuery));
  }, [dashboard, searchQuery]);

  const checklistItems = dashboard?.checklist?.length ? dashboard.checklist : initialChecklist;
  const careProfiles = dashboard?.care_profiles || [];
  const selectedProfile = careProfiles.find((profile) => profile.id === activeProfileId) || careProfiles[0] || null;
  const nextAppointment = appointments[0];
  const urgentItems = appointments.filter((item) => item.fasting_required || item.type === "refill_reminder").slice(0, 3);
  const records = appointments.filter((item) => item.date || item.reminder_text);
  const isPersonalMode = dashboard?.mode === "personal" || identity.status === "authenticated";

  async function handleFilesSelected(files) {
    setScanning(true);
    setOcrError(null);
    setOcrData(null);

    try {
      const result = await ocrAnalyze(files, {
        idToken: identity.idToken,
        profileId: activeProfileId,
      });
      if (result.success && result.data) {
        setOcrData(result.data);
        setScanCount(files.length);
        setScanned(true);
        await loadDashboard(identity, activeProfileId);
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
  }

  function handleUploadChange(event) {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) handleFilesSelected(files);
    event.target.value = "";
  }

  function handleProfileChange(profileId) {
    setActiveProfileId(profileId);
    loadDashboard(identity, profileId);
  }

  function handleSetupComplete() {
    // Reload dashboard after setup
    loadDashboard(identity, activeProfileId);
  }

  return (
    <main className="care-shell">
      <LoginSetup identity={identity} onSetupComplete={handleSetupComplete} />
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        onChange={handleUploadChange}
      />

      <section className="care-hero" aria-label="Care WEDO 健康小管家">
        <div className="hero-copy">
          <div className="brand-row">
            <img src={heroImage} alt="Care WEDO" className="brand-mark" />
            <span className="beta-pill">目前免費試用</span>
          </div>
          <h1>
            LINE 一鍵上傳看診單，
            <br className="phone-break" />
            Care WEDO 幫您整理提醒。
          </h1>
          <p>
            直接從 LINE 拍照上傳，系統會自動記住看診、吃藥、空腹、帶卡等重要事項。
            <br className="phone-break" />
            讓爸爸媽媽和家人都能看清今天該做的事。
          </p>
          <div className="hero-highlights">
            <span>大字提醒</span>
            <span>拍照上傳即可</span>
            <span>家人一起看</span>
          </div>
          <div className="hero-actions">
            <button className="primary-action" type="button" onClick={() => setActiveSection("calendar")}>
              看今天重點
            </button>
            <button className="secondary-action" type="button" onClick={() => fileInputRef.current?.click()} disabled={scanning}>
              {scanning ? "正在整理單子..." : scanned ? `已整理 ${scanCount} 張` : "拍照上傳單子"}
            </button>
          </div>
        </div>

        <aside className="login-panel" aria-label="LINE 登入狀態">
          <img src={aiAvatar} alt="健康小管家" className="assistant-avatar" />
          <div>
            <p className="panel-eyebrow">LINE 健康小管家</p>
            <h2>{isPersonalMode ? "已用 LINE 登入" : "用 LINE 登入後就能看"}</h2>
            <p className="panel-copy">
              {isPersonalMode
                ? "這裡只會顯示您的看診、吃藥和領藥提醒。"
                : (
                  <>
                    從 LINE 打開後，
                    <br className="phone-break" />
                    就會進到自己的頁面。
                  </>
                )}
            </p>
          </div>
          <div className="login-status">
            <span className={isPersonalMode ? "status-dot online" : "status-dot"} />
            {isPersonalMode ? "已登入" : "範例畫面"}
          </div>
        </aside>
      </section>

      {(dashboardError || identity.message || ocrError) && (
        <section className="notice-stack" aria-live="polite">
          {dashboardError && <p>現在是範例畫面。</p>}
          {identity.message && !dashboardError && <p>{identity.message}</p>}
          {ocrError && <p className="notice-danger">{ocrError}</p>}
        </section>
      )}

      {ocrData && <OcrResult data={ocrData} onClose={() => setOcrData(null)} />}

      <section className="dashboard-grid">
        <aside className="side-rail" aria-label="健康小管家選單">
          <div className="profile-block">
            <img src={identity.profile?.pictureUrl || aiAvatar} alt="個人頭像" className="profile-avatar" />
            <div>
              <p className="profile-name">{selectedProfile?.display_name || patient.name || "親愛的爸爸 / 媽媽"}</p>
              <p className="profile-note">{patient.dept || "常看科別待補"}・{patient.age || "年齡待補"}</p>
            </div>
          </div>

          <ProfileSwitcher
            profiles={careProfiles}
            activeProfileId={activeProfileId}
            onChange={handleProfileChange}
          />

          <nav className="section-nav">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? "nav-item active" : "nav-item"}
                onClick={() => setActiveSection(section.id)}
              >
                <span>{section.icon}</span>
                {section.label}
              </button>
            ))}
          </nav>

          <div className="plan-panel">
            <p className="panel-eyebrow">目前免費試用</p>
            <strong>NT$30 / 使用者 / 月</strong>
            <p>之後完整頁面會改為付費。沒有訂閱時，還是可以用 LINE 拍照解析單子。</p>
          </div>
        </aside>

        <section className="content-area">
          <div className="toolbar">
            <div>
              <p className="panel-eyebrow">Care WEDO 健康小管家</p>
              <h2>{SECTIONS.find((item) => item.id === activeSection)?.label}</h2>
            </div>
            <label className="search-box">
              <span>搜尋</span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="找醫院、科別、藥名..."
              />
            </label>
          </div>

          {activeSection === "overview" && (
            <OverviewView
              nextAppointment={nextAppointment}
              urgentItems={urgentItems}
              medications={medications}
              checklistItems={checklistItems}
              onOpenCalendar={() => setActiveSection("calendar")}
              onUpload={() => fileInputRef.current?.click()}
            />
          )}

          {activeSection === "calendar" && (
            <CalendarView appointments={appointments} />
          )}

          {activeSection === "meds" && (
            <MedicationView medications={medications} />
          )}

          {activeSection === "records" && (
            <RecordsView records={records} />
          )}

          {activeSection === "settings" && (
            <SettingsView
              patient={patient}
              identity={identity}
              isPersonalMode={isPersonalMode}
              careProfiles={careProfiles}
              selectedProfile={selectedProfile}
              onGroupChange={() => loadDashboard(identity, activeProfileId)}
            />
          )}
        </section>
      </section>
    </main>
  );
}

function ProfileSwitcher({ profiles, activeProfileId, onChange }) {
  if (!profiles.length) {
    return (
      <div className="profile-switcher empty">
        <p className="panel-eyebrow">正在看的資料</p>
        <strong>親愛的爸爸 / 媽媽</strong>
        <span>之後可加入爸爸、媽媽、阿公、阿嬤或自己的資料。</span>
      </div>
    );
  }

  return (
    <div className="profile-switcher">
      <p className="panel-eyebrow">正在看的資料</p>
      <div className="profile-options" role="listbox" aria-label="切換照護對象">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className={profile.id === activeProfileId ? "profile-option active" : "profile-option"}
            onClick={() => onChange(profile.id)}
          >
            {profile.display_name}
          </button>
        ))}
      </div>
    </div>
  );
}

function OverviewView({ nextAppointment, urgentItems, medications, checklistItems, onOpenCalendar, onUpload }) {
  return (
    <div className="overview-grid">
      <section className="summary-panel next-panel">
        <p className="panel-eyebrow">下一件要記得的事</p>
        {nextAppointment ? (
          <>
            <div className="date-badge">{formatDateLabel(nextAppointment.date)}</div>
            <h3>{nextAppointment.department}</h3>
            <p>{[nextAppointment.time, nextAppointment.hospital, nextAppointment.doctor && `${nextAppointment.doctor}醫師`].filter(Boolean).join(" ｜ ")}</p>
            {nextAppointment.location && <p className="location-line">地點：{nextAppointment.location}</p>}
            {nextAppointment.reminder_text && <p className="soft-note">{nextAppointment.reminder_text}</p>}
          </>
        ) : (
          <p className="empty-state">目前沒有新的看診或領藥提醒。</p>
        )}
        <button type="button" className="inline-action" onClick={onOpenCalendar}>看全部日曆</button>
      </section>

      <section className="summary-panel">
        <p className="panel-eyebrow">今天先看這幾件</p>
        <ul className="check-list">
          {checklistItems.slice(0, 4).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="summary-panel">
        <p className="panel-eyebrow">需要多留意</p>
        <div className="attention-list">
          {urgentItems.length ? urgentItems.map((item) => (
            <article key={item.id} className="attention-item">
              <strong>{typeLabel(item.type)}：{item.department}</strong>
              <span>{item.fasting_required ? `前 ${item.fasting_hours || 8} 小時先不要吃東西` : item.reminder_text || "照提醒做就好"}</span>
            </article>
          )) : <p className="empty-state">目前沒有特別要擔心的提醒。</p>}
        </div>
      </section>

      <section className="summary-panel">
        <p className="panel-eyebrow">常用功能</p>
        <div className="quick-actions">
          <button type="button" onClick={onUpload}>拍照放進來</button>
          <button type="button">找以前紀錄</button>
          <button type="button">記一件小提醒</button>
        </div>
        <p className="helper-copy">現在建議先用 LINE 傳照片。這裡的上傳功能會慢慢補齊。</p>
      </section>

      <section className="summary-panel wide-panel">
        <p className="panel-eyebrow">現在要吃的藥</p>
        <div className="medicine-strip">
          {medications.slice(0, 4).map((med) => (
            <article key={med.id} className="medicine-chip">
              <span style={{ backgroundColor: med.color }} />
              <div>
                <strong>{med.name}</strong>
                <p>{med.frequency}・{med.dosage}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function CalendarView({ appointments }) {
  return (
    <div className="calendar-layout">
      <section className="calendar-board" aria-label="月曆預覽">
        <div className="calendar-head">
          <strong>看診和領藥日曆</strong>
          <span>拍照後會自動整理</span>
        </div>
        <div className="calendar-weekdays">
          {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-days">
          {Array.from({ length: 35 }, (_, index) => {
            const day = index + 1;
            const hasEvent = appointments.some((apt) => apt.date?.endsWith(String(day).padStart(2, "0")));
            return (
              <button key={day} type="button" className={hasEvent ? "calendar-day has-event" : "calendar-day"}>
                {day}
              </button>
            );
          })}
        </div>
      </section>

      <section className="event-list" aria-label="看診和領藥清單">
        {appointments.length ? appointments.map((apt) => (
          <article key={apt.id} className="event-row">
            <div className="event-type">{typeIcon(apt.type)}</div>
            <div>
              <p className="event-date">{formatDateLabel(apt.date)} {apt.time}</p>
              <h3>{apt.department}</h3>
              <p>{[apt.hospital, apt.doctor && `${apt.doctor}醫師`, apt.number && `${apt.number}號`].filter(Boolean).join(" ｜ ")}</p>
              {apt.location && <p className="location-line">地點：{apt.location}</p>}
              {apt.notes && <p className="soft-note">{apt.notes}</p>}
            </div>
          </article>
        )) : <p className="empty-state">沒有找到符合的提醒。</p>}
      </section>
    </div>
  );
}

function MedicationView({ medications }) {
  return (
    <div className="medicine-grid">
      {medications.length ? medications.map((med) => (
        <article key={med.id} className="medicine-card">
          <span className="medicine-color" style={{ backgroundColor: med.color }} />
          <div>
            <h3>{med.name}</h3>
            <p>{med.purpose}</p>
            <dl>
              <div><dt>時間</dt><dd>{med.frequency}</dd></div>
              <div><dt>份量</dt><dd>{med.dosage}</dd></div>
              {med.warnings && <div><dt>注意</dt><dd>{med.warnings}</dd></div>}
            </dl>
          </div>
        </article>
      )) : <p className="empty-state">沒有找到符合的藥。</p>}
    </div>
  );
}

function RecordsView({ records }) {
  return (
    <div className="records-table" role="table" aria-label="看診紀錄">
      <div className="records-head" role="row">
        <span>日期</span>
        <span>類型</span>
        <span>內容</span>
        <span>整理狀態</span>
      </div>
      {records.length ? records.map((record) => (
        <article key={record.id} className="records-row" role="row">
          <span>{record.date || "還沒看到日期"}</span>
          <span>{typeLabel(record.type)}</span>
          <span>{record.department} {record.hospital && `｜${record.hospital}`}</span>
          <span>已整理</span>
        </article>
      )) : <p className="empty-state">還沒有可以看的紀錄。</p>}
    </div>
  );
}

function SettingsView({ patient, identity, isPersonalMode, careProfiles, selectedProfile, onGroupChange }) {
  return (
    <div className="settings-grid">
      <section className="summary-panel">
        <p className="panel-eyebrow">現在主要照顧誰</p>
        <div className="profile-form-preview">
          <img src={identity.profile?.pictureUrl || aiAvatar} alt="個人頭像" />
          <div>
            <label>稱呼</label>
            <strong>{selectedProfile?.display_name || patient.name || "親愛的爸爸 / 媽媽"}</strong>
            <label>LINE 狀態</label>
            <strong>{isPersonalMode ? "已用 LINE 登入" : "目前是範例畫面"}</strong>
          </div>
        </div>
      </section>

      <section className="summary-panel">
        <p className="panel-eyebrow">家裡有哪些資料</p>
        <div className="care-profile-list">
          {careProfiles.length ? careProfiles.map((profile) => (
            <article key={profile.id} className="care-profile-item">
              <strong>{profile.display_name}</strong>
              <span>{profile.is_default ? "主要照護對象" : "共同管理"}</span>
            </article>
          )) : (
            <p className="empty-state">登入後，可以先建立媽媽或爸爸的資料。</p>
          )}
        </div>
      </section>

      <section className="summary-panel">
        <GroupManager identity={identity} onGroupChange={onGroupChange} />
      </section>

      <section className="summary-panel">
        <GroupSettings identity={identity} onProfileCreated={onGroupChange} onGroupChange={onGroupChange} />
      </section>

      <section className="summary-panel">
        <p className="panel-eyebrow">家人要記得的事</p>
        <ul className="check-list">
          <li>哪些藥不能吃、以前有沒有過敏</li>
          <li>看診前要不要量血壓、空腹、帶健保卡</li>
          <li>緊急時要打給誰、常去哪家醫院</li>
        </ul>
      </section>

      <section className="summary-panel wide-panel">
        <p className="panel-eyebrow">之後會開放的功能</p>
        <div className="paid-feature-grid">
          {paidFeatureGroups.map((group) => (
            <article key={group.title} className="paid-feature">
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
