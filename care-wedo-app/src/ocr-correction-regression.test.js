import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(import.meta.dirname, "App.jsx"), "utf8");
const ocrResultSource = readFileSync(resolve(import.meta.dirname, "components/OcrResult.jsx"), "utf8");

test("Dashboard keeps saved OCR record ids for correction", () => {
  assert.match(appSource, /setOcrData\(\{\s*data:\s*result\.data,\s*saved:\s*result\.saved/);
});

test("Dashboard passes an OCR correction saver to OcrResult", () => {
  assert.match(appSource, /onSaveCorrections=\{handleOcrCorrectionsSave\}/);
});

test("OcrResult exposes an editable correction flow", () => {
  assert.match(ocrResultSource, /onSaveCorrections/);
  assert.match(ocrResultSource, /setEditing\(true\)/);
  assert.match(ocrResultSource, /handleSave/);
});
