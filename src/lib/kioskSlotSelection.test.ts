import { describe, expect, it } from "vitest";
import { preferredKioskSlot } from "./kioskSlotSelection";

describe("preferredKioskSlot", () => {
  it("preselects the highest confirmed rentable charge when no strict recommendation exists", () => {
    expect(preferredKioskSlot([
      { slot_num: 1, rentable: true, recommended: false, charge_percent: 55 },
      { slot_num: 2, rentable: true, recommended: false, charge_percent: 55 },
      { slot_num: 3, rentable: false, recommended: false, charge_percent: 0 },
      { slot_num: 4, rentable: true, recommended: false, charge_percent: 79 },
    ])).toBe(4);
  });

  it("honours a stricter backend recommendation before raw charge", () => {
    expect(preferredKioskSlot([
      { slot_num: 1, rentable: true, recommended: true, charge_percent: 55 },
      { slot_num: 4, rentable: true, recommended: false, charge_percent: 79 },
    ])).toBe(1);
  });
});
