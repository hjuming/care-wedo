import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import GroupManager from "./components/GroupManager";
import GroupSettings from "./components/GroupSettings";
import LoginSetup from "./components/LoginSetup";
import MobileBottomNav from "./components/MobileBottomNav";
import OcrResult from "./components/OcrResult";
import { patientData, medicines, timeline as initialTimeline } from "./data/patient";
import { confirmOcrDocument, createAppointment, fetchDashboard, joinGroup, markMedicationSlotStatus, ocrAnalyze, patchAppointment, patchMedication, updateProfile } from "./services/api";
import { initLineIdentity, loginWithLine, logoutLineIdentity } from "./services/liff";
import { trackError, trackEvent } from "./services/telemetry";
import { buildTodayTasks, formatTaipeiTodayLabel, groupMedicationsBySchedule } from "./services/todayTasks";
import PrivacyPage from "./components/PrivacyPage";
import TermsPage from "./components/TermsPage";
import aiAvatar from "./assets/ai-avatar.png";
import { isLineCallbackSearch, resolveCareWedoRoute, resolveInitialCareWedoRoute } from "./routing";


const IS_PROD = import.meta.env.PROD;

function todayInTaipei() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
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
  if (type === "inspection") return "檢查";
  if (type === "refill_reminder") return "領藥";
  return "回診";
}

function typeIcon(type) {
  if (type === "inspection") return "驗";
  if (type === "refill_reminder") return "藥";
  return "診";
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
    status: apt.status || "upcoming",
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
    reminder_text: med.reminder_text || "",
    time_slot: med.time_slot || "",
    meal_timing: med.meal_timing || "",
    scheduled_time: med.scheduled_time || "",
    taken_status: med.taken_status || "",
    active: med.active !== false,
    color: med.color || ["#b7791f", "#2f855a", "#2b6cb0", "#805ad5"][index % 4],
  };
}

function matchSearch(item, query) {
  if (!query) return true;
  return Object.values(item).join(" ").toLowerCase().includes(query.toLowerCase());
}

function dashboardHasCareData(data) {
  return Boolean((data?.appointments?.length || 0) + (data?.medications?.length || 0) + (data?.checklist?.length || 0));
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

function LandingPage() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Care WEDO 入口導覽">
        <a href="/" className="brand-home">Care WEDO</a>
        <div className="landing-nav-links">
          <a href="#features">功能</a>
          <a href="#plans">方案</a>
          <a href="#faq">FAQ</a>
          <a href="/login" className="nav-login-link">登入 / 註冊</a>
        </div>
      </nav>

      <section className="landing-hero" aria-label="Care WEDO 首頁">
        <div className="landing-hero-copy">
          <span className="landing-version">V 1.0</span>
          <h1>Care WEDO 陪你照顧最重要的人</h1>
          <p>
            結合 AI 照護提醒、醫療紀錄整理與家庭共享，協助家人更有秩序地陪伴長輩面對看診、用藥與日常健康管理。
          </p>
          <div className="landing-cta-row">
            <a className="primary-action" href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer">
              免費使用 LINE 照護小管家
            </a>
            <a className="secondary-action" href="/login">建立家庭照護空間</a>
          </div>
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
            <p>爸爸、媽媽、子女都看同一份照護紀錄。</p>
          </div>
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

      <section className="landing-section plan-section" id="plans">
        <div className="section-kicker">免費與收費</div>
        <h2>先用 LINE 試試，需要長期管理時再建立家庭照護空間。</h2>
        <div className="plan-cards">
          <article className="plan-card">
            <span>免費版</span>
            <h3>LINE 照護小管家</h3>
            <p>適合第一次體驗，透過 LINE 傳送看診單或藥袋照片，讓 AI 協助整理重點。</p>
            <a href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer">免費開始</a>
          </article>
          <article className="plan-card featured-plan">
            <span>收費版</span>
            <h3>家庭照護空間</h3>
            <p>適合長期照顧父母、長輩或慢性病家人的家庭，登入後可保存、共享、追蹤照護紀錄。</p>
            <a href="/login">建立照護空間</a>
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
            <button
              type="button"
              className="line-login-btn"
              onClick={handleLineLogin}
              disabled={loggingIn}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.494.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
              </svg>
              {loggingIn ? "正在開啟 LINE..." : "用 LINE 登入"}
            </button>
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
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [identity, setIdentity] = useState({ status: "loading", idToken: null, profile: null, message: null });
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showManualReminder, setShowManualReminder] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState(null);
  const [familyNotes, setFamilyNotes] = useState([
    "哪些藥不能吃、以前有沒有過敏",
    "看診前要不要量血壓、空腹、帶健保卡",
    "緊急時要打給誰、常去哪家醫院",
  ]);
  const dashboardRequestSeqRef = useRef(0);
  const dashboardCacheRef = useRef(new Map());
  const dashboardShellRef = useRef(null);

  const loadDashboard = useCallback(async (lineIdentity, profileId = null) => {
    const requestSeq = dashboardRequestSeqRef.current + 1;
    dashboardRequestSeqRef.current = requestSeq;
    const cacheKey = profileId ? String(profileId) : "default";

    try {
      const data = await fetchDashboard({ idToken: lineIdentity?.idToken, profileId });
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return data;
      }

      // Production: demo payload is only valid in dev. Redirect if received unexpectedly.
      if (IS_PROD && data?.mode === "demo") {
        window.location.replace("/login");
        return null;
      }

      const resolvedProfileId = data.active_profile_id || profileId || null;
      const resolvedCacheKey = resolvedProfileId ? String(resolvedProfileId) : cacheKey;
      const cachedProfileData = dashboardCacheRef.current.get(resolvedCacheKey);
      const nextData = cachedProfileData && dashboardHasCareData(cachedProfileData) && !dashboardHasCareData(data)
        ? mergeDashboardShell(cachedProfileData, data)
        : data;

      dashboardShellRef.current = {
        ...(dashboardShellRef.current || {}),
        ...nextData,
        appointments: [],
        medications: [],
        checklist: [],
      };

      dashboardCacheRef.current.set(resolvedCacheKey, nextData);
      if (!profileId) {
        dashboardCacheRef.current.set("default", nextData);
      }

      setDashboard(nextData);
      setDashboardError(null);
      if (resolvedProfileId) {
        setActiveProfileId(resolvedProfileId);
      }
      return data;
    } catch (err) {
      if (requestSeq !== dashboardRequestSeqRef.current) {
        return null;
      }
      // AUTH_REQUIRED or expired token in production → redirect to login
      if (IS_PROD && (err.code === "AUTH_REQUIRED" || err.message?.includes("idToken"))) {
        window.location.replace("/login");
        return null;
      }
      trackError("frontend.dashboard", err, { profileId });
      setDashboardError(err.message);
      return null;
    }
  }, []);

  const updateActiveDashboard = useCallback((updater) => {
    setDashboard((prev) => {
      if (!prev) return prev;
      const next = typeof updater === "function" ? updater(prev) : updater;
      const cacheProfileId = next.active_profile_id || activeProfileId;
      if (cacheProfileId) {
        dashboardCacheRef.current.set(String(cacheProfileId), next);
      }
      return next;
    });
  }, [activeProfileId]);

  async function handleProfileUpdate(updates) {
    if (!activeProfileId) {
      throw new Error("請先使用 LINE 登入並建立照護對象後再儲存。");
    }
    await updateProfile(activeProfileId, updates, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId);
    setShowEditProfile(false);
  }

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const lineIdentity = await initLineIdentity();
        if (!active || lineIdentity.status === "redirecting") return;

        // 登入閘門：unauthenticated 一律導向 /login
        if (lineIdentity.status === "unauthenticated") {
          if (!active) return;
          setIdentity(lineIdentity);
          window.location.replace("/login");
          return;
        }

        // Production: demo identity must never be treated as valid
        if (IS_PROD && lineIdentity.status === "demo") {
          if (!active) return;
          window.location.replace("/login");
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
        await loadDashboard(lineIdentity, Number.isFinite(preferredProfileId) && preferredProfileId > 0 ? preferredProfileId : null);
      } catch (err) {
        if (!active) return;
        // 正式環境發生錯誤代表無法驗證身分，導向 /login
        if (import.meta.env.PROD) {
          setIdentity({
            status: "unauthenticated",
            idToken: null,
            profile: null,
            message: err instanceof Error ? err.message : "登入失敗，請重新嘗試。",
          });
          window.location.replace("/login");
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
  const selectedProfile = careProfiles.find((profile) => profile.id === activeProfileId) || careProfiles[0] || null;

  const patient = (isPersonalMode && dashboard) 
    ? { ...dashboard.patient, name: selectedProfile?.display_name || dashboard.patient.name, age: calculateAge(selectedProfile) } 
    : (dashboard?.patient?.name ? dashboard.patient : patientData);
  const appointments = useMemo(() => {
    let source = [];
    if (isPersonalMode && dashboard) {
      source = dashboard.appointments || [];
    } else {
      source = dashboard?.appointments?.length ? dashboard.appointments : initialTimeline;
    }
    return source.map(normalizeAppointment).filter((item) => matchSearch(item, searchQuery));
  }, [dashboard, searchQuery, isPersonalMode]);

  const medications = useMemo(() => {
    let source = [];
    if (isPersonalMode && dashboard) {
      source = dashboard.medications || [];
    } else {
      source = dashboard?.medications?.length ? dashboard.medications : medicines;
    }
    return source.map(normalizeMedication).filter((item) => matchSearch(item, searchQuery));
  }, [dashboard, searchQuery, isPersonalMode]);

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
  const records = appointments.filter((item) => item.status === "completed");
  const hasCareData = dashboardHasCareData(dashboard);
  const todayDate = todayInTaipei();
  const todayLabel = useMemo(() => formatTaipeiTodayLabel(todayDate), [todayDate]);
  const todayTasks = useMemo(() => buildTodayTasks({
    today: todayDate,
    appointments,
  }), [appointments, todayDate]);
  const showContactDock = !IS_PROD || isPersonalMode;

  useEffect(() => {
    const key = `care_wedo_family_notes_${activeProfileId || "default"}`;
    const stored = window.localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) {
          setFamilyNotes(parsed);
          return;
        }
      } catch {
        // keep defaults
      }
    }
    setFamilyNotes([
      "哪些藥不能吃、以前有沒有過敏",
      "看診前要不要量血壓、空腹、帶健保卡",
      "緊急時要打給誰、常去哪家醫院",
    ]);
  }, [activeProfileId]);

  function handleFamilyNotesChange(notes) {
    const nextNotes = notes.map((item) => item.trim()).filter(Boolean);
    setFamilyNotes(nextNotes);
    window.localStorage.setItem(`care_wedo_family_notes_${activeProfileId || "default"}`, JSON.stringify(nextNotes));
  }

  async function handleAskFamily(task = null) {
    const careName = selectedProfile?.display_name || patient.name || "家人";
    let message = `${careName} 正在看 Care WEDO 今日照護，但看不太懂，需要家人協助確認。`;
    if (task?.kind === "medication") {
      message = `${careName} 忘記剛剛有沒有吃藥，請幫忙確認。先不要讓 ${careName} 重複吃藥。\n\n藥品：${task.title}\n時間：${task.time}\n內容：${[task.subtitle, task.detail].filter(Boolean).join("；") || "請協助查看這筆吃藥說明。"}`;
    } else if (task?.kind === "appointment") {
      message = `${careName} 正在準備看診，請幫忙確認時間、醫院和要帶的東西。\n\n時間：${task.time}\n內容：${[task.title, task.subtitle, task.detail].filter(Boolean).join("；") || "請協助查看這筆看診提醒。"}`;
    } else if (task) {
      message = `${careName} 正在看 Care WEDO 的「${task.title}」提醒，但看不太懂，需要家人協助確認。\n\n時間：${task.time}\n內容：${[task.subtitle, task.detail].filter(Boolean).join("；") || "請協助查看這筆照護提醒。"}`;
    }

    try {
      if (navigator.share) {
        await navigator.share({ text: message });
        return;
      }
      await navigator.clipboard?.writeText(message);
      window.alert("已幫你把求助文字複製好，可以貼到 LINE 給家人。");
    } catch {
      window.prompt("請把這段文字傳給家人：", message);
    }
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
        await loadDashboard(identity, activeProfileId);
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
    await loadDashboard(identity, activeProfileId);
  }

  async function handleMedicationTaken(group, status) {
    await markMedicationSlotStatus({
      medicationIds: group.medicationIds,
      status,
      idToken: identity.idToken,
      timeSlot: group.slot,
    });
    await loadDashboard(identity, activeProfileId);
  }

  async function handleManualReminderSave(payload) {
    if (!activeProfileId) {
      throw new Error("請先選擇照護對象。");
    }
    await createAppointment({ ...payload, profile_id: activeProfileId }, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId);
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
      hospital: payload.hospital || null,
      department: payload.department || payload.title || null,
      doctor: payload.doctor || null,
      location: payload.location || null,
      fasting_required: Boolean(payload.fasting_required),
      fasting_hours: payload.fasting_required ? payload.fasting_hours || 8 : null,
      notes: payload.notes || null,
      reminder_text: payload.notes || null,
      status: "upcoming",
    }, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId);
    setEditingAppointment(null);
  }

  async function handleDeleteAppointment(appointment) {
    if (!appointment?.id) return;
    if (!window.confirm("確定要刪除這筆行程或提醒嗎？刪除後首頁與未來行程不會再顯示。")) return;
    await patchAppointment(appointment.id, { status: "deleted" }, { idToken: identity.idToken });
    updateActiveDashboard((prev) => ({
      ...prev,
      appointments: (prev.appointments || []).filter((apt) => String(apt.id) !== String(appointment.id)),
    }));
    await loadDashboard(identity, activeProfileId);
  }

  function handleProfileChange(profileId) {
    trackEvent("frontend.profile_switch", { profileId });
    setActiveProfileId(profileId);
    window.localStorage.setItem("care_wedo_active_profile_id", String(profileId));
    const cached = dashboardCacheRef.current.get(String(profileId));
    if (cached) {
      setDashboard(mergeDashboardShell(cached, dashboardShellRef.current));
      setDashboardError(null);
    }
    loadDashboard(identity, profileId);
  }

  function handleSetupComplete() {
    // Reload dashboard after setup
    loadDashboard(identity, activeProfileId);
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
                <p className="profile-name">{selectedProfile?.display_name || patient.name || "洪爸爸"}</p>
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
                style={activeSection === section.id ? { "--item-color": section.color } : {}}
              >
                <span>{section.icon}</span>
                {section.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="content-area" data-active-section={activeSection}>
          {activeSection !== "overview" && (
            <div className="toolbar">
              <SectionHeading section={SECTIONS.find(s => s.id === activeSection)} />
              <label className="search-box">
                <span>搜尋</span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="找醫院、科別、藥名..."
                />
              </label>
            </div>
          )}

          {activeSection === "overview" && (
            <OverviewView
              todayLabel={todayLabel}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              todayTasks={todayTasks}
              nextAppointment={nextAppointment}
              urgentItems={urgentItems}
              familyNotes={familyNotes}
              hasCareData={hasCareData}
              patient={patient}
              selectedProfile={selectedProfile}
              onOpenCalendar={() => setActiveSection("calendar")}
              onOpenRecords={() => setActiveSection("records")}
              onOpenMeds={() => setActiveSection("meds")}
              onOpenFamily={() => setActiveSection("settings")}
              onOpenProfile={() => setShowEditProfile(true)}
              onUpload={handleUploadClick}
              onAddReminder={() => setShowManualReminder(true)}
              onEditAppointment={handleEditAppointment}
              onDeleteAppointment={handleDeleteAppointment}
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
              onDeleteAppointment={handleDeleteAppointment}
            />
          )}

          {activeSection === "meds" && (
            <MedicationView
              medications={medications}
              onUpload={handleUploadClick}
              onTaken={handleMedicationTaken}
            />
          )}

          {activeSection === "records" && (
            <RecordsView
              records={records}
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
              onGroupChange={() => loadDashboard(identity, activeProfileId)}
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

      {editingAppointment && (
        <ManualReminderModal
          mode="edit"
          initialAppointment={editingAppointment}
          onClose={() => setEditingAppointment(null)}
          onSave={handleAppointmentUpdate}
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
            <label>顯示名稱 (如：洪爸爸)</label>
            <input 
              value={formData.display_name} 
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })} 
              placeholder="請輸入稱呼"
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
                placeholder="例如：0912-345-678"
              />
            </div>
          </div>

          <div className="form-group">
            <label>EMAIL</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="example@email.com"
            />
          </div>

          <div className="form-group">
            <label>重要附註 (會顯示在側邊欄)</label>
            <textarea 
              value={formData.notes} 
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })} 
              placeholder="例如：過敏史、緊急聯絡電話、常拿的藥物..."
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


function ProfileSwitcher({ profiles, activeProfileId, onChange }) {
  if (!profiles.length) {
    return (
      <div className="profile-switcher empty">
        <p className="panel-eyebrow">正在看的資料</p>
        <strong>洪爸爸</strong>
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

function buildReminderFormData(appointment = null) {
  return {
    type: appointment?.type || "reminder",
    title: appointment?.department || appointment?.hospital || "",
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

function ManualReminderModal({ mode = "create", initialAppointment = null, onClose, onSave }) {
  const [formData, setFormData] = useState(() => initialAppointment ? buildReminderFormData(initialAppointment) : {
    type: "reminder",
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
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...formData,
        title: formData.title || formData.department || formData.hospital,
        department: formData.department || formData.title,
        fasting_hours: formData.fasting_required ? formData.fasting_hours : null,
      });
    } catch (err) {
      setError(err.message || "新增提醒失敗");
    } finally {
      setSaving(false);
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
            <div className="form-row-two">
              <div className="form-group">
                <label>提醒類型</label>
                <select
                  value={formData.type}
                  onChange={(event) => setFormData({ ...formData, type: event.target.value })}
                >
                  <option value="reminder">提醒</option>
                  <option value="clinic_visit">門診</option>
                  <option value="inspection">檢查</option>
                  <option value="refill_reminder">領藥</option>
                </select>
              </div>
              <div className="form-group">
                <label>提醒名稱</label>
                <input
                  value={formData.title}
                  onChange={(event) => setFormData({ ...formData, title: event.target.value })}
                  placeholder="例如：腫瘤醫學部回診"
                  required
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>日期</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(event) => setFormData({ ...formData, date: event.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>時間</label>
                <input
                  type="text"
                  value={formData.time}
                  onChange={(event) => setFormData({ ...formData, time: event.target.value })}
                  placeholder="例如：07:45 或 7:45-19:00"
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>醫院 / 地點</label>
                <input
                  value={formData.hospital}
                  onChange={(event) => setFormData({ ...formData, hospital: event.target.value })}
                  placeholder="例如：臺大醫院"
                />
              </div>
              <div className="form-group">
                <label>診別 / 科別</label>
                <input
                  value={formData.department}
                  onChange={(event) => setFormData({ ...formData, department: event.target.value })}
                  placeholder="例如：藥局、腫瘤醫學部"
                />
              </div>
            </div>
            <div className="form-row-two">
              <div className="form-group">
                <label>醫師</label>
                <input
                  value={formData.doctor}
                  onChange={(event) => setFormData({ ...formData, doctor: event.target.value })}
                  placeholder="醫師姓名"
                />
              </div>
              <div className="form-group">
                <label>詳細地點</label>
                <input
                  value={formData.location}
                  onChange={(event) => setFormData({ ...formData, location: event.target.value })}
                  placeholder="例如：總院西址門診藥局"
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
                placeholder="例如：帶健保卡、處方箋正本"
                rows={4}
              />
            </div>
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
  nextAppointment,
  urgentItems,
  familyNotes,
  hasCareData,
  patient,
  selectedProfile,
  onOpenCalendar,
  onOpenRecords,
  onOpenMeds,
  onOpenFamily,
  onOpenProfile,
  onUpload,
  onAddReminder,
  onEditAppointment,
  onDeleteAppointment,
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
      </section>

      <section className="today-hero-panel">
        <div className="today-count-block">
          <span>{todayTasks.length ? `今天有 ${todayTasks.length} 件事` : "今天沒有新的照護事項"}</span>
          <p>{todayTasks.length ? "照時間慢慢做就好。" : "可以查看未來行程，或新增一筆提醒。"}</p>
        </div>
        <label className="search-box today-search-box">
          <span>搜尋</span>
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="依醫院、診別、醫師篩選"
          />
        </label>
      </section>

      <section className="today-timeline-panel">
        {todayTasks.length ? (
          <div className="elder-task-list">
            {todayTasks.map((task) => {
              const isDone = locallyDoneTaskIds.has(task.id) || task.status === "completed";
              return (
                <article key={task.id} className={`elder-task-card ${isDone ? "is-done" : ""} ${task.needsReview ? "needs-review" : ""}`}>
                  <div className="elder-task-time">{task.time}</div>
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
                    {task.kind === "appointment" && (
                      <div className="card-inline-actions">
                        <button type="button" className="secondary-action subtle" onClick={() => onEditAppointment(task.sourceId)}>
                          編輯
                        </button>
                        <button type="button" className="secondary-action subtle danger-subtle" onClick={() => onDeleteAppointment({ id: task.sourceId })}>
                          刪除
                        </button>
                      </div>
                    )}
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
              <h3>{nextAppointment.department}</h3>
              <p>{[nextAppointment.hospital, nextAppointment.doctor && `${nextAppointment.doctor}醫師`].filter(Boolean).join(" ｜ ")}</p>
              <button type="button" className="inline-action" onClick={onOpenCalendar}>看看診清單</button>
            </>
          ) : (
            <p className="empty-state">目前沒有下一次看診安排。</p>
          )}
        </article>

        <article className="summary-panel">
          <p className="panel-eyebrow">需要多留意</p>
          <div className="attention-list">
            {urgentItems.length || familyNotes.length ? (
              <>
                {urgentItems.map((item) => (
              <article key={item.id} className="attention-item">
                <strong>{typeLabel(item.type)}：{item.department}</strong>
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

function CalendarView({ appointments, onUpload, onAddReminder, onEditAppointment, onDeleteAppointment }) {
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
            <div className="event-type">{typeIcon(apt.type)}</div>
            <div>
              <p className="event-date">{formatDateLabel(apt.date, apt.time)}</p>
              <h3>{apt.department}</h3>
              <p>{[apt.hospital, apt.doctor && `${apt.doctor}醫師`, apt.number && `${apt.number}號`].filter(Boolean).join(" ｜ ")}</p>
              {apt.location && <p className="location-line">地點：{apt.location}</p>}
              {apt.notes && <p className="soft-note">{apt.notes}</p>}
              <div className="event-row-actions">
                <button type="button" className="secondary-action subtle" onClick={() => onEditAppointment(apt)}>編輯</button>
                <button type="button" className="secondary-action subtle danger-subtle" onClick={() => onDeleteAppointment(apt)}>刪除</button>
              </div>
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

function MedicationView({ medications, onUpload, onTaken }) {
  const [savingSlot, setSavingSlot] = useState(null);
  const [expandedMedicationId, setExpandedMedicationId] = useState(null);
  const medicationGroups = useMemo(() => groupMedicationsBySchedule(medications), [medications]);

  async function handleSlotStatus(group, status) {
    setSavingSlot(`${group.slot}-${status}`);
    try {
      await onTaken?.(group, status);
    } finally {
      setSavingSlot(null);
    }
  }

  return (
    <div className="medicine-grid">
      {medicationGroups.length ? medicationGroups.map((group) => (
        <section key={group.slot} className="medicine-time-group">
          <div className="medicine-slot-head">
            <div>
              <p>{group.medications.length} 種藥</p>
              <h3>{group.label}</h3>
            </div>
            <div className="medicine-slot-actions">
              {!group.medications.every((med) => med.taken_status === "taken") && (
                <span className="medicine-slot-status">尚未記錄</span>
              )}
              <button type="button" className="primary-action compact-action" onClick={() => handleSlotStatus(group, "taken")} disabled={savingSlot === `${group.slot}-taken` || group.medications.every((med) => med.taken_status === "taken")}>
                {savingSlot === `${group.slot}-taken` ? "記錄中…" : group.medications.every((med) => med.taken_status === "taken") ? "已吃" : "吃了"}
              </button>
            </div>
          </div>
          <div className="medicine-chip-list">
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
                    <dl>
                      <div><dt>全名</dt><dd>{med.name || "藥名待確認"}</dd></div>
                      <div><dt>份量</dt><dd>{med.dosage || "待確認"}</dd></div>
                      {[med.schedule.timeLabel, med.schedule.mealTimingLabel].filter(Boolean).length > 0 && (
                        <div><dt>時間</dt><dd>{[med.schedule.timeLabel, med.schedule.mealTimingLabel].filter(Boolean).join(" ｜ ")}</dd></div>
                      )}
                      {med.purpose && <div><dt>用途</dt><dd>{med.purpose}</dd></div>}
                      {med.warnings && <div><dt>注意</dt><dd>{med.warnings}</dd></div>}
                    </dl>
                  )}
                </article>
              );
            })}
          </div>
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

function RecordsView({ records, onUpload }) {
  const grouped = useMemo(() => {
    const groups = {};
    records.forEach(record => {
      if (!record.date || typeof record.date !== "string") return;
      // Defensive slice: only if it looks like YYYY-MM-DD
      const monthStr = record.date.includes("-") ? record.date.slice(0, 7) : "其他日期"; 
      if (!groups[monthStr]) groups[monthStr] = [];
      groups[monthStr].push(record);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  return (
    <div className="records-timeline-view">
      {grouped.length ? grouped.map(([month, items]) => (
        <section key={month} className="record-month-group">
          <h3 className="month-divider">{month.replace("-", " 年 ")} 月</h3>
          <div className="records-stack">
            {items.map(record => (
              <article key={record.id} className="records-row record-completed">
                <span className="record-date-col">{formatDateLabel(record.date)}</span>
                <span className="record-tag">{typeLabel(record.type)}</span>
                <div className="record-info">
                  <strong>{record.department}</strong>
                  <span>{record.hospital}</span>
                </div>
                <span className="record-status-tag">✓ 已完成</span>
              </article>
            ))}
          </div>
        </section>
      )) : (
        <EmptyGuide
          title="目前還沒有照護紀錄。"
          description="每一次看診、用藥調整、症狀觀察，都可以慢慢整理成家人看得懂的健康時間線。"
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
            <strong>{selectedProfile?.display_name || patient.name || "洪爸爸"}</strong>
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
  const [draft, setDraft] = useState(notes.join("\n"));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(notes.join("\n"));
  }, [notes]);

  function handleSave() {
    onChange(draft.split("\n"));
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="family-notes-editor">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={5}
        aria-label="家庭群組提醒"
      />
      <button type="button" className="inline-action" onClick={handleSave}>
        {saved ? "已儲存" : "儲存提醒"}
      </button>
    </div>
  );
}
