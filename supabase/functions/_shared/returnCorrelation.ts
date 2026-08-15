export type PhysicalReturnCandidate = {
  receivedAt: string;
  externalEventId: string | null;
  batteryId: string | null;
  slotNum: number | null;
};

export type PhysicalReturnEvidence = {
  receivedAt: string;
  externalEventId: string | null;
  returnedSlotNum: number;
};

export function selectPhysicalReturnEvidence(
  candidates: PhysicalReturnCandidate[],
  expectedBatteryId: string,
): PhysicalReturnEvidence | null {
  for (const candidate of candidates) {
    if (candidate.batteryId !== expectedBatteryId) continue;
    if (!Number.isInteger(candidate.slotNum) || Number(candidate.slotNum) < 1) continue;
    if (!candidate.receivedAt || !Number.isFinite(Date.parse(candidate.receivedAt))) continue;
    return {
      receivedAt: candidate.receivedAt,
      externalEventId: candidate.externalEventId,
      returnedSlotNum: Number(candidate.slotNum),
    };
  }
  return null;
}

export function classifyRentalCandidates(count: number): "none" | "unique" | "ambiguous" {
  if (count === 1) return "unique";
  if (count > 1) return "ambiguous";
  return "none";
}
