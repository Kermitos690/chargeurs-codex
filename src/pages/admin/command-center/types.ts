export type CommandCenterMode = "mobile" | "large";

export type DevelopmentDecision = "FIX" | "VALIDATE" | "BUILD" | "FREEZE" | "PAUSE" | "ARCHIVE";
export type RoadmapLane = "NOW" | "NEXT" | "LATER" | "PARKED";
export type ProductMaturity = "IDEA" | "STARTED" | "ADVANCED" | "STAGING" | "FIELD_PARTIAL" | "PROVEN";
export type ProductGate = "PROTECTED_CORE_CHANGE_REQUIRED" | "BUSINESS_DECISION_REQUIRED" | "RELEASE_BLOCKED";

export type Severity = "critical" | "warning" | "info";

export type AlertRow = {
  id: string;
  severity: Severity;
  stationId: string;
  title: string;
  detail: string;
  recommendation: string;
  href: string;
};

export type FleetRow = {
  stationId: string;
  name: string;
  locationName: string | null;
  providerOnline: boolean;
  kioskAuthenticated: boolean;
  rentalReady: boolean;
  status: string | null;
  rentableCount: number;
  returnableCount: number;
  totalCount: number;
  lastSyncAt: string | null;
  lastProviderSuccessAt: string | null;
  lastKioskSeenAt: string | null;
  providerError: string | null;
};

export type TrendRow = {
  date: string;
  rentals: number;
  completedRentals: number;
  payments: number;
  revenueCents: number;
  adMinutes: number;
};

export type Metrics = {
  stations: number;
  providerOnline: number;
  kioskAuthenticated: number;
  rentalReady: number;
  healthScore: number;
  batteries: number;
  activeRentals: number;
  rentalsToday: number;
  paymentsToday: number;
  revenueTodayCents: number;
  criticalAlerts: number;
  adImpressions30d: number;
  adHours30d: number;
};

export type OverviewData = {
  ok: boolean;
  generatedAt: string;
  metrics: Metrics;
  alerts: AlertRow[];
  fleet: FleetRow[];
  trends: TrendRow[];
  error?: string;
};

export const NOT_AVAILABLE = "NOT_AVAILABLE" as const;
