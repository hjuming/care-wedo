export type MedicationSlotStatusLog = {
  id?: number;
  status: string | null;
  time_slot: string | null;
  created_at?: string | null;
};

function medicationLogTime(log: MedicationSlotStatusLog) {
  const value = Date.parse(String(log.created_at || ""));
  return Number.isFinite(value) ? value : 0;
}

export function resolveLatestMedicationSlotStatus<T extends MedicationSlotStatusLog>(logs: T[]) {
  const latestBySlot = new Map<string, T>();
  const sortedLogs = [...logs].sort((left, right) => {
    const timeDifference = medicationLogTime(right) - medicationLogTime(left);
    if (timeDifference !== 0) return timeDifference;
    return Number(right.id || 0) - Number(left.id || 0);
  });

  sortedLogs.forEach((log) => {
    const slot = log.time_slot || "unspecified";
    if (!latestBySlot.has(slot)) latestBySlot.set(slot, log);
  });

  const takenLogs = Array.from(latestBySlot.values()).filter((log) => log.status === "taken");
  return {
    latestTakenLog: takenLogs[0] || null,
    takenLogs,
    takenSlots: takenLogs.map((log) => log.time_slot).filter((slot): slot is string => Boolean(slot)),
  };
}
