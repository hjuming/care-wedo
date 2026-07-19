import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("care_documents schema is extended for private medical document storage", () => {
  const migration = readProjectFile("supabase/migration_phase56_care_documents_library.sql");
  const schema = readProjectFile("supabase/schema.sql");

  for (const field of [
    "storage_bucket",
    "storage_path",
    "original_file_name",
    "mime_type",
    "file_size_bytes",
    "page_count",
    "document_title",
    "source_hospital",
    "document_date",
    "summary_status",
    "preserve_original_file",
  ]) {
    assert.match(migration, new RegExp(field));
    assert.match(schema, new RegExp(field));
  }
  assert.match(migration, /care-documents/);
  assert.match(migration, /public,\s*file_size_limit/);
  assert.match(migration, /false,\s*26214400/);
});

test("document APIs require group access and keep original files behind signed URLs", () => {
  const listApi = readProjectFile("functions/api/documents.ts");
  const uploadApi = readProjectFile("functions/api/documents/upload.ts");
  const detailApi = readProjectFile("functions/api/documents/[id].ts");
  const fileUrlApi = readProjectFile("functions/api/documents/[id]/file-url.ts");
  const shared = readProjectFile("functions/_shared/care_documents.ts");

  assert.match(listApi, /getCurrentUserDocumentContext/);
  assert.match(detailApi, /fetchAccessibleDocument/);
  assert.match(fileUrlApi, /createCareDocumentSignedUrl/);
  assert.match(fileUrlApi, /expires_in/);
  assert.match(shared, /storage\/v1\/object\/sign/);
  assert.match(shared, /CARE_DOCUMENT_SIGNED_URL_SECONDS = 5 \* 60/);
  assert.match(shared, /application\/pdf/);
  assert.match(uploadApi, /validateCareDocumentFile/);
  assert.match(uploadApi, /preserve_original_file/);
  assert.match(uploadApi, /saveParsedDataToProfile/);
});

test("dashboard returns document summaries without leaking signed file URLs", () => {
  const dashboard = readProjectFile("functions/api/dashboard.ts");
  const shared = readProjectFile("functions/_shared/supabase.ts");

  assert.match(dashboard, /fetchDocuments/);
  assert.match(dashboard, /documents:\s*documents\.map\(serializeCareDocument\)/);
  assert.match(shared, /has_original_file/);
  assert.doesNotMatch(shared, /signedUrl/);
  assert.doesNotMatch(shared, /signed_url/);
});

test("frontend exposes document library upload and doctor display mode", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");
  const ocrWorkflow = readProjectFile("care-wedo-app/src/features/ocr/OcrWorkflow.jsx");
  const api = readProjectFile("care-wedo-app/src/services/api.js");
  const css = readProjectFile("care-wedo-app/src/index.css");

  assert.match(api, /uploadCareDocument/);
  assert.match(api, /fetchDocumentDetail/);
  assert.match(api, /fetchDocumentFileUrl/);
  assert.match(api, /deleteCareDocument/);
  assert.match(app, /CareDocumentUploadModal/);
  assert.match(ocrWorkflow, /export function CareDocumentUploadModal/);
  assert.match(ocrWorkflow, /上傳病歷或用藥紀錄/);
  assert.match(app, /CareDocumentDetailModal/);
  assert.match(app, /function hasDisplayableCareDocument/);
  assert.match(app, /\.filter\(hasDisplayableCareDocument\)/);
  assert.match(app, /醫師快速摘要/);
  assert.match(app, /開啟原始檔/);
  assert.match(app, /醫療文件/);
  assert.match(css, /\.document-library-card/);
  assert.match(css, /\.doctor-briefing-panel/);
});

test("document upload cannot be dismissed or submitted twice while the medical file is being stored", () => {
  const ocrWorkflow = readProjectFile("care-wedo-app/src/features/ocr/OcrWorkflow.jsx");
  const css = readProjectFile("care-wedo-app/src/index.css");
  const uploadModal = ocrWorkflow.slice(
    ocrWorkflow.indexOf("export function CareDocumentUploadModal"),
  );

  assert.match(uploadModal, /const savingRef = useRef\(false\)/);
  assert.match(uploadModal, /function requestClose\(\)[\s\S]*if \(savingRef\.current\) return;[\s\S]*onClose\(\)/);
  assert.match(uploadModal, /if \(savingRef\.current\) return;/);
  assert.match(uploadModal, /savingRef\.current = true/);
  assert.match(uploadModal, /savingRef\.current = false/);
  assert.match(uploadModal, /className="modal-overlay" onClick=\{requestClose\}/);
  assert.match(uploadModal, /aria-busy=\{saving\}/);
  assert.match(uploadModal, /className="btn-close" onClick=\{requestClose\} aria-label="關閉" disabled=\{saving\}/);
  assert.match(uploadModal, /id="care-document-file"[\s\S]*disabled=\{saving\}/);
  assert.match(uploadModal, /id="care-document-type"[\s\S]*disabled=\{saving\}/);
  assert.match(uploadModal, /checked=\{preserveOriginalFile\}[\s\S]*disabled=\{saving\}/);
  assert.match(uploadModal, /role="status"[\s\S]*文件正在上傳並整理，請先不要關閉/);
  assert.ok(uploadModal.indexOf("care-document-upload-status") < uploadModal.indexOf('id="care-document-file"'));
  assert.match(uploadModal, /className="notice-danger" role="alert"/);
  assert.match(uploadModal, /className="secondary-action" onClick=\{requestClose\} disabled=\{saving\}/);
  assert.match(css, /\.care-document-upload-status\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
});
