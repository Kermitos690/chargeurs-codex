export type KioskSlotCandidate = {
  slot_num: number;
  rentable: boolean;
  recommended: boolean;
  charge_percent: number | null;
};

/**
 * Prefer the backend recommendation, then the highest confirmed charge.
 * A customer never gets a hidden/ambiguous auto-selection: the returned slot
 * is still highlighted and sent explicitly when a rental is created.
 */
export function preferredKioskSlot(slots: KioskSlotCandidate[]): number | null {
  const candidates = slots.filter((slot) => slot.rentable);
  if (!candidates.length) return null;
  return [...candidates]
    .sort((a, b) => {
      const recommendation = Number(b.recommended) - Number(a.recommended);
      if (recommendation !== 0) return recommendation;
      const charge = (b.charge_percent ?? -1) - (a.charge_percent ?? -1);
      return charge !== 0 ? charge : a.slot_num - b.slot_num;
    })[0].slot_num;
}
