import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import GroupSettings from "./components/GroupSettings";
import LoginSetup from "./components/LoginSetup";
import MobileBottomNav from "./components/MobileBottomNav";
import OcrResult from "./components/OcrResult";
import { CalendarView, ManualReminderModal } from "./features/appointments/AppointmentView";
import MedicationView from "./features/medications/MedicationView";
import { CareDocumentUploadModal, ScanProgress, UploadGuide } from "./features/ocr/OcrWorkflow";
import { buildAppointmentTitle, formatDateLabel, isDateTodayOrFuture, normalizeDateInput, todayInTaipei, typeIcon, typeLabel } from "./features/shared/careFormatters";
import { patientData, medicines, timeline as initialTimeline } from "./data/patient";
import { confirmOcrDocument, createAppointment, deleteAppointment, deleteCareDocument, downloadAppointmentCalendarFile, downloadLocalAppointmentCalendarFile, fetchDashboard, fetchDocumentDetail, fetchDocumentFileUrl, fetchSessionIdentity, joinGroup, markMedicationSlotStatus, ocrAnalyze, ocrAnalyzeText, patchAppointment, patchMedication, updateActiveProfilePreference, updateFamilyNotes, updateProfile, updateProfileOrder, uploadCareDocument } from "./services/api";
import { buildExternalAppUrl, buildLiffEntryUrl, buildLineAppLiffFallbackUrl, initLineIdentity, isLineInAppBrowser, loginWithLine, logoutLineIdentity, openDashboardInExternalBrowserAfterLineCallback, openUrlInExternalBrowser, resetCareWedoSessionAndReturnHome, shouldOpenLiffEntryUrl } from "./services/liff";
import { completeSupabaseOAuthCallback, hasSupabaseAuthConfig, loginWithGoogle, signInWithSupabasePassword } from "./services/supabaseAuth";
import { safeReviewLoginEnabled } from "./services/safeReviewLogin";
import { deriveCareCapabilities } from "./services/capabilities";
import { trackError, trackEvent } from "./services/telemetry";
import { buildTodayTasks, formatTaipeiTodayLabel, groupMedicationsBySchedule, hasSameDayTasks } from "./services/todayTasks";
import { buildSearchSuggestions, matchSearch } from "./services/search";
import { dedupeAppointments } from "./services/appointmentDedupe";
import PrivacyPage from "./components/PrivacyPage";
import TermsPage from "./components/TermsPage";
import aiAvatar from "./assets/ai-avatar.png";
import { isLineCallbackSearch, resolveCareWedoRoute } from "./routing";


const IS_PROD = import.meta.env.PROD;

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
  { id: "calendar", label: "照護排程", mobileLabel: "排程", icon: "□", color: "#5E8F9A" },
  { id: "records", label: "照護紀錄", mobileLabel: "紀錄", icon: "≡", color: "#B97832" },
  { id: "meds", label: "用藥管理", mobileLabel: "用藥", icon: "○", color: "#4F7D5A" },
  { id: "settings", label: "照護圈", mobileLabel: "照護圈", icon: "⚙", color: "#315F68" },
];

const MOBILE_SECTIONS = [
  { id: "overview", label: "今日照護", mobileLabel: "今天", icon: "⌂" },
  { id: "calendar", label: "照護排程", mobileLabel: "排程", icon: "□" },
  { id: "records", label: "照護紀錄", mobileLabel: "紀錄", icon: "≡" },
  { id: "meds", label: "用藥管理", mobileLabel: "用藥", icon: "○" },
  { id: "settings", label: "照護圈", mobileLabel: "照護圈", icon: "⚙" },
];

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
    created_at: apt.created_at || "",
    created_by_user_id: apt.created_by_user_id || null,
    duplicate_count: apt.duplicate_count,
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
    taken_by: med.taken_by || med.taken_by_name || med.confirmed_by || "",
    taken_at: med.taken_at || med.confirmed_at || "",
    active: med.active !== false,
    color: med.color || ["#b7791f", "#2f855a", "#2b6cb0", "#805ad5"][index % 4],
  };
}

function documentTypeLabel(type) {
  if (type === "medical_record") return "病歷";
  if (type === "medication_record") return "用藥紀錄";
  if (type === "lab_report") return "檢驗";
  if (type === "imaging_report") return "影像";
  if (type === "prescription") return "處方";
  if (type === "appointment_slip") return "預約單";
  return "文件";
}

function normalizeCareDocument(document, index) {
  const summary = document.ai_summary || {};
  return {
    id: document.id || `demo-doc-${index}`,
    group_id: document.group_id || null,
    profile_id: document.profile_id || null,
    document_type: document.document_type || "other",
    document_title: document.document_title || summary.document_title || document.original_file_name || "醫療文件",
    source_hospital: document.source_hospital || summary.source_hospital || "",
    document_date: document.document_date || summary.document_date || "",
    original_file_name: document.original_file_name || "",
    mime_type: document.mime_type || "",
    file_size_bytes: document.file_size_bytes || null,
    page_count: document.page_count || null,
    summary_status: document.summary_status || "pending",
    preserve_original_file: document.preserve_original_file !== false,
    has_original_file: Boolean(document.has_original_file),
    ai_summary: summary,
    status: document.status || "uploaded",
    captured_at: document.captured_at || "",
    created_at: document.created_at || "",
  };
}

function hasDisplayableCareDocument(document) {
  const title = String(document.document_title || "").trim();
  const summary = document.ai_summary || {};
  const briefing = summary.doctor_briefing || {};
  const hasBriefing = Object.values(briefing).some((value) => {
    if (Array.isArray(value)) return value.some((item) => String(item || "").trim());
    return Boolean(String(value || "").trim());
  });
  const hasMeaningfulTitle = title && title !== "醫療文件";

  return Boolean(
    document.has_original_file
    || hasMeaningfulTitle
    || document.source_hospital
    || document.document_date
    || document.original_file_name
    || document.page_count
    || hasBriefing
  );
}

function dashboardHasCareData(data) {
  return Boolean((data?.appointments?.length || 0) + (data?.medications?.length || 0) + (data?.documents?.length || 0) + (data?.checklist?.length || 0));
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
    pricing: shellData.pricing ?? profileData.pricing,
    ocr_used: shellData.ocr_used ?? profileData.ocr_used,
    ocr_limit: shellData.ocr_limit ?? profileData.ocr_limit,
    care_profiles: shellData.care_profiles?.length ? shellData.care_profiles : profileData.care_profiles,
  };
}

const AVATAR_MAX_SOURCE_SIZE = 5 * 1024 * 1024;
const AVATAR_CANVAS_SIZE = 480;
const CARE_WEDO_SUPPORT_EMAIL = "Care@wedopr.com";
const CARE_WEDO_PRICING = {
  currency_symbol: "$",
  recipientMonthly: 30,
  collaboratorMonthly: 10,
  includedCareProfilesDuringBeta: 1,
  freeMonthlyOcrLimit: 10,
  paidMonthlyOcrLimit: 100,
};
const CARE_WEDO_TEST_MODE_COPY = "目前為測試模式：不會實際扣款；費用與額度僅供流程驗證，正式規則會在付款前清楚確認。";

function normalizeCareWedoPricing(pricing = {}) {
  return {
    currency_symbol: pricing.currency_symbol || "$",
    recipientMonthly: Number(pricing.recipient_monthly ?? pricing.recipientMonthly ?? CARE_WEDO_PRICING.recipientMonthly),
    collaboratorMonthly: Number(pricing.collaborator_monthly ?? pricing.collaboratorMonthly ?? CARE_WEDO_PRICING.collaboratorMonthly),
    includedCareProfilesDuringBeta: Number(pricing.included_care_profiles_during_beta ?? pricing.includedCareProfilesDuringBeta ?? CARE_WEDO_PRICING.includedCareProfilesDuringBeta),
    freeMonthlyOcrLimit: Number(pricing.free_monthly_ocr_limit ?? pricing.freeMonthlyOcrLimit ?? CARE_WEDO_PRICING.freeMonthlyOcrLimit),
    paidMonthlyOcrLimit: Number(pricing.paid_monthly_ocr_limit ?? pricing.paidMonthlyOcrLimit ?? CARE_WEDO_PRICING.paidMonthlyOcrLimit),
  };
}

function formatCareWedoPricingCopy(pricing = CARE_WEDO_PRICING) {
  const normalized = normalizeCareWedoPricing(pricing);
  return `首位照護對象 ${normalized.currency_symbol}0/月；新增照護對象每位 ${normalized.currency_symbol}${normalized.recipientMonthly}/月、協作者每位 ${normalized.currency_symbol}${normalized.collaboratorMonthly}/月，付款前會清楚確認。`;
}
const CARE_WEDO_GROUP_LIMITS = {
  maxCareProfiles: 4,
  maxPaidCollaborators: 5,
  maxMembersIncludingOwner: 6,
};

function isQuotaLimitMessage(message = "") {
  return /本月.*(免費|AI).*?(次數|整理).*?用完|整理額度已用完|超過使用次數限制|升級(家庭|付費)方案|quota/i.test(String(message || ""));
}

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
    title: "看診時間容易忘",
    copy: "掛號單、檢查單、領藥日散在 LINE 和紙本裡，家人常常要重新找一次。",
  },
  {
    title: "藥袋看不太懂",
    copy: "藥名很長、字又小。長輩需要的是：什麼時候吃、要不要注意。",
  },
  {
    title: "家人資訊不同步",
    copy: "誰上傳、誰陪診、誰確認過，最好有一份大家都看得到的紀錄。",
  },
];

const LANDING_SOLUTIONS = [
  "LINE 上傳前先選家人，資料自動歸到正確照護對象",
  "看診單與領藥單整理成短提醒，不用讀長篇文字",
  "藥袋資訊完整存入資料庫，LINE 只回長輩需要知道的重點",
  "家人登入後可查看今日照護、未來行程、吃藥提醒與資料保存",
];

const LANDING_WORKFLOW = [
  {
    step: "01",
    title: "先選家人",
    copy: "LINE 會顯示姓名標籤，點一下就知道這次資料要存給誰。",
  },
  {
    step: "02",
    title: "再拍單子",
    copy: "藥袋、處方箋、掛號單或預約單都可以先拍照傳給小管家。",
  },
  {
    step: "03",
    title: "收到短提醒",
    copy: "長輩只看重點：日期、地點、要做什麼、要帶什麼。",
  },
];

const LANDING_PREVIEW_ITEMS = [
  {
    label: "今天 08:00",
    title: "媽媽心臟科回診",
    copy: "記得帶健保卡、上次檢查報告。",
  },
  {
    label: "晚餐後",
    title: "高血壓藥 1 顆",
    copy: "家人已確認，今晚不用再重複提醒。",
  },
  {
    label: "上傳完成",
    title: "藥袋已整理成用藥清單",
    copy: "下次看診可直接開給醫師看。",
  },
];

const LANDING_ONBOARDING_STEPS = [
  {
    step: "1",
    title: "按「用 LINE 綁定帳號」",
    copy: "先完成 LINE 登入，家人才看得到資料。",
  },
  {
    step: "2",
    title: "LINE 會跳出確認畫面",
    copy: "照著 LINE 畫面按確認，不用下載 App。",
  },
  {
    step: "3",
    title: "完成後開始收到提醒",
    copy: "看診與用藥提醒會集中在 Care WEDO。",
  },
  {
    step: "4",
    title: "不會操作就問小管家",
    copy: "協助綁定、建立家人資料，說明提醒怎麼用。",
  },
];

const LANDING_PAGE_ENTRIES = [
  {
    title: "功能導覽",
    copy: "看 Care WEDO 如何把單子整理成短提醒。",
    href: "/features",
  },
  {
    title: "方案比較",
    copy: "看免費版、照護圈升級與加人加資料怎麼算。",
    href: "/pricing",
  },
  {
    title: "第一次使用",
    copy: "照著 LINE 綁定、加入小管家、拍單子的順序開始。",
    href: "/guide",
  },
];

const FREE_FEATURES = [
  ["LINE 照護小管家", true, true],
  ["上傳前選擇照護對象", true, true],
  ["看診單、藥袋、預約單 AI 解析", "10 筆/月", "每位照護對象 100 筆/月"],
  ["長輩友善短提醒", true, true],
  ["給醫生看的用藥總表", true, true],
  ["吃藥提醒與資料保存", "保留最近 30 天；不開放歷史查詢", "完整保存與查詢"],
  ["照護圈協作", false, "最多 5 位協作者"],
  ["照護對象", "1 位", "最多 4 位"],
  ["照護協作者", "不含協作者", "最多 5 位"],
  ["今日照護與未來行程", true, true],
  ["完整歷史紀錄與健康時間線", false, "完整保存與查詢"],
  ["正式版月費訂閱", "$0", "首位測試期減免，增加才收費"],
];

const PLAN_TIERS = [
  { name: "Free", label: "免費版", price: "$0/月", copy: "1 位照護對象、每月 10 筆 AI 整理，可看未來提醒；最近 30 天資料會保存但不開放歷史查詢。", featured: false },
  { name: "Care Circle", label: "照護圈升級", price: "首位減免，增加才收費", copy: "開放測試期首位主要照護對象減免 $30/月；新增照護對象或協作者才收費。", featured: true },
  { name: "Helper", label: "增加照護協作者", price: "+$10/人/月", copy: "可協助上傳、編輯、查看照護資料；不可變更付款與成員權限。" },
  { name: "Care Recipient", label: "增加照護對象", price: "+$30/人/月", copy: "每增加一位爸爸、媽媽、自己或其他照護對象，加收資料保存費。" },
];

const LANDING_FAQS = [
  {
    question: "Care WEDO 是什麼？",
    answer: "Care WEDO 是給長輩與家人的 LINE 醫療照護小管家。長輩用 LINE 傳醫院單子，系統協助整理成看得懂的提醒與家庭照護紀錄。",
  },
  {
    question: "Care WEDO 可以診斷疾病嗎？",
    answer: "不可以。Care WEDO 是照護資訊整理與提醒工具，不取代醫師診斷、藥師建議或正式醫療判斷。",
  },
  {
    question: "Care WEDO 可以整理哪些資料？",
    answer: "目前可整理看診單、藥袋、處方箋、領藥資訊、掛號預約單與一般照護提醒。資料會存到對應照護對象底下，方便家人回頭查。",
  },
  {
    question: "Free 和照護圈升級差在哪裡？",
    answer: "測試期間一般測試帳號開放照護圈升級體驗。正式版會保留 Free 體驗；Free 可保存最近 30 天資料但不開放歷史查詢，照護圈升級提供每位照護對象 100 筆/月整理額度、家庭協作、多位照護對象與完整保存。",
  },
  {
    question: "長輩一定要會用系統嗎？",
    answer: "不一定。長輩可以只用 LINE 收提醒；家人負責登入後台、查看清單與修改資料。",
  },
  {
    question: "上傳前為什麼要先選照護對象？",
    answer: "如果家中有多位長輩，先選姓名可以讓單子直接存到正確的人。系統不確定時，也會先請使用者確認。",
  },
  {
    question: "圖片和紀錄會被保存嗎？",
    answer: "會。系統會保存上傳文件與解析資料；重複上傳時，提醒與藥品會盡量更新同一筆，避免清單混亂。",
  },
  {
    question: "重複上傳同一張單子會怎麼處理？",
    answer: "系統會保存原始上傳紀錄，並盡量把相同的提醒或藥品更新到既有資料，避免家人的清單出現太多重複項目。",
  },
  {
    question: "測試期間需要付費嗎？",
    answer: "第一位主要照護對象在開放測試期減免 $30/月。若新增照護對象或協作者，會在付款前清楚顯示月費並前往綠界安全付款。",
  },
  {
    question: "家人可以一起看同一份紀錄嗎？",
    answer: "可以。家庭群組可讓家人一起查看今日照護、未來行程、吃藥提醒與照護紀錄。測試期間此功能開放使用。",
  },
  {
    question: "資料有錯可以修改嗎？",
    answer: "可以。家人或協作者登入後，統一到「照護圈」管理中心處理照護對象、手動提醒與家庭提醒；長輩頁面只保留查看、拍照新增與完成確認。",
  },
  {
    question: "Care WEDO 適合誰使用？",
    answer: "適合需要協助整理看診、領藥、吃藥與檢查提醒的家庭，特別是照顧父母、慢性病家人或多位照護對象的主要照護者。",
  },
];

const FEEDBACK_TOPICS = [
  "LINE 上傳流程",
  "提醒文案是否看得懂",
  "今日照護首頁",
  "吃藥提醒",
  "家人協作",
  "其他建議",
];

function FeatureValue({ value }) {
  if (value === true) return <span className="feature-yes">有</span>;
  if (value === false) return <span className="feature-no">無</span>;
  return <span>{value}</span>;
}

function PlanTierTable({ reviewMode = false }) {
  if (reviewMode) {
    return (
      <div className="pricing-test-mode-card" role="status">
        <strong>STAGING 測試模式</strong>
        <p>{CARE_WEDO_TEST_MODE_COPY}</p>
      </div>
    );
  }
  return (
    <div className="plan-tier-table pricing-model-table" role="table" aria-label="Care WEDO 版本 A 收費方式">
      <div className="plan-tier-row plan-tier-head" role="row">
        <strong>項目</strong>
        <strong>月費</strong>
        <strong>說明</strong>
      </div>
      {PLAN_TIERS.map((tier) => (
        <div className="plan-tier-row" role="row" key={tier.name}>
          <span className="plan-tier-name">
            <span className="plan-tier-english">{tier.name}</span>
            <span className="plan-tier-local">
              {tier.label}
              {tier.featured && <span className="plan-tier-star" aria-label="推薦方案">★</span>}
            </span>
          </span>
          <span className="plan-tier-price">{tier.price}</span>
          <span>{tier.copy}</span>
        </div>
      ))}
    </div>
  );
}

function PlanDetailsModal({ onClose, reviewMode = safeReviewLoginEnabled() }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content plan-details-modal" role="dialog" aria-modal="true" aria-labelledby="plan-details-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-kicker">照護圈升級方案</p>
            <h2 id="plan-details-title">功能規劃</h2>
          </div>
          <button type="button" className="btn-close" onClick={onClose} aria-label="關閉">×</button>
        </div>
        <div className="modal-body">
          <PlanTierTable reviewMode={reviewMode} />
          {reviewMode ? (
            <p className="helper-copy">這個 staging 入口只用來驗證家庭協作流程，不會建立付款或扣款動作。</p>
          ) : (
            <>
              <div className="pricing-note-card">
                <strong>版本 A 收費方向</strong>
                <p>免費可以先照顧 1 位家人，最近 30 天資料會保存但不開放歷史查詢。開放測試期首位照護對象減免 $30/月；新增照護對象或協作者才會進入付款確認。</p>
              </div>
              <p className="helper-copy">付款由綠界安全處理，Care WEDO 不保存信用卡資料。付款與資料問題可聯絡 <a href={`mailto:${CARE_WEDO_SUPPORT_EMAIL}`}>{CARE_WEDO_SUPPORT_EMAIL}</a>。</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanUpgradeModal({ reason = "quota", onClose, onViewPlans, pricing = CARE_WEDO_PRICING }) {
  const isHistory = reason === "history";
  const reviewMode = safeReviewLoginEnabled();
  const normalizedPricing = normalizeCareWedoPricing(pricing);
  const title = isHistory ? "歷史紀錄是照護圈功能" : "本月免費整理額度已用完";
  const kicker = isHistory ? "歷史查詢" : "整理額度";
  const heroTitle = isHistory
    ? "Free 會保留最近 30 天資料，但不開放歷史查詢。"
    : "升級照護圈後可以繼續保存新資料，並查看完整歷史紀錄。";
  const heroCopy = isHistory
    ? "升級照護圈後，可以查看完整歷史紀錄與健康時間線，家人回診前也比較容易一起確認過去資料。"
    : "開放測試期首位照護對象減免；若新增照護對象或協作者，付款前會清楚確認。也可以下個月再繼續使用免費整理額度。";
  const secondaryActionLabel = isHistory ? "先看未來安排" : "先不要保存";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content quota-upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="quota-upgrade-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-kicker">{kicker}</p>
            <h2 id="quota-upgrade-title">{title}</h2>
          </div>
          <button type="button" className="btn-close" onClick={onClose} aria-label="關閉">×</button>
        </div>
        <div className="modal-body">
          <div className="quota-upgrade-hero">
            <strong>{heroTitle}</strong>
            <p>{heroCopy}</p>
          </div>
          {reviewMode ? (
            <div className="pricing-test-mode-card" role="status">
              <strong>STAGING 測試模式</strong>
              <p>{CARE_WEDO_TEST_MODE_COPY}</p>
            </div>
          ) : (
            <>
              <div className="quota-upgrade-options" aria-label="版本 A 收費方式">
                <article>
                  <span>首位照護對象</span>
                  <strong>{normalizedPricing.currency_symbol}0/月</strong>
                  <p>開放測試期減免；啟用家庭群組協作與完整歷史保存。</p>
                </article>
                <article>
                  <span>整理額度</span>
                  <strong>{normalizedPricing.paidMonthlyOcrLimit} 筆/月</strong>
                  <p>每位照護對象各自計算。</p>
                </article>
                <article>
                  <span>增加照護對象</span>
                  <strong>+{normalizedPricing.currency_symbol}{normalizedPricing.recipientMonthly}/人/月</strong>
                  <p>每多照顧一位家人加一份保存空間。</p>
                </article>
              </div>
              <p className="helper-copy">Free 會保留最近 30 天資料，但歷史查詢與完整保存是照護圈功能；{formatCareWedoPricingCopy(normalizedPricing)} Care WEDO 目前透過綠界安全付款，後續可再納入藍新等金流。</p>
            </>
          )}
          <div className="quota-upgrade-actions">
            <button type="button" className="primary-action" onClick={onViewPlans}>查看方案</button>
            <button type="button" className="secondary-action" onClick={onClose}>{secondaryActionLabel}</button>
            <a className="inline-action" href={`mailto:${CARE_WEDO_SUPPORT_EMAIL}`}>聯絡客服</a>
          </div>
        </div>
      </div>
    </div>
  );
}

async function sendFeedbackEmail(formData) {
  const cleanName = formData.name?.trim() || "Care WEDO 使用者";
  const cleanEmail = formData.email?.trim();
  const cleanMessage = formData.message?.trim();

  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: cleanName,
      email: cleanEmail,
      topic: formData.topic,
      message: cleanMessage,
    }),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "回饋暫時送不出去，請稍後再試。");
  }
}

function LineIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.494.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
    </svg>
  );
}

function GoogleIcon() {
  return (
    <span className="google-login-mark" aria-hidden="true">G</span>
  );
}

function CareHelperIcon() {
  return (
    <svg className="care-helper-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.75 6.9C4.75 4.75 6.5 3 8.65 3h6.7c2.15 0 3.9 1.75 3.9 3.9v4.55c0 2.15-1.75 3.9-3.9 3.9h-2.86l-4.23 3.3c-.56.43-1.37.04-1.37-.67v-2.72A3.9 3.9 0 0 1 4.75 11.45V6.9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M12 7.25v4.5M9.75 9.5h4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
    </svg>
  );
}

function LineLoginAction({ className = "", loggingIn = false, label = "用 LINE 登入", loadingLabel = "正在開啟 LINE...", onLogin }) {
  const isMobile = shouldOpenLiffEntryUrl();
  const loginHref = isMobile ? buildLineAppLiffFallbackUrl() : buildLiffEntryUrl();

  function handleClick(event) {
    if (loggingIn) {
      event.preventDefault();
      return;
    }
    if (!isMobile) {
      event.preventDefault();
      onLogin?.();
    }
  }

  return (
    <span className="line-login-action-stack">
      <a
        className={`line-login-btn ${className}`.trim()}
        href={loginHref}
        onClick={handleClick}
        aria-disabled={loggingIn ? "true" : undefined}
      >
        <LineIcon />
        {loggingIn ? loadingLabel : label}
      </a>
    </span>
  );
}

function GoogleLoginAction({ loggingIn = false, disabled = false, onLogin }) {
  function handleClick(event) {
    event.preventDefault();
    if (loggingIn || disabled) return;
    onLogin?.();
  }

  return (
    <button
      type="button"
      className="google-login-btn"
      onClick={handleClick}
      disabled={loggingIn || disabled}
    >
      <GoogleIcon />
      {loggingIn ? "正在開啟 Google..." : "用 Google 登入後台"}
    </button>
  );
}

function ProductPreviewPanel() {
  return (
    <div className="landing-hero-panel landing-product-preview" aria-label="Care WEDO 提醒預覽">
      <div className="preview-phone-header">
        <span>今日照護</span>
        <strong>家人一起看得懂</strong>
      </div>
      <div className="preview-reminder-list">
        {LANDING_PREVIEW_ITEMS.map((item) => (
          <article key={item.title} className="preview-reminder-card">
            <span>{item.label}</span>
            <strong>{item.title}</strong>
            <p>{item.copy}</p>
          </article>
        ))}
      </div>
      <div className="preview-line-bubble">
        <span>LINE 小管家</span>
        <p>拍下藥袋或預約單，就整理成短提醒。</p>
      </div>
    </div>
  );
}

function OnboardingGuidePanel() {
  return (
    <div className="landing-hero-panel landing-hero-guide" aria-label="第一次使用導引">
      <div className="hero-guide-header">
        <span>第一次使用照這樣做</span>
        <strong>兩分鐘完成綁定</strong>
      </div>
      <ol className="hero-guide-steps">
        {LANDING_ONBOARDING_STEPS.map((item) => (
          <li key={item.step}>
            <span>{item.step}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.copy}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="hero-helper-card">
        <strong>也要加入 LINE 照護小管家好友</strong>
        <p>加入後才能上傳圖片、解析圖片與文字資料，並接收看診與用藥提醒通知。</p>
      </div>
    </div>
  );
}

function LandingPage({ variant = "home" }) {
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [showPlanDetails, setShowPlanDetails] = useState(false);
  const isDetailsPage = variant === "details";
  const isGuidePage = variant === "guide";
  const isPricingPage = variant === "pricing";
  const reviewMode = safeReviewLoginEnabled();
  const pricing = normalizeCareWedoPricing(CARE_WEDO_PRICING);
  const showDetailedContent = isDetailsPage || isGuidePage || isPricingPage;
  const heroMode = isGuidePage ? "guide" : isPricingPage ? "pricing" : isDetailsPage ? "features" : "home";
  const heroContent = {
    home: {
      kicker: "給主要照顧者與家人",
      title: ["幫家人記住", "看診、用藥", "與照護提醒。"],
      desktop: "拍下藥袋、處方箋或預約單，Care WEDO 會整理成家人看得懂的提醒。長輩用 LINE 收重點，家人登入後台看完整紀錄。",
      mobile: ["拍下藥袋、處方箋或預約單。", "系統整理成家人看得懂的提醒。"],
      primaryLabel: "加入 LINE 小管家",
      secondaryHref: "/guide",
      secondaryLabel: "看第一次怎麼用",
    },
    features: {
      kicker: "了解 Care WEDO",
      title: ["把看診、用藥", "與提醒整理成", "家人看得懂。"],
      desktop: "這裡整理完整功能、方案、回饋與常見問題。你可以先看 Care WEDO 如何把零散單據變成家庭照護紀錄。",
      mobile: ["看 Care WEDO 如何整理單據、提醒與家人協作。", "第一次使用者可以先看教學。"],
      primaryLabel: "用 LINE 開始",
      secondaryHref: "/guide",
      secondaryLabel: "第一次使用教學",
    },
    guide: {
      kicker: "第一次使用 Care WEDO",
      title: ["先加入小管家，", "再綁定帳號，", "拍照就能開始。"],
      desktop: "不需要下載新的 App。照著 LINE 畫面完成綁定後，選家人、拍單子，系統會把日期、地點、用藥與提醒整理成短訊息。",
      mobile: ["不用下載新 App。", "照著 LINE 畫面完成綁定，再拍單子。"],
      primaryLabel: "用 LINE 綁定帳號",
      secondaryHref: "/features",
      secondaryLabel: "先看功能",
    },
    pricing: {
      kicker: "Free / 照護圈升級",
      title: ["先免費使用，", "需要長期保存", "再升級。"],
      desktop: "開放測試期首位照護對象減免；新增照護對象或協作者才收費。Free 可先整理近期資料，照護圈升級適合長期照顧多位家人。",
      mobile: ["首位照護對象測試期減免。", "增加家人或協作者才收費。"],
      primaryLabel: "建立家庭協作",
      secondaryHref: "/guide",
      secondaryLabel: "看使用流程",
    },
  }[heroMode];
  const [feedbackForm, setFeedbackForm] = useState({
    name: "",
    email: "",
    topic: FEEDBACK_TOPICS[0],
    message: "",
  });
  const [feedbackStatus, setFeedbackStatus] = useState({ state: "idle", message: "" });

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

  function handleFeedbackChange(event) {
    const { name, value } = event.target;
    setFeedbackForm((current) => ({ ...current, [name]: value }));
  }

  async function handleFeedbackSubmit(event) {
    event.preventDefault();
    if (!feedbackForm.message.trim()) {
      setFeedbackStatus({ state: "error", message: "請先寫下您的建議。" });
      return;
    }
    if (!feedbackForm.email.trim()) {
      setFeedbackStatus({ state: "error", message: "請留下 Email，我們才寄得到確認信。" });
      return;
    }

    setFeedbackStatus({ state: "sending", message: "正在送出..." });
    try {
      await sendFeedbackEmail(feedbackForm);
      trackEvent("landing_feedback_sent", { topic: feedbackForm.topic });
      setFeedbackStatus({ state: "success", message: "收到，謝謝您的回饋。" });
      setFeedbackForm({
        name: "",
        email: "",
        topic: FEEDBACK_TOPICS[0],
        message: "",
      });
    } catch (err) {
      trackError("landing_feedback_failed", err, { topic: feedbackForm.topic });
      setFeedbackStatus({
        state: "error",
        message: err instanceof Error ? err.message : "回饋暫時送不出去，請稍後再試。",
      });
    }
  }

  return (
    <main className={`landing-shell landing-shell-${heroMode}`}>
      <nav className="landing-nav" aria-label="Care WEDO 入口導覽">
        <a href="/" className="brand-home">Care WEDO</a>
        <div className="landing-nav-links">
          <a href="/features">功能說明</a>
          <a href="/guide">第一次使用</a>
          <a href="/pricing">方案</a>
          <a href="/features#feedback">回饋</a>
          <a href="/features#faq">FAQ</a>
          <a href="/privacy">隱私</a>
          <a className="nav-helper-link" href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer">聯繫小管家</a>
          <LineLoginAction className="nav-login-link nav-login-line-login" loggingIn={loggingIn} label="用 LINE 綁定 / 登入" loadingLabel="開啟 LINE..." onLogin={handleLineLogin} />
        </div>
      </nav>

      <section className="landing-hero" aria-label="Care WEDO 首頁">
        <div className="landing-hero-copy">
          <span className="landing-version">{heroContent.kicker}</span>
          <h1>
            {heroContent.title.map((line) => <span key={line}>{line}</span>)}
          </h1>
          <p className="landing-hero-intro landing-hero-intro-desktop">
            {heroContent.desktop}
          </p>
          <p className="landing-hero-intro landing-hero-intro-mobile">
            {heroContent.mobile.map((line) => <span key={line}>{line}</span>)}
          </p>
          <div className="landing-cta-row">
            <LineLoginAction className="landing-line-login landing-bind-account" loggingIn={loggingIn} label={heroContent.primaryLabel} onLogin={handleLineLogin} />
            <a className="landing-secondary-cta" href={heroContent.secondaryHref}>{heroContent.secondaryLabel}</a>
          </div>
          {loginError && <p className="notice-danger landing-login-error">{loginError}</p>}
          <p className="landing-trust-copy">Care WEDO 陪你照顧最重要的人。不取代醫師，只幫家人把照護資訊整理清楚。</p>
        </div>
        {isGuidePage ? <OnboardingGuidePanel /> : <ProductPreviewPanel />}
      </section>

      <a className="landing-helper-fab" href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer" aria-label="聯繫 LINE 照護小管家">
        <CareHelperIcon />
      </a>

      {showDetailedContent ? (
        <>
          <section className="landing-section details-intro-section" aria-label="Care WEDO 說明">
            <div className="section-kicker">
              {isGuidePage ? "第一次使用" : isPricingPage ? "方案與保存" : "了解 Care WEDO"}
            </div>
            <h2>
              {isGuidePage
                ? "照著 LINE 綁定、加入小管家、拍照上傳，就能開始整理照護資料。"
                : isPricingPage
                  ? "先免費使用，需要長期保存與家人協作時再升級。"
                  : "把看診、用藥與提醒整理成家人看得懂的照護資訊。"}
            </h2>
            <p>
              {isGuidePage
                ? "這頁只保留第一次上手最需要的步驟。若卡住，可以直接聯繫 LINE 照護小管家協助。"
                : isPricingPage
                  ? "首位照護對象測試期減免；增加家人或協作者前會清楚確認費用，不會靜默收費。"
                  : "這裡保留完整功能、方案、回饋與常見問題。第一次使用者可以先看教學，再完成 LINE 綁定。"}
            </p>
          </section>

          {isGuidePage && (
            <section className="landing-section guide-start-section" aria-label="第一次使用流程">
              <div className="section-kicker">照這個順序開始</div>
              <h2>先完成綁定，再拍單子。</h2>
              <div className="guide-start-layout">
                <OnboardingGuidePanel />
                <div className="guide-workflow-card">
                  <h3>上傳資料前，先選家人。</h3>
                  <div className="workflow-grid compact-workflow-grid">
                    {LANDING_WORKFLOW.map((item) => (
                      <article key={item.step} className="workflow-card">
                        <span>{item.step}</span>
                        <h3>{item.title}</h3>
                        <p>{item.copy}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {isPricingPage && (
            <section className="landing-section pricing-start-section" id="plans" aria-label="Care WEDO 方案">
              <div className="section-kicker">費用先講清楚</div>
              {reviewMode ? (
                <div className="pricing-test-mode-card" role="status">
                  <h2>STAGING 測試模式</h2>
                  <p>{CARE_WEDO_TEST_MODE_COPY}</p>
                  <p>本頁只驗證登入與家庭協作流程，不建立付款、扣款或正式方案承諾。</p>
                </div>
              ) : (
              <>
              <h2>Free 先試用，照護圈升級才做長期保存。</h2>
              <div className="plan-cards">
                <article className="plan-card">
                  <span>Free</span>
                  <h3>$0/月</h3>
                  <p>適合先試用。可照顧 1 位家人，每月 10 筆 AI 整理，查看接下來的提醒；最近 30 天資料會保存但不開放歷史查詢。</p>
                  <a href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer">加入 LINE 小管家</a>
                </article>
                <article className="plan-card featured-plan">
                  <button type="button" className="plan-name-trigger" onClick={() => setShowPlanDetails(true)}>版本 A 收費方式</button>
                  <h3>首位減免，增加才收費</h3>
                  <p>適合長期照顧父母、長輩或慢性病家人。開放測試期首位照護對象減免；{formatCareWedoPricingCopy(pricing)}</p>
                  <LineLoginAction loggingIn={loggingIn} label="建立家庭協作" onLogin={handleLineLogin} />
                </article>
              </div>
              <div className="pricing-example-band" aria-label="收費方式範例">
                <article>
                  <span>照護協作者</span>
                  <strong>+{pricing.currency_symbol}{pricing.collaboratorMonthly}/人/月</strong>
                  <p>可協助上傳、編輯、查看資料，不可更改付款與成員權限。</p>
                </article>
                <article>
                  <span>照護對象</span>
                  <strong>+{pricing.currency_symbol}{pricing.recipientMonthly}/人/月</strong>
                  <p>每多照顧一位家人，就增加一份長期資料保存空間。</p>
                </article>
                <article>
                  <span>客服與資料問題</span>
                  <strong>{CARE_WEDO_SUPPORT_EMAIL}</strong>
                  <p>付款由綠界安全處理，Care WEDO 不保存信用卡資料。</p>
                </article>
              </div>
              <p className="plan-beta-note">開放測試期間，首位主要照護對象減免；增加照護對象或協作者才會進入付款確認。</p>
              <div className="feature-table" role="table" aria-label="Care WEDO Free 與照護圈升級功能對照">
                <div className="feature-row table-head" role="row">
                  <strong>功能</strong>
                  <strong>Free</strong>
                  <strong>照護圈升級</strong>
                </div>
                {FREE_FEATURES.map(([feature, free, paid]) => (
                  <div className="feature-row" role="row" key={feature}>
                    <span>{feature}</span>
                    <FeatureValue value={free} />
                    <FeatureValue value={paid} />
                  </div>
                ))}
              </div>
              <div className="trust-note-panel">
                <div>
                  <p className="panel-eyebrow">資料怎麼保存</p>
                  <h3>我們保存整理後的重要文字資料。</h3>
                  <p>Care WEDO 使用雲端資料庫保存照護資料，並規劃定期備份。Free 會保留最近 30 天資料，但歷史查詢與完整保存是付費功能；若資料有問題、需要匯出或刪除，可聯絡客服信箱。</p>
                </div>
                <a href={`mailto:${CARE_WEDO_SUPPORT_EMAIL}`}>{CARE_WEDO_SUPPORT_EMAIL}</a>
              </div>
              </>
              )}
            </section>
          )}

          <section className="landing-section landing-entry-section" aria-label="快速入口">
        <div className="section-kicker">網站入口</div>
        <h2>第一次來，先看這三件事。</h2>
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
        <h2>照顧長輩，最怕重要事情散掉。</h2>
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
          <h2>資料完整保存，LINE 只講重點。</h2>
          <p>
            系統會把看診、領藥、藥袋與預約資訊存進資料庫。長輩收到的是短提醒；家人需要時再看完整清單。
          </p>
        </div>
        <ul className="solution-list">
          {LANDING_SOLUTIONS.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      {!isGuidePage && (
      <section className="landing-section workflow-section" aria-label="使用流程">
        <div className="section-kicker">使用流程</div>
        <h2>先選家人，再上傳照片。</h2>
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
      )}

      {!isPricingPage && (
      <section className="landing-section plan-section" id="plans">
        <div className="section-kicker">Free / 照護圈升級</div>
        <h2>先免費使用，需要查歷史再升級。</h2>
        <div className="plan-cards">
          <article className="plan-card">
            <span>Free</span>
            <h3>$0/月</h3>
            <p>適合先試用。可照顧 1 位家人，每月 10 筆 AI 整理，查看接下來的提醒；最近 30 天資料會保存但不開放歷史查詢。</p>
            <a href="https://lin.ee/xzbyyvf" target="_blank" rel="noopener noreferrer">LINE 照護小管家</a>
          </article>
          <article className="plan-card featured-plan">
            <button type="button" className="plan-name-trigger" onClick={() => setShowPlanDetails(true)}>版本 A 收費方式</button>
            <h3>首位減免，增加才收費</h3>
            <p>適合長期照顧父母、長輩或慢性病家人。開放測試期首位照護對象減免；新增照護對象 $30/位/月、協作者 $10/人/月。</p>
            <LineLoginAction loggingIn={loggingIn} label="建立家庭協作" onLogin={handleLineLogin} />
          </article>
        </div>
        <div className="pricing-example-band" aria-label="收費方式範例">
          <article>
            <span>照護協作者</span>
            <strong>+$10/人/月</strong>
            <p>可協助上傳、編輯、查看資料，不可更改付款與成員權限。</p>
          </article>
          <article>
            <span>照護對象</span>
            <strong>+$30/人/月</strong>
            <p>每多照顧一位家人，就增加一份長期資料保存空間。</p>
          </article>
          <article>
            <span>客服與資料問題</span>
            <strong>{CARE_WEDO_SUPPORT_EMAIL}</strong>
            <p>付款由綠界安全處理，Care WEDO 不保存信用卡資料。</p>
          </article>
        </div>
        <p className="plan-beta-note">開放測試期間，首位主要照護對象減免 $30/月；增加照護對象或協作者才會進入付款確認。</p>

        <div className="feature-table" role="table" aria-label="Care WEDO Free 與照護圈升級功能對照">
          <div className="feature-row table-head" role="row">
            <strong>功能</strong>
            <strong>Free</strong>
            <strong>照護圈升級</strong>
          </div>
          {FREE_FEATURES.map(([feature, free, paid]) => (
            <div className="feature-row" role="row" key={feature}>
              <span>{feature}</span>
              <FeatureValue value={free} />
              <FeatureValue value={paid} />
            </div>
          ))}
        </div>

        <div className="trust-note-panel">
          <div>
            <p className="panel-eyebrow">資料怎麼保存</p>
            <h3>我們保存整理後的重要文字資料。</h3>
            <p>Care WEDO 使用雲端資料庫保存照護資料，並規劃定期備份。Free 會保留最近 30 天資料，但歷史查詢與完整保存是付費功能；若資料有問題、需要匯出或刪除，可聯絡客服信箱。</p>
          </div>
          <a href={`mailto:${CARE_WEDO_SUPPORT_EMAIL}`}>{CARE_WEDO_SUPPORT_EMAIL}</a>
        </div>
      </section>
      )}

      {showPlanDetails && (
        <PlanDetailsModal onClose={() => setShowPlanDetails(false)} />
      )}

      <section className="landing-section belief-section">
        <h2>科技不該讓照護變冷。</h2>
        <p>
          Care WEDO 相信，AI 最好的角色不是取代醫師，也不是取代家人，而是幫家庭把重要資訊整理清楚，讓陪伴少一點慌亂，多一點安心。
        </p>
      </section>

      <section className="landing-section feedback-section" id="feedback">
        <div className="feedback-copy">
          <div className="section-kicker">試用回饋</div>
          <h2>哪裡不夠簡單友善，請直接告訴我們。</h2>
          <p>
            當照護不再只是你一個人的責任，透過家庭協作，邀請家人一起同步看診、用藥與提醒資訊。您的回饋意見，會幫助長輩獲得更好的健康照護。
          </p>
        </div>
        <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
          <label>
            想回饋的項目
            <select name="topic" value={feedbackForm.topic} onChange={handleFeedbackChange}>
              {FEEDBACK_TOPICS.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
            </select>
          </label>
          <label>
            您的建議
            <textarea
              name="message"
              value={feedbackForm.message}
              onChange={handleFeedbackChange}
              rows={5}
              placeholder="例：LINE 回覆還是太長、按鈕文字看不懂、吃藥提醒想更簡單..."
            />
          </label>
          <div className="feedback-form-row">
            <label>
              稱呼
              <input name="name" value={feedbackForm.name} onChange={handleFeedbackChange} placeholder="可不填" />
            </label>
            <label>
              Email
              <input name="email" type="email" value={feedbackForm.email} onChange={handleFeedbackChange} placeholder="用來寄送確認信" required />
            </label>
          </div>
          <button type="submit" disabled={feedbackStatus.state === "sending"}>
            {feedbackStatus.state === "sending" ? "送出中..." : "送出回饋"}
          </button>
          {feedbackStatus.message && (
            <p className={`feedback-status ${feedbackStatus.state === "error" ? "notice-danger" : ""}`}>
              {feedbackStatus.message}
            </p>
          )}
        </form>
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
        </>
      ) : (
        <>
          <section className="landing-section home-workflow-section" aria-label="Care WEDO 使用流程">
            <div className="section-kicker">手機上這樣用</div>
            <h2>先選家人，再拍單子，提醒就不會散掉。</h2>
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

          <section className="landing-section home-spirit-section" aria-label="Care WEDO 品牌精神">
            <div className="section-kicker">Care WEDO 的角色</div>
            <h2>陪你照顧最重要的人。</h2>
            <p>
              從「一個人」升級到「一家人」。長輩用 LINE 傳照片，系統整理看診、用藥與提醒，家人同步掌握。AI 不取代醫師，也不取代家人，只把重要資訊整理清楚，讓陪伴少一點慌亂，多一點安心。
            </p>
          </section>

          <section className="home-more-section" aria-label="更多資訊">
            <a href="/features">看功能與方案</a>
            <a href="/features#feedback">留下試用回饋</a>
            <a href="/privacy">查看隱私政策</a>
          </section>
        </>
      )}

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
  const [googleLoggingIn, setGoogleLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const inviteCode = new URLSearchParams(window.location.search).get("invite_code");
  const googleAuthReady = hasSupabaseAuthConfig();
  const reviewLoginReady = safeReviewLoginEnabled();
  const [reviewEmail, setReviewEmail] = useState("");
  const [reviewPassword, setReviewPassword] = useState("");
  const [reviewLoggingIn, setReviewLoggingIn] = useState(false);

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

  function handleGoogleLogin() {
    setGoogleLoggingIn(true);
    setLoginError(null);
    try {
      loginWithGoogle({ next: "/app" });
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Google 登入尚未設定，請稍後再試。");
      setGoogleLoggingIn(false);
    }
  }

  async function handleReviewLogin(event) {
    event.preventDefault();
    setReviewLoggingIn(true);
    setLoginError(null);
    try {
      await signInWithSupabasePassword({ email: reviewEmail, password: reviewPassword });
      window.location.assign("/app");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "登入資料不正確，請重新確認。");
      setReviewLoggingIn(false);
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
            長輩可以用 LINE，家人協作者可以用 Google 登入後台。
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
            {googleAuthReady ? (
              <GoogleLoginAction loggingIn={googleLoggingIn} onLogin={handleGoogleLogin} />
            ) : (
              <p className="login-support-note">協作者 Google 後台登入尚未開放，請先用 LINE 進入 Care WEDO。</p>
            )}
            <a
              className="login-alt-link"
              href="https://lin.ee/xzbyyvf"
              target="_blank"
              rel="noopener noreferrer"
            >
              還沒加入照護小管家？先加入 →
            </a>
            {reviewLoginReady && (
              <form className="review-login-form" aria-label="安全測試登入" onSubmit={handleReviewLogin}>
                <strong>安全測試入口</strong>
                <p className="login-support-note">僅限指定測試站；請使用配發的獨立測試帳號。</p>
                <label>
                  Email
                  <input type="email" autoComplete="username" value={reviewEmail} onChange={(event) => setReviewEmail(event.target.value)} required />
                </label>
                <label>
                  密碼
                  <input type="password" autoComplete="current-password" value={reviewPassword} onChange={(event) => setReviewPassword(event.target.value)} required />
                </label>
                <button className="secondary-action" type="submit" disabled={reviewLoggingIn}>
                  {reviewLoggingIn ? "正在登入…" : "登入測試家庭"}
                </button>
              </form>
            )}
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

function AuthCallbackPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    try {
      completeSupabaseOAuthCallback();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google 登入失敗，請重新登入。";
      window.setTimeout(() => {
        if (active) setError(message);
      }, 0);
    }
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="login-route-shell">
      <section className="external-open-card auth-callback-card" aria-label="Google 登入確認">
        {error ? (
          <>
            <p className="panel-eyebrow">登入未完成</p>
            <h1>請重新登入</h1>
            <p>{error}</p>
            <a className="primary-action" href="/login">回到登入頁</a>
          </>
        ) : (
          <>
            <div className="auth-loading-spinner" aria-hidden="true" />
            <p className="panel-eyebrow">Google 登入確認</p>
            <h1>正在帶你進入照護後台</h1>
            <p>正在確認登入狀態，完成後會自動回到 Care WEDO。</p>
          </>
        )}
      </section>
    </main>
  );
}

export default function App() {
  function resolveRoute(pathname = window.location.pathname) {
    return resolveCareWedoRoute(pathname);
  }

  const [route, setRoute] = useState(() => {
    // LINE OAuth callback URL must remain untouched until liff.init() completes.
    // We only route the SPA view to /app here; URL cleanup happens after LIFF init.
    return resolveRoute(window.location.pathname, window.location.search);
  });

  useEffect(() => {
    // 處理瀏覽器上一頁/下一頁
    const handlePopState = () => setRoute(resolveRoute(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    // OAuth callback may replace the URL before this listener is mounted.
    // Read the current pathname once so the callback cannot remain on its spinner.
    window.setTimeout(() => setRoute(resolveRoute(window.location.pathname)), 0);

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
      const [pathAndSearch, hash = ""] = href.split("#", 2);
      const [path] = pathAndSearch.split("?", 2);
      setRoute(resolveRoute(path || "/"));
      const hashWithSymbol = hash ? `#${hash}` : "";
      if (hashWithSymbol) {
        window.setTimeout(() => document.querySelector(hashWithSymbol)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    document.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  useEffect(() => {
    if (route !== "landing" || window.location.pathname !== "/") return undefined;
    let active = true;
    fetchSessionIdentity().then((session) => {
      if (!active || !session) return;
      window.history.replaceState(null, "", "/app");
      setRoute("app");
    }).catch(() => null);
    return () => {
      active = false;
    };
  }, [route]);

  if (route === "app") return <DashboardApp />;
  if (route === "external-open") return <ExternalOpenPage />;
  if (route === "auth-callback") return <AuthCallbackPage />;
  if (route === "login") return <LoginPage />;
  if (route === "features") return <LandingPage variant="details" />;
  if (route === "guide") return <LandingPage variant="guide" />;
  if (route === "pricing") return <LandingPage variant="pricing" />;
  if (route === "privacy") return <PrivacyPage />;
  if (route === "terms") return <TermsPage />;
  return <LandingPage />;
}

function ExternalOpenPage() {
  const [status, setStatus] = useState(isLineInAppBrowser() ? "opening" : "redirecting");
  const callbackSearch = window.location.search || "";
  const targetUrl = buildExternalAppUrl(`/app${callbackSearch}`);

  const handleOpenExternal = useCallback(async () => {
    setStatus("opening");
    const opened = await openUrlInExternalBrowser(targetUrl);
    setStatus(opened ? "opened" : "manual");
  }, [targetUrl]);

  useEffect(() => {
    if (!isLineInAppBrowser()) {
      window.location.replace(targetUrl);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      handleOpenExternal();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [handleOpenExternal, targetUrl]);

  return (
    <main className="external-open-shell">
      <section className="external-open-card" aria-label="用瀏覽器開啟 Care WEDO">
        <p className="panel-eyebrow">Care WEDO</p>
        <h1>用瀏覽器開啟，之後就不用一直重新登入。</h1>
        <p>
          如果 LINE 沒有自動跳出，請按下面這顆按鈕。完成登入後，除非你主動登出，之後回到首頁會直接進入後台。
        </p>
        <button type="button" className="primary-action" onClick={handleOpenExternal}>
          用瀏覽器開啟
        </button>
        <a className="secondary-action external-open-fallback" href={targetUrl}>
          留在這裡繼續
        </a>
        <p className="external-open-status" aria-live="polite">
          {status === "opening" && "正在嘗試開啟外部瀏覽器..."}
          {status === "opened" && "如果外部瀏覽器已開啟，可以回到瀏覽器繼續。"}
          {status === "manual" && "如果沒有跳出，請長按連結或使用右上角在瀏覽器開啟。"}
          {status === "redirecting" && "正在前往 Care WEDO..."}
        </p>
      </section>
    </main>
  );
}

function DashboardApp() {
  const fileInputRef = useRef(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [ocrData, setOcrData] = useState(null);
  const [ocrError, setOcrError] = useState(null);
  const [planUpgradePrompt, setPlanUpgradePrompt] = useState(null);
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
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [documentDetail, setDocumentDetail] = useState(null);
  const [documentDetailLoading, setDocumentDetailLoading] = useState(false);
  const [documentNotice, setDocumentNotice] = useState("");
  const [showFamilyNotesEditor, setShowFamilyNotesEditor] = useState(false);
  const [showPlanDetails, setShowPlanDetails] = useState(false);
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
        documents: [],
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
        if (await openDashboardInExternalBrowserAfterLineCallback(lineIdentity.idToken)) {
          return;
        }
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
  const permissionVersion = dashboard?.permission_version || (dashboard?.plan ? {
    label: dashboard.plan.name,
    description: `成員 ${dashboard.plan.max_members} 位・照護對象 ${dashboard.plan.max_recipients} 位`,
  } : null);
  const planPermissions = dashboard?.plan_permissions || permissionVersion?.capabilities || {};
  const pricing = normalizeCareWedoPricing(dashboard?.pricing || CARE_WEDO_PRICING);
  const canViewHistory = planPermissions.can_view_history !== false;
  const careCapabilities = deriveCareCapabilities(dashboard || {});
  const { canManageCare, canCompleteMedication, readOnly } = careCapabilities;
  const visibleSections = canManageCare ? SECTIONS : SECTIONS.filter((section) => ["overview", "calendar", "meds"].includes(section.id));
  const visibleMobileSections = canManageCare ? MOBILE_SECTIONS : MOBILE_SECTIONS.filter((section) => ["overview", "calendar", "meds"].includes(section.id));
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
    const normalized = source
      .filter((item) => !isPersonalMode || belongsToActiveCareScope(item, activeProfileId, activeGroupId))
      .map(normalizeAppointment);
    return dedupeAppointments(normalized);
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

  const allDocuments = useMemo(() => {
    const source = isPersonalMode && dashboard ? (dashboard.documents || []) : [];
    return source
      .filter((document) => !isPersonalMode || belongsToActiveCareScope(document, activeProfileId, activeGroupId))
      .map(normalizeCareDocument)
      .filter(hasDisplayableCareDocument);
  }, [dashboard, isPersonalMode, activeProfileId, activeGroupId]);

  const documents = useMemo(() => {
    return allDocuments.filter((item) => matchSearch({
      ...item,
      title: item.document_title,
      hospital: item.source_hospital,
      department: documentTypeLabel(item.document_type),
      notes: JSON.stringify(item.ai_summary || {}),
    }, searchQuery));
  }, [allDocuments, searchQuery]);

  const searchSuggestions = useMemo(() => {
    return buildSearchSuggestions([...allAppointments, ...allMedications, ...allDocuments.map((document) => ({
      hospital: document.source_hospital,
      department: documentTypeLabel(document.document_type),
      title: document.document_title,
      notes: document.original_file_name,
    }))]);
  }, [allAppointments, allMedications, allDocuments]);

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
  const collaborators = dashboard?.collaborators || dashboard?.members || [];
  const linePushAudit = dashboard?.line_push_audit || [];
  const activityAudit = dashboard?.activity_audit || [];

  useEffect(() => {
    if (readOnly && !visibleSections.some((section) => section.id === activeSection)) {
      setActiveSection("overview");
    }
  }, [activeSection, readOnly, visibleSections]);

  useEffect(() => {
    setFamilyNotes(dashboard?.family_notes || []);
  }, [dashboard?.active_group_id, dashboard?.family_notes]);

  async function handleFamilyNotesChange(notes) {
    const nextNotes = notes.map((item) => item.trim()).filter(Boolean);
    if (!activeGroupId) {
      setFamilyNotes(nextNotes);
      return;
    }
    const result = await updateFamilyNotes({ idToken: identity.idToken, groupId: activeGroupId, notes: nextNotes });
    const persistedNotes = Array.isArray(result?.notes) ? result.notes : nextNotes;
    setFamilyNotes(persistedNotes);
    await loadDashboard(identity, activeProfileId, activeGroupId);
    return result;
  }

  function handleMobileNavChange(sectionId) {
    if (sectionId === "upload") {
      handleUploadClick();
      return;
    }
    openSection(sectionId);
  }

  function openSection(sectionId) {
    if (sectionId !== activeSection) {
      setSearchQuery("");
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

  function showPlanUpgradePrompt(reason, source, message = "") {
    setOcrError(null);
    setPlanUpgradePrompt({ reason, message, source });
    trackEvent("frontend.plan_upgrade_prompt", { reason, source });
  }

  async function handleFilesSelected(files) {
    setScanning(true);
    setOcrError(null);
    setOcrData(null);
    setPlanUpgradePrompt(null);

    try {
      const result = await ocrAnalyze(files, {
        idToken: identity.idToken,
        profileId: activeProfileId,
      });
      if (result.success && result.data) {
        setOcrData({ data: result.data, saved: result.saved });
        await loadDashboard(identity, activeProfileId, activeGroupId);
      } else {
        const message = result.error || "解析失敗";
        if (isQuotaLimitMessage(message)) {
          showPlanUpgradePrompt("quota", "image_upload", message);
        } else {
          setOcrError(message);
        }
      }
    } catch (err) {
      trackError("frontend.ocr", err, {
        fileCount: files.length,
        profileId: activeProfileId,
      });
      const message = err instanceof Error ? err.message : String(err || "解析失敗");
      if (isQuotaLimitMessage(message)) {
        showPlanUpgradePrompt("quota", "image_upload", message);
      } else {
        setOcrError(message);
      }
    } finally {
      setScanning(false);
    }
  }

  async function handleTextUpload(text) {
    const sourceText = text.trim();
    if (!sourceText) {
      setOcrError("請先貼上要整理的文字。");
      return;
    }

    setShowUploadGuide(false);
    setScanning(true);
    setOcrError(null);
    setOcrData(null);
    setPlanUpgradePrompt(null);

    try {
      const result = await ocrAnalyzeText(sourceText, {
        idToken: identity.idToken,
        profileId: activeProfileId,
      });
      if (result.success && result.data) {
        setOcrData({ data: result.data, saved: result.saved });
        await loadDashboard(identity, activeProfileId, activeGroupId);
      } else {
        const message = result.error || "解析失敗";
        if (isQuotaLimitMessage(message)) {
          showPlanUpgradePrompt("quota", "text_upload", message);
        } else {
          setOcrError(message);
        }
      }
    } catch (err) {
      trackError("frontend.ocr_text", err, {
        textLength: sourceText.length,
        profileId: activeProfileId,
      });
      const message = err instanceof Error ? err.message : String(err || "解析失敗");
      if (isQuotaLimitMessage(message)) {
        showPlanUpgradePrompt("quota", "text_upload", message);
      } else {
        setOcrError(message);
      }
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

  async function handleCareDocumentUpload({ file, preserveOriginalFile, documentType }) {
    if (!activeProfileId) {
      throw new Error("請先選擇照護對象。");
    }
    setScanning(true);
    setOcrError(null);
    setDocumentNotice("");
    try {
      const result = await uploadCareDocument(file, {
        idToken: identity.idToken,
        profileId: activeProfileId,
        preserveOriginalFile,
        documentType,
      });
      trackEvent("frontend.document_upload", {
        profileId: activeProfileId,
        documentType,
        preserveOriginalFile,
        documentId: result.document?.id,
      });
      setShowDocumentUpload(false);
      setDocumentNotice("文件已存入照護紀錄。");
      await loadDashboard(identity, activeProfileId, activeGroupId);
      if (result.document?.id) {
        await handleDocumentOpen(result.document);
      }
    } catch (err) {
      trackError("frontend.document_upload", err, { profileId: activeProfileId, documentType });
      const message = err instanceof Error ? err.message : "文件上傳失敗";
      if (isQuotaLimitMessage(message)) {
        showPlanUpgradePrompt("quota", "document_upload", message);
      }
      throw err;
    } finally {
      setScanning(false);
    }
  }

  async function handleDocumentOpen(document) {
    setDocumentNotice("");
    setDocumentDetail(document);
    if (!document?.id || String(document.id).startsWith("demo-")) return;
    setDocumentDetailLoading(true);
    try {
      const result = await fetchDocumentDetail(document.id, { idToken: identity.idToken });
      setDocumentDetail(result.document || document);
    } catch (err) {
      trackError("frontend.document_detail", err, { documentId: document.id });
      setDocumentNotice(err instanceof Error ? err.message : "無法取得文件內容。");
    } finally {
      setDocumentDetailLoading(false);
    }
  }

  async function handleDocumentFileOpen(document) {
    if (!document?.id) return;
    try {
      const result = await fetchDocumentFileUrl(document.id, { idToken: identity.idToken });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      trackError("frontend.document_file_url", err, { documentId: document.id });
      setDocumentNotice(err instanceof Error ? err.message : "無法開啟原始文件。");
    }
  }

  async function handleDocumentDelete(document) {
    if (!document?.id) return;
    if (!window.confirm("確定要刪除這份醫療文件嗎？")) return;
    try {
      await deleteCareDocument(document.id, { idToken: identity.idToken });
      setDocumentDetail(null);
      setDocumentNotice("文件已刪除。");
      await loadDashboard(identity, activeProfileId, activeGroupId);
    } catch (err) {
      trackError("frontend.document_delete", err, { documentId: document.id });
      setDocumentNotice(err instanceof Error ? err.message : "無法刪除文件。");
    }
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
    try {
      const result = await markMedicationSlotStatus({
        medicationIds: group.medicationIds,
        status,
        idToken: identity.idToken,
        timeSlot: group.slot,
      });
      await loadDashboard(identity, activeProfileId, activeGroupId);
      return result;
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

  async function handleAppointmentUpdateSave(payload) {
    if (!editingAppointment?.id) {
      throw new Error("找不到要修改的提醒。");
    }

    const updates = {
      ...payload,
      date: normalizeDateInput(payload.date),
      title: buildAppointmentTitle(payload.department, payload.type),
      department: payload.department,
      fasting_hours: payload.fasting_required ? payload.fasting_hours : null,
    };

    if (String(editingAppointment.id).startsWith("demo-")) {
      updateActiveDashboard((prev) => ({
        ...prev,
        appointments: (prev.appointments || []).map((apt) => (
          apt.id === editingAppointment.id ? { ...apt, ...updates } : apt
        )),
      }));
      setEditingAppointment(null);
      return;
    }

    await patchAppointment(editingAppointment.id, updates, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId, activeGroupId);
    setEditingAppointment(null);
  }

  async function handleAppointmentDelete() {
    if (!editingAppointment?.id) {
      throw new Error("找不到要刪除的提醒。");
    }

    if (String(editingAppointment.id).startsWith("demo-")) {
      updateActiveDashboard((prev) => ({
        ...prev,
        appointments: (prev.appointments || []).map((apt) => (
          apt.id === editingAppointment.id ? { ...apt, status: "deleted" } : apt
        )),
      }));
      setEditingAppointment(null);
      return;
    }

    await deleteAppointment(editingAppointment.id, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId, activeGroupId);
    setEditingAppointment(null);
  }

  async function handleAppointmentCopySave(payload) {
    if (!activeProfileId) {
      throw new Error("請先選擇照護對象。");
    }
    await createAppointment({ ...payload, profile_id: activeProfileId }, { idToken: identity.idToken });
    await loadDashboard(identity, activeProfileId, activeGroupId);
    setEditingAppointment(null);
  }

  async function handleAddAppointmentToCalendar(appointment) {
    if (!appointment?.id) return;

    try {
      let exportMode = "api";
      if (!identity.idToken || String(appointment.id).startsWith("demo-")) {
        await downloadLocalAppointmentCalendarFile(appointment, { profileName: selectedProfile?.display_name || patient.name });
        exportMode = "local";
      } else {
        try {
          await downloadAppointmentCalendarFile(appointment.id, { idToken: identity.idToken });
        } catch (error) {
          trackError("frontend.calendar_export_api_fallback", error, {
            appointmentId: appointment.id,
            profileId: appointment.profile_id,
          });
          await downloadLocalAppointmentCalendarFile(appointment, { profileName: selectedProfile?.display_name || patient.name });
          exportMode = "local_fallback";
        }
      }
      trackEvent("frontend.calendar_export", {
        appointmentId: appointment.id,
        profileId: appointment.profile_id,
        type: appointment.type,
        exportMode,
      });
    } catch (err) {
      trackError("frontend.calendar_export", err, {
        appointmentId: appointment.id,
        profileId: appointment.profile_id,
      });
      window.alert("無法產生行事曆檔，請稍後再試。");
    }
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
    const nextGroupId = Number(groupId);
    if (!Number.isFinite(nextGroupId) || nextGroupId <= 0) return;
    const firstProfileInGroup = careProfiles.find((profile) => profile.group_id === nextGroupId);
    const nextProfileId = firstProfileInGroup?.id || activeProfileId;
    trackEvent("frontend.group_switch", { groupId: nextGroupId, profileId: nextProfileId });
    setActiveGroupId(nextGroupId);
    window.localStorage.setItem("care_wedo_active_group_id", String(nextGroupId));
    if (nextProfileId) {
      setActiveProfileId(nextProfileId);
      persistActiveProfilePreference(nextProfileId);
      window.localStorage.setItem("care_wedo_active_profile_id", String(nextProfileId));
    }
    loadDashboard(identity, nextProfileId, nextGroupId);
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
            onReorder={canManageCare ? handleProfileOrderChange : undefined}
            readOnly={readOnly}
          />

          <nav className="section-nav">
            {visibleSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? "nav-item active" : "nav-item"}
                onClick={() => openSection(section.id)}
                style={activeSection === section.id ? { "--item-color": section.color } : {}}
              >
                <span>{section.icon}</span>
                {section.label}
              </button>
            ))}
          </nav>

          {identity.status === "authenticated" && (
            <div className="side-rail-footer">
              {canManageCare && (
                <button type="button" className="side-footer-action" onClick={() => setShowPlanDetails(true)}>
                  照護圈升級
                </button>
              )}
              <a className="side-footer-action" href="https://care.wedopr.com/">
                Care WEDO
              </a>
              <button type="button" className="btn-logout side-logout" onClick={logoutLineIdentity}>
                登出
              </button>
            </div>
          )}
        </aside>

        <section className="content-area" data-active-section={activeSection}>
          <CareContextHeader
            identity={identity}
            patient={patient}
            selectedProfile={selectedProfile}
            profiles={careProfiles}
            groups={groups}
            activeGroupId={activeGroupId}
            activeGroupName={activeGroup?.name || dashboard?.active_group_name}
            collaborators={collaborators}
            onProfileChange={handleProfileChange}
            onGroupChange={canManageCare ? handleGroupChange : undefined}
            onOpenProfile={canManageCare ? () => setShowEditProfile(true) : undefined}
            onOpenFamily={canManageCare ? () => openSection("settings") : undefined}
            readOnly={readOnly}
          />

          {activeSection !== "overview" && activeSection !== "settings" && (
            <>
            <div className="toolbar">
              <SectionHeading section={SECTIONS.find(s => s.id === activeSection)} compact />
            </div>
            <section className="today-search-panel content-search-panel" aria-label={`${SECTIONS.find(s => s.id === activeSection)?.label || "照護資料"}搜尋`}>
              <SearchField
                value={searchQuery}
                onChange={setSearchQuery}
                suggestions={searchSuggestions}
                placeholder="依醫院、診別、藥名篩選"
              />
            </section>
            </>
          )}

          {activeSection === "settings" && (
            <div className="toolbar">
              <SectionHeading section={SECTIONS.find(s => s.id === activeSection)} badge={permissionVersion} compact />
            </div>
          )}

          {activeSection === "overview" && (
            <OverviewView
              todayLabel={todayLabel}
              todayDate={todayDate}
              medications={medications}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              todayTasks={todayTasks}
              hasTodayCareTasks={hasTodayCareTasks}
              searchSuggestions={searchSuggestions}
              nextAppointment={nextAppointment}
              urgentItems={urgentItems}
              familyNotes={familyNotes}
              hasCareData={hasCareData}
              onOpenCalendar={() => openSection("calendar")}
              onUpload={canManageCare ? handleUploadClick : undefined}
              onComplete={canManageCare ? handleComplete : undefined}
              readOnly={readOnly}
            />
          )}

          {activeSection === "calendar" && (
            <CalendarView
              appointments={appointments}
              careName={selectedProfile?.display_name || patient.name}
              onUpload={canManageCare ? handleUploadClick : undefined}
              onAddToCalendar={handleAddAppointmentToCalendar}
              onEditAppointment={canManageCare ? setEditingAppointment : undefined}
            />
          )}

          {activeSection === "meds" && (
            <MedicationView
              medications={medications}
              medicationSummarySource={allMedications}
              totalMedicationCount={allMedications.length}
              searchQuery={searchQuery}
              todayDate={todayDate}
              copyText={copyText}
              formatDateLabel={formatDateLabel}
              onClearSearch={() => setSearchQuery("")}
              onUpload={canManageCare ? handleUploadClick : undefined}
              onTaken={canCompleteMedication ? handleMedicationTaken : undefined}
              canCompleteMedication={canCompleteMedication}
              readOnly={readOnly}
              activityAudit={activityAudit}
            />
          )}

          {activeSection === "records" && (
            <RecordsView
              records={allAppointments}
              documents={documents}
              searchQuery={searchQuery}
              onUpload={canManageCare ? handleUploadClick : undefined}
              onUploadDocument={canManageCare ? () => setShowDocumentUpload(true) : undefined}
              onOpenDocument={handleDocumentOpen}
              onEditRecord={canManageCare ? setEditingAppointment : undefined}
              readOnly={readOnly}
              canViewHistory={canViewHistory}
              documentNotice={documentNotice}
              onUpgradeRequired={(reason) => showPlanUpgradePrompt(reason, "records_history")}
            />
          )}

          {activeSection === "settings" && canManageCare && (
            <SettingsView
              patient={patient}
              identity={identity}
              isPersonalMode={isPersonalMode}
              careProfiles={careProfiles}
              collaborators={collaborators}
              selectedProfile={selectedProfile}
              activeProfileId={activeProfileId}
              onProfileChange={handleProfileChange}
              onGroupChange={() => loadDashboard(identity, activeProfileId, activeGroupId)}
              onEditProfile={() => setShowEditProfile(true)}
              onAddReminder={() => setShowManualReminder(true)}
              linePushAudit={linePushAudit}
              activityAudit={activityAudit}
              pricing={pricing}
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
          onTextSubmit={handleTextUpload}
          onClose={() => setShowUploadGuide(false)}
        />
      )}

      {showDocumentUpload && (
        <CareDocumentUploadModal
          onClose={() => setShowDocumentUpload(false)}
          onSave={handleCareDocumentUpload}
        />
      )}

      {documentDetail && (
        <CareDocumentDetailModal
          document={documentDetail}
          loading={documentDetailLoading}
          notice={documentNotice}
          onClose={() => setDocumentDetail(null)}
          onOpenFile={() => handleDocumentFileOpen(documentDetail)}
          onDelete={() => handleDocumentDelete(documentDetail)}
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
          onSave={handleAppointmentUpdateSave}
          onDelete={handleAppointmentDelete}
          onCopy={handleAppointmentCopySave}
        />
      )}

      {showFamilyNotesEditor && (
        <FamilyNotesModal
          groupName={activeGroup?.name || dashboard?.active_group_name || "照護圈"}
          notes={familyNotes}
          onClose={() => setShowFamilyNotesEditor(false)}
          onSave={handleFamilyNotesChange}
        />
      )}

      {showPlanDetails && (
        <PlanDetailsModal onClose={() => setShowPlanDetails(false)} />
      )}

      {planUpgradePrompt && (
        <PlanUpgradeModal
          reason={planUpgradePrompt.reason}
          pricing={pricing}
          onClose={() => setPlanUpgradePrompt(null)}
          onViewPlans={() => {
            setPlanUpgradePrompt(null);
            setShowPlanDetails(true);
          }}
        />
      )}

      <MobileBottomNav
        sections={visibleMobileSections}
        activeSection={activeSection}
        onChange={handleMobileNavChange}
      />
    </main>
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
          <button type="button" onClick={onClose} className="btn-close" aria-label="關閉">✕</button>
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
      name: group.name || "照護圈",
      profiles: profilesByGroupId.get(group.id),
    }));

  const knownGroupIds = new Set(groups.map((group) => group.id));
  const extraSections = Array.from(profilesByGroupId.entries())
    .filter(([groupId]) => groupId === "ungrouped" || !knownGroupIds.has(groupId))
    .map(([groupId, groupProfiles]) => ({
      id: groupId,
      name: groupId === "ungrouped" ? "未分組" : "照護圈",
      profiles: groupProfiles,
    }));

  return [...knownSections, ...extraSections];
}

function ProfileSwitcher({ profiles, groups = [], activeProfileId, onChange, onReorder, readOnly = false }) {
  const [dragState, setDragState] = useState(null);
  const longPressTimerRef = useRef(null);
  const pointerDragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const sections = useMemo(() => groupProfilesForSwitcher(profiles, groups), [profiles, groups]);

  if (!profiles.length) {
    return (
      <div className="profile-switcher empty">
        <p className="panel-eyebrow">正在照護</p>
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
      <p className="panel-eyebrow">正在照護</p>
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
                  draggable={!readOnly}
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
                    if (readOnly) return;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(profile.id));
                    setDragState({ profileId: profile.id, groupId: profile.group_id || "ungrouped", targetId: profile.id });
                  }}
                  onDragOver={(event) => { if (!readOnly) event.preventDefault(); }}
                  onDrop={(event) => {
                    if (readOnly) return;
                    event.preventDefault();
                    requestReorder(profile.group_id || "ungrouped", dragState?.profileId || event.dataTransfer.getData("text/plain"), profile.id);
                    setDragState(null);
                  }}
                  onDragEnd={() => setDragState(null)}
                  onPointerDown={(event) => { if (!readOnly) handlePointerDown(event, profile); }}
                  onPointerMove={(event) => { if (!readOnly) handlePointerMove(event); }}
                  onPointerCancel={readOnly ? undefined : handlePointerEnd}
                  onPointerUp={readOnly ? undefined : handlePointerEnd}
                >
                  <span className="profile-option-name">{profile.display_name}</span>
                  {!readOnly && <span className="profile-drag-handle" aria-hidden="true">☰</span>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function GroupBadge({ groups = [], activeGroupId, activeGroupName, onChange, fallbackLabel = "照護圈" }) {
  const [open, setOpen] = useState(false);
  const label = activeGroupName || groups.find((group) => group.id === activeGroupId)?.name || fallbackLabel;

  if (!groups.length || !onChange) {
    return <span className="group-context-badge static"><span className="group-context-badge-label">{label}</span></span>;
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
        <span className="group-context-badge-label">{label}</span>
      </button>
      {open && (
        <div className="group-context-menu" role="listbox" aria-label="切換照護圈">
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
              {group.name || "照護圈"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CareContextHeader({
  identity,
  patient,
  selectedProfile,
  profiles = [],
  groups = [],
  activeGroupId,
  activeGroupName,
  collaborators = [],
  onProfileChange,
  onGroupChange,
  onOpenProfile,
  onOpenFamily,
  readOnly = false,
}) {
  const careName = selectedProfile?.display_name || patient?.name || "照護對象";
  const careTitle = getCareTodayTitle(selectedProfile, careName);
  const careDepartment = patient?.dept && patient.dept !== "藥局" ? patient.dept : null;
  const careMeta = [careDepartment, patient?.age].filter(Boolean).join("・") || selectedProfile?.notes || "照護資料";
  const loginName = identity?.profile?.displayName || identity?.profile?.display_name || (identity?.status === "demo" ? "範例帳號" : "LINE 帳號");
  const normalizedCollaborators = useMemo(() => collaborators
    .map(normalizeCollaborator)
    .filter((item) => item.displayName)
    .sort((a, b) => {
      if (a.role === "admin" && b.role !== "admin") return -1;
      if (b.role === "admin" && a.role !== "admin") return 1;
      return a.displayName.localeCompare(b.displayName, "zh-Hant");
    }), [collaborators]);
  const collaboratorPreview = normalizedCollaborators.slice(0, 2);
  const collaboratorSummary = normalizedCollaborators.length
    ? `${normalizedCollaborators.length} 人`
    : "尚未邀請";

  return (
    <section className="care-context-header" aria-label={careTitle}>
      <div className="care-context-main">
        {onOpenProfile ? (
          <button type="button" className="care-context-avatar" onClick={onOpenProfile} aria-label="編輯照護者資料">
            <img src={selectedProfile?.avatar_url || aiAvatar} alt={`${careName} 頭像`} />
          </button>
        ) : (
          <div className="care-context-avatar" aria-hidden="true">
            <img src={selectedProfile?.avatar_url || aiAvatar} alt={`${careName} 頭像`} />
          </div>
        )}
        <div className="care-context-copy">
          <p className="care-context-eyebrow">正在照護</p>
          <h2>{careName}</h2>
          <p className="care-context-meta">{careMeta}</p>
          {profiles.length > 1 && !readOnly && (
            <label className="care-profile-quick-switch">
              <span>切換照護者</span>
              <select value={selectedProfile?.id || ""} onChange={(event) => onProfileChange?.(Number(event.target.value))}>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.display_name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="care-context-details" aria-label="目前帳號與照護圈">
        <div className="care-context-item">
          <span className="care-context-label">照護圈</span>
          <GroupBadge
            groups={groups}
            activeGroupId={activeGroupId}
            activeGroupName={activeGroupName}
            onChange={onGroupChange}
            fallbackLabel="尚未建立照護圈"
          />
        </div>
        {onOpenFamily ? (
          <button type="button" className="care-context-item care-context-family-button" onClick={onOpenFamily}>
            <span className="care-context-label">照護協作者</span>
            <strong>{collaboratorSummary}</strong>
            {collaboratorPreview.length > 0 && (
              <span className="care-context-avatar-stack" aria-label="協作者頭像">
                {collaboratorPreview.map((item) => (
                  item.avatarUrl
                    ? <img key={item.id} src={item.avatarUrl} alt={`${item.displayName} 頭像`} />
                    : <span key={item.id}>{item.displayName.slice(0, 2)}</span>
                ))}
              </span>
            )}
          </button>
        ) : (
          <div className="care-context-item">
            <span className="care-context-label">照護協作者</span>
            <strong>{collaboratorSummary}</strong>
            {collaboratorPreview.length > 0 && (
              <span className="care-context-avatar-stack" aria-label="協作者頭像">
                {collaboratorPreview.map((item) => (
                  item.avatarUrl
                    ? <img key={item.id} src={item.avatarUrl} alt={`${item.displayName} 頭像`} />
                    : <span key={item.id}>{item.displayName.slice(0, 2)}</span>
                ))}
              </span>
            )}
          </div>
        )}
        <div className="care-context-item">
          <span className="care-context-label">登入者</span>
          <strong>{loginName}</strong>
          <span className="care-context-helper">{readOnly ? "僅可查看" : identity?.status === "demo" ? "範例畫面" : "目前帳號"}</span>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ section, badge = null, compact = false }) {
  return (
    <div className={compact ? "section-heading-row is-compact" : "section-heading-row"} style={{ "--section-color": section.color }}>
      <h2>{section.label}</h2>
      {badge?.label && (
        <span className={badge.id === "unlimited" ? "permission-badge permission-badge-unlimited" : "permission-badge"} title={badge.description || ""}>
          {badge.label}
        </span>
      )}
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

function briefingList(summary, key) {
  const value = summary?.doctor_briefing?.[key] || summary?.[key] || [];
  if (Array.isArray(value)) return value.filter(Boolean).slice(0, 8);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function CareDocumentDetailModal({ document, loading, notice, onClose, onOpenFile, onDelete }) {
  const summary = document.ai_summary || {};
  const briefingSections = [
    ["major_history", "重大病史"],
    ["recent_symptoms", "近期狀況"],
    ["current_treatment", "目前治療"],
    ["current_medications", "用藥重點"],
    ["recent_exams", "檢查摘要"],
    ["upcoming_plan", "後續安排"],
    ["questions_for_doctor", "門診可確認"],
  ].map(([key, label]) => ({ key, label, items: briefingList(summary, key) })).filter((section) => section.items.length);
  const appointments = document.linked_appointments || [];
  const medications = document.linked_medications || [];
  const sourceWarning = summary?.doctor_briefing?.source_warning || summary?.source_warning || "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content care-document-detail-modal" role="dialog" aria-modal="true" aria-labelledby="care-document-detail-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="modal-kicker">{documentTypeLabel(document.document_type)}</p>
            <h2 id="care-document-detail-title">{document.document_title || "醫療文件"}</h2>
          </div>
          <button type="button" className="btn-close" onClick={onClose} aria-label="關閉">×</button>
        </div>
        <div className="modal-body">
          <div className="document-meta-strip">
            <span>{document.source_hospital || "院所待確認"}</span>
            <span>{document.document_date ? formatDateLabel(document.document_date) : "日期待確認"}</span>
            {document.page_count && <span>{document.page_count} 頁</span>}
          </div>
          {loading && <p className="helper-copy">正在讀取文件內容...</p>}
          {notice && <p className="calendar-action-notice">{notice}</p>}
          {sourceWarning && <p className="document-source-warning">{sourceWarning}</p>}

          <section className="doctor-briefing-panel" aria-label="醫師快速摘要">
            <h3>醫師快速摘要</h3>
            {briefingSections.length ? (
              <div className="doctor-briefing-grid">
                {briefingSections.map((section) => (
                  <article key={section.key} className="briefing-block">
                    <strong>{section.label}</strong>
                    <ul>
                      {section.items.map((item, index) => <li key={`${section.key}-${index}`}>{item}</li>)}
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <p className="helper-copy">這份文件尚未產生摘要。</p>
            )}
          </section>

          <section className="document-linked-section" aria-label="關聯資料">
            <h3>已帶入照護資料</h3>
            <div className="document-linked-grid">
              <article>
                <strong>行程</strong>
                {appointments.length ? appointments.slice(0, 4).map((apt) => (
                  <span key={apt.id}>{formatDateLabel(apt.date, apt.time)}・{apt.title || apt.department || typeLabel(apt.type)}</span>
                )) : <span>沒有新增行程</span>}
              </article>
              <article>
                <strong>用藥</strong>
                {medications.length ? medications.slice(0, 5).map((med) => (
                  <span key={med.id}>{med.name || "藥名待確認"}・{med.dosage || med.frequency || "用法待確認"}</span>
                )) : <span>沒有新增用藥</span>}
              </article>
            </div>
          </section>
        </div>
        <div className="modal-footer care-document-actions">
          {document.has_original_file && (
            <button type="button" className="primary-action" onClick={onOpenFile}>開啟原始檔</button>
          )}
          <button type="button" className="secondary-action" onClick={onClose}>關閉</button>
          <button type="button" className="inline-danger-action" onClick={onDelete}>刪除</button>
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
          {suggestions.map((suggestion) => {
            const label = typeof suggestion === "string" ? suggestion : suggestion.label;
            return (
              <button type="button" key={label} onClick={() => onChange(label)}>
                <span className="search-suggestion-label">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OverviewView({
  todayLabel,
  todayDate,
  medications = [],
  searchQuery,
  onSearchChange,
  todayTasks,
  hasTodayCareTasks,
  searchSuggestions,
  nextAppointment,
  urgentItems,
  familyNotes,
  hasCareData,
  onOpenCalendar,
  onUpload,
  onComplete,
  readOnly = false,
}) {
  const [locallyDoneTaskIds, setLocallyDoneTaskIds] = useState(() => new Set());
  const todayMedicationGroups = useMemo(
    () => groupMedicationsBySchedule(medications).filter((group) => group.medications.length > 0),
    [medications],
  );

  function handlePrimaryAction(task) {
    if (readOnly || !onComplete) return;
    setLocallyDoneTaskIds((prev) => new Set(prev).add(task.id));
    if (task.kind === "appointment") {
      onComplete(task.sourceId);
    }
  }

  return (
    <div className="today-care-view">
      <section className="today-hero-panel">
        <div className="today-count-block">
          <span className="today-date-text">{todayLabel.date}</span>
          <strong>今天要照顧的事</strong>
          <p>
            {todayTasks.length
              ? (hasTodayCareTasks ? `今天有 ${todayTasks.length} 件事，照時間慢慢做就好。` : "今天沒有新事項，先幫你接上最近的下一筆。")
              : "拍藥袋、處方箋、掛號單或提醒單，Care WEDO 會幫你整理。"}
          </p>
        </div>
        <div className="today-main-actions" aria-label="今天常用操作">
          {onUpload ? (
            <>
              <button type="button" className="primary-action" onClick={onUpload}>拍照新增照護資料</button>
              <p className="today-upload-helper">用藥、回診、處方箋、掛號單都從這裡開始。</p>
            </>
          ) : (
            <p className="today-upload-helper read-only-helper">目前是唯讀查看模式，資料由家人協作者管理。</p>
          )}
        </div>
      </section>

      <section className="today-search-panel" aria-label="照護資料搜尋">
        <SearchField
          value={searchQuery}
          onChange={onSearchChange}
          suggestions={searchSuggestions}
          placeholder="依醫院、診別、醫師篩選"
          className="today-search-box"
        />
      </section>

      {readOnly && todayMedicationGroups.length > 0 && (
        <section className="today-medication-priority" aria-label="今天用藥">
          <div className="panel-title-row">
            <div>
              <p className="panel-eyebrow">今天先看</p>
              <h3>今天用藥</h3>
            </div>
            <span className="today-medication-date">{todayLabel.date}</span>
          </div>
          <div className="today-medication-list">
            {todayMedicationGroups.map((group) => {
              const completed = group.medications.every((medication) => (
                medication.taken_slots?.includes(group.slot)
                || (medication.taken_status === "taken" && medication.taken_date === todayDate)
              ));
              return (
                <article key={group.slot} className={`today-medication-row ${completed ? "is-done" : ""}`}>
                  <strong>{group.label}</strong>
                  <span>{group.medications.map((medication) => medication.name || "藥名待確認").join("、")}</span>
                  <em>{completed ? "已記錄" : "請依藥袋服用"}</em>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="today-timeline-panel">
        {todayTasks.length ? (
          <div className="elder-task-list">
            {todayTasks.map((task) => {
              const isDone = locallyDoneTaskIds.has(task.id) || task.status === "completed";
              return (
                <article key={task.id} className={`elder-task-card ${isDone ? "is-done" : ""} ${task.needsReview ? "needs-review" : ""}`}>
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
                    {!readOnly && onComplete && (
                      <button type="button" className="primary-action elder-primary-action" onClick={() => handlePrimaryAction(task)} disabled={isDone}>
                        {isDone ? "已記好了" : task.primaryActionLabel}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : hasCareData ? (
          <div className="today-empty-card">
            <div className="empty-guide-actions">
              <button type="button" className="primary-action" onClick={onOpenCalendar}>查看照護排程</button>
            </div>
          </div>
        ) : (
          <EmptyGuide
            title="今天還沒有照護事項。"
            description="可以先拍藥袋、處方箋或掛號單，Care WEDO 會自動分類並整理成照護待辦。"
          />
        )}
      </section>

      <section className="today-support-grid">
        <article className="summary-panel next-panel">
          <p className="panel-eyebrow">下一次看診</p>
          {nextAppointment ? (
            <>
              <div className="date-badge">{formatDateLabel(nextAppointment.date, nextAppointment.time)}</div>
              <h3>{nextAppointment.title || nextAppointment.department}</h3>
              <p>{[nextAppointment.hospital, nextAppointment.doctor && `${nextAppointment.doctor}醫師`].filter(Boolean).join(" ｜ ")}</p>
              <button type="button" className="inline-action" onClick={onOpenCalendar}>查看排程</button>
            </>
          ) : (
            <p className="empty-state">目前沒有下一次看診安排。</p>
          )}
        </article>

        <article className="summary-panel">
          <div className="panel-title-row">
            <p className="panel-eyebrow">需要多留意</p>
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
      </section>
    </div>
  );
}

function appointmentTimeValue(record = {}) {
  const date = typeof record.date === "string" && record.date ? record.date : "9999-12-31";
  const time = typeof record.time === "string" && /^\d{1,2}:\d{2}/.test(record.time) ? record.time.slice(0, 5) : "23:59";
  return `${date}T${time}`;
}

function recordDateParts(record = {}) {
  if (!record.date) {
    return {
      year: "日期",
      date: "待確認",
      weekday: "",
      time: record.time || "時間待確認",
    };
  }

  const date = new Date(`${record.date}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) {
    return {
      year: "",
      date: record.date,
      weekday: "",
      time: record.time || "時間待確認",
    };
  }

  return {
    year: String(date.getFullYear()),
    date: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
    weekday: `週${["日", "一", "二", "三", "四", "五", "六"][date.getDay()]}`,
    time: record.time || "時間待確認",
  };
}

function buildRecordReminderCopy(record = {}) {
  const dateParts = recordDateParts(record);
  const title = typeLabel(record.type);
  const carePlace = [record.hospital, record.department, record.doctor && `${record.doctor}醫師`].filter(Boolean).join(" ｜ ");
  const note = record.notes || record.reminder_text;
  return [
    "請記得這筆照護提醒：",
    [dateParts.date, dateParts.weekday, dateParts.time].filter(Boolean).join(" "),
    title,
    carePlace,
    note,
    "已存入 Care WEDO。",
  ].filter(Boolean).join("\n");
}

async function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available.");
  }
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

function RecordsView({ records, documents = [], searchQuery, onUpload, onUploadDocument, onOpenDocument, onEditRecord, canViewHistory = true, documentNotice = "", onUpgradeRequired, readOnly = false }) {
  const [mode, setMode] = useState("future");
  const [copyNotice, setCopyNotice] = useState({ id: null, message: "" });
  const activeMode = canViewHistory ? mode : "future";
  const isDocumentMode = mode === "documents";
  const modeLabel = isDocumentMode ? "醫療文件" : activeMode === "history" ? "歷史紀錄" : "未來安排";

  function handleModeChange(nextMode) {
    if (nextMode === "history" && !canViewHistory) {
      onUpgradeRequired?.("history");
      return;
    }
    setMode(nextMode);
  }

  const grouped = useMemo(() => {
    const today = todayInTaipei();
    const filteredRecords = records
      .filter((record) => record.status !== "deleted")
      .filter((record) => {
        if (activeMode === "history") return true;
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
  }, [records, searchQuery, activeMode]);

  async function handleCopyReminder(record) {
    try {
      await copyText(buildRecordReminderCopy(record));
      setCopyNotice({ id: record.id, message: "已複製提醒文字。" });
    } catch {
      setCopyNotice({ id: record.id, message: "複製失敗，請再試一次。" });
    }
  }

  return (
    <div className="records-timeline-view">
      <div className="record-mode-switch" role="group" aria-label="查詢紀錄模式">
        <button
          type="button"
          className={!isDocumentMode && activeMode === "future" ? "active" : ""}
          onClick={() => handleModeChange("future")}
        >
          未來安排
        </button>
        <button
          type="button"
          className={!isDocumentMode && activeMode === "history" ? "active" : ""}
          onClick={() => handleModeChange("history")}
        >
          歷史紀錄
        </button>
        <button
          type="button"
          className={isDocumentMode ? "active" : ""}
          onClick={() => handleModeChange("documents")}
        >
          醫療文件
        </button>
      </div>
      {documentNotice && <p className="calendar-action-notice">{documentNotice}</p>}
      {isDocumentMode ? (
        <DocumentLibraryView
          documents={documents}
          searchQuery={searchQuery}
          onUploadDocument={readOnly ? undefined : onUploadDocument}
          onOpenDocument={onOpenDocument}
        />
      ) : grouped.length ? grouped.map(([month, items]) => (
        <section key={month} className="record-month-group">
          <h3 className="month-divider">{month.replace("-", " 年 ")} 月</h3>
          <div className="records-stack">
            {items.map(record => {
              const dateParts = recordDateParts(record);
              const carePlace = [record.hospital, record.department, record.doctor && `${record.doctor}醫師`].filter(Boolean).join(" ｜ ");
              const title = typeLabel(record.type);
              const note = record.notes || record.reminder_text;
              return (
                <article key={record.id} className="records-row record-completed records-card">
                  <div className="record-summary-button">
                    <span className="record-date-col">
                      <span className="record-date-year">{dateParts.year}</span>
                      <strong>{dateParts.date}</strong>
                      <span>{[dateParts.weekday, dateParts.time].filter(Boolean).join(" ")}</span>
                    </span>
                    <div className="record-info">
                      <span className="record-card-heading">
                        <span className="record-type-chip record-type-icon" aria-hidden="true">{typeIcon(record.type)}</span>
                        <span className="record-type-chip record-tag">{title}</span>
                      </span>
                      {carePlace && <span className="record-place-line">{carePlace}</span>}
                      {note && <small>{note}</small>}
                    </div>
                    {record.status === "completed" ? (
                      <span className="record-status-tag is-completed">已完成</span>
                    ) : (
                      <button
                        type="button"
                        className="record-status-tag record-status-copy"
                        onClick={() => handleCopyReminder(record)}
                        aria-label={`複製 ${title} 提醒文字`}
                      >
                        待提醒
                      </button>
                    )}
                  </div>
                  <div className="record-card-actions">
                    {copyNotice.id === record.id && <span className="record-copy-notice">{copyNotice.message}</span>}
                    {onEditRecord && (
                      <button type="button" className="record-edit-button" onClick={() => onEditRecord?.(record)} aria-label={`編輯 ${title} 提醒`}>
                        編輯
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )) : (
        <EmptyGuide
          title={searchQuery ? "沒有符合的紀錄。" : `目前沒有${modeLabel}。`}
          description={searchQuery ? "換一個醫院、科別、醫師或提醒類型試試看。" : mode === "history" ? "切回未來安排可以查看接下來要做的事。" : "拍藥袋、處方箋、掛號單或提醒單後，整理好的照護資料會先出現在這裡。"}
          primaryLabel={onUpload ? "拍照新增照護資料" : undefined}
          onPrimary={onUpload}
        />
      )}
    </div>
  );
}

function DocumentLibraryView({ documents, searchQuery, onUploadDocument, onOpenDocument }) {
  const grouped = useMemo(() => {
    const groups = {};
    documents
      .filter((document) => document.status !== "deleted")
      .sort((a, b) => String(b.document_date || b.created_at || "").localeCompare(String(a.document_date || a.created_at || "")))
      .forEach((document) => {
        const date = document.document_date || document.created_at || "";
        const month = date && date.includes("-") ? date.slice(0, 7) : "未分類日期";
        if (!groups[month]) groups[month] = [];
        groups[month].push(document);
      });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [documents]);

  if (!documents.length) {
    return (
      <EmptyGuide
        title={searchQuery ? "沒有符合的文件。" : "目前沒有醫療文件。"}
        description={searchQuery ? "換一個醫院、文件類型、藥名或日期試試看。" : "可以上傳醫院申請回來的病歷、用藥紀錄、檢查報告或處方箋。"}
        primaryLabel={onUploadDocument ? "上傳病歷文件" : undefined}
        onPrimary={onUploadDocument}
      />
    );
  }

  return (
    <div className="document-library-view">
      <div className="document-library-actions">
        {onUploadDocument && <button type="button" className="primary-action" onClick={onUploadDocument}>上傳病歷文件</button>}
      </div>
      {grouped.map(([month, items]) => (
        <section key={month} className="record-month-group">
          <h3 className="month-divider">{month === "未分類日期" ? month : `${month.replace("-", " 年 ")} 月`}</h3>
          <div className="document-card-grid">
            {items.map((document) => (
              <article key={document.id} className="document-library-card">
                <button type="button" className="document-card-main" onClick={() => onOpenDocument?.(document)}>
                  <span className="record-type-chip record-type-icon">{documentTypeLabel(document.document_type).slice(0, 2)}</span>
                  <span>
                    <strong>{document.document_title}</strong>
                    <small>{[document.source_hospital, document.document_date && formatDateLabel(document.document_date), document.page_count && `${document.page_count} 頁`].filter(Boolean).join(" ｜ ")}</small>
                  </span>
                </button>
                <div className="document-card-footer">
                  <span>{document.has_original_file ? "已保存原始檔" : "只保存摘要"}</span>
                  <button type="button" className="record-edit-button" onClick={() => onOpenDocument?.(document)}>給醫師看</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function reminderAuditEventLabel(eventType = "") {
  if (eventType === "daily_appointment_reminder") return "今日行程提醒";
  if (eventType === "evening_appointment_reminder") return "明日行程提醒";
  return "LINE 提醒";
}

function reminderAuditStatusLabel(status = "") {
  if (status === "sent") return "已送出";
  if (status === "failed") return "失敗";
  if (status === "skipped") return "略過";
  return "待確認";
}

function reminderAuditTimeLabel(value) {
  if (!value) return "時間待確認";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時間待確認";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function ReminderAuditPanel({ logs = [] }) {
  return (
    <section className="summary-panel wide-panel reminder-audit-panel">
      <div className="panel-heading-row">
        <div>
          <p className="panel-eyebrow">提醒送達確認</p>
          <h3>最近提醒送達</h3>
        </div>
        <span>{logs.length ? `${logs.length} 筆` : "尚無紀錄"}</span>
      </div>
      {logs.length ? (
        <div className="reminder-audit-list">
          {logs.map((log) => (
            <article key={log.id} className={`reminder-audit-row is-${log.status || "unknown"}`}>
              <div>
                <strong>{reminderAuditEventLabel(log.event_type)}</strong>
                <span>
                  {[log.target_date && formatDateLabel(log.target_date), `${Number(log.item_count || 0)} 筆提醒`].filter(Boolean).join(" ｜ ")}
                </span>
              </div>
              <div>
                <span className="reminder-audit-status">{reminderAuditStatusLabel(log.status)}</span>
                <small>
                  {reminderAuditTimeLabel(log.created_at)}
                  {log.line_user_suffix ? ` ｜ LINE 後四碼 ${log.line_user_suffix}` : ""}
                  {log.http_status ? ` ｜ HTTP ${log.http_status}` : ""}
                </small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="helper-copy">目前還沒有提醒送達紀錄。等 08:00 或 20:00 排程送出後，這裡會顯示去識別化紀錄。</p>
      )}
    </section>
  );
}

function activityAuditActionLabel(action = "") {
  if (action === "appointment_created") return "新增行程";
  if (action === "family_note_created") return "更新家庭提醒";
  if (action === "medication_taken") return "確認本次服用";
  if (action === "medication_forgotten") return "標記尚未服用";
  return "照護資料異動";
}

function ActivityAuditPanel({ events = [] }) {
  return (
    <section className="summary-panel wide-panel activity-audit-panel" aria-label="照護共同紀錄">
      <div className="panel-heading-row">
        <div>
          <p className="panel-eyebrow">共同紀錄</p>
          <h3>誰在什麼時候做了什麼</h3>
        </div>
        <span>{events.length ? `${events.length} 筆` : "尚無紀錄"}</span>
      </div>
      {events.length ? (
        <div className="activity-audit-list">
          {events.map((event) => (
            <article key={event.id} className="activity-audit-row">
              <div>
                <strong>{activityAuditActionLabel(event.action)}</strong>
                <span>{event.summary || "照護資料"}</span>
              </div>
              <div>
                <span className="activity-audit-actor">{event.actor_display_name || "家庭協作者"}</span>
                <small>{reminderAuditTimeLabel(event.occurred_at)}・{event.status === "success" ? "已同步" : event.status || "待確認"}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="helper-copy">重要的行程、家庭提醒與用藥確認會在這裡留下操作者與同步時間。</p>
      )}
    </section>
  );
}

function SettingsView({
  identity,
  isPersonalMode,
  careProfiles,
  selectedProfile,
  activeProfileId,
  onProfileChange,
  onGroupChange,
  onEditProfile,
  onAddReminder,
  linePushAudit = [],
  activityAudit = [],
  pricing = CARE_WEDO_PRICING,
  familyNotes,
  onFamilyNotesChange,
  onLogout,
}) {
  const reviewMode = safeReviewLoginEnabled();
  const accountProvider = identity.profile?.authProvider || identity.provider;
  const accountProviderLabel = accountProvider === "email"
    ? "Email／密碼測試帳號"
    : accountProvider === "google"
      ? "Google 帳號"
      : accountProvider === "supabase"
        ? "Supabase 帳號"
        : "LINE 帳號";
  const accountDisplayName = identity.profile?.displayName || identity.profile?.email || accountProviderLabel;
  const normalizedPricing = normalizeCareWedoPricing(pricing);

  return (
    <div className="settings-grid">
      <div className="settings-section-label" role="heading" aria-level="2">家庭與成員</div>
      <section className="summary-panel wide-panel collaborator-control-panel">
        <p className="panel-eyebrow">協作者管理中心</p>
        <h3>設定與資料整理都集中在這裡。</h3>
        <p>長輩頁面只保留今天、行程與用藥查看；編輯資料、手動新增、家人提醒由照護圈協作者在這裡處理。</p>
        <div className="management-action-grid">
          <button type="button" className="primary-action" onClick={onEditProfile}>編輯照護對象</button>
          <button type="button" className="secondary-action" onClick={onAddReminder}>手動新增提醒</button>
          <a className="secondary-action" href={`mailto:${CARE_WEDO_SUPPORT_EMAIL}`}>資料協助</a>
        </div>
      </section>

      <section className="summary-panel">
        <p className="panel-eyebrow">照護對象</p>
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
              title="目前還沒有其他照護對象。"
              description="可以在下方新增爸爸、媽媽、自己，或其他需要一起管理照護資料的人。"
            />
          )}
        </div>
      </section>

      <section className="summary-panel wide-panel">
        <GroupSettings identity={identity} onProfileCreated={onGroupChange} onGroupChange={onGroupChange} />
      </section>

      <div className="settings-section-label" role="heading" aria-level="2">提醒與通知</div>
      <ReminderAuditPanel logs={linePushAudit} />

      <ActivityAuditPanel events={activityAudit} />

      <section className="summary-panel wide-panel">
        <p className="panel-eyebrow">家人要記得的事</p>
        <FamilyNotesEditor notes={familyNotes} onChange={onFamilyNotesChange} />
      </section>

      <div className="settings-section-label" role="heading" aria-level="2">照護資料</div>
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

      <section className="summary-panel wide-panel trust-panel">
        <p className="panel-eyebrow">資料怎麼保存</p>
        <h3>保存整理後的重要文字資料，方便日後查詢。</h3>
        <p>Care WEDO 使用雲端資料庫保存照護資料，並規劃定期備份。若資料有問題、需要匯出或刪除，可聯絡客服信箱。</p>
        <a className="inline-action" href={`mailto:${CARE_WEDO_SUPPORT_EMAIL}`}>{CARE_WEDO_SUPPORT_EMAIL}</a>
      </section>

      <div className="settings-section-label" role="heading" aria-level="2">費用與帳號</div>
      <section className="summary-panel wide-panel pricing-mode-panel" aria-label="目前費用模式">
        <p className="panel-eyebrow">{reviewMode ? "STAGING 測試模式" : "正式方案"}</p>
        <h3>{reviewMode ? "測試環境不會實際扣款" : "方案與付款"}</h3>
        <p>{reviewMode ? CARE_WEDO_TEST_MODE_COPY : formatCareWedoPricingCopy(normalizedPricing)}</p>
      </section>

      {isPersonalMode && onLogout && (
        <section className="summary-panel wide-panel">
              <p className="panel-eyebrow">帳號</p>
          <div className="account-row">
            <div>
              <p className="account-name">{accountDisplayName}</p>
              <p className="account-sub">目前以 {accountProviderLabel} 登入</p>
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
  const [savedAt, setSavedAt] = useState(null);
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
    setSaved(false);
    try {
      await onChange(drafts);
      setSaved(true);
      setSavedAt(new Date());
      setTimeout(() => setSaved(false), 2400);
    } catch (err) {
      setSavedAt(null);
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
              刪除
            </button>
          </article>
        ))}
      </div>
      {error && <p className="error-msg">{error}</p>}
      {saved && <p className="success-msg" role="status">已儲存{savedAt ? `・${savedAt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}` : ""}，家庭成員重新整理後即可看到。</p>}
      <div className="family-notes-actions">
        <button type="button" className="secondary-action" onClick={addDraft}>
          新增
        </button>
        <button type="button" className="inline-action" onClick={handleSave} disabled={saving}>
          {saving ? "儲存中..." : error ? "重試儲存" : saved ? "已儲存" : "儲存"}
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
          <button type="button" onClick={onClose} className="btn-close" aria-label="關閉">✕</button>
        </div>
        <div className="modal-body">
          <p className="helper-copy">每一則會成為一張家庭提醒卡，儲存在目前家庭群組，切換群組後會顯示各自的提醒。</p>
          <FamilyNotesEditor notes={notes} onChange={onSave} />
        </div>
      </div>
    </div>
  );
}
