import { describe, expect, it } from "vitest";
import { kioskOperationalRetryDelayMs } from "@/components/kiosk/KioskOperationalGuard";

describe("kiosk operational guard request budget", () => {
  it("backs off repeated service failures up to ten minutes", () => {
    expect(kioskOperationalRetryDelayMs(1)).toBe(60_000);
    expect(kioskOperationalRetryDelayMs(2)).toBe(120_000);
    expect(kioskOperationalRetryDelayMs(3)).toBe(240_000);
    expect(kioskOperationalRetryDelayMs(4)).toBe(480_000);
    expect(kioskOperationalRetryDelayMs(5)).toBe(600_000);
    expect(kioskOperationalRetryDelayMs(20)).toBe(600_000);
  });
});
