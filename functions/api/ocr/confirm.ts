import {
  Env,
  getBearerToken,
  getOrCreateDefaultUser,
  getUserMemberships,
  supabaseFetch,
  verifyLineIdToken,
} from "../../_shared/supabase";

type CareDocumentSummary = {
  id: number;
  group_id: number;
  profile_id: number | null;
  status: string;
};

async function getCurrentUserContext(request: Request, env: Env) {
  const token = getBearerToken(request);
  if (!token) {
    return { error: Response.json({ error: "請先登入" }, { status: 401 }) };
  }

  const identity = await verifyLineIdToken(env, token);
  const userId = await getOrCreateDefaultUser(env, identity.lineUserId);
  const memberships = await getUserMemberships(env, userId);
  return { userId, groupIds: memberships.map((membership) => membership.group_id) };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json<{ document_id?: number }>().catch(() => ({}));
    const documentId = Number(body.document_id);
    if (!Number.isFinite(documentId) || documentId <= 0) {
      return Response.json({ error: "請提供有效的文件 ID" }, { status: 400 });
    }

    const context = await getCurrentUserContext(request, env);
    if ("error" in context) return context.error;

    const documents = await supabaseFetch<CareDocumentSummary[]>(
      env,
      `care_documents?id=eq.${documentId}&select=id,group_id,profile_id,status&limit=1`,
    );
    const document = documents[0];
    if (!document || !context.groupIds.includes(document.group_id)) {
      return Response.json({ error: "找不到文件或沒有確認權限" }, { status: 403 });
    }

    const confirmedDocuments = await supabaseFetch<Array<{ id: number }>>(
      env,
      `care_documents?id=eq.${documentId}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "confirmed" }),
      },
    );

    const appointments = await supabaseFetch<Array<{ id: number }>>(
      env,
      `appointments?source_document_id=eq.${documentId}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "upcoming" }),
      },
    );

    const medications = await supabaseFetch<Array<{ id: number }>>(
      env,
      `medications?source_document_id=eq.${documentId}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ active: true }),
      },
    );

    return Response.json({
      success: true,
      document_id: confirmedDocuments[0]?.id ?? documentId,
      appointment_ids: appointments.map((row) => row.id),
      medication_ids: medications.map((row) => row.id),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法確認文件" },
      { status: 500 },
    );
  }
};
