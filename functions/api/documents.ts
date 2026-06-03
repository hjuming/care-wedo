import {
  documentMatchesQuery,
  getCurrentUserDocumentContext,
  normalizeDocumentType,
} from "../_shared/care_documents";
import {
  CareDocumentRow,
  Env,
  serializeCareDocument,
  supabaseFetch,
} from "../_shared/supabase";

function parsePositiveNumber(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const context = await getCurrentUserDocumentContext(request, env);
    if (context.groupIds.length === 0) {
      return Response.json({ documents: [] });
    }

    const url = new URL(request.url);
    const profileId = parsePositiveNumber(url.searchParams.get("profile_id"));
    const type = normalizeDocumentType(url.searchParams.get("type"));
    const query = url.searchParams.get("q") || "";
    const canViewHistory = url.searchParams.get("history") !== "future";
    const filters = [
      `group_id=in.(${context.groupIds.join(",")})`,
      "status=neq.deleted",
      "deleted_at=is.null",
    ];

    if (profileId) {
      const profile = context.profiles.find((item) => item.id === profileId);
      if (!profile) return Response.json({ error: "沒有此照護對象的查看權限" }, { status: 403 });
      filters.push(`profile_id=eq.${profile.id}`);
    }

    if (type !== "other" || url.searchParams.has("type")) {
      filters.push(`document_type=eq.${encodeURIComponent(type)}`);
    }

    if (!canViewHistory) {
      filters.push(`created_at=gte.${encodeURIComponent(dateDaysAgo(30))}`);
    }

    const rows = await supabaseFetch<CareDocumentRow[]>(
      env,
      `care_documents?${filters.join("&")}&select=*&order=document_date.desc.nullslast,captured_at.desc.nullslast,created_at.desc&limit=100`,
    );

    const documents = rows
      .map(serializeCareDocument)
      .filter((document) => documentMatchesQuery(document, query));

    return Response.json({ documents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法取得文件";
    const status = message.includes("請先登入") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};
