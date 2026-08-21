import { describe, expect, it } from "vitest";
import { buildRentalAlertPlan, dueRentalAlerts } from "@/lib/rentalAlerts";

describe("rental alert engine", () => {
  const startedAt = new Date("2026-07-15T08:00:00.000Z");

  it("creates the complete alert plan", () => {
    const plan = buildRentalAlertPlan({ startedAt });
    expect(plan.map((item) => item.kind)).toEqual([
      "rental_started",
      "first_hour",
      "daily_cap_approaching",
      "daily_cap_reached",
      "return_reminder",
      "non_return_warning",
    ]);
  });

  it("returns only due and unsent alerts", () => {
    const due = dueRentalAlerts(
      { startedAt, now: new Date("2026-07-15T09:05:00.000Z") },
      ["rental_started"],
    );
    expect(due.map((item) => item.kind)).toEqual(["first_hour"]);
  });

  it("warns before the daily cap and blocks duplicates", () => {
    const due = dueRentalAlerts(
      { startedAt, now: new Date("2026-07-16T07:30:00.000Z") },
      ["rental_started", "first_hour"],
    );
    expect(due.some((item) => item.kind === "daily_cap_approaching")).toBe(true);
    expect(due.some((item) => item.kind === "daily_cap_reached")).toBe(false);
  });
});
