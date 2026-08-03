export type StationConnectionState = "online" | "offline" | "unknown";

type StationConnectionInput = {
  online: boolean | null | undefined;
  status: string | null | undefined;
};

/**
 * `online` is the safety gate for rentals. `status` preserves the distinction
 * between an explicit supplier-offline response and a failed/ambiguous poll.
 * Never present the latter as a physical outage.
 */
export function stationConnectionState({ online, status }: StationConnectionInput): StationConnectionState {
  if (status === "online" && online === true) return "online";
  if (status === "offline") return "offline";
  return "unknown";
}

export function stationConnectionLabel(input: StationConnectionInput): string {
  switch (stationConnectionState(input)) {
    case "online": return "En ligne";
    case "offline": return "Hors ligne";
    default: return "Statut à vérifier";
  }
}

export function stationConnectionDetail(input: StationConnectionInput): string {
  switch (stationConnectionState(input)) {
    case "online": return "Borne disponible";
    case "offline": return "Borne hors ligne";
    default: return "Vérification fournisseur en cours";
  }
}
