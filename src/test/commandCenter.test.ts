import { describe, expect, it } from "vitest";
import { buildCommandCenterHomeModel } from "@/pages/admin/command-center/model";
import { resolveCommandCenterMode } from "@/pages/admin/command-center/useCommandCenterMode";
import type { OverviewData } from "@/pages/admin/command-center/types";

function overview(overrides: Partial<OverviewData> = {}): OverviewData {
  return {
    ok: true,
    generatedAt: "2026-08-14T08:00:00Z",
    metrics: {
      stations: 2,
      providerOnline: 2,
      kioskAuthenticated: 2,
      rentalReady: 1,
      healthScore: 72,
      batteries: 7,
      activeRentals: 0,
      rentalsToday: 0,
      paymentsToday: 0,
      revenueTodayCents: 0,
      criticalAlerts: 0,
      adImpressions30d: 0,
      adHours30d: 0,
    },
    alerts: [],
    fleet: [],
    trends: [],
    ...overrides,
  };
}

describe("resolveCommandCenterMode", () => {
  it("keeps a phone in portrait on the dedicated mobile shell", () => {
    expect(resolveCommandCenterMode(430, 932)).toBe("mobile");
  });

  it("switches the same phone to the large shell in landscape", () => {
    expect(resolveCommandCenterMode(932, 430)).toBe("large");
  });

  it("uses the large shell for a tablet in portrait", () => {
    expect(resolveCommandCenterMode(768, 1024)).toBe("large");
  });

  it("uses the large shell on desktop", () => {
    expect(resolveCommandCenterMode(1440, 900)).toBe("large");
  });
});

describe("buildCommandCenterHomeModel", () => {
  it("promotes a real critical alert to the next FIX/NOW development", () => {
    const data = overview({
      alerts: [
        { id: "warning", severity: "warning", stationId: "DTA1", title: "À vérifier", detail: "detail", recommendation: "Valider le stock", href: "/admin/stations" },
        { id: "critical", severity: "critical", stationId: "DTA2", title: "Location bloquée", detail: "detail", recommendation: "Corriger le blocage", href: "/admin/rental-flow-health" },
      ],
    });

    const model = buildCommandCenterHomeModel(data);
    expect(model.health.tone).toBe("critical");
    expect(model.decisions[0].id).toBe("critical");
    expect(model.development).toMatchObject({ action: "FIX", lane: "NOW", title: "Corriger le blocage", source: "LIVE_ALERT" });
  });

  it("never fabricates operational decisions when the source returns no alerts", () => {
    const model = buildCommandCenterHomeModel(overview());
    expect(model.decisions).toEqual([]);
    expect(model.development).toMatchObject({ action: "VALIDATE", lane: "NOW", source: "OPERATIONS" });
  });

  it("falls back to the validated P0 governance rule only when all stations are ready and no alert exists", () => {
    const data = overview({ metrics: { ...overview().metrics, rentalReady: 2 } });
    const model = buildCommandCenterHomeModel(data);
    expect(model.health.tone).toBe("success");
    expect(model.development).toMatchObject({ action: "VALIDATE", lane: "NOW", source: "GOVERNANCE" });
  });
});
