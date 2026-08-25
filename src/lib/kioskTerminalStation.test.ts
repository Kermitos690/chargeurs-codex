import { describe, expect, it } from "vitest";
import { stationHasPaymentTerminal } from "@/lib/kioskTerminalStation";

describe("stationHasPaymentTerminal", () => {
  it("enables Terminal only on the live DTA21277 binding", () => {
    expect(stationHasPaymentTerminal("DTA21269")).toBe(false);
    expect(stationHasPaymentTerminal("DTA21270")).toBe(false);
    expect(stationHasPaymentTerminal("DTA21277")).toBe(true);
    expect(stationHasPaymentTerminal(" dta21277 ")).toBe(true);
    expect(stationHasPaymentTerminal("DTA22032")).toBe(false);
    expect(stationHasPaymentTerminal(undefined)).toBe(false);
  });
});
