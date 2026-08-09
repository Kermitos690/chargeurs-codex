import type { ApiResult } from "./chargenow.ts";

/**
 * A 2xx transport response proves only that ChargeNow received/responded to C3.
 * It does NOT prove that exactly one battery left the cabinet. This remains true
 * even if the provider response names a battery: the cabinet can physically
 * release more than one compartment after a single command.
 *
 * Every 2xx C3 response therefore stays in confirmation-pending until the
 * read-only four-slot delta reconciler observes exactly one expected release.
 */
export function needsSupplierReleaseConfirmation(
  result: ApiResult,
  _releasedBatteryId: string | null,
): boolean {
  return result.status >= 200 && result.status < 300;
}
