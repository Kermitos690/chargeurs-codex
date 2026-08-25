import { describe, expect, it } from "vitest";
import { stationHasPaymentTerminal } from "@/lib/kioskIdentity";

describe("stationHasPaymentTerminal", () => {
  it("enables Terminal only on the dedicated DTA21270 kiosk", () => {
    expect(stationHasPaymentTerminal("DTA21269")).toBe(false);
    expect(stationHasPaymentTerminal("DTA21270")).toBe(true);
    expect(stationHasPaymentTerminal("DTA21277")).toBe(false);
    expect(stationHasPaymentTerminal("DTA22032")).toBe(false);
  });
});
