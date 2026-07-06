import { readJsonBody } from "../../_shared/request_body";
import {
  Env,
  getBearerToken,
  getUserMemberships,
  supabaseFetch,
} from "../../_shared/supabase";
import { getRequestUser } from "../../_shared/auth_context";
import {
  isMissingMedicationIdentityColumn,
  stripMedicationIdentityPayload,
} from "../../_shared/medical_ocr";

type CareDocumentSummary = {
  id: number;
  group_id: number;
  profile_id: number | null;
  status: string;
};

type PendingMedicationRow = {
  id: number;
  profile_id: number | null;
  duplicate_candidate_ids?: unknown;
  identity_confidence?: number | string | null;
  name?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  time_slot?: string | null;
  meal_timing?: string | null;
  scheduled_time?: string | null;
  purpose?: string | null;
  warnings?: string | null;
  reminder_text?: string | null;
  normalized_name?: string | null;
  brand_name?: string | null;
  generic_name?: string | null;
  drug_code?: string | null;
  dosage_text?: string | null;
};

async function getCurrentUserContext(context: { request: Request; env: Env; data?: any }): Promise<{ error: Response } | { userId: number; groupIds: number[] }> {
  const { request, env } = context;
  const token = getBearerToken(request);
  if (!token) {
    return { error: Response.json({ error: "請先登入" }, { status: 401 }) };
  }

  const { userId } = await getRequestUser(context);
  const memberships = await getUserMemberships(env, userId);
  return { userId, groupIds: memberships.map((membership) => membership.group_id) };
}

function parseDuplicateCandidateIds(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (typeof value === "string" && value.trim()) {
    try {
      return parseDuplicateCandidateIds(JSON.parse(value));
    } catch {
      return value.split(",").map((id) => Number(id.trim())).filter((id) => Number.isFinite(id) && id > 0);
    }
  }
  return [];
}

function medicationMergePayload(medication: PendingMedicationRow): Record<string, unknown> {
  return {
    name: medication.name || null,
    dosage: medication.dosage || null,
    frequency: medication.frequency || null,
    time_slot: medication.time_slot || null,
    meal_timing: medication.meal_timing || null,
    scheduled_time: medication.scheduled_time || null,
    purpose: medication.purpose || null,
    warnings: medication.warnings || null,
    reminder_text: medication.reminder_text || null,
    normalized_name: medication.normalized_name || null,
    brand_name: medication.brand_name || null,
    generic_name: medication.generic_name || null,
    drug_code: medication.drug_code || null,
    dosage_text: medication.dosage_text || null,
    identity_confidence: medication.identity_confidence ? Number(medication.identity_confidence) : null,
    duplicate_candidate_ids: [],
    active: true,
  };
}

async function confirmLegacyMedications(env: Env, documentId: number) {
  const medications = await supabaseFetch<Array<{ id: number }>>(
    env,
    `medications?source_document_id=eq.${documentId}&select=id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ active: true }),
    },
  );
  return medications.map((row) => row.id);
}

async function confirmMedications(env: Env, documentId: number) {
  let pendingMedications: PendingMedicationRow[];
  try {
    pendingMedications = await supabaseFetch<PendingMedicationRow[]>(
      env,
      `medications?source_document_id=eq.${documentId}&select=id,profile_id,duplicate_candidate_ids,identity_confidence,name,dosage,frequency,time_slot,meal_timing,scheduled_time,purpose,warnings,reminder_text,normalized_name,brand_name,generic_name,drug_code,dosage_text`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isMissingMedicationIdentityColumn(message)) throw error;
    return confirmLegacyMedications(env, documentId);
  }

  const regularMedicationIds: number[] = [];
  const mergedMedicationIds: number[] = [];

  for (const medication of pendingMedications) {
    const duplicateCandidateIds = parseDuplicateCandidateIds(medication.duplicate_candidate_ids);
    const identityConfidence = Number(medication.identity_confidence || 0);
    const mergeTargetId = duplicateCandidateIds[0];
    if (mergeTargetId && identityConfidence >= 0.99) {
      const payload = medicationMergePayload(medication);
      let updated: Array<{ id: number }>;
      try {
        updated = await supabaseFetch<Array<{ id: number }>>(
          env,
          `medications?id=eq.${mergeTargetId}&profile_id=eq.${medication.profile_id}&select=id`,
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify(payload),
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isMissingMedicationIdentityColumn(message)) throw error;
        updated = await supabaseFetch<Array<{ id: number }>>(
          env,
          `medications?id=eq.${mergeTargetId}&profile_id=eq.${medication.profile_id}&select=id`,
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify(stripMedicationIdentityPayload(payload)),
          },
        );
      }
      if (updated[0]?.id) {
        mergedMedicationIds.push(updated[0].id);
        continue;
      }
    }
    regularMedicationIds.push(medication.id);
  }

  let activatedMedicationIds: number[] = [];
  if (regularMedicationIds.length > 0) {
    const activated = await supabaseFetch<Array<{ id: number }>>(
      env,
      `medications?id=in.(${regularMedicationIds.join(",")})&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ active: true }),
      },
    );
    activatedMedicationIds = activated.map((row) => row.id);
  }

  return Array.from(new Set([...activatedMedicationIds, ...mergedMedicationIds]));
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  try {
    const body = await readJsonBody<{ document_id?: number }>(request);
    const documentId = Number(body.document_id);
    if (!Number.isFinite(documentId) || documentId <= 0) {
      return Response.json({ error: "請提供有效的文件 ID" }, { status: 400 });
    }

    const userContext = await getCurrentUserContext(context);
    if ("error" in userContext) return userContext.error;

    const documents = await supabaseFetch<CareDocumentSummary[]>(
      env,
      `care_documents?id=eq.${documentId}&select=id,group_id,profile_id,status&limit=1`,
    );
    const document = documents[0];
    if (!document || !userContext.groupIds.includes(document.group_id)) {
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

    const medicationIds = await confirmMedications(env, documentId);

    return Response.json({
      success: true,
      document_id: confirmedDocuments[0]?.id ?? documentId,
      appointment_ids: appointments.map((row) => row.id),
      medication_ids: medicationIds,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法確認文件" },
      { status: 500 },
    );
  }
};
