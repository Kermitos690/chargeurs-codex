/** Public allow-list: never add provider payloads, internal identifiers or raw_data. */
export const PUBLIC_STATION_FIELDS = [
  "station_id",
  "name",
  "location_name",
  "status",
  "online",
  "rentable_count",
  "returnable_count",
  "total_count",
  "currency",
  "last_sync_at",
].join(",");

export function publicStationPath(stationId: string) {
  return `/bornes/${encodeURIComponent(stationId.trim().toUpperCase())}`;
}

export function stationDirectionsUrl(location: string | null, stationId: string) {
  const destination = location?.trim() || `Borne Chargeurs.ch ${stationId}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
}
