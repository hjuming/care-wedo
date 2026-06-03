import {
  CARE_DOCUMENT_SIGNED_URL_SECONDS,
  createCareDocumentSignedUrl,
  fetchAccessibleDocument,
  getCurrentUserDocumentContext,
} from "../../../_shared/care_documents";
import { Env } from "../../../_shared/supabase";

function parseDocumentId(params: Record<string, string | string[]>) {
  const id = Number(params.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = parseDocumentId(params);
    if (!id) return Response.json({ error: "無效的文件 ID" }, { status: 400 });

    const context = await getCurrentUserDocumentContext(request, env);
    const document = await fetchAccessibleDocument(env, id, context.groupIds);
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
    const message = error instanceof Error ? error.message : "無法開啟原始文件";
    const status = message.includes("請先登入") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};
