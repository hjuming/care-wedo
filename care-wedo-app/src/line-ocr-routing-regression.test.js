import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("LINE OCR matches parsed patient identity before saving records", () => {
  const callback = readProjectFile("functions/callback.ts");
  const ocr = readProjectFile("functions/_shared/medical_ocr.ts");

  assert.match(ocr, /patient_name/);
  assert.match(ocr, /birth_date/);
  assert.match(ocr, /resolveMatchedCareProfile/);
  assert.match(ocr, /createPendingLineOcrDocument/);
  assert.match(ocr, /savePendingParsedDataToProfile/);
  assert.match(callback, /pendingProfileQuickReply/);
  assert.match(callback, /action"\)\s*===\s*"assign_pending_ocr"/);
  assert.match(callback, /savePendingParsedDataToProfile/);
  assert.match(callback, /assignPendingOcrByText/);
  assert.match(callback, /pending_profile_selection/);
});

test("LINE pending OCR assignment accepts LINE display text and replies with the parsed summary", () => {
  const callback = readProjectFile("functions/callback.ts");

  assert.match(callback, /resolveProfileFromSelectionText/);
  assert.match(callback, /normalizedText\.includes\(normalizedName\)/);
  assert.match(callback, /event\.type === "postback" && event\.postback\?\.data/);
  assert.doesNotMatch(callback, /event\.type === "postback" && event\.postback\?\.data && event\.replyToken/);
  assert.match(callback, /ASSIGNMENT_ACK_TEXT/);
  assert.match(callback, /waitUntil\(completePendingOcrAssignment/);
  assert.match(callback, /pushAssignmentSummary/);
  assert.match(callback, /pushText\(env,\s*lineUserId,\s*reply\)/);
  assert.match(callback, /formatResultSummary\(saved\.parsed/);
});

test("LINE OCR profile reassignment keeps group and profile scope consistent", () => {
  const callback = readProjectFile("functions/callback.ts");
  const reassign = callback.slice(callback.indexOf("async function reassignRecordsToProfile"));

  assert.match(reassign, /group_id:\s*targetProfile\.group_id/);
  assert.match(reassign, /profile_id:\s*targetProfile\.id/);
});
