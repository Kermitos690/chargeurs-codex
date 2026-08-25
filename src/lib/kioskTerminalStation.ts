const TERMINAL_STATION_IDS = new Set(["DTA21277"]);

export function stationHasPaymentTerminal(stationId: unknown): boolean {
  if (typeof stationId !== "string") return false;
  return TERMINAL_STATION_IDS.has(stationId.trim().toUpperCase());
}
