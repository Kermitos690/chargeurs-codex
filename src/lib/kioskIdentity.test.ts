import { describe, expect, it } from "vitest";
import { stationHasPaymentTerminal } from "@/lib/kioskIdentity";

describe("stationHasPaymentTerminal", () => {
  it("enables Terminal on the two terminal-equipped pilot kiosks only", () => {
    expect(stationHasPaymentTerminal("DTA21269")).toBe(true);
    expect(stationHasPaymentTerminal("DTA21277")).toBe(true);
    expect(stationHasPaymentTerminal("DTA22032")).toBe(false);
  });
});
