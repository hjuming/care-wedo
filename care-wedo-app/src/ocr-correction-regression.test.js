import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(import.meta.dirname, "App.jsx"), "utf8");
const ocrResultSource = readFileSync(resolve(import.meta.dirname, "components/OcrResult.jsx"), "utf8");
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
  assert.match(appSource, /整理文字/);
  assert.match(ocrApiSource, /medical_text/);
  assert.match(ocrApiSource, /parseMedicalText/);
});

test("OcrResult exposes an editable correction flow", () => {
  assert.match(ocrResultSource, /onSaveCorrections/);
  assert.match(ocrResultSource, /setEditing\(true\)/);
  assert.match(ocrResultSource, /handleSave/);
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
