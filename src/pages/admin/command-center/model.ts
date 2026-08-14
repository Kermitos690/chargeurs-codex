import type {
  AlertRow,
  DevelopmentDecision,
  FleetRow,
  OverviewData,
  RoadmapLane,
  Severity,
} from "./types";

export type CommandCenterDecision = AlertRow & {
  action: DevelopmentDecision;
};

export type CommandCenterDevelopment = {
  action: DevelopmentDecision;
  lane: RoadmapLane;
  title: string;
  reason: string;
  href: string;
  source: "LIVE_ALERT" | "OPERATIONS" | "GOVERNANCE";
};

export type CommandCenterHealth = {
  score: number;
  label: string;
  tone: "success" | "warning" | "critical";
  rentalReady: number;
  stations: number;
  criticalAlerts: number;
};

export type CommandCenterHomeModel = {
  health: CommandCenterHealth;
  stations: FleetRow[];
  decisions: CommandCenterDecision[];
  development: CommandCenterDevelopment;
};

const severityRank: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function actionForSeverity(severity: Severity): DevelopmentDecision {
  if (severity === "critical") return "FIX";
  return "VALIDATE";
}

export function buildCommandCenterHomeModel(data: OverviewData): CommandCenterHomeModel {
  const sortedAlerts = [...data.alerts].sort((left, right) => severityRank[left.severity] - severityRank[right.severity]);
  const decisions = sortedAlerts.slice(0, 3).map((alert) => ({
    ...alert,
    action: actionForSeverity(alert.severity),
  }));
  const criticalAlerts = sortedAlerts.filter((alert) => alert.severity === "critical");

  let health: CommandCenterHealth;
  if (criticalAlerts.length > 0) {
    health = {
      score: data.metrics.healthScore,
      label: "Action immédiate",
      tone: "critical",
      rentalReady: data.metrics.rentalReady,
      stations: data.metrics.stations,
      criticalAlerts: criticalAlerts.length,
    };
  } else if (data.metrics.stations > 0 && data.metrics.rentalReady === data.metrics.stations) {
    health = {
      score: data.metrics.healthScore,
      label: "Opérationnel",
      tone: "success",
      rentalReady: data.metrics.rentalReady,
      stations: data.metrics.stations,
      criticalAlerts: 0,
    };
  } else {
    health = {
      score: data.metrics.healthScore,
      label: "À fiabiliser",
      tone: "warning",
      rentalReady: data.metrics.rentalReady,
      stations: data.metrics.stations,
      criticalAlerts: 0,
    };
  }

  const leadingAlert = sortedAlerts[0];
  let development: CommandCenterDevelopment;
  if (leadingAlert) {
    development = {
      action: actionForSeverity(leadingAlert.severity),
      lane: "NOW",
      title: leadingAlert.recommendation || leadingAlert.title,
      reason: leadingAlert.title,
      href: leadingAlert.href,
      source: "LIVE_ALERT",
    };
  } else if (data.metrics.rentalReady < data.metrics.stations) {
    development = {
      action: "VALIDATE",
      lane: "NOW",
      title: "Rendre toutes les bornes prêtes à louer",
      reason: `${data.metrics.rentalReady}/${data.metrics.stations} bornes sont actuellement prêtes à servir une location.`,
      href: "/admin/stations",
      source: "OPERATIONS",
    };
  } else {
    development = {
      action: "VALIDATE",
      lane: "NOW",
      title: "P0 — compléter la preuve terrain du parcours de location",
      reason: "Gouvernance produit : la fiabilité du cœur reste prioritaire avant l’extension P2/P3/P4.",
      href: "/admin/rental-flow-health",
      source: "GOVERNANCE",
    };
  }

  return {
    health,
    stations: data.fleet,
    decisions,
    development,
  };
}
