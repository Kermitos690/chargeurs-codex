import type { ApiResult } from "./chargenow.ts";

/**
 * A 2xx transport response means the supplier received the physical command.
 * Some ChargeNow cabinets still return a non-zero business code while they
 * execute the command asynchronously. Treat that result as ambiguous, never
 * as proof of delivery and never as a reason to send a second eject command.
 */
export function needsSupplierReleaseConfirmation(result: ApiResult): boolean {
  return result.status >= 200 && result.status < 300
    && !result.ok
    && /^HTTP_2\d\d_CODE_\d+$/.test(String(result.error ?? ""));
}
