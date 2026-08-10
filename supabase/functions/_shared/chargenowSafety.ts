// Fail-closed policies shared by all ChargeNow mutation paths.

export const PROVIDER_AUTO_SELECT_SLOT_MODE = "provider_auto_select";

export type RentSlotDecision =
  | { ok: true; slotNum: number; automatic: boolean }
  | { ok: false; error: "CHARGENOW_SLOT_SELECTION_REQUIRED" | "CHARGENOW_SLOT_INVALID" | "CHARGENOW_SLOT_ZERO_NOT_ALLOWED" };

export function resolveRentSlot(value: unknown, zeroMode?: string | null): RentSlotDecision {
  if (value === null || value === undefined || value === "") {
    return zeroMode === PROVIDER_AUTO_SELECT_SLOT_MODE
      ? { ok: true, slotNum: 0, automatic: true }
      : { ok: false, error: "CHARGENOW_SLOT_SELECTION_REQUIRED" };
  }

  const slotNum = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(slotNum) || slotNum < 0) {
    return { ok: false, error: "CHARGENOW_SLOT_INVALID" };
  }
  if (slotNum === 0 && zeroMode !== PROVIDER_AUTO_SELECT_SLOT_MODE) {
    return { ok: false, error: "CHARGENOW_SLOT_ZERO_NOT_ALLOWED" };
  }
  return { ok: true, slotNum, automatic: slotNum === 0 };
}

export function chargeNowCloseFailure(result: {
  ok: boolean;
  status: number;
  error?: string | null;
}): string | null {
  if (result.ok) return null;
  const providerCode = typeof result.error === "string" && /^[A-Z0-9_:-]{1,120}$/.test(result.error)
    ? result.error
    : result.status > 0
    ? `CHARGENOW_CLOSE_HTTP_${result.status}`
    : "CHARGENOW_CLOSE_FAILED";
  return providerCode;
}
