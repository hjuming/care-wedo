import { Env, supabaseFetch } from "./supabase";

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export type MedicationLogWrite = {
  medication_id: number;
  group_id: number | null;
  profile_id: number | null;
  taken_date: string;
  time_slot: string;
  status: string;
  confirmed_by_user_id: number;
};

type MedicationLogReadback = MedicationLogWrite & {
  id: number;
  idempotency_key: string;
};

export function parseMedicationIdempotencyKey(request: Request) {
  const key = String(request.headers.get("Idempotency-Key") || "").trim();
  if (!key) return { key: null, error: "缺少操作識別碼，請重新整理後再試一次" };
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return { key: null, error: "操作識別碼格式不正確，請重新整理後再試一次" };
  }
  return { key, error: null };
}

function sameLog(left: MedicationLogReadback, right: MedicationLogWrite) {
  return left.medication_id === right.medication_id
    && left.group_id === right.group_id
    && left.profile_id === right.profile_id
    && left.taken_date === right.taken_date
    && left.time_slot === right.time_slot
    && left.status === right.status
    && left.confirmed_by_user_id === right.confirmed_by_user_id;
}

export async function writeMedicationLogsIdempotently(
  env: Env,
  writes: MedicationLogWrite[],
  idempotencyKey: string,
) {
  const payload = writes.map((write) => ({ ...write, idempotency_key: idempotencyKey }));
  const inserted = await supabaseFetch<MedicationLogReadback[]>(
    env,
    "medication_logs?on_conflict=medication_id%2Cidempotency_key&select=id,medication_id,group_id,profile_id,taken_date,time_slot,status,confirmed_by_user_id,idempotency_key",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(payload),
    },
  );

  const medicationIds = writes.map((write) => write.medication_id);
  const readback = await supabaseFetch<MedicationLogReadback[]>(
    env,
    `medication_logs?medication_id=in.(${medicationIds.join(",")})&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=id,medication_id,group_id,profile_id,taken_date,time_slot,status,confirmed_by_user_id,idempotency_key`,
  );

  const expectedByMedication = new Map(writes.map((write) => [write.medication_id, write]));
  const validReadback = readback.length === writes.length && readback.every((row) => {
    const expected = expectedByMedication.get(row.medication_id);
    return expected ? sameLog(row, expected) : false;
  });
  if (!validReadback) {
    throw new Error("Idempotency-Key 已用於不同的用藥紀錄");
  }

  return {
    logs: readback,
    deduplicated: inserted.length < writes.length,
  };
}
