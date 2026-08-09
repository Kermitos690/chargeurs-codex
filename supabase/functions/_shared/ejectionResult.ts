import type { ApiResult } from "./chargenow.ts";

/**
 * A 2xx transport response means the supplier received the physical command.
 * Some ChargeNow cabinets answer asynchronously, or omit the released battery
 * identity even with a success code. Treat either response as ambiguous, never
 * as proof of delivery and never as a reason to send a second eject command.
 */
export function needsSupplierReleaseConfirmation(
  result: ApiResult,
  releasedBatteryId: string | null,
): boolean {
  return result.status >= 200 && result.status < 300
    && !releasedBatteryId;
}
