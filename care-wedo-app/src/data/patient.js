export const patientData = {
  name: "洪永吉",
  age: 75,
  dept: "腫瘤醫學部",
  doctor: "廖斌志醫師",
  diagnoses: ["C13.9 下咽癌", "E11.9 第二型糖尿病"],
};

export const medicines = [
  { name: "UFUR (Tegafur)", use: "化療口服藥", freq: "每日2次", qty: "56粒", days: 28, color: "#e74c3c" },
  { name: "Mopride 5mg", use: "腸胃蠕動", freq: "每日3次", qty: "84粒", days: 28, color: "#e67e22" },
  { name: "Imovane 7.5mg", use: "安眠藥（管4）", freq: "睡前", qty: "28粒", days: 28, color: "#9b59b6" },
  { name: "Fudecough 15mg", use: "止咳", freq: "飯後每日3次", qty: "84粒", days: 28, color: "#3498db" },
  { name: "Musco 30mg", use: "化痰", freq: "飯後每日3次", qty: "84粒", days: 28, color: "#1abc9c" },
  { name: "Megest 40mg/ml", use: "食慾促進劑", freq: "每日2次 4ml", qty: "2瓶", days: 28, color: "#27ae60" },
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

export const checklist = [
  "3日內領第1次藥（D-444，D窗口）",
  "胸部X光：先結帳繳費再至影醫部報到",
  "確認抽血日期（回診前7天）",
  "確認手機號碼 093564**** 是否正確（MRI簡訊通知用）",
];
