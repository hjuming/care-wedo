export const patientData = {
  name: "示範長輩",
  age: "",
  dept: "家醫科",
  doctor: "示範醫師",
  diagnoses: ["慢性病追蹤"],
};

export const medicines = [
  { name: "血壓藥 A", use: "血壓控制", freq: "每日1次", qty: "28粒", days: 28, color: "#2f80c0" },
  { name: "腸胃藥 B", use: "腸胃保護", freq: "每日3次", qty: "84粒", days: 28, color: "#2c8c5a" },
  { name: "睡前藥 C", use: "睡前服用", freq: "睡前", qty: "28粒", days: 28, color: "#7b55d9" },
];

export const timeline = [
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
    desc: "領藥號 A-001，一樓藥局窗口，帶健保卡與處方箋",
    icon: "💊",
    urgent: true,
    location: "一樓藥局窗口",
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
    label: "家醫科門診",
    desc: "示範醫師，診30號，預計來診 11:00-12:00",
    icon: "🏥",
    urgent: false,
    location: "門診一樓",
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
    label: "影像檢查",
    desc: "提前10分鐘報到，帶健保卡與預約單",
    icon: "🧲",
    urgent: false,
    location: "影像檢查室",
    done: false,
  },
];

export const checklist = [
  "3日內領第1次藥（A-001，一樓窗口）",
  "影像檢查：先結帳繳費再至檢查室報到",
  "確認抽血日期（回診前7天）",
  "確認聯絡電話是否正確（簡訊通知用）",
];
