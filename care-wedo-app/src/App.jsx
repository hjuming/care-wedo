import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import GroupManager from "./components/GroupManager";
import GroupSettings from "./components/GroupSettings";
import LoginSetup from "./components/LoginSetup";
import MobileBottomNav from "./components/MobileBottomNav";
import OcrResult from "./components/OcrResult";
import { patientData, medicines, timeline as initialTimeline } from "./data/patient";
import { confirmOcrDocument, createAppointment, fetchDashboard, joinGroup, markMedicationSlotStatus, ocrAnalyze, patchAppointment, patchMedication, updateActiveProfilePreference, updateFamilyNotes, updateProfile, updateProfileOrder } from "./services/api";
import { buildLiffEntryUrl, initLineIdentity, loginWithLine, logoutLineIdentity, resetCareWedoSessionAndReturnHome, shouldOpenLiffEntryUrl } from "./services/liff";
import { trackError, trackEvent } from "./services/telemetry";
import { buildTodayTasks, formatTaipeiTodayLabel, groupMedicationsBySchedule, hasSameDayTasks } from "./services/todayTasks";
import { buildSearchSuggestions, matchSearch } from "./services/search";
import PrivacyPage from "./components/PrivacyPage";
import TermsPage from "./components/TermsPage";
import aiAvatar from "./assets/ai-avatar.png";
import { isLineCallbackSearch, resolveCareWedoRoute, resolveInitialCareWedoRoute } from "./routing";


const IS_PROD = import.meta.env.PROD;

function todayInTaipei() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function buildAskFamilyMessage(task, careName) {
  if (task?.kind === "medication") {
    return `${careName} 忘記剛剛有沒有吃藥，請幫忙確認。先不要讓 ${careName} 重複吃藥。\n\n藥品：${task.title}\n時間：${task.time}\n內容：${[task.subtitle, task.detail].filter(Boolean).join("；") || "請協助查看這筆吃藥說明。"}`;
  }

  if (task?.kind === "appointment") {
    return `${careName} 正在準備看診，請幫忙確認時間、醫院和要帶的東西。\n\n時間：${task.time}\n內容：${[task.title, task.subtitle, task.detail].filter(Boolean).join("；") || "請協助查看這筆看診提醒。"}`;
  }

  if (task) {
    return `${careName} 正在看 Care WEDO 的「${task.title}」提醒，但看不太懂，需要家人協助確認。\n\n時間：${task.time}\n內容：${[task.subtitle, task.detail].filter(Boolean).join("；") || "請協助查看這筆照護提醒。"}`;
  }

  return `${careName} 正在看 Care WEDO 今日照護，但看不太懂，需要家人協助確認。`;
}

function isDateTodayOrFuture(dateValue, today = todayInTaipei()) {
  if (!dateValue) return false;
  const dateText = String(dateValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return false;
  return dateText >= String(today);
}

function calculateAge(profile) {
  const birthDate = profile?.birth_date;
  const birthYear = profile?.birth_year;
  const today = new Date(`${todayInTaipei()}T00:00:00+08:00`);

  if (birthDate) {
    const date = new Date(`${birthDate}T00:00:00+08:00`);
    if (!Number.isNaN(date.getTime())) {
      let age = today.getFullYear() - date.getFullYear();
      const monthDelta = today.getMonth() - date.getMonth();
      if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) age -= 1;
      return age > 0 ? `${age} 歲` : "";
    }
  }

  const year = Number(birthYear);
  if (Number.isFinite(year) && year > 1900) {
    return `${today.getFullYear() - year} 歲`;
  }
  return "";
}

const SECTIONS = [
  { id: "overview", label: "今日照護", mobileLabel: "今天", icon: "⌂", color: "#315F68" },
  { id: "calendar", label: "未來行程", mobileLabel: "未來", icon: "□", color: "#5E8F9A" },
  { id: "records", label: "查詢紀錄", mobileLabel: "查詢", icon: "≡", color: "#B97832" },
  { id: "meds", label: "吃藥紀錄", mobileLabel: "吃藥", icon: "○", color: "#4F7D5A" },
  { id: "settings", label: "家人協作", mobileLabel: "家人", icon: "⚙", color: "#315F68" },
];

const MOBILE_SECTIONS = [
  { id: "overview", label: "今日照護", mobileLabel: "今天", icon: "⌂" },
  { id: "calendar", label: "未來行程", mobileLabel: "未來", icon: "□" },
  { id: "records", label: "查詢紀錄", mobileLabel: "查詢", icon: "≡" },
  { id: "meds", label: "吃藥紀錄", mobileLabel: "吃藥", icon: "○" },
  { id: "settings", label: "家人協作", mobileLabel: "家人", icon: "⚙" },
];

function typeLabel(type) {
  if (type === "family_note") return "家庭提醒";
  if (type === "inspection") return "檢查";
  if (type === "refill_reminder") return "領藥";
  if (type === "medication") return "用藥";
  if (type === "measurement") return "量測";
  if (type === "document") return "文件";
  if (type === "rehab") return "復健";
  if (type === "exercise") return "運動";
  if (type === "other") return "其他";
  if (type === "reminder") return "提醒";
  return "回診";
}

function typeIcon(type) {
  if (type === "family_note") return "家";
  if (type === "inspection") return "驗";
  if (type === "refill_reminder") return "藥";
  if (type === "medication") return "服";
  if (type === "measurement") return "量";
  if (type === "document") return "文";
  if (type === "rehab") return "復";
  if (type === "exercise") return "動";
  if (type === "other") return "他";
  if (type === "reminder") return "醒";
  return "診";
}

const REMINDER_TYPE_OPTIONS = [
  { value: "clinic_visit", label: "門診" },
  { value: "inspection", label: "檢查" },
  { value: "refill_reminder", label: "領藥" },
  { value: "rehab", label: "復健" },
  { value: "exercise", label: "運動" },
  { value: "other", label: "其他" },
];

function normalizeManualReminderType(type) {
  return REMINDER_TYPE_OPTIONS.some((option) => option.value === type) ? type : "other";
}

function addDaysInTaipei(days) {
  const date = new Date(`${todayInTaipei()}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function addMonthsInTaipei(months) {
  const date = new Date(`${todayInTaipei()}T00:00:00+08:00`);
  date.setMonth(date.getMonth() + months);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function normalizeDateInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return text;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function formatDateLabel(value, time = "") {
  if (!value) return "日期待確認";
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const dayName = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  
  const base = `${yyyy}/${mm}/${dd} (${dayName})`;
  return time ? `${base} ${time}` : base;
}

function normalizeAppointment(apt, index) {
  return {
    id: apt.id || `demo-${index}`,
    group_id: apt.group_id || null,
    profile_id: apt.profile_id || null,
    type: apt.type || (apt.label?.includes("領藥") ? "refill_reminder" : "clinic_visit"),
    date: apt.date || "",
    time: apt.time || "",
    title: apt.title || "",
    hospital: apt.hospital || "",
    department: apt.department || apt.label || "看診安排",
    doctor: apt.doctor || "",
    number: apt.number || "",
    location: apt.location || "",
    notes: apt.notes || "",
    reminder_text: apt.reminder_text || apt.desc || "",
    fasting_required: Boolean(apt.fasting_required || apt.urgent),
    fasting_hours: apt.fasting_hours || null,
    status: apt.status || "upcoming",
  };
}

function normalizeMedication(med, index) {
  return {
    id: med.id || `demo-med-${index}`,
    group_id: med.group_id || null,
    profile_id: med.profile_id || null,
    name: med.name || "藥物名稱待確認",
    purpose: med.purpose || med.use || "這顆藥的用途待確認",
    frequency: med.frequency || med.freq || "照單子上的時間吃",
    dosage: med.dosage || med.qty || "份量待確認",
    warnings: med.warnings || "",
    reminder_text: med.reminder_text || "",
    time_slot: med.time_slot || "",
    meal_timing: med.meal_timing || "",
    scheduled_time: med.scheduled_time || "",
    taken_status: med.taken_status || "",
    taken_date: med.taken_date || "",
    taken_slots: Array.isArray(med.taken_slots) ? med.taken_slots : [],
    active: med.active !== false,
    color: med.color || ["#b7791f", "#2f855a", "#2b6cb0", "#805ad5"][index % 4],
  };
}

function dashboardHasCareData(data) {
  return Boolean((data?.appointments?.length || 0) + (data?.medications?.length || 0) + (data?.checklist?.length || 0));
}

function sameRecordId(left, right) {
  return String(left || "") === String(right || "");
}

function belongsToActiveCareScope(record, profileId, groupId) {
  if (!record) return false;
  if (profileId) {
    return sameRecordId(record.profile_id, profileId);
  }
  if (groupId) {
    return sameRecordId(record.group_id, groupId);
  }
  return true;
}

function mergeDashboardShell(profileData, shellData) {
  if (!profileData || !shellData) return profileData || shellData;
  return {
    ...profileData,
    mode: shellData.mode || profileData.mode,
    plan: shellData.plan ?? profileData.plan,
    ocr_used: shellData.ocr_used ?? profileData.ocr_used,
    ocr_limit: shellData.ocr_limit ?? profileData.ocr_limit,
    care_profiles: shellData.care_profiles?.length ? shellData.care_profiles : profileData.care_profiles,
  };
}

const AVATAR_MAX_SOURCE_SIZE = 5 * 1024 * 1024;
const AVATAR_CANVAS_SIZE = 480;
const CARE_WEDO_LINE_URL = "https://lin.ee/xzbyyvf";
const CARE_WEDO_APP_ICON = "/android-chrome-512x512.png";

function setAvatarName(avatarUrl, name) {
  if (!avatarUrl) return "";
  const cleanName = encodeURIComponent((name || "照護對象頭像").trim().slice(0, 80));
  const withoutName = avatarUrl.replace(/^data:([^;,]+);name=[^;]+(;base64,)/, "data:$1$2");
  return withoutName.replace(/^data:([^;,]+)(;base64,)/, `data:$1;name=${cleanName}$2`);
}

function getCareTodayTitle(profile, fallbackName = "照護對象") {
  const relationship = profile?.relationship;
  const name = profile?.display_name || fallbackName;
  if (relationship === "self") return "我的今日照護";
  if (relationship === "father") return "爸爸的今日照護";
  if (relationship === "mother") return "媽媽的今日照護";
  return `${name}的今日照護`;
}

function getInitial(name = "家") {
  return name.trim().charAt(0) || "家";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("無法讀取圖片檔案"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片格式無法處理"));
    image.src = src;
  });
}

async function prepareAvatarDataUrl(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("請上傳 JPG、PNG 或 WebP 圖片。");
  }
  if (file.size > AVATAR_MAX_SOURCE_SIZE) {
    throw new Error("頭像原始檔不可超過 5MB。");
  }

  const sourceUrl = await fileToDataUrl(file);
  const image = await loadImage(sourceUrl);
  const scale = Math.min(AVATAR_CANVAS_SIZE / image.width, AVATAR_CANVAS_SIZE / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);

  return setAvatarName(canvas.toDataURL("image/jpeg", 0.84), file.name.replace(/\.[^.]+$/, ""));
}

const LANDING_PROBLEMS = [
  {
    title: "提醒散在不同地方",
    copy: "回診、抽血、領藥、帶卡、空腹，常常靠家人各自記，忙起來就容易漏。",
  },
  {
    title: "醫療資料很難回頭找",
    copy: "藥袋、處方箋、檢查單與照片分散在 LINE、相簿和紙本裡，下一次看診又重新整理一次。",
  },
  {
    title: "照護責任集中在一個人身上",
    copy: "誰提醒了、誰陪診了、誰知道最新狀況，家人之間沒有同一份清楚紀錄。",
  },
];

const LANDING_SOLUTIONS = [
  "拍照解析看診單、藥袋與檢查提醒",
  "整理回診、用藥、領藥與空腹注意事項",
  "建立長輩健康時間線，方便家人回顧",
  "登入後建立家庭群組，共享照護進度",
];

const LANDING_WORKFLOW = [
  {
    step: "01",
    title: "用 LINE 登入",
    copy: "不用另外記帳號密碼，家人點一下就能開始建立照護空間。",
  },
  {
    step: "02",
    title: "拍照或手動新增",
    copy: "看診單、處方箋、檢查提醒與家人交代事項都能整理成卡片。",
  },
  {
    step: "03",
    title: "家人一起照顧",
    copy: "家庭群組同步今日照護、未來行程與每日提醒。",
  },
];

const LANDING_PAGE_ENTRIES = [
  {
    title: "功能導覽",
    copy: "了解 Care WEDO 如何整理門診、檢查、領藥與家庭提醒。",
    href: "#features",
  },
  {
    title: "方案比較",
    copy: "先用 LINE 體驗，需要長期保存時再建立家庭照護空間。",
    href: "#plans",
  },
  {
    title: "隱私與條款",
    copy: "查看資料使用方式、LINE 登入與照護紀錄保存原則。",
    href: "/privacy",
  },
];

const FREE_FEATURES = [
  ["LINE 對話使用", true, true],
  ["圖片 AI 解析", "每月有限次數", "較高額度"],
  ["看診單重點摘要", true, true],
  ["用藥資訊整理", "基礎摘要", "完整保存"],
  ["長期記憶", false, true],
  ["家庭群組共享", false, true],
  ["多位照護對象", false, true],
  ["健康時間線", false, true],
  ["管理頁 Dashboard", false, true],
];

const LANDING_FAQS = [
  {
    question: "Care WEDO 可以診斷疾病嗎？",
    answer: "不可以。Care WEDO 是照護資訊整理與提醒工具，不取代醫師診斷、藥師建議或正式醫療判斷。",
  },
  {
    question: "免費版和收費版差在哪？",
    answer: "免費版適合先透過 LINE 體驗圖片摘要與對話提醒；收費版適合長期照護，提供記憶、家庭群組、照護對象與健康時間線。",
  },
  {
    question: "長輩一定要會用系統嗎？",
    answer: "不一定。家人可以負責建立資料與管理提醒，長輩只需要透過熟悉的 LINE 接收重點訊息。",
  },
  {
    question: "圖片和紀錄會被保存嗎？",
    answer: "免費版以對話體驗為主，不提供完整長期記憶；登入後的收費版才會把照護資料保存為家庭可管理的紀錄。",
  },
];

function FeatureValue({ value }) {
  if (value === true) return <span className="feature-yes">有</span>;
  if (value === false) return <span className="feature-no">無</span>;
  return <span>{value}</span>;
}

function LineIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.494.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
    </svg>
  );
}

function LineLoginAction({ className = "", loggingIn = false, label = "用 LINE 登入", loadingLabel = "正在開啟 LINE...", onLogin }) {
  function handleClick(event) {
    if (loggingIn) {
      event.preventDefault();
      return;
    }
    if (!shouldOpenLiffEntryUrl()) {
      event.preventDefault();
      onLogin?.();
    }
  }

  return (
    <a
      className={`line-login-btn ${className}`.trim()}
      href={buildLiffEntryUrl()}
      onClick={handleClick}
      aria-disabled={loggingIn ? "true" : undefined}
    >
      <LineIcon />
      {loggingIn ? loadingLabel : label}
    </a>
  );
}

function LandingPage() {
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);

  async function handleLineLogin() {
    setLoggingIn(true);
    setLoginError(null);
    try {
      await loginWithLine();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "登入失敗，請重試。");
      setLoggingIn(false);
    }
  }

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Care WEDO 入口導覽">
        <a href="/" className="brand-home">Care WEDO</a>
        <div className="landing-nav-links">
          <a href="#features">功能</a>
          <a href="#plans">方案</a>
          <a href="#faq">FAQ</a>
          <a href="/privacy">隱私</a>
          <button type="button" className="nav-login-link nav-login-button" onClick={handleLineLogin} disabled={loggingIn}>
            {loggingIn ? "開啟 LINE..." : "用 LINE 登入"}
          </button>
        </div>
      </nav>

      <section className="landing-hero" aria-label="Care WEDO 首頁">
        <div className="landing-hero-copy">
          <span className="landing-version">長輩友善健康管理平台</span>
          <h1>
            <span>Care WEDO</span>
            <span>把家人的照護提醒</span>
            <span>整理清楚。</span>
          </h1>
          <p>
            拍下看診單、處方箋或檢查單，Care WEDO 會協助整理成今日照護、未來行程、吃藥紀錄與家庭提醒，讓家人一起照顧不慌亂。
          </p>
          <div className="landing-cta-row">
            <LineLoginAction className="landing-line-login" loggingIn={loggingIn} label="用 LINE 登入開始" onLogin={handleLineLogin} />
            <a className="secondary-action" href="#features">先看功能導覽</a>
          </div>
          {loginError && <p className="notice-danger landing-login-error">{loginError}</p>}
          <p className="landing-trust-copy">AI 協助整理，家人安心陪伴。不取代醫師，也不取代家人。</p>
        </div>
        <div className="landing-hero-panel" aria-label="照護重點預覽">
          <div className="care-note-card primary-note">
            <span>今日照護</span>
            <strong>下午 3:20 回診</strong>
            <p>記得帶健保卡、慢箋與近期檢查單。</p>
          </div>
          <div className="care-note-card">
            <span>AI 整理</span>
            <strong>藥袋照片已摘要</strong>
            <p>用藥時間、注意事項、領藥日會整理成清單。</p>
          </div>
          <div className="family-sync-card">
            <strong>家人同步</strong>
            <p>主要照護者與家人都看同一份照護紀錄。</p>
          </div>
        </div>
      </section>

      <section className="landing-section landing-entry-section" aria-label="快速入口">
        <div className="section-kicker">網站入口</div>
        <h2>第一次來，可以從這裡開始。</h2>
        <div className="landing-entry-grid">
          {LANDING_PAGE_ENTRIES.map((item) => (
            <a key={item.title} href={item.href} className="landing-entry-card">
              <strong>{item.title}</strong>
              <span>{item.copy}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="landing-section" id="features">
        <div className="section-kicker">照護痛點</div>
        <h2>照顧長輩，最累的常常不是事情本身。</h2>
        <div className="landing-card-grid">
          {LANDING_PROBLEMS.map((item) => (
            <article key={item.title} className="landing-card">
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section solution-band">
        <div>
          <div className="section-kicker">Care WEDO 的角色</div>
          <h2>把照護資訊整理成家人看得懂的日常清單。</h2>
          <p>
            AI 負責協助分類、摘要與提醒；家人保留判斷與陪伴。Care WEDO 讓資訊更清楚，讓照護不再只靠一個人硬撐。
          </p>
        </div>
        <ul className="solution-list">
          {LANDING_SOLUTIONS.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="landing-section workflow-section" aria-label="使用流程">
        <div className="section-kicker">使用流程</div>
        <h2>從登入到共同照護，盡量少步驟。</h2>
        <div className="workflow-grid">
          {LANDING_WORKFLOW.map((item) => (
            <article key={item.step} className="workflow-card">
              <span>{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section plan-section" id="plans">
        <div className="section-kicker">免費與收費</div>
        <h2>先用 LINE 試試，需要長期管理時再建立家庭照護空間。</h2>
        <div className="plan-cards">
          <article className="plan-card">
            <span>免費版</span>
            <h3>LINE 照護小管家</h3>
            <p>適合第一次體驗，透過 LINE 傳送看診單或藥袋照片，讓 AI 協助整理重點。</p>
            <a href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer">加入 LINE 小管家</a>
          </article>
          <article className="plan-card featured-plan">
            <span>收費版</span>
            <h3>家庭照護空間</h3>
            <p>適合長期照顧父母、長輩或慢性病家人的家庭，登入後可保存、共享、追蹤照護紀錄。</p>
            <LineLoginAction loggingIn={loggingIn} label="用 LINE 登入建立" onLogin={handleLineLogin} />
          </article>
        </div>

        <div className="feature-table" role="table" aria-label="Care WEDO 免費版與收費版功能對照">
          <div className="feature-row table-head" role="row">
            <strong>功能</strong>
            <strong>免費版</strong>
            <strong>收費版</strong>
          </div>
          {FREE_FEATURES.map(([feature, free, paid]) => (
            <div className="feature-row" role="row" key={feature}>
              <span>{feature}</span>
              <FeatureValue value={free} />
              <FeatureValue value={paid} />
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section belief-section">
        <h2>科技不該讓照護變冷。</h2>
        <p>
          Care WEDO 相信，AI 最好的角色不是取代醫師，也不是取代家人，而是幫家庭把重要資訊整理清楚，讓陪伴少一點慌亂，多一點安心。
        </p>
      </section>

      <section className="landing-section faq-section" id="faq">
        <div className="section-kicker">常見問題</div>
        <h2>開始使用前，你可能會想知道</h2>
        <div className="faq-list">
          {LANDING_FAQS.map((item) => (
            <details key={item.question} className="faq-item">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-brand">
          <a href="https://care.wedopr.com/" className="footer-brand-link">Care WEDO</a>
          <span>讓照護資訊更清楚，讓家庭陪伴更安心。</span>
        </div>
        <div className="landing-footer-links">
          <a href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer">LINE 照護小管家</a>
          <a href="/login">登入</a>
          <a href="/privacy">隱私政策</a>
          <a href="/terms">服務條款</a>
          <a href="mailto:care@wedopr.com">care@wedopr.com</a>
        </div>
        <p className="footer-copyright">© {new Date().getFullYear()} Care WEDO. All rights reserved.</p>
      </footer>
    </main>
  );
}

function LoginPage() {
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const inviteCode = new URLSearchParams(window.location.search).get("invite_code");

  useEffect(() => {
    if (inviteCode) {
      window.localStorage.setItem("care_wedo_pending_invite_code", inviteCode);
    }
  }, [inviteCode]);

  async function handleLineLogin() {
    setLoggingIn(true);
    setLoginError(null);
    try {
      await loginWithLine();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "登入失敗，請重試。");
      setLoggingIn(false);
    }
  }

  return (
    <main className="login-route-shell">
      <nav className="landing-nav login-route-nav" aria-label="Care WEDO 登入導覽">
        <a href="/" className="brand-home">Care WEDO</a>
        <a href="/features" className="nav-login-link">功能說明</a>
      </nav>

      <section className="login-route-card login-route-card-simple" aria-label="登入 Care WEDO">
        <div className="login-route-copy">
          <span className="landing-version">Care WEDO</span>
          <h1>幫家人記住看診、檢查、領藥與照護提醒。</h1>
          <p>
            使用 LINE 登入後，就可以查看今日照護事項。
          </p>
          {inviteCode && (
            <p className="helper-copy">登入後會自動加入家庭群組，邀請碼：{inviteCode}</p>
          )}

          {loginError && (
            <p className="notice-danger" style={{ marginTop: "12px", fontSize: "15px" }}>
              {loginError}
            </p>
          )}

          <div className="login-route-actions">
            <LineLoginAction loggingIn={loggingIn} onLogin={handleLineLogin} />
            <a
              className="login-alt-link"
              href="https://lin.ee/xzbyyvf"
              target="_blank"
              rel="noopener noreferrer"
            >
              還沒加入照護小管家？先加入 →
            </a>
          </div>
        </div>

        <div className="login-route-quick-note" aria-label="登入後可以做的事">
          <strong>登入後看今日照護</strong>
          <p>門診、檢查、領藥或提醒，一打開就看得到。</p>
        </div>
      </section>

      <footer className="login-route-footer">
        <a href="/about">關於我們</a>
        <a href="/features">功能說明</a>
        <a href="/privacy">隱私權政策</a>
      </footer>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState(() => {
    // LINE OAuth callback URL must remain untouched until liff.init() completes.
    // We only route the SPA view to /app here; URL cleanup happens after LIFF init.
    return resolveInitialCareWedoRoute(window.location.pathname, window.location.search);
  });

  useEffect(() => {
    // 處理瀏覽器上一頁/下一頁
    const handlePopState = () => setRoute(resolveCareWedoRoute(window.location.pathname));
    window.addEventListener("popstate", handlePopState);

    // 攔截所有內部 <a> 點擊，改用 pushState 客戶端導航
    // 不攔截：外部連結、mailto、tel、hash 錨點、target="_blank"
    const handleClick = (e) => {
      const anchor = e.target.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("http") ||
        href.startsWith("mailto") ||
        href.startsWith("tel") ||
        href.startsWith("#") ||
        anchor.target === "_blank"
      ) return;
      e.preventDefault();
      window.history.pushState(null, "", href);
      setRoute(resolveCareWedoRoute(href));
    };
    document.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  if (route === "app") return <DashboardApp />;
  if (route === "login") return <LoginPage />;
  if (route === "privacy") return <PrivacyPage />;
  if (route === "terms") return <TermsPage />;
  return <LandingPage />;
}

function DashboardApp() {
  const fileInputRef = useRef(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [ocrData, setOcrData] = useState(null);
  const [ocrError, setOcrError] = useState(null);
  const [showUploadGuide, setShowUploadGuide] = useState(false);
  const [scanStep, setScanStep] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardError, setDashboardError] = useState(null);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [identity, setIdentity] = useState({ status: "loading", idToken: null, profile: null, message: null });
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showManualReminder, setShowManualReminder] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState(null);
  const [showFamilyNotesEditor, setShowFamilyNotesEditor] = useState(false);
  const [familyHelpDraft, setFamilyHelpDraft] = useState(null);
  const [familyNotes, setFamilyNotes] = useState([]);
  const dashboardRequestSeqRef = useRef(0);
  const dashboardCacheRef = useRef(new Map());
  const dashboardShellRef = useRef(null);

  const loadDashboard = useCallback(async (lineIdentity, profileId = null, groupId = null) => {
    const requestSeq = dashboardRequestSeqRef.current + 1;
    dashboardRequestSeqRef.current = requestSeq;

    try {
      const data = await fetchDashboard({ idToken: lineIdentity?.idToken, profileId, groupId });
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return data;
      }

      // Production: demo payload is only valid in dev. Reset stale auth state if received unexpectedly.
      if (IS_PROD && data?.mode === "demo") {
        await resetCareWedoSessionAndReturnHome();
        return null;
      }

      const resolvedProfileId = data.active_profile_id || profileId || null;
      const resolvedGroupId = data.active_group_id || groupId || null;
      const resolvedCacheKey = `${resolvedGroupId || "default"}:${resolvedProfileId || "default"}`;
      const nextData = data;

      dashboardShellRef.current = {
        ...(dashboardShellRef.current || {}),
        ...nextData,
        appointments: [],
        medications: [],
        checklist: [],
      };

      dashboardCacheRef.current.set(resolvedCacheKey, nextData);
      if (!profileId && !groupId) {
        dashboardCacheRef.current.set("default", nextData);
      }

      setDashboard(nextData);
      setDashboardError(null);
      if (nextData.active_group_id) {
        setActiveGroupId(nextData.active_group_id);
        window.localStorage.setItem("care_wedo_active_group_id", String(nextData.active_group_id));
      }
      if (resolvedProfileId) {
        setActiveProfileId(resolvedProfileId);
        window.localStorage.setItem("care_wedo_active_profile_id", String(resolvedProfileId));
      }
      return data;
    } catch (err) {
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return null;
      }
      // AUTH_REQUIRED or expired token in production → clear stale auth state and return home.
      if (IS_PROD && err.code === "AUTH_REQUIRED") {
        trackError("frontend.dashboard_auth_reset", err, { profileId, groupId });
        await resetCareWedoSessionAndReturnHome();
        return null;
      }
      trackError("frontend.dashboard", err, { profileId, groupId });
      setDashboardError(err.message);
      return null;
    }
  }, []);

  const updateActiveDashboard = useCallback((updater) => {
    setDashboard((prev) => {
      if (!prev) return prev;
      const next = typeof updater === "function" ? updater(prev) : updater;
      const cacheProfileId = next.active_profile_id || activeProfileId;
      const cacheGroupId = next.active_group_id || activeGroupId;
      if (cacheProfileId) {
        dashboardCacheRef.current.set(String(cacheProfileId), next);
        dashboardCacheRef.current.set(`${cacheGroupId || "default"}:${cacheProfileId}`, next);
      }
      return next;
    });
  }, [activeGroupId, activeProfileId]);

  async function handleProfileUpdate(updates) {
    if (!activeProfileId) {
      throw new Error("請先使用 LINE 登入並建立照護對象後再儲存。");
    }
    await updateProfile(activeProfileId, updates, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId, activeGroupId);
    setShowEditProfile(false);
  }

  async function handleProfileOrderChange(groupId, orderedProfileIds) {
    const sortOrderMap = new Map(orderedProfileIds.map((id, index) => [Number(id), (index + 1) * 10]));
    updateActiveDashboard((prev) => ({
      ...prev,
      care_profiles: (prev.care_profiles || []).map((profile) => (
        sortOrderMap.has(Number(profile.id)) ? { ...profile, sort_order: sortOrderMap.get(Number(profile.id)) } : profile
      )),
    }));

    if (!identity.idToken) return;

    try {
      await updateProfileOrder(orderedProfileIds, { idToken: identity.idToken });
      await loadDashboard(identity, activeProfileId, activeGroupId);
    } catch (err) {
      trackError("frontend.profile_order", err, { groupId });
      await loadDashboard(identity, activeProfileId, activeGroupId);
    }
  }

  function persistActiveProfilePreference(profileId) {
    if (!identity.idToken || !profileId) return;
    updateActiveProfilePreference(profileId, { idToken: identity.idToken })
      .catch((err) => trackError("frontend.active_profile_preference", err, { profileId }));
  }

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const lineIdentity = await initLineIdentity();
        if (!active || lineIdentity.status === "redirecting") return;

        // 登入閘門：unauthenticated 一律清掉舊狀態並回首頁
        if (lineIdentity.status === "unauthenticated") {
          if (!active) return;
          setIdentity(lineIdentity);
          await resetCareWedoSessionAndReturnHome();
          return;
        }

        // Production: demo identity must never be treated as valid
        if (IS_PROD && lineIdentity.status === "demo") {
          if (!active) return;
          await resetCareWedoSessionAndReturnHome();
          return;
        }

        setIdentity(lineIdentity);
        if (isLineCallbackSearch(window.location.search)) {
          window.history.replaceState(null, "", "/app");
        }
        const inviteCode = new URLSearchParams(window.location.search).get("invite_code")
          || window.localStorage.getItem("care_wedo_pending_invite_code");
        if (inviteCode && lineIdentity.idToken) {
          try {
            await joinGroup({ idToken: lineIdentity.idToken, code: inviteCode });
            window.localStorage.removeItem("care_wedo_pending_invite_code");
          } catch (err) {
            trackError("frontend.invite_join", err, {});
          }
        }

        const preferredProfileId = Number(window.localStorage.getItem("care_wedo_active_profile_id"));
        const preferredGroupId = Number(window.localStorage.getItem("care_wedo_active_group_id"));
        await loadDashboard(
          lineIdentity,
          Number.isFinite(preferredProfileId) && preferredProfileId > 0 ? preferredProfileId : null,
          Number.isFinite(preferredGroupId) && preferredGroupId > 0 ? preferredGroupId : null,
        );
      } catch (err) {
        if (!active) return;
        // 正式環境發生錯誤代表無法驗證身分，清掉舊狀態並回首頁
        if (import.meta.env.PROD) {
          setIdentity({
            status: "unauthenticated",
            idToken: null,
            profile: null,
            message: err instanceof Error ? err.message : "登入失敗，請重新嘗試。",
          });
          await resetCareWedoSessionAndReturnHome();
          return;
        }
        // 本機開發環境降級為 demo 模式
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

  useEffect(() => {
    if (!scanning) { setScanStep(null); return; }
    setScanStep(0);
    const t1 = setTimeout(() => setScanStep(1), 1200);
    const t2 = setTimeout(() => setScanStep(2), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [scanning]);

  const isPersonalMode = dashboard?.mode === "personal" || identity.status === "authenticated";
  const careProfiles = dashboard?.care_profiles || [];
  const groups = dashboard?.groups || [];
  const activeGroup = groups.find((group) => group.id === activeGroupId)
    || groups.find((group) => group.id === dashboard?.active_group_id)
    || null;
  const selectedProfile = careProfiles.find((profile) => profile.id === activeProfileId)
    || careProfiles.find((profile) => profile.group_id === activeGroupId)
    || careProfiles[0]
    || null;

  const patient = (isPersonalMode && dashboard) 
    ? { ...dashboard.patient, name: selectedProfile?.display_name || dashboard.patient.name, age: calculateAge(selectedProfile) } 
    : (dashboard?.patient?.name ? dashboard.patient : patientData);
  const allAppointments = useMemo(() => {
    let source = [];
    if (isPersonalMode && dashboard) {
      source = dashboard.appointments || [];
    } else {
      source = dashboard?.appointments?.length ? dashboard.appointments : initialTimeline;
    }
    return source
      .filter((item) => !isPersonalMode || belongsToActiveCareScope(item, activeProfileId, activeGroupId))
      .map(normalizeAppointment);
  }, [dashboard, isPersonalMode, activeProfileId, activeGroupId]);

  const appointments = useMemo(() => {
    return allAppointments.filter((item) => matchSearch(item, searchQuery));
  }, [allAppointments, searchQuery]);

  const allMedications = useMemo(() => {
    let source = [];
    if (isPersonalMode && dashboard) {
      source = dashboard.medications || [];
    } else {
      source = dashboard?.medications?.length ? dashboard.medications : medicines;
    }
    return source
      .filter((medication) => !isPersonalMode || belongsToActiveCareScope(medication, activeProfileId, activeGroupId))
      .map(normalizeMedication);
  }, [dashboard, isPersonalMode, activeProfileId, activeGroupId]);

  const medications = useMemo(() => {
    return allMedications.filter((item) => matchSearch(item, searchQuery));
  }, [allMedications, searchQuery]);

  const searchSuggestions = useMemo(() => {
    return buildSearchSuggestions([...allAppointments, ...allMedications]);
  }, [allAppointments, allMedications]);

  const nextAppointment = useMemo(() => {
    return appointments
      .filter(apt => apt.status !== "completed" && isDateTodayOrFuture(apt.date, todayInTaipei()))
      .sort((a, b) => {
        try {
          const dateA = new Date(a.date.includes("-") ? `${a.date}T${a.time || "00:00"}` : a.date);
          const dateB = new Date(b.date.includes("-") ? `${b.date}T${b.time || "00:00"}` : b.date);
          return dateA.getTime() - dateB.getTime();
        } catch {
          return 0;
        }
      })[0];
  }, [appointments]);

  const urgentItems = appointments.filter((item) => (item.fasting_required || item.type === "refill_reminder") && item.status !== "completed" && isDateTodayOrFuture(item.date, todayInTaipei())).slice(0, 3);
  const hasCareData = dashboardHasCareData(dashboard);
  const todayDate = todayInTaipei();
  const todayLabel = useMemo(() => formatTaipeiTodayLabel(todayDate), [todayDate]);
  const todayTasks = useMemo(() => buildTodayTasks({
    today: todayDate,
    appointments,
  }), [appointments, todayDate]);
  const hasTodayCareTasks = useMemo(() => hasSameDayTasks({
    today: todayDate,
    appointments,
  }), [appointments, todayDate]);
  const showContactDock = !IS_PROD || isPersonalMode;

  useEffect(() => {
    setFamilyNotes(dashboard?.family_notes || []);
  }, [dashboard?.active_group_id, dashboard?.family_notes]);

  async function handleFamilyNotesChange(notes) {
    const nextNotes = notes.map((item) => item.trim()).filter(Boolean);
    if (!activeGroupId) {
      setFamilyNotes(nextNotes);
      return;
    }
    await updateFamilyNotes({ idToken: identity.idToken, groupId: activeGroupId, notes: nextNotes });
    setFamilyNotes(nextNotes);
    await loadDashboard(identity, activeProfileId, activeGroupId);
  }

  function handleAskFamily(task = null) {
    const careName = selectedProfile?.display_name || patient.name || "家人";
    setFamilyHelpDraft({
      title: task?.title ? `問家人：${task.title}` : "問家人",
      message: buildAskFamilyMessage(task, careName),
    });
  }

  function handleMobileNavChange(sectionId) {
    if (sectionId === "upload") {
      handleUploadClick();
      return;
    }
    setActiveSection(sectionId);
  }

  async function handleComplete(aptId) {
    // Optimistic UI update
    updateActiveDashboard(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        appointments: prev.appointments.map(apt =>
          apt.id === aptId ? { ...apt, status: "completed" } : apt
        )
      };
    });

    // demo-prefixed IDs are local-only; skip API call
    if (String(aptId).startsWith("demo-")) return;

    try {
      await patchAppointment(aptId, { status: "completed" }, { idToken: identity.idToken });
    } catch (err) {
      console.error("Failed to complete task", err);
      // Rollback optimistic update on failure
      updateActiveDashboard(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          appointments: prev.appointments.map(apt =>
            apt.id === aptId ? { ...apt, status: "upcoming" } : apt
          )
        };
      });
    }
  }

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
        setOcrData({ data: result.data, saved: result.saved });
        await loadDashboard(identity, activeProfileId, activeGroupId);
      } else {
        setOcrError(result.error || "解析失敗");
      }
    } catch (err) {
      trackError("frontend.ocr", err, {
        fileCount: files.length,
        profileId: activeProfileId,
      });
      setOcrError(err.message);
    } finally {
      setScanning(false);
    }
  }

  function handleUploadChange(event) {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) handleFilesSelected(files);
    event.target.value = "";
  }

  function handleUploadClick() {
    setShowUploadGuide(true);
  }

  function handleUploadConfirm() {
    setShowUploadGuide(false);
    fileInputRef.current?.click();
  }

  async function handleOcrCorrectionsSave({ appointments: correctedAppointments = [], medications: correctedMedications = [] }) {
    const appointmentIds = ocrData?.saved?.appointment_ids || [];
    const medicationIds = ocrData?.saved?.medication_ids || [];
    const documentId = ocrData?.saved?.document_id;

    await Promise.all([
      ...correctedAppointments.map((apt, index) => {
        const id = appointmentIds[index];
        if (!id) return null;
        return patchAppointment(id, apt, { idToken: identity.idToken });
      }).filter(Boolean),
      ...correctedMedications.map((med, index) => {
        const id = medicationIds[index];
        if (!id) return null;
        return patchMedication(id, med, { idToken: identity.idToken });
      }).filter(Boolean),
    ]);

    if (documentId) {
      await confirmOcrDocument(documentId, { idToken: identity.idToken });
    }

    setOcrData((prev) => prev ? {
      ...prev,
      data: {
        ...prev.data,
        appointments: correctedAppointments,
        medications: correctedMedications,
      },
    } : prev);
    await loadDashboard(identity, activeProfileId, activeGroupId);
  }

  async function handleMedicationTaken(group, status) {
    updateActiveDashboard((prev) => ({
      ...prev,
      medications: (prev.medications || []).map((medication) => (
        group.medicationIds.includes(medication.id)
          ? {
              ...medication,
              taken_status: status,
              taken_date: todayInTaipei(),
              taken_slots: Array.from(new Set([...(medication.taken_slots || []), group.slot])),
            }
          : medication
      )),
    }));
    try {
      await markMedicationSlotStatus({
        medicationIds: group.medicationIds,
        status,
        idToken: identity.idToken,
        timeSlot: group.slot,
      });
      await loadDashboard(identity, activeProfileId, activeGroupId);
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      await loadDashboard(identity, activeProfileId, activeGroupId);
      throw err;
    }
  }

  async function handleMedicationDelete(medication) {
    if (!medication?.id || String(medication.id).startsWith("demo-med-")) return;

    updateActiveDashboard((prev) => ({
      ...prev,
      medications: (prev.medications || []).filter((item) => String(item.id) !== String(medication.id)),
    }));

    try {
      await patchMedication(medication.id, { active: false }, { idToken: identity.idToken });
      await loadDashboard(identity, activeProfileId, activeGroupId);
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      await loadDashboard(identity, activeProfileId, activeGroupId);
      throw err;
    }
  }

  async function handleMedicationUpdate(medication, updates) {
    if (!medication?.id || String(medication.id).startsWith("demo-med-")) return;

    updateActiveDashboard((prev) => ({
      ...prev,
      medications: (prev.medications || []).map((item) => (
        String(item.id) === String(medication.id) ? { ...item, ...updates } : item
      )),
    }));

    try {
      await patchMedication(medication.id, updates, { idToken: identity.idToken });
      await loadDashboard(identity, activeProfileId, activeGroupId);
    } catch (err) {
      if (err.code === "AUTH_REQUIRED") {
        await resetCareWedoSessionAndReturnHome();
        return;
      }
      await loadDashboard(identity, activeProfileId, activeGroupId);
      throw err;
    }
  }

  async function handleManualReminderSave(payload) {
    if (!activeProfileId) {
      throw new Error("請先選擇照護對象。");
    }
    await createAppointment({ ...payload, profile_id: activeProfileId }, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId, activeGroupId);
    setShowManualReminder(false);
  }

  function handleEditAppointment(appointmentOrId) {
    const appointment = typeof appointmentOrId === "object"
      ? appointmentOrId
      : appointments.find((apt) => String(apt.id) === String(appointmentOrId));
    if (!appointment) return;
    setEditingAppointment(appointment);
  }

  async function handleAppointmentUpdate(payload) {
    if (!editingAppointment?.id) {
      throw new Error("找不到要編輯的提醒。");
    }
    await patchAppointment(editingAppointment.id, {
      type: payload.type,
      date: payload.date || null,
      time: payload.time || null,
      title: payload.title || payload.department || payload.hospital || null,
      hospital: payload.hospital || null,
      department: payload.department || null,
      doctor: payload.doctor || null,
      location: payload.location || null,
      fasting_required: Boolean(payload.fasting_required),
      fasting_hours: payload.fasting_required ? payload.fasting_hours || 8 : null,
      notes: payload.notes || null,
      reminder_text: payload.notes || null,
      status: "upcoming",
    }, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId, activeGroupId);
    setEditingAppointment(null);
  }

  async function handleDeleteAppointment(appointment, options = {}) {
    if (!appointment?.id) return;
    if (!options.skipConfirm && !window.confirm("確定要刪除這筆行程或提醒嗎？刪除後首頁與未來行程不會再顯示。")) return;
    await patchAppointment(appointment.id, { status: "deleted" }, { idToken: identity.idToken });
    updateActiveDashboard((prev) => ({
      ...prev,
      appointments: (prev.appointments || []).filter((apt) => String(apt.id) !== String(appointment.id)),
    }));
    await loadDashboard(identity, activeProfileId, activeGroupId);
  }

  function handleProfileChange(profileId) {
    const profileGroupId = careProfiles.find((profile) => profile.id === profileId)?.group_id || activeGroupId;
    trackEvent("frontend.profile_switch", { profileId, groupId: profileGroupId });
    setActiveProfileId(profileId);
    persistActiveProfilePreference(profileId);
    if (profileGroupId) {
      setActiveGroupId(profileGroupId);
      window.localStorage.setItem("care_wedo_active_group_id", String(profileGroupId));
    }
    window.localStorage.setItem("care_wedo_active_profile_id", String(profileId));
    const cached = dashboardCacheRef.current.get(`${profileGroupId || "default"}:${profileId}`)
      || dashboardCacheRef.current.get(String(profileId));
    if (cached) {
      setDashboard(mergeDashboardShell(cached, dashboardShellRef.current));
      setDashboardError(null);
    }
    loadDashboard(identity, profileId, profileGroupId);
  }

  function handleGroupChange(groupId) {
    const groupProfile = careProfiles.find((profile) => profile.group_id === groupId);
    const nextProfileId = groupProfile?.id || null;
    trackEvent("frontend.group_switch", { groupId, profileId: nextProfileId });
    setActiveGroupId(groupId);
    setActiveProfileId(nextProfileId);
    window.localStorage.setItem("care_wedo_active_group_id", String(groupId));
    if (nextProfileId) {
      window.localStorage.setItem("care_wedo_active_profile_id", String(nextProfileId));
      persistActiveProfilePreference(nextProfileId);
    } else {
      window.localStorage.removeItem("care_wedo_active_profile_id");
    }
    const cached = dashboardCacheRef.current.get(`${groupId}:${nextProfileId || "default"}`);
    if (cached) {
      setDashboard(mergeDashboardShell(cached, dashboardShellRef.current));
      setDashboardError(null);
    }
    loadDashboard(identity, nextProfileId, groupId);
  }

  function handleSetupComplete() {
    // Reload dashboard after setup
    loadDashboard(identity, activeProfileId, activeGroupId);
  }

  // Production: show loading screen until auth is resolved, preventing demo data flash
  if (IS_PROD && identity.status === "loading") {
    return (
      <main className="care-shell">
        <div className="auth-loading-screen">
          <div className="auth-loading-spinner" />
          <p>正在確認登入狀態…</p>
        </div>
      </main>
    );
  }

  return (
    <>
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

      {scanning ? (
        <ScanProgress step={scanStep} />
      ) : (
        <>
          {(dashboardError || (!IS_PROD && identity.message) || ocrError) && (
            <section className="notice-stack" aria-live="polite">
              {dashboardError && <p>{IS_PROD ? "資料載入失敗，請重新整理頁面。" : "現在是範例畫面。"}</p>}
              {identity.message && !dashboardError && !IS_PROD && <p>{identity.message}</p>}
              {ocrError && <p className="notice-danger">{ocrError}</p>}
            </section>
          )}
          {ocrData && (
            <OcrResult
              data={ocrData}
              onClose={() => setOcrData(null)}
              onSaveCorrections={handleOcrCorrectionsSave}
              onAskFamily={handleAskFamily}
              onNavigate={(section) => {
                setOcrData(null);
                setActiveSection(section);
              }}
            />
          )}
        </>
      )}

      <section className="dashboard-grid">
        <aside className="side-rail" aria-label="健康小管家選單">
          <div className="profile-block">
            <img src={selectedProfile?.avatar_url || identity.profile?.pictureUrl || aiAvatar} alt="個人頭像" className="profile-avatar" />
            <div className="profile-info-main">
              <div className="profile-name-row">
                <p className="profile-name">{selectedProfile?.display_name || patient.name || "照護對象"}</p>
                <button type="button" className="btn-edit-inline" onClick={() => setShowEditProfile(true)}>✎</button>
              </div>
              <p className="profile-note">{patient.dept || "常看科別待補"}・{patient.age || "年齡待補"}</p>
              {selectedProfile?.notes && (
                <div className="profile-pinned-notes">
                  <strong>附註：</strong>
                  {selectedProfile.notes}
                </div>
              )}
            </div>
          </div>

          <ProfileSwitcher
            profiles={careProfiles}
            groups={groups}
            activeProfileId={activeProfileId}
            onChange={handleProfileChange}
            onReorder={handleProfileOrderChange}
          />

          <nav className="section-nav">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? "nav-item active" : "nav-item"}
                onClick={() => setActiveSection(section.id)}
                style={activeSection === section.id ? { "--item-color": section.color } : {}}
              >
                <span>{section.icon}</span>
                {section.label}
              </button>
            ))}
          </nav>

          {identity.status === "authenticated" && (
            <div className="side-rail-footer">
              <button type="button" className="btn-logout side-logout" onClick={logoutLineIdentity}>
                登出
              </button>
            </div>
          )}
        </aside>

        <section className="content-area" data-active-section={activeSection}>
          {activeSection !== "overview" && activeSection !== "settings" && (
            <div className="toolbar">
              <SectionHeading section={SECTIONS.find(s => s.id === activeSection)} />
              <SearchField
                value={searchQuery}
                onChange={setSearchQuery}
                suggestions={searchSuggestions}
                placeholder="找醫院、科別、藥名"
              />
            </div>
          )}

          {activeSection === "settings" && (
            <div className="toolbar">
              <SectionHeading section={SECTIONS.find(s => s.id === activeSection)} />
            </div>
          )}

          {activeSection === "overview" && (
            <OverviewView
              todayLabel={todayLabel}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              todayTasks={todayTasks}
              hasTodayCareTasks={hasTodayCareTasks}
              searchSuggestions={searchSuggestions}
              nextAppointment={nextAppointment}
              urgentItems={urgentItems}
              familyNotes={familyNotes}
              groups={groups}
              activeGroup={activeGroup}
              activeGroupId={activeGroupId}
              hasCareData={hasCareData}
              patient={patient}
              selectedProfile={selectedProfile}
              onOpenCalendar={() => setActiveSection("calendar")}
              onOpenRecords={() => setActiveSection("records")}
              onOpenMeds={() => setActiveSection("meds")}
              onOpenFamily={() => setActiveSection("settings")}
              onOpenProfile={() => setShowEditProfile(true)}
              onGroupChange={handleGroupChange}
              onEditFamilyNotes={() => setShowFamilyNotesEditor(true)}
              onUpload={handleUploadClick}
              onAddReminder={() => setShowManualReminder(true)}
              onEditAppointment={handleEditAppointment}
              onComplete={handleComplete}
              onAskFamily={handleAskFamily}
            />
          )}

          {activeSection === "calendar" && (
            <CalendarView
              appointments={appointments}
              onUpload={handleUploadClick}
              onAddReminder={() => setShowManualReminder(true)}
              onEditAppointment={handleEditAppointment}
            />
          )}

          {activeSection === "meds" && (
            <MedicationView
              medications={medications}
              onUpload={handleUploadClick}
              onTaken={handleMedicationTaken}
              onDeleteMedication={handleMedicationDelete}
              onUpdateMedication={handleMedicationUpdate}
            />
          )}

          {activeSection === "records" && (
            <RecordsView
              records={allAppointments}
              searchQuery={searchQuery}
              onUpload={handleUploadClick}
            />
          )}

          {activeSection === "settings" && (
            <SettingsView
              patient={patient}
              identity={identity}
              isPersonalMode={isPersonalMode}
              careProfiles={careProfiles}
              selectedProfile={selectedProfile}
              activeProfileId={activeProfileId}
              onProfileChange={handleProfileChange}
              onGroupChange={() => loadDashboard(identity, activeProfileId, activeGroupId)}
              onEditProfile={() => setShowEditProfile(true)}
              familyNotes={familyNotes}
              onFamilyNotesChange={handleFamilyNotesChange}
              onLogout={logoutLineIdentity}
            />
          )}
        </section>
      </section>

      {showEditProfile && (
        <ProfileEditModal
          profile={selectedProfile}
          onClose={() => setShowEditProfile(false)}
          onSave={handleProfileUpdate}
          canPersist={Boolean(activeProfileId)}
        />
      )}

      {showUploadGuide && (
        <UploadGuide
          onConfirm={handleUploadConfirm}
          onClose={() => setShowUploadGuide(false)}
        />
      )}

      {showManualReminder && (
        <ManualReminderModal
          onClose={() => setShowManualReminder(false)}
          onSave={handleManualReminderSave}
        />
      )}

      {showFamilyNotesEditor && (
        <FamilyNotesModal
          groupName={activeGroup?.name || dashboard?.active_group_name || "家庭群組"}
          notes={familyNotes}
          onClose={() => setShowFamilyNotesEditor(false)}
          onSave={handleFamilyNotesChange}
        />
      )}

      {familyHelpDraft && (
        <AskFamilyModal
          title={familyHelpDraft.title}
          initialMessage={familyHelpDraft.message}
          onClose={() => setFamilyHelpDraft(null)}
        />
      )}

      {editingAppointment && (
        <ManualReminderModal
          mode="edit"
          initialAppointment={editingAppointment}
          onClose={() => setEditingAppointment(null)}
          onSave={handleAppointmentUpdate}
          onDelete={async () => {
            await handleDeleteAppointment(editingAppointment, { skipConfirm: true });
            setEditingAppointment(null);
          }}
        />
      )}

      <MobileBottomNav
        sections={MOBILE_SECTIONS}
        activeSection={activeSection}
        onChange={handleMobileNavChange}
      />
    </main>
    {showContactDock && (
      <GlobalCareContactDock
        botContact={{
          label: "小管家",
          avatarUrl: CARE_WEDO_APP_ICON,
          lineUrl: CARE_WEDO_LINE_URL,
          available: true,
        }}
        collaborators={dashboard?.collaborators || dashboard?.members || []}
        context={activeSection}
        onAskFamily={handleAskFamily}
      />
    )}
    </>
  );
}

function ProfileEditModal({ profile, onClose, onSave, canPersist }) {
  const [formData, setFormData] = useState({
    display_name: profile?.display_name || "",
    avatar_url: profile?.avatar_url || "",
    birth_date: profile?.birth_date || "",
    emergency_phone: profile?.emergency_phone || "",
    email: profile?.email || "",
    notes: profile?.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleAvatarUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const avatarUrl = await prepareAvatarDataUrl(file);
      setFormData((current) => ({ ...current, avatar_url: setAvatarName(avatarUrl, file.name.replace(/\.[^.]+$/, "") || "照護對象頭像") }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...formData,
        avatar_url: formData.avatar_url || null,
        birth_date: formData.birth_date || null,
        emergency_phone: formData.emergency_phone || null,
        email: formData.email || null,
      });
    } catch (err) {
      setError(err.message || "無法儲存修改");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content profile-edit-modal">
        <div className="modal-header">
          <h2>修改照護對象資訊</h2>
          <button type="button" onClick={onClose} className="btn-close">✕</button>
        </div>
        <div className="modal-body">
          {!canPersist && (
            <p className="error-msg">{IS_PROD ? "請先重新登入 LINE，才能儲存修改。" : "目前是範例畫面。請先從 LINE 登入並建立照護對象，才能把修改存進資料庫。"}</p>
          )}
          {error && <p className="error-msg">{error}</p>}

          <div className="form-group">
            <label>顯示名稱</label>
            <input 
              value={formData.display_name} 
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })} 
              placeholder="例：家中長輩、主要照護對象"
            />
          </div>

          <div className="avatar-manager compact-avatar-manager">
            <label className={`avatar-preview-frame avatar-replace-control ${uploading ? "is-uploading" : ""}`}>
              <img src={formData.avatar_url || aiAvatar} alt="照護對象頭像預覽" />
              <span>{uploading ? "處理中" : "點選替換"}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarUpload} disabled={uploading} />
            </label>
            <div className="avatar-controls">
              <p className="helper-copy">點頭像即可重新上傳並直接替換。沒有上傳時，會先使用 LINE 頭像或系統預設圖示。</p>
            </div>
          </div>

          <div className="form-row-two">
            <div className="form-group">
              <label>出生年月日</label>
              <input
                type="date"
                value={formData.birth_date}
                onChange={(e) => setFormData({ ...formData, birth_date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>緊急聯絡電話</label>
              <input
                type="tel"
                value={formData.emergency_phone}
                onChange={(e) => setFormData({ ...formData, emergency_phone: e.target.value })}
                placeholder="例：09xx-xxx-xxx"
              />
            </div>
          </div>

          <div className="form-group">
            <label>EMAIL</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="例：care@example.com"
            />
          </div>

          <div className="form-group">
            <label>重要附註 (會顯示在側邊欄)</label>
            <textarea 
              value={formData.notes} 
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })} 
              placeholder="例：過敏史、緊急聯絡方式、常用藥物"
              rows={4}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-action" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="primary-action" onClick={handleSave} disabled={saving || uploading}>
            {saving ? "儲存中..." : "儲存修改"}
          </button>
        </div>
      </div>
    </div>
  );
}


function profileSortValue(profile = {}) {
  const order = Number(profile.sort_order);
  return Number.isFinite(order) ? order : 0;
}

function sortProfilesForSwitcher(profiles = []) {
  return [...profiles].sort((a, b) => (
    profileSortValue(a) - profileSortValue(b)
    || Number(b.is_default === true) - Number(a.is_default === true)
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.display_name || "").localeCompare(String(b.display_name || ""), "zh-Hant")
  ));
}

function moveProfileId(profileIds, fromId, toId) {
  const next = profileIds.map(Number);
  const fromIndex = next.indexOf(Number(fromId));
  const toIndex = next.indexOf(Number(toId));
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return next;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function groupProfilesForSwitcher(profiles = [], groups = []) {
  const profilesByGroupId = new Map();
  sortProfilesForSwitcher(profiles).forEach((profile) => {
    const key = profile.group_id || "ungrouped";
    if (!profilesByGroupId.has(key)) profilesByGroupId.set(key, []);
    profilesByGroupId.get(key).push(profile);
  });

  const knownSections = groups
    .filter((group) => profilesByGroupId.has(group.id))
    .map((group) => ({
      id: group.id,
      name: group.name || "家庭群組",
      profiles: profilesByGroupId.get(group.id),
    }));

  const knownGroupIds = new Set(groups.map((group) => group.id));
  const extraSections = Array.from(profilesByGroupId.entries())
    .filter(([groupId]) => groupId === "ungrouped" || !knownGroupIds.has(groupId))
    .map(([groupId, groupProfiles]) => ({
      id: groupId,
      name: groupId === "ungrouped" ? "未分組" : "家庭群組",
      profiles: groupProfiles,
    }));

  return [...knownSections, ...extraSections];
}

function ProfileSwitcher({ profiles, groups = [], activeProfileId, onChange, onReorder }) {
  const [dragState, setDragState] = useState(null);
  const longPressTimerRef = useRef(null);
  const pointerDragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const sections = useMemo(() => groupProfilesForSwitcher(profiles, groups), [profiles, groups]);

  if (!profiles.length) {
    return (
      <div className="profile-switcher empty">
        <p className="panel-eyebrow">正在看的資料</p>
        <strong>照護對象</strong>
        <span>之後可加入家人、自己或其他需要照護的人。</span>
      </div>
    );
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function requestReorder(groupId, fromId, toId) {
    if (!fromId || !toId || Number(fromId) === Number(toId)) return;
    const section = sections.find((item) => String(item.id) === String(groupId));
    if (!section) return;
    const nextIds = moveProfileId(section.profiles.map((profile) => profile.id), fromId, toId);
    onReorder?.(section.id, nextIds);
  }

  function handlePointerDown(event, profile) {
    if (event.pointerType === "mouse") return;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      pointerDragRef.current = { profileId: profile.id, groupId: profile.group_id || "ungrouped", targetId: profile.id };
      suppressClickRef.current = true;
      setDragState(pointerDragRef.current);
    }, 420);
  }

  function handlePointerMove(event) {
    if (!pointerDragRef.current) return;
    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest?.("[data-profile-id]");
    if (!target || String(target.dataset.groupId) !== String(pointerDragRef.current.groupId)) return;
    pointerDragRef.current = {
      ...pointerDragRef.current,
      targetId: Number(target.dataset.profileId),
    };
    setDragState(pointerDragRef.current);
  }

  function handlePointerEnd() {
    clearLongPressTimer();
    const currentDrag = pointerDragRef.current;
    pointerDragRef.current = null;
    if (currentDrag) {
      requestReorder(currentDrag.groupId, currentDrag.profileId, currentDrag.targetId);
      setDragState(null);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  return (
    <div className="profile-switcher">
      <p className="panel-eyebrow">正在看的資料</p>
      <div className="profile-options" role="listbox" aria-label="切換照護對象">
        {sections.map((section) => (
          <section key={section.id} className="profile-group-section">
            <p className="profile-group-title">{section.name}</p>
            {section.profiles.map((profile) => {
              const isActive = profile.id === activeProfileId;
              const isDragging = dragState?.profileId === profile.id;
              const isDropTarget = dragState?.targetId === profile.id && !isDragging;
              return (
                <button
                  key={profile.id}
                  type="button"
                  draggable
                  data-profile-id={profile.id}
                  data-group-id={profile.group_id || "ungrouped"}
                  className={[
                    "profile-option",
                    isActive ? "active" : "",
                    isDragging ? "is-dragging" : "",
                    isDropTarget ? "is-drop-target" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    onChange(profile.id);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(profile.id));
                    setDragState({ profileId: profile.id, groupId: profile.group_id || "ungrouped", targetId: profile.id });
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    requestReorder(profile.group_id || "ungrouped", dragState?.profileId || event.dataTransfer.getData("text/plain"), profile.id);
                    setDragState(null);
                  }}
                  onDragEnd={() => setDragState(null)}
                  onPointerDown={(event) => handlePointerDown(event, profile)}
                  onPointerMove={handlePointerMove}
                  onPointerCancel={handlePointerEnd}
                  onPointerUp={handlePointerEnd}
                >
                  <span className="profile-option-name">{profile.display_name}</span>
                  <span className="profile-drag-handle" aria-hidden="true">☰</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function GroupBadge({ groups = [], activeGroupId, activeGroupName, onChange }) {
  const [open, setOpen] = useState(false);
  const label = activeGroupName || groups.find((group) => group.id === activeGroupId)?.name || "家庭群組";

  if (!groups.length) {
    return <span className="group-context-badge">{label}</span>;
  }

  return (
    <div className="group-context-switcher">
      <button
        type="button"
        className="group-context-badge"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="group-context-menu" role="listbox" aria-label="切換家庭群組">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={group.id === activeGroupId ? "active" : ""}
              onClick={() => {
                setOpen(false);
                onChange?.(group.id);
              }}
            >
              {group.name || "家庭群組"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHeading({ section }) {
  return (
    <div className="section-heading-row" style={{ "--section-color": section.color }}>
      <h2>{section.label}</h2>
    </div>
  );
}

function normalizeCollaborator(item, index) {
  const user = item?.user || item?.users || {};
  const displayName = item?.displayName || item?.display_name || item?.name || user.name || `家人 ${index + 1}`;
  return {
    id: String(item?.id || item?.user_id || user.id || displayName),
    displayName,
    avatarUrl: item?.avatarUrl || item?.avatar_url || item?.picture_url || user.avatar_url || user.picture_url || "",
    role: item?.role || "member",
    canContact: item?.canContact ?? item?.can_contact ?? true,
  };
}

function getMedicationShortName(name = "藥") {
  return String(name || "藥")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 4) || "藥";
}

function GlobalCareContactDock({ collaborators = [], botContact, onAskFamily }) {
  const [expanded, setExpanded] = useState(false);
  const [contactSheet, setContactSheet] = useState(null);
  const [showAllCollaborators, setShowAllCollaborators] = useState(false);
  const lastContactTriggerRef = useRef(null);
  const contactSheetPrimaryRef = useRef(null);
  const normalizedCollaborators = useMemo(() => collaborators
    .map(normalizeCollaborator)
    .filter((item) => item.canContact)
    .sort((a, b) => {
      if (a.role === "admin" && b.role !== "admin") return -1;
      if (b.role === "admin" && a.role !== "admin") return 1;
      return a.displayName.localeCompare(b.displayName, "zh-Hant");
    }), [collaborators]);
  const visibleCollaborators = normalizedCollaborators.length > 3
    ? normalizedCollaborators.slice(0, 1)
    : normalizedCollaborators.slice(0, 2);
  const hiddenCollaboratorCount = Math.max(normalizedCollaborators.length - visibleCollaborators.length, 0);
  const contactName = contactSheet?.name || "家人";

  const restoreContactTriggerFocus = useCallback(() => {
    requestAnimationFrame(() => lastContactTriggerRef.current?.focus());
  }, []);

  const closeContactSheet = useCallback(() => {
    setContactSheet(null);
    restoreContactTriggerFocus();
  }, [restoreContactTriggerFocus]);

  const closeCollaboratorList = useCallback(() => {
    setShowAllCollaborators(false);
    restoreContactTriggerFocus();
  }, [restoreContactTriggerFocus]);

  useEffect(() => {
    if (!contactSheet && !showAllCollaborators) return undefined;

    contactSheetPrimaryRef.current?.focus();

    function handleSheetKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (contactSheet) {
          closeContactSheet();
        } else {
          closeCollaboratorList();
        }
      }
    }

    window.addEventListener("keydown", handleSheetKeyDown);
    return () => window.removeEventListener("keydown", handleSheetKeyDown);
  }, [closeCollaboratorList, closeContactSheet, contactSheet, showAllCollaborators]);

  function openBotSheet(event) {
    lastContactTriggerRef.current = event.currentTarget;
    setContactSheet({ type: "bot", name: botContact.label });
  }

  function openCollaboratorSheet(collaborator, triggerElement = null) {
    if (triggerElement) lastContactTriggerRef.current = triggerElement;
    setContactSheet({
      type: "family",
      name: collaborator.displayName,
    });
  }

  function handleContactConfirm() {
    if (contactSheet?.type === "bot") {
      window.open(botContact.lineUrl || CARE_WEDO_LINE_URL, "_blank", "noopener,noreferrer");
    } else {
      onAskFamily(null);
    }
    setContactSheet(null);
    setExpanded(false);
  }

  return (
    <>
      {expanded && (
        <button type="button" className="care-contact-dismiss-layer" onClick={() => setExpanded(false)} aria-label="收合照護協助入口" />
      )}
      <aside className={`global-care-contact-dock ${expanded ? "is-expanded" : ""}`} aria-label="照護協助入口">
        <button
          type="button"
          className="care-contact-main-button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={expanded ? "收合照護協助入口" : "展開照護協助入口"}
        >
          <img src={botContact.avatarUrl || CARE_WEDO_APP_ICON} alt="" />
        </button>
        {expanded && botContact.available && (
          <button type="button" className="care-contact-item with-label" onClick={openBotSheet} aria-label="問 Care WEDO 照護小管家">
            <img src={botContact.avatarUrl || CARE_WEDO_APP_ICON} alt="" />
            <span>{botContact.label}</span>
          </button>
        )}
        {expanded && visibleCollaborators.map((collaborator) => (
          <button
            key={collaborator.id}
            type="button"
            className="care-contact-item"
            onClick={(event) => openCollaboratorSheet(collaborator, event.currentTarget)}
            aria-label={`聯絡 ${collaborator.displayName}`}
            title={collaborator.displayName}
          >
            {collaborator.avatarUrl ? <img src={collaborator.avatarUrl} alt="" /> : <span>{getInitial(collaborator.displayName)}</span>}
          </button>
        ))}
        {expanded && hiddenCollaboratorCount > 0 && (
          <button type="button" className="care-contact-more" onClick={(event) => {
            lastContactTriggerRef.current = event.currentTarget;
            setShowAllCollaborators(true);
          }} aria-label={`顯示其他 ${hiddenCollaboratorCount} 位家人`}>
            +{hiddenCollaboratorCount}
          </button>
        )}
      </aside>

      {showAllCollaborators && (
        <div className="contact-sheet-backdrop" role="presentation" onClick={closeCollaboratorList}>
          <section className="contact-sheet" role="dialog" aria-modal="true" aria-labelledby="collaborator-list-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="collaborator-list-title">可以聯絡的家人</h3>
            <div className="collaborator-list">
              {normalizedCollaborators.map((collaborator, index) => (
                <button key={collaborator.id} type="button" ref={index === 0 ? contactSheetPrimaryRef : null} onClick={() => {
                  setShowAllCollaborators(false);
                  openCollaboratorSheet(collaborator);
                }}>
                  {collaborator.avatarUrl ? <img src={collaborator.avatarUrl} alt="" /> : <span>{getInitial(collaborator.displayName)}</span>}
                  {collaborator.displayName}
                </button>
              ))}
            </div>
            <button type="button" className="secondary-action" onClick={closeCollaboratorList}>取消</button>
          </section>
        </div>
      )}

      {contactSheet && (
        <div className="contact-sheet-backdrop" role="presentation" onClick={closeContactSheet}>
          <section className="contact-sheet" role="dialog" aria-modal="true" aria-labelledby="contact-sheet-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="contact-sheet-title">{contactSheet.type === "bot" ? "要問 Care WEDO 照護小管家嗎？" : `要聯絡 ${contactName} 嗎？`}</h3>
            <button type="button" className="primary-action" ref={contactSheetPrimaryRef} onClick={handleContactConfirm}>
              {contactSheet.type === "bot" ? "打開 LINE 對話" : "傳 LINE 訊息"}
            </button>
            {contactSheet.type !== "bot" && (
              <button type="button" className="secondary-action" onClick={() => window.alert("請到 LINE 聯絡人頁面選擇語音通話。")}>
                打 LINE 語音
              </button>
            )}
            <button type="button" className="secondary-action subtle" onClick={closeContactSheet}>取消</button>
          </section>
        </div>
      )}
    </>
  );
}


const SCAN_STEPS = ["讀取照片", "辨識文字", "整理提醒"];

function ScanProgress({ step }) {
  return (
    <section className="ocr-progress" aria-live="polite">
      <div className="ocr-progress-header">
        <p className="ocr-progress-title">正在幫你整理照護資訊…</p>
        <p className="ocr-progress-sub">等等請你再確認一次內容是否正確。</p>
      </div>
      <div className="ocr-progress-steps">
        {SCAN_STEPS.map((label, index) => (
          <div
            key={label}
            className={[
              "ocr-progress-step",
              step === null ? "" : index < step ? "done" : index === step ? "active" : "",
            ].filter(Boolean).join(" ")}
          >
            <span className="ocr-step-dot" aria-hidden="true" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function UploadGuide({ onConfirm, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>上傳照護單據</h2>
          <button type="button" onClick={onClose} className="btn-close">✕</button>
        </div>
        <div className="modal-body upload-guide-body">
          <p className="upload-guide-intro">
            請拍下<strong>看診單、藥袋、處方箋或提醒單</strong>。
          </p>
          <ul className="upload-guide-tips">
            <li>照片文字清楚、盡量拍完整</li>
            <li>盡量避免反光或模糊</li>
            <li>可以一次上傳多張</li>
          </ul>
          <p className="upload-guide-note">
            Care WEDO 會協助整理出回診時間、用藥資訊與注意事項。
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-action" onClick={onClose}>取消</button>
          <button type="button" className="primary-action" onClick={onConfirm}>拍照或上傳照片</button>
        </div>
      </div>
    </div>
  );
}

function AskFamilyModal({ title, initialMessage, onClose }) {
  const [message, setMessage] = useState(initialMessage || "");
  const [copyStatus, setCopyStatus] = useState("");

  async function handleCopy() {
    const text = message.trim();
    if (!text) {
      setCopyStatus("請先輸入要傳給家人的文字。");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyStatus("已複製，可以貼到 LINE 給家人。");
    } catch {
      setCopyStatus("目前無法自動複製，請長按文字框選取後複製。");
    }
  }

  return (
    <div className="modal-overlay ask-family-overlay" onClick={onClose}>
      <div className="modal-content ask-family-modal" role="dialog" aria-modal="true" aria-labelledby="ask-family-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header ask-family-header">
          <div>
            <p className="modal-kicker">家人協助</p>
            <h2 id="ask-family-title">{title || "問家人"}</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-close" aria-label="關閉">✕</button>
        </div>
        <div className="modal-body ask-family-body">
          <p className="ask-family-intro">可以先修改內容，再一鍵複製貼到 LINE 家庭群組。</p>
          <label className="ask-family-label" htmlFor="ask-family-message">要傳給家人的文字</label>
          <textarea
            id="ask-family-message"
            className="ask-family-textarea"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setCopyStatus("");
            }}
            rows={10}
          />
          {copyStatus && <p className="ask-family-copy-status" aria-live="polite">{copyStatus}</p>}
        </div>
        <div className="modal-footer ask-family-actions">
          <button type="button" className="secondary-action" onClick={onClose}>關閉</button>
          <button type="button" className="primary-action" onClick={handleCopy}>一鍵複製</button>
        </div>
      </div>
    </div>
  );
}

function EmptyGuide({ title, description, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
  return (
    <div className="empty-guide">
      <p className="empty-guide-title">{title}</p>
      <p className="empty-guide-copy">{description}</p>
      <div className="empty-guide-actions">
        {primaryLabel && (
          <button type="button" className="primary-action" onClick={onPrimary}>
            {primaryLabel}
          </button>
        )}
        {secondaryLabel && (
          <button type="button" className="secondary-action" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function SearchField({ value, onChange, suggestions = [], placeholder = "搜尋", className = "" }) {
  return (
    <div className={`search-box ${className}`.trim()}>
      <span>搜尋</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {suggestions.length > 0 && (
        <div className="search-suggestions" aria-label="常用搜尋關鍵字">
          {suggestions.map((keyword) => (
            <button type="button" key={keyword} onClick={() => onChange(keyword)}>
              {keyword}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function buildReminderFormData(appointment = null) {
  return {
    type: normalizeManualReminderType(appointment?.type || "clinic_visit"),
    title: appointment?.title || appointment?.department || appointment?.hospital || "",
    date: appointment?.date || todayInTaipei(),
    time: appointment?.time || "",
    hospital: appointment?.hospital || "",
    department: appointment?.department || "",
    doctor: appointment?.doctor || "",
    location: appointment?.location || "",
    notes: appointment?.notes || appointment?.reminder_text || "",
    fasting_required: Boolean(appointment?.fasting_required),
    fasting_hours: appointment?.fasting_hours || 8,
  };
}

function ManualReminderModal({ mode = "create", initialAppointment = null, onClose, onSave, onDelete }) {
  const [formData, setFormData] = useState(() => initialAppointment ? buildReminderFormData(initialAppointment) : {
    type: "clinic_visit",
    title: "",
    date: todayInTaipei(),
    time: "",
    hospital: "",
    department: "",
    doctor: "",
    location: "",
    notes: "",
    fasting_required: false,
    fasting_hours: 8,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...formData,
        date: normalizeDateInput(formData.date),
        title: formData.title || formData.department || formData.hospital,
        department: formData.department,
        fasting_hours: formData.fasting_required ? formData.fasting_hours : null,
      });
    } catch (err) {
      setError(err.message || "新增提醒失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await onDelete?.();
    } catch (err) {
      setError(err.message || "刪除失敗，請再試一次");
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content manual-reminder-modal">
        <div className="modal-header">
          <h2>{mode === "edit" ? "編輯提醒" : "新增提醒"}</h2>
          <button type="button" onClick={onClose} className="btn-close">✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <p className="error-msg">{error}</p>}
            <div className="form-group">
              <label>提醒類型</label>
              <div className="segmented-choice-grid" role="group" aria-label="提醒類型">
                {REMINDER_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`choice-pill choice-pill-${option.value} ${formData.type === option.value ? "active" : ""}`}
                    onClick={() => setFormData({ ...formData, type: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>提醒名稱</label>
                <input
                  value={formData.title}
                  onChange={(event) => setFormData({ ...formData, title: event.target.value })}
                  placeholder="例：下次回診、領藥提醒"
                  required
                />
              </div>
              <div className="form-group">
                <label>日期</label>
                <div className="quick-choice-row">
                  <button type="button" onClick={() => setFormData({ ...formData, date: todayInTaipei() })}>今天</button>
                  <button type="button" onClick={() => setFormData({ ...formData, date: addDaysInTaipei(1) })}>明天</button>
                  <button type="button" onClick={() => setFormData({ ...formData, date: addDaysInTaipei(7) })}>下週</button>
                  <button type="button" onClick={() => setFormData({ ...formData, date: addMonthsInTaipei(1) })}>下月</button>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formData.date}
                  onChange={(event) => setFormData({ ...formData, date: event.target.value })}
                  placeholder="例：2026/05/15 或 2026-05-15"
                  required
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>時間</label>
                <div className="quick-choice-row">
                  {["上午", "下午", "晚上", "睡前", "全天"].map((timeLabel) => (
                    <button key={timeLabel} type="button" onClick={() => setFormData({ ...formData, time: timeLabel })}>
                      {timeLabel}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={formData.time}
                  onChange={(event) => setFormData({ ...formData, time: event.target.value })}
                  placeholder="例：07:45、上午、7:45-19:00"
                />
              </div>
              <div className="form-group">
                <label>醫院 / 地點</label>
                <input
                  value={formData.hospital}
                  onChange={(event) => setFormData({ ...formData, hospital: event.target.value })}
                  placeholder="例：常去的醫院、診所或藥局"
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>診別 / 科別</label>
                <input
                  value={formData.department}
                  onChange={(event) => setFormData({ ...formData, department: event.target.value })}
                  placeholder="例：家醫科、藥局、檢查室"
                />
              </div>
              <div className="form-group">
                <label>醫師</label>
                <input
                  value={formData.doctor}
                  onChange={(event) => setFormData({ ...formData, doctor: event.target.value })}
                  placeholder="例：醫師或藥師姓名"
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>詳細地點</label>
                <input
                  value={formData.location}
                  onChange={(event) => setFormData({ ...formData, location: event.target.value })}
                  placeholder="例：門診區、檢查室、領藥窗口"
                />
              </div>
            </div>
            <label className="settings-toggle compact-toggle">
              <span>需要空腹提醒</span>
              <input
                type="checkbox"
                checked={formData.fasting_required}
                onChange={(event) => setFormData({ ...formData, fasting_required: event.target.checked })}
              />
            </label>
            {formData.fasting_required && (
              <div className="form-group">
                <label>空腹小時數</label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={formData.fasting_hours}
                  onChange={(event) => setFormData({ ...formData, fasting_hours: Number(event.target.value) })}
                />
              </div>
            )}
            <div className="form-group">
              <label>提醒內容</label>
              <textarea
                value={formData.notes}
                onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
                placeholder="例：要帶的資料、注意事項、家人分工"
                rows={4}
              />
            </div>
            {mode === "edit" && onDelete && (
              <div className="modal-danger-zone">
                <div>
                  <strong>刪除提醒</strong>
                  <p>{confirmDelete ? "刪除後，首頁與未來行程不會再顯示這筆資料。請再次確認。" : "如果這筆資料不需要了，可以在這裡刪除。"}</p>
                </div>
                <div className="modal-danger-actions">
                  {confirmDelete && (
                    <button type="button" className="secondary-action subtle" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      取消刪除
                    </button>
                  )}
                  <button type="button" className="secondary-action subtle danger-subtle" onClick={handleDelete} disabled={saving || deleting}>
                    {deleting ? "刪除中..." : confirmDelete ? "確認刪除" : "刪除這筆提醒"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="secondary-action" onClick={onClose} disabled={saving}>取消</button>
            <button type="submit" className="primary-action" disabled={saving}>{saving ? "儲存中..." : mode === "edit" ? "儲存修改" : "儲存提醒"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OverviewView({
  todayLabel,
  searchQuery,
  onSearchChange,
  todayTasks,
  hasTodayCareTasks,
  searchSuggestions,
  nextAppointment,
  urgentItems,
  familyNotes,
  groups,
  activeGroup,
  activeGroupId,
  hasCareData,
  patient,
  selectedProfile,
  onOpenCalendar,
  onOpenRecords,
  onOpenMeds,
  onOpenFamily,
  onOpenProfile,
  onGroupChange,
  onEditFamilyNotes,
  onUpload,
  onAddReminder,
  onEditAppointment,
  onComplete,
  onAskFamily,
}) {
  const [locallyDoneTaskIds, setLocallyDoneTaskIds] = useState(() => new Set());
  const careName = selectedProfile?.display_name || patient?.name || "照護對象";
  const careTitle = getCareTodayTitle(selectedProfile, careName);

  function handlePrimaryAction(task) {
    setLocallyDoneTaskIds((prev) => new Set(prev).add(task.id));
    if (task.kind === "appointment") {
      onComplete(task.sourceId);
    }
  }

  return (
    <div className="today-care-view">
      <section className="care-subject-header" aria-label={`${careName} 的照護頁`}>
        <button type="button" className="care-avatar care-avatar-primary" onClick={onOpenProfile} aria-label={`開啟 ${careName} 的照護資料`}>
          <img src={selectedProfile?.avatar_url || aiAvatar} alt={`${careName} 頭像`} />
        </button>
        <div>
          <h3>{careTitle}</h3>
          <p>{todayLabel.date}</p>
        </div>
        <GroupBadge
          groups={groups}
          activeGroupId={activeGroupId}
          activeGroupName={activeGroup?.name}
          onChange={onGroupChange}
        />
      </section>

      <section className="today-hero-panel">
        <div className="today-count-block">
          <span>{todayTasks.length ? (hasTodayCareTasks ? `今天有 ${todayTasks.length} 件事` : "最近下一筆照護事項") : "今天沒有新的照護事項"}</span>
          <p>{todayTasks.length ? (hasTodayCareTasks ? "照時間慢慢做就好。" : "今天沒有新事項，先幫你接上最近的下一筆。") : "可以查看未來行程，或新增一筆提醒。"}</p>
        </div>
        <SearchField
          value={searchQuery}
          onChange={onSearchChange}
          suggestions={searchSuggestions}
          placeholder="依醫院、診別、醫師篩選"
          className="today-search-box"
        />
      </section>

      <section className="today-timeline-panel">
        {todayTasks.length ? (
          <div className="elder-task-list">
            {todayTasks.map((task) => {
              const isDone = locallyDoneTaskIds.has(task.id) || task.status === "completed";
              return (
                <article key={task.id} className={`elder-task-card ${isDone ? "is-done" : ""} ${task.needsReview ? "needs-review" : ""}`}>
                  {task.kind === "appointment" && (
                    <button type="button" className="card-corner-edit" onClick={() => onEditAppointment(task.sourceId)} aria-label={`編輯 ${task.title}`}>
                      編輯
                    </button>
                  )}
                  <div className="elder-task-time">
                    {!task.isToday && task.dateLabel && <span className="elder-task-date">{task.dateLabel}</span>}
                    {task.time}
                  </div>
                  <div className="elder-task-body">
                    <span className="elder-task-label">{task.label}</span>
                    <h3>{task.title}</h3>
                    {task.subtitle && <p>{task.subtitle}</p>}
                    {task.detail && <p className="elder-task-detail">{task.detail}</p>}
                    {task.needsReview && <p className="elder-task-warning">這筆資料還需要家人確認日期或內容。</p>}
                  </div>
                  <div className="elder-task-actions">
                    <button type="button" className="primary-action elder-primary-action" onClick={() => handlePrimaryAction(task)} disabled={isDone}>
                      {isDone ? "已記好了" : task.primaryActionLabel}
                    </button>
                    <button type="button" className="secondary-action elder-secondary-action subtle" onClick={() => onAskFamily(task)}>
                      問家人
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : hasCareData ? (
          <div className="today-empty-card">
            <div className="empty-guide-actions">
              <button type="button" className="primary-action" onClick={onOpenCalendar}>查看未來行程</button>
              <button type="button" className="secondary-action" onClick={onUpload}>拍照上傳</button>
              <button type="button" className="secondary-action" onClick={onAddReminder}>新增提醒</button>
            </div>
          </div>
        ) : (
          <EmptyGuide
            title="今天還沒有照護事項。"
            description="可以先拍一張看診單或藥袋，Care WEDO 會幫你整理成今天要做的事。"
            primaryLabel="拍照上傳"
            onPrimary={onUpload}
            secondaryLabel="新增提醒"
            onSecondary={onAddReminder}
          />
        )}
      </section>

      <section className="today-action-grid" aria-label="照護功能入口">
        <button type="button" className="today-action-tile" onClick={onOpenCalendar}>
          <span>未來</span>
          <strong>看未來行程</strong>
          <small>本週、下週、本月</small>
        </button>
        <button type="button" className="today-action-tile" onClick={onOpenRecords}>
          <span>查詢</span>
          <strong>找照護紀錄</strong>
          <small>醫院、診別、醫師</small>
        </button>
        <button type="button" className="today-action-tile" onClick={onOpenMeds}>
          <span>吃藥</span>
          <strong>看吃藥紀錄</strong>
          <small>早、中、晚、睡前</small>
        </button>
        <button type="button" className="today-action-tile" onClick={onOpenFamily}>
          <span>家人</span>
          <strong>照護圈設定</strong>
          <small>邀請與切換資料</small>
        </button>
      </section>

      <section className="today-support-grid">
        <article className="summary-panel next-panel">
          <p className="panel-eyebrow">下一次看診</p>
          {nextAppointment ? (
            <>
              <div className="date-badge">{formatDateLabel(nextAppointment.date, nextAppointment.time)}</div>
              <h3>{nextAppointment.title || nextAppointment.department}</h3>
              <p>{[nextAppointment.hospital, nextAppointment.doctor && `${nextAppointment.doctor}醫師`].filter(Boolean).join(" ｜ ")}</p>
              <button type="button" className="inline-action" onClick={onOpenCalendar}>看看診清單</button>
            </>
          ) : (
            <p className="empty-state">目前沒有下一次看診安排。</p>
          )}
        </article>

        <article className="summary-panel">
          <div className="panel-title-row">
            <p className="panel-eyebrow">需要多留意</p>
            <button type="button" className="card-corner-edit inline-edit-button" onClick={onEditFamilyNotes}>
              編輯
            </button>
          </div>
          <div className="attention-list">
            {urgentItems.length || familyNotes.length ? (
              <>
                {urgentItems.map((item) => (
              <article key={item.id} className="attention-item">
                <strong>{typeLabel(item.type)}：{item.title || item.department}</strong>
                <span>{item.fasting_required ? `前 ${item.fasting_hours || 8} 小時先不要吃東西` : item.reminder_text || "照提醒做就好"}</span>
              </article>
                ))}
                {familyNotes.map((note, index) => (
                  <article key={`family-note-${index}`} className="attention-item family-note-item">
                    <strong>家庭提醒</strong>
                    <span>{note}</span>
                  </article>
                ))}
              </>
            ) : <p className="empty-state">目前沒有特別要擔心的提醒。</p>}
          </div>
        </article>

        <article className="summary-panel wide-panel">
          <p className="panel-eyebrow">新增照護資料</p>
          <h3>拍下看診單、檢查單或領藥單</h3>
          <p className="empty-state">Care WEDO 會整理成今日或未來照護提醒。</p>
          <div className="inline-action-row">
            <button type="button" className="inline-action" onClick={onUpload}>拍照上傳</button>
            <button type="button" className="inline-action secondary-inline" onClick={onAddReminder}>新增提醒</button>
          </div>
        </article>
      </section>
    </div>
  );
}

function CalendarView({ appointments, onUpload, onAddReminder, onEditAppointment }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const futureAppointments = useMemo(
    () => appointments.filter((apt) => apt.status !== "completed" && isDateTodayOrFuture(apt.date)),
    [appointments],
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
  const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1; // Adjust to Mon starting

  const calendarDays = Array.from({ length: 42 }, (_, i) => {
    const dayNumber = i - adjustedFirstDay + 1;
    if (dayNumber > 0 && dayNumber <= daysInMonth) {
      return dayNumber;
    }
    return null;
  });

  function changeMonth(offset) {
    const nextDate = new Date(year, month + offset, 1);
    setCurrentDate(nextDate);
  }

  function scrollToDate(day) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const element = document.getElementById(`event-${dateStr}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div className="calendar-layout">
      <section className="calendar-board" aria-label="月曆預覽">
        <div className="calendar-head">
          <div className="month-nav">
            <button type="button" onClick={() => changeMonth(-1)}>❮</button>
            <strong>{year} 年 {month + 1} 月</strong>
            <button type="button" onClick={() => changeMonth(1)}>❯</button>
          </div>
          <button type="button" className="btn-today" onClick={() => setCurrentDate(new Date())}>回到今天</button>
        </div>
        <div className="calendar-weekdays">
          {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-days">
          {calendarDays.map((day, index) => {
            if (!day) return <div key={`empty-${index}`} className="calendar-day empty" />;
            
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const hasEvent = futureAppointments.some((apt) => apt.date === dateStr);
            const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
            
            return (
              <button 
                key={day} 
                type="button" 
                className={`calendar-day ${hasEvent ? "has-event" : ""} ${isToday ? "is-today" : ""}`}
                onClick={() => scrollToDate(day)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </section>

      <section className="event-list" aria-label="看診和領藥清單">
        <div className="inline-action-row event-list-actions">
          <button type="button" className="secondary-action" onClick={onUpload}>拍照上傳</button>
          <button type="button" className="primary-action" onClick={onAddReminder}>新增提醒</button>
        </div>
        {futureAppointments.length ? futureAppointments.map((apt) => (
          <article key={apt.id} id={`event-${apt.date}`} className="event-row">
            <button type="button" className="card-corner-edit" onClick={() => onEditAppointment(apt)} aria-label={`編輯 ${apt.title || apt.department || "提醒"}`}>
              編輯
            </button>
            <div className="event-type">{typeIcon(apt.type)}</div>
            <div>
              <p className="event-date">{formatDateLabel(apt.date, apt.time)}</p>
              <h3>{apt.title || apt.department}</h3>
              <p>{[apt.hospital, apt.doctor && `${apt.doctor}醫師`, apt.number && `${apt.number}號`].filter(Boolean).join(" ｜ ")}</p>
              {apt.location && <p className="location-line">地點：{apt.location}</p>}
              {apt.notes && <p className="soft-note">{apt.notes}</p>}
            </div>
          </article>
        )) : (
          <EmptyGuide
            title="目前還沒有看診提醒。"
            description="你可以從看診單照片開始，或手動新增下一次回診日期。建立後，家人也能一起同步查看。"
            primaryLabel="上傳看診單"
            onPrimary={onUpload}
            secondaryLabel="新增看診提醒"
            onSecondary={onAddReminder}
          />
        )}
      </section>
    </div>
  );
}

const MEDICATION_SLOT_OPTIONS = [
  { value: "morning", label: "早" },
  { value: "noon", label: "中" },
  { value: "evening", label: "晚" },
  { value: "bedtime", label: "睡前" },
  { value: "other", label: "其他" },
];

function getMedicationSlotValues(medication = {}) {
  const text = [medication.time_slot, medication.scheduled_time, medication.frequency, medication.reminder_text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const values = new Set();
  if (/morning|breakfast|早/.test(text)) values.add("morning");
  if (/noon|lunch|中/.test(text)) values.add("noon");
  if (/evening|night|dinner|晚/.test(text)) values.add("evening");
  if (/bedtime|睡前/.test(text)) values.add("bedtime");
  if (values.size === 0) values.add("other");
  return values;
}

function MedicationView({ medications, onUpload, onTaken, onDeleteMedication, onUpdateMedication }) {
  const [savingSlot, setSavingSlot] = useState(null);
  const [savingMedicationId, setSavingMedicationId] = useState(null);
  const [expandedMedicationId, setExpandedMedicationId] = useState(null);
  const [locallyTakenSlots, setLocallyTakenSlots] = useState(() => new Set());
  const medicationGroups = useMemo(() => groupMedicationsBySchedule(medications), [medications]);
  const hasAnyMedication = medicationGroups.some((group) => group.medications.length > 0);
  const todayDate = todayInTaipei();

  function isSlotDone(group) {
    return locallyTakenSlots.has(`${todayDate}:${group.slot}`)
      || group.medications.every((med) => (
        med.taken_slots?.includes(group.slot)
        || (med.taken_status === "taken" && med.taken_date === todayDate)
      ));
  }

  async function handleSlotStatus(group, status) {
    if (!group.medicationIds.length) return;
    setSavingSlot(`${group.slot}-${status}`);
    try {
      await onTaken?.(group, status);
      if (status === "taken") {
        setLocallyTakenSlots((prev) => new Set(prev).add(`${todayDate}:${group.slot}`));
      }
    } finally {
      setSavingSlot(null);
    }
  }

  async function handleSlotToggle(medication, slotValue) {
    const current = getMedicationSlotValues(medication);
    if (current.has(slotValue) && current.size > 1) {
      current.delete(slotValue);
    } else {
      current.add(slotValue);
      if (slotValue !== "other") current.delete("other");
      if (slotValue === "other") {
        current.clear();
        current.add("other");
      }
    }
    const nextSlots = MEDICATION_SLOT_OPTIONS
      .map((option) => option.value)
      .filter((value) => current.has(value));
    setSavingMedicationId(medication.id);
    try {
      await onUpdateMedication?.(medication, { time_slot: nextSlots.join(",") });
    } finally {
      setSavingMedicationId(null);
    }
  }

  async function handleDeleteMedication(medication) {
    const confirmed = window.confirm(`確定要刪除「${medication.name || "這顆藥"}」嗎？刪除後不會再出現在吃藥提醒。`);
    if (!confirmed) return;
    setSavingMedicationId(medication.id);
    try {
      await onDeleteMedication?.(medication);
    } finally {
      setSavingMedicationId(null);
    }
  }

  return (
    <div className="medicine-grid">
      {hasAnyMedication ? medicationGroups.map((group) => (
        <section key={group.slot} className="medicine-time-group">
          <div className="medicine-slot-head">
            <div>
              <p>{group.medications.length ? `${group.medications.length} 種藥` : "沒有安排"}</p>
              <h3>{group.label}</h3>
            </div>
            <div className="medicine-slot-actions">
              {group.medications.length > 0 && isSlotDone(group) && (
                <span className="medicine-slot-status is-done">{formatDateLabel(todayDate)} 已記錄</span>
              )}
              {group.medications.length > 0 && !isSlotDone(group) && (
                <button type="button" className="primary-action compact-action" onClick={() => handleSlotStatus(group, "taken")} disabled={savingSlot === `${group.slot}-taken`}>
                  {savingSlot === `${group.slot}-taken` ? "記錄中…" : "我已吃完"}
                </button>
              )}
            </div>
          </div>
          {group.medications.length ? <div className="medicine-chip-list">
            {group.medications.map((med) => {
              const isExpanded = expandedMedicationId === med.id;
              return (
                <article key={med.id} className={`medicine-card ${isExpanded ? "is-expanded" : ""}`}>
                  <button
                    type="button"
                    className="medicine-chip-button"
                    onClick={() => setExpandedMedicationId(isExpanded ? null : med.id)}
                    aria-expanded={isExpanded}
                    aria-label={`查看 ${med.name || "藥名待確認"} 說明`}
                  >
                    <span className="medicine-color" style={{ backgroundColor: med.color }} aria-hidden="true">
                      {getMedicationShortName(med.name).slice(0, 1)}
                    </span>
                    <span>{getMedicationShortName(med.name)}</span>
                  </button>
                  {isExpanded && (
                    <div className="medicine-card-detail">
                      <dl>
                        <div><dt>全名</dt><dd>{med.name || "藥名待確認"}</dd></div>
                        <div><dt>份量</dt><dd>{med.dosage || "待確認"}</dd></div>
                        {[med.schedule.timeLabel, med.schedule.mealTimingLabel].filter(Boolean).length > 0 && (
                          <div><dt>時間</dt><dd>{[med.schedule.timeLabel, med.schedule.mealTimingLabel].filter(Boolean).join(" ｜ ")}</dd></div>
                        )}
                        {med.purpose && <div><dt>用途</dt><dd>{med.purpose}</dd></div>}
                        {med.warnings && <div><dt>注意</dt><dd>{med.warnings}</dd></div>}
                      </dl>
                      <div className="medicine-manage-panel">
                        <p>這顆藥要在哪些時段提醒？</p>
                        <div className="medicine-slot-picker" role="group" aria-label={`${med.name || "藥物"}提醒時段`}>
                          {MEDICATION_SLOT_OPTIONS.map((option) => {
                            const selected = getMedicationSlotValues(med).has(option.value);
                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={selected ? "is-active" : ""}
                                onClick={() => handleSlotToggle(med, option.value)}
                                disabled={savingMedicationId === med.id}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          className="medicine-delete-action"
                          onClick={() => handleDeleteMedication(med)}
                          disabled={savingMedicationId === med.id}
                        >
                          刪除這顆藥
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div> : (
            <p className="medicine-slot-empty">這個時段目前沒有藥。</p>
          )}
        </section>
      )) : (
        <EmptyGuide
          title="目前還沒有吃藥說明。"
          description="你可以拍下藥袋或處方資訊，讓 Care WEDO 幫你整理吃藥時間、份量與注意事項。"
          primaryLabel="上傳藥袋照片"
          onPrimary={onUpload}
          secondaryLabel="新增吃藥說明"
        />
      )}
    </div>
  );
}

function appointmentTimeValue(record = {}) {
  const date = typeof record.date === "string" && record.date ? record.date : "9999-12-31";
  const time = typeof record.time === "string" && /^\d{1,2}:\d{2}/.test(record.time) ? record.time.slice(0, 5) : "23:59";
  return `${date}T${time}`;
}

function RecordsView({ records, searchQuery, onUpload }) {
  const [mode, setMode] = useState("future");
  const modeLabel = mode === "history" ? "歷史紀錄" : "未來安排";
  const grouped = useMemo(() => {
    const today = todayInTaipei();
    const filteredRecords = records
      .filter((record) => record.status !== "deleted")
      .filter((record) => {
        if (mode === "history") return true;
        return record.status !== "completed" && isDateTodayOrFuture(record.date, today);
      })
      .filter((record) => matchSearch(record, searchQuery))
      .sort((a, b) => appointmentTimeValue(a).localeCompare(appointmentTimeValue(b)));
    const groups = {};
    filteredRecords.forEach(record => {
      if (!record.date || typeof record.date !== "string") return;
      // Defensive slice: only if it looks like YYYY-MM-DD
      const monthStr = record.date.includes("-") ? record.date.slice(0, 7) : "其他日期"; 
      if (!groups[monthStr]) groups[monthStr] = [];
      groups[monthStr].push(record);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [records, searchQuery, mode]);

  return (
    <div className="records-timeline-view">
      <div className="record-mode-switch" role="group" aria-label="查詢紀錄模式">
        <button
          type="button"
          className={mode === "future" ? "active" : ""}
          onClick={() => setMode("future")}
        >
          未來安排
        </button>
        <button
          type="button"
          className={mode === "history" ? "active" : ""}
          onClick={() => setMode("history")}
        >
          歷史紀錄
        </button>
      </div>
      {grouped.length ? grouped.map(([month, items]) => (
        <section key={month} className="record-month-group">
          <h3 className="month-divider">{month.replace("-", " 年 ")} 月</h3>
          <div className="records-stack">
            {items.map(record => (
              <article key={record.id} className="records-row record-completed">
                <span className="record-date-col">{formatDateLabel(record.date)}</span>
                <span className="record-tag">{typeLabel(record.type)}</span>
                <div className="record-info">
                  <strong>{record.title || record.department}</strong>
                  <span>{record.hospital}</span>
                </div>
                <span className="record-status-tag">{record.status === "completed" ? "✓ 已完成" : "提醒"}</span>
              </article>
            ))}
          </div>
        </section>
      )) : (
        <EmptyGuide
          title={searchQuery ? "沒有符合的紀錄。" : `目前沒有${modeLabel}。`}
          description={searchQuery ? "換一個醫院、科別、醫師或提醒類型試試看。" : mode === "history" ? "切回未來安排可以查看接下來要做的事。" : "之後新增的看診、檢查或領藥提醒會先出現在這裡。"}
          primaryLabel="上傳看診單"
          onPrimary={onUpload}
          secondaryLabel="新增照護紀錄"
        />
      )}
    </div>
  );
}

function SettingsView({
  patient,
  identity,
  isPersonalMode,
  careProfiles,
  selectedProfile,
  activeProfileId,
  onProfileChange,
  onGroupChange,
  familyNotes,
  onFamilyNotesChange,
  onLogout,
}) {
  return (
    <div className="settings-grid">
      <section className="summary-panel">
        <p className="panel-eyebrow">現在主要照顧誰</p>
        <div className="profile-form-preview">
          <img src={identity.profile?.pictureUrl || aiAvatar} alt="個人頭像" />
          <div>
            <label>稱呼</label>
            <strong>{selectedProfile?.display_name || patient.name || "照護對象"}</strong>
            <label>LINE 狀態</label>
            <strong>{isPersonalMode ? "已用 LINE 登入" : IS_PROD ? "請重新登入 LINE" : "目前是範例畫面"}</strong>
          </div>
        </div>
      </section>

      <section className="summary-panel">
        <p className="panel-eyebrow">家庭群組成員</p>
        <div className="care-profile-list">
          {careProfiles.length ? careProfiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={(profile.id === activeProfileId || (!activeProfileId && profile.id === selectedProfile?.id)) ? "care-profile-item active" : "care-profile-item"}
              onClick={() => onProfileChange(profile.id)}
            >
              <strong>{profile.display_name}</strong>
            </button>
          )) : (
            <EmptyGuide
              title="目前還沒有加入其他家人。"
              description="你可以邀請家人一起管理照護空間，讓提醒、紀錄與重要事項不再只靠一個人記得。"
              primaryLabel="邀請家人"
              secondaryLabel="複製邀請碼"
            />
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
        <FamilyNotesEditor notes={familyNotes} onChange={onFamilyNotesChange} />
      </section>

      <section className="summary-panel wide-panel">
        <p className="panel-eyebrow">常見照護提醒</p>
        <div className="care-tips-grid">
          <article className="care-tip-card">
            <h3>過敏與禁忌</h3>
            <p>設定照護對象的過敏史，讓所有家人在解析單據時都能獲得即時警告。</p>
          </article>
          <article className="care-tip-card">
            <h3>常用醫院</h3>
            <p>記下常去的醫院與科別，系統會自動歸納並優化之後的看診建議。</p>
          </article>
        </div>
      </section>

      {isPersonalMode && onLogout && (
        <section className="summary-panel wide-panel">
          <p className="panel-eyebrow">帳號</p>
          <div className="account-row">
            <div>
              <p className="account-name">{identity.profile?.displayName || "LINE 帳號"}</p>
              <p className="account-sub">目前以 LINE 帳號登入</p>
            </div>
            <button type="button" className="btn-logout" onClick={onLogout}>
              登出
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function FamilyNotesEditor({ notes, onChange }) {
  const [drafts, setDrafts] = useState(notes.length ? notes : [""]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDrafts(notes.length ? notes : [""]);
  }, [notes]);

  function updateDraft(index, value) {
    setDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function addDraft() {
    setDrafts((current) => [...current, ""]);
  }

  function removeDraft(index) {
    setDrafts((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      return next.length ? next : [""];
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onChange(drafts);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err.message || "儲存失敗，請再試一次");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="family-notes-editor">
      <div className="family-note-draft-list">
        {drafts.map((draft, index) => (
          <article className="family-note-draft-card" key={`family-note-draft-${index}`}>
            <label htmlFor={`family-note-draft-${index}`}>提醒 {index + 1}</label>
            <textarea
              id={`family-note-draft-${index}`}
              value={draft}
              onChange={(event) => updateDraft(index, event.target.value)}
              rows={3}
              aria-label={`家庭群組提醒 ${index + 1}`}
              placeholder="例如：回診前 8 小時不要吃東西、記得帶健保卡"
            />
            <button type="button" className="secondary-action note-delete-action" onClick={() => removeDraft(index)}>
              刪除這則
            </button>
          </article>
        ))}
      </div>
      {error && <p className="error-msg">{error}</p>}
      <div className="family-notes-actions">
        <button type="button" className="secondary-action" onClick={addDraft}>
          新增一則
        </button>
        <button type="button" className="inline-action" onClick={handleSave} disabled={saving}>
          {saving ? "儲存中..." : saved ? "已儲存" : "儲存提醒"}
        </button>
      </div>
    </div>
  );
}

function FamilyNotesModal({ groupName, notes, onClose, onSave }) {
  return (
    <div className="modal-overlay">
      <div className="modal-content family-notes-modal">
        <div className="modal-header">
          <div>
            <p className="panel-eyebrow">{groupName}</p>
            <h2>編輯需要多留意</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-close">✕</button>
        </div>
        <div className="modal-body">
          <p className="helper-copy">每一則會成為一張家庭提醒卡，儲存在目前家庭群組，切換群組後會顯示各自的提醒。</p>
          <FamilyNotesEditor notes={notes} onChange={onSave} />
        </div>
      </div>
    </div>
  );
}
