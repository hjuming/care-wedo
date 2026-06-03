import {
  buildCareDocumentDetail,
  cleanDocumentString,
  deleteCareDocumentObject,
  fetchAccessibleDocument,
  getCurrentUserDocumentContext,
  normalizeDocumentDate,
  normalizeDocumentType,
} from "../../_shared/care_documents";
import {
  Env,
  serializeCareDocument,
  supabaseFetch,
} from "../../_shared/supabase";

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

    return Response.json({ document: await buildCareDocumentDetail(env, document) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得文件";
    const status = message.includes("請先登入") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = parseDocumentId(params);
    if (!id) return Response.json({ error: "無效的文件 ID" }, { status: 400 });

    const context = await getCurrentUserDocumentContext(request, env);
    const document = await fetchAccessibleDocument(env, id, context.groupIds);
    if (!document) return Response.json({ error: "找不到文件或沒有修改權限" }, { status: 404 });

    const body = await request.json<any>().catch(() => ({}));
    const updates: Record<string, unknown> = {};
    if (body.document_type !== undefined) updates.document_type = normalizeDocumentType(body.document_type);
    if (body.document_title !== undefined) updates.document_title = cleanDocumentString(body.document_title, 120) || null;
    if (body.source_hospital !== undefined) updates.source_hospital = cleanDocumentString(body.source_hospital, 120) || null;
    if (body.document_date !== undefined) updates.document_date = normalizeDocumentDate(body.document_date) || null;

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "未提供任何更新欄位" }, { status: 400 });
    }

    const rows = await supabaseFetch<any[]>(env, `care_documents?id=eq.${document.id}&select=*`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(updates),
    });

    return Response.json({ success: true, document: serializeCareDocument(rows[0]) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法更新文件";
    const status = message.includes("請先登入") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = parseDocumentId(params);
    if (!id) return Response.json({ error: "無效的文件 ID" }, { status: 400 });

    const context = await getCurrentUserDocumentContext(request, env);
    const document = await fetchAccessibleDocument(env, id, context.groupIds);
    if (!document) return Response.json({ error: "找不到文件或沒有刪除權限" }, { status: 404 });

    if (document.storage_bucket && document.storage_path) {
      await deleteCareDocumentObject(env, document.storage_bucket, document.storage_path);
    }

    const rows = await supabaseFetch<any[]>(env, `care_documents?id=eq.${document.id}&select=*`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "deleted",
        deleted_at: new Date().toISOString(),
        storage_path: null,
        storage_bucket: null,
      }),
    });

    return Response.json({ success: true, document: serializeCareDocument(rows[0]) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法刪除文件";
    const status = message.includes("請先登入") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};
