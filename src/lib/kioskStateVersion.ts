/**
 * Returns true only when a kiosk polling response is at least as recent as the
 * last accepted server projection. The database owns the counter; this helper
 * merely prevents a late HTTP response from repainting stale state.
 */
export function acceptsKioskStateVersion(lastSeen: number, incoming: number | null | undefined): boolean {
  return typeof incoming !== "number" || Number.isNaN(incoming) || incoming >= lastSeen;
}
