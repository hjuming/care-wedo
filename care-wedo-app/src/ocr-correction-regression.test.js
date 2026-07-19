import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(import.meta.dirname, "App.jsx"), "utf8");
const ocrResultSource = readFileSync(resolve(import.meta.dirname, "components/OcrResult.jsx"), "utf8");
const ocrWorkflowSource = readFileSync(resolve(import.meta.dirname, "features/ocr/OcrWorkflow.jsx"), "utf8");
const ocrApiSource = readFileSync(resolve(import.meta.dirname, "../../functions/api/ocr/[[path]].ts"), "utf8");

function readProjectFile(path) {
  return readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
}

test("Dashboard keeps saved OCR record ids for correction", () => {
  assert.match(appSource, /setOcrData\(\{\s*data:\s*result\.data,\s*saved:\s*result\.saved/);
});

test("Dashboard passes an OCR correction saver to OcrResult", () => {
  assert.match(appSource, /onSaveCorrections=\{handleOcrCorrectionsSave\}/);
});

test("Dashboard supports text upload through the same OCR review flow", () => {
  assert.match(appSource, /ocrAnalyzeText/);
  assert.match(appSource, /handleTextUpload/);
  assert.match(appSource, /onTextSubmit=\{handleTextUpload\}/);
  assert.match(ocrWorkflowSource, /整理文字/);
  assert.match(ocrApiSource, /medical_text/);
  assert.match(ocrApiSource, /parseMedicalText/);
});

test("OCR keeps its original care context locked through scan and review", () => {
  const app = appSource;
  const css = readProjectFile("care-wedo-app/src/index.css");
  const switcher = app.slice(app.indexOf("function ProfileSwitcher"), app.indexOf("function GroupBadge"));
  const groupBadge = app.slice(app.indexOf("function GroupBadge"), app.indexOf("function CareDisplayModeSwitch"));
  const header = app.slice(app.indexOf("function CareContextHeader"), app.indexOf("function RecordsView"));

  assert.match(app, /const ocrCareContextRef = useRef\(null\)/);
  assert.match(app, /function isOcrCareContextLocked\(\)[\s\S]*scanning \|\| Boolean\(ocrData\)/);
  assert.match(app, /async function handleFilesSelected[\s\S]*const ocrCareContext = \{ profileId: activeProfileId, groupId: activeGroupId, recipientName:[\s\S]*ocrCareContextRef\.current = ocrCareContext/);
  assert.match(app, /async function handleTextUpload[\s\S]*const ocrCareContext = \{ profileId: activeProfileId, groupId: activeGroupId, recipientName:[\s\S]*ocrCareContextRef\.current = ocrCareContext/);
  assert.match(app, /function handleProfileChange\(profileId\) \{[\s\S]*if \(isOcrCareContextLocked\(\)\) return;/);
  assert.match(app, /function handleGroupChange\(groupId\) \{[\s\S]*if \(isOcrCareContextLocked\(\)\) return;/);
  assert.match(app, /await loadDashboard\(identity, ocrCareContext\.profileId, ocrCareContext\.groupId\)/);
  assert.match(app, /<OcrResult[\s\S]*careRecipientName=\{ocrData\.careContext\?\.recipientName/);
  assert.match(switcher, /disabled=\{disabled\}/);
  assert.match(groupBadge, /disabled=\{disabled\}/);
  assert.match(header, /disabled=\{disabled\}/);
  assert.match(ocrResultSource, /careRecipientName = "目前照護對象"/);
  assert.match(ocrResultSource, /這次資料會存入：\{careRecipientName\}/);
  assert.match(css, /\.ocr-save-note\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
});

test("OCR review becomes one clear column on 320px screens with enlarged text", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  const narrowStart = css.indexOf("@media (max-width: 360px)");
  const narrowEnd = css.indexOf(".group-settings", narrowStart);
  const narrow = css.slice(narrowStart, narrowEnd);

  assert.match(narrow, /\.ocr-result-header\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(narrow, /\.ocr-result-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*width:\s*100%/);
  assert.match(narrow, /\.ocr-result-actions \.compact-action,[\s\S]*\.ocr-result-actions \.ocr-close-action\s*\{[\s\S]*min-height:\s*52px[\s\S]*width:\s*100%[\s\S]*white-space:\s*normal/);
  assert.match(narrow, /\.ocr-edit-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("OcrResult exposes an editable correction flow", () => {
  assert.match(ocrResultSource, /onSaveCorrections/);
  assert.match(ocrResultSource, /setEditing\(true\)/);
  assert.match(ocrResultSource, /handleSave/);
});

test("OcrResult cannot be dismissed or submitted twice while corrections are being saved", () => {
  assert.match(ocrResultSource, /import \{ useEffect, useMemo, useRef, useState \} from "react"/);
  assert.match(ocrResultSource, /const savingRef = useRef\(false\)/);
  assert.match(ocrResultSource, /function requestClose\(\)[\s\S]*if \(savingRef\.current\) return;[\s\S]*onClose\(\)/);
  assert.match(ocrResultSource, /function startEditing\(\)[\s\S]*if \(savingRef\.current\) return;[\s\S]*setEditing\(true\)/);
  assert.match(ocrResultSource, /function cancelEditing\(\)[\s\S]*if \(savingRef\.current\) return;[\s\S]*setEditing\(false\)/);
  assert.match(ocrResultSource, /async function handleSave\(\)[\s\S]*if \(!onSaveCorrections \|\| savingRef\.current\) return;[\s\S]*savingRef\.current = true/);
  assert.match(ocrResultSource, /finally \{[\s\S]*savingRef\.current = false;[\s\S]*setSaving\(false\)/);
  assert.match(ocrResultSource, /className="ocr-result-panel" aria-busy=\{saving\}/);
  assert.match(ocrResultSource, /className="inline-action ocr-close-action" onClick=\{requestClose\} disabled=\{saving\}/);
  assert.match(ocrResultSource, /onClick=\{startEditing\} disabled=\{saving\}/);
  assert.match(ocrResultSource, /onClick=\{cancelEditing\} disabled=\{saving\}/);
  assert.match(ocrResultSource, /className="ocr-save-note" role="status">正在儲存校正內容，請先不要收起。/);
  assert.match(ocrResultSource, /className="ocr-save-note danger" role="alert"/);
});

test("OcrResult uses confirm-first actions before formalizing OCR records", () => {
  assert.match(ocrResultSource, /正確，存起來/);
  assert.match(ocrResultSource, /有錯，我要修改/);
  assert.doesNotMatch(ocrResultSource, /問家人/);
  assert.match(ocrResultSource, /我先幫你分成/);
  assert.match(ocrResultSource, /照護提醒/);
  assert.match(ocrResultSource, /種用藥/);
  assert.match(appSource, /confirmOcrDocument/);
});

test("OCR API stores a care document and links generated records to it", () => {
  assert.match(ocrApiSource, /care_documents\?select=id/);
  assert.match(ocrApiSource, /group_id:\s*groupId/);
  assert.match(ocrApiSource, /profile_id:\s*profileId/);
  assert.match(ocrApiSource, /uploaded_by_user_id:\s*userId/);
  assert.match(ocrApiSource, /source_document_id:\s*documentId/);
  assert.match(ocrApiSource, /document_id:\s*documentId/);
});

test("OCR API keeps parsed records pending until human confirmation", () => {
  assert.match(ocrApiSource, /status:\s*"pending_review"/);
  assert.doesNotMatch(ocrApiSource, /status:\s*"draft"/);
  assert.doesNotMatch(ocrApiSource, /status:\s*"upcoming"/);
  assert.match(ocrApiSource, /active:\s*false/);
});

test("OCR confirm API promotes pending parsed records into formal care records", () => {
  const confirmApiSource = readProjectFile("functions/api/ocr/confirm.ts");
  assert.match(confirmApiSource, /care_documents\?id=eq\.\$\{documentId\}/);
  assert.match(confirmApiSource, /status:\s*"confirmed"/);
  assert.match(confirmApiSource, /appointments\?source_document_id=eq\.\$\{documentId\}/);
  assert.match(confirmApiSource, /status:\s*"upcoming"/);
  assert.match(confirmApiSource, /medications\?source_document_id=eq\.\$\{documentId\}/);
  assert.match(confirmApiSource, /active:\s*true/);
});
