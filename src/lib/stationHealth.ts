export type StationHealthInput = {
  online: boolean;
  configured: boolean;
  lastSyncAt: string | null;
  rentableCount: number;
  returnableCount?: number | null;
  totalCount?: number | null;
  activeIncidentCount?: number;
  now?: Date;
};

export type StationHealthStatus = "healthy" | "degraded" | "critical" | "offline";

export type StationHealthResult = {
  score: number;
  status: StationHealthStatus;
  reasons: string[];
  lastSyncAgeSeconds: number | null;
};

export function calculateStationHealth(input: StationHealthInput): StationHealthResult {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  let score = 100;

  if (!input.configured) {
    score -= 45;
    reasons.push("API fournisseur non configurée");
  }

  if (!input.online) {
    score -= 55;
    reasons.push("Borne hors ligne");
  }

  const lastSyncAgeSeconds = input.lastSyncAt
    ? Math.max(0, Math.floor((now.getTime() - new Date(input.lastSyncAt).getTime()) / 1000))
    : null;

  if (lastSyncAgeSeconds === null) {
    score -= 20;
    reasons.push("Aucune synchronisation connue");
  } else if (lastSyncAgeSeconds > 900) {
    score -= 30;
    reasons.push("Synchronisation expirée depuis plus de 15 minutes");
  } else if (lastSyncAgeSeconds > 180) {
    score -= 15;
    reasons.push("Synchronisation ancienne");
  }

  if (input.rentableCount <= 0) {
    score -= 18;
    reasons.push("Aucune batterie disponible");
  }

  const totalCount = input.totalCount ?? null;
  const returnableCount = input.returnableCount ?? null;
  if (totalCount !== null && totalCount > 0 && returnableCount !== null && returnableCount <= 0) {
    score -= 12;
    reasons.push("Aucun emplacement libre pour un retour");
  }

  const incidents = Math.max(0, input.activeIncidentCount ?? 0);
  if (incidents > 0) {
    score -= Math.min(30, incidents * 10);
    reasons.push(`${incidents} incident${incidents > 1 ? "s" : ""} actif${incidents > 1 ? "s" : ""}`);
  }

  score = Math.max(0, Math.min(100, score));

  let status: StationHealthStatus = "healthy";
  if (!input.online) status = "offline";
  else if (score < 45) status = "critical";
  else if (score < 80) status = "degraded";

  if (reasons.length === 0) reasons.push("Aucune anomalie détectée");

  return { score, status, reasons, lastSyncAgeSeconds };
}

export function stationHealthLabel(status: StationHealthStatus) {
  const labels: Record<StationHealthStatus, string> = {
    healthy: "Saine",
    degraded: "À surveiller",
    critical: "Critique",
    offline: "Hors ligne",
  };
  return labels[status];
}
