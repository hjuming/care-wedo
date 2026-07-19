import {
  CARE_DOCUMENT_SIGNED_URL_SECONDS,
  createCareDocumentSignedUrl,
  fetchAccessibleDocument,
  getCurrentUserDocumentContext,
} from "../../../_shared/care_documents";
import { Env } from "../../../_shared/supabase";
import { logError } from "../../../_shared/logger";
import { resolvePublicApiError } from "../../../_shared/public_error";

function parseDocumentId(params: Record<string, string | string[]>) {
  const id = Number(params.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  try {
    const id = parseDocumentId(params);
    if (!id) return Response.json({ error: "無效的文件 ID" }, { status: 400 });

    const documentContext = await getCurrentUserDocumentContext(context);
    const document = await fetchAccessibleDocument(env, id, documentContext.groupIds);
    if (!document) return Response.json({ error: "找不到文件或沒有查看權限" }, { status: 404 });
    if (document.preserve_original_file === false || !document.storage_bucket || !document.storage_path) {
      return Response.json({ error: "這份文件沒有保存原始檔" }, { status: 404 });
    }

    const signedUrl = await createCareDocumentSignedUrl(env, document.storage_bucket, document.storage_path);
    return Response.json({
      url: signedUrl,
      expires_in: CARE_DOCUMENT_SIGNED_URL_SECONDS,
      file_name: document.original_file_name || `care-document-${document.id}`,
    });
  } catch (error) {
    logError("documents.file_url_failed", error);
    const publicError = resolvePublicApiError(error, { fallback: "無法開啟原始文件" });
    return Response.json({ error: publicError.message }, { status: publicError.status });
  }
};
