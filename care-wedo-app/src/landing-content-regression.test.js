import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("landing page copy matches elder-friendly beta positioning", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");

  assert.match(app, /測試期間開放 Family Pro/);
  assert.match(app, /陪你照顧/);
  assert.match(app, /從「一個人」升級到「一家人」/);
  assert.match(app, /資料完整保存，LINE 只講重點/);
  assert.match(app, /Free \/ Family Pro/);
  assert.match(app, /plan-name-trigger/);
  assert.match(app, /side-footer-action/);
  assert.match(app, /href="https:\/\/care\.wedopr\.com\/"/);
  assert.doesNotMatch(app, /<button[^>]*>規劃中<\/button>/);
  assert.doesNotMatch(app, /查看方案規劃/);
  assert.match(app, /10 筆\/月/);
  assert.match(app, /100 筆\/月/);
  assert.match(app, /家庭群組/);
  assert.match(app, /8 位/);
  assert.match(app, /4 位/);
  assert.match(app, /完整歷史紀錄與健康時間線/);
  assert.match(app, /PLAN_TIERS/);
  assert.match(app, /Family Pro/);
  assert.match(app, /功能規劃/);
  assert.match(app, /超級版/);
  assert.match(app, /推薦方案/);
  assert.match(app, /家人協作/);
  assert.match(app, /10筆\/月/);
  assert.match(app, /系統測試期間，所有帳號開放 Family Pro 體驗，一起守護家人健康/);
  assert.match(app, /家庭群組協作/);
  assert.match(app, /家庭成員數量/);
  assert.match(app, /家人共同協作/);
  assert.match(app, /PlanDetailsModal/);
  assert.doesNotMatch(app, /目前規劃/);
  assert.doesNotMatch(app, /圖片解析 \/ 月/);
  assert.doesNotMatch(app, /家人帳號/);
  assert.doesNotMatch(app, /家庭專業/);
  assert.doesNotMatch(app, /無限版本/);
  assert.doesNotMatch(app, /Care Team/);
  assert.match(app, /回饋意見/);
  assert.match(app, /sendFeedbackEmail/);
  assert.match(app, /name: cleanName/);
  assert.match(app, /email: cleanEmail/);
  assert.match(app, /title,/);
  assert.match(app, /submitted_at_taipei/);
  assert.match(app, /website_url: "https:\/\/care\.wedopr\.com\/"/);
  assert.match(app, /logo_url: "https:\/\/care\.wedopr\.com\/android-chrome-192x192\.png"/);
  assert.match(app, /hero_image_url: "https:\/\/care\.wedopr\.com\/assets\/images\/og-care-wedo\.png"/);
  assert.match(app, /請留下 Email，我們才寄得到確認信/);
  assert.match(app, /placeholder="用來寄送確認信" required/);
  assert.match(app, /VITE_EMAILJS_SERVICE_ID/);
  assert.match(app, /VITE_EMAILJS_TEMPLATE_ID/);
  assert.match(app, /VITE_EMAILJS_PUBLIC_KEY/);

  const viteConfig = readProjectFile("care-wedo-app/vite.config.js");
  assert.match(viteConfig, /envDir: resolve\(__dirname, '\.\.'\)/);
});

test("landing page avoids outdated free-versus-paid claims during beta", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const terms = readProjectFile("care-wedo-app/src/components/TermsPage.jsx");
  const privacy = readProjectFile("care-wedo-app/src/components/PrivacyPage.jsx");
  const combined = `${app}\n${terms}\n${privacy}`;

  assert.doesNotMatch(combined, /免費版以對話體驗為主，不提供完整長期記憶/);
  assert.doesNotMatch(combined, /登入後的收費版才會把照護資料保存/);
  assert.doesNotMatch(combined, /先用 LINE 體驗，需要長期保存時再建立家庭照護空間/);
  assert.doesNotMatch(combined, /無家庭群組與長期記憶功能/);
});
