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

  assert.match(app, /測試期間全功能免費開放/);
  assert.match(app, /長輩用 LINE 傳照片/);
  assert.match(app, /資料完整保存，LINE 只講重點/);
  assert.match(app, /正式免費版規劃/);
  assert.match(app, /正式收費版規劃/);
  assert.match(app, /回饋意見/);
  assert.match(app, /sendFeedbackEmail/);
  assert.match(app, /VITE_EMAILJS_SERVICE_ID/);
  assert.match(app, /VITE_EMAILJS_TEMPLATE_ID/);
  assert.match(app, /VITE_EMAILJS_PUBLIC_KEY/);
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
