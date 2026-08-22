import { describe, expect, it } from "vitest";
import { rentalProgressPath, rentalProgressUrl, shouldShowRentalProgress } from "./rentalProgressLink";

describe("rental progress link", () => {
  it("only starts the live mobile tracker once the rental has left payment preparation", () => {
    expect(shouldShowRentalProgress("payment_pending")).toBe(false);
    expect(shouldShowRentalProgress("payment_succeeded")).toBe(true);
    expect(shouldShowRentalProgress("ejecting")).toBe(true);
    expect(shouldShowRentalProgress("active_rental")).toBe(true);
    expect(shouldShowRentalProgress("battery_returned")).toBe(true);
    expect(shouldShowRentalProgress("completed")).toBe(true);
  });

  it("keeps the public session capability and language in the tracker URL", () => {
    const path = rentalProgressPath("session-id", "CHG-ABC 123", "de");
    expect(path).toBe("/pay/session-id/progress?c=CHG-ABC+123&lang=de");
    expect(rentalProgressUrl("https://chargeurs-ch-staging.vercel.app", "session-id", "CHG-ABC 123", "de"))
      .toBe("https://chargeurs-ch-staging.vercel.app/pay/session-id/progress?c=CHG-ABC+123&lang=de");
  });
});
