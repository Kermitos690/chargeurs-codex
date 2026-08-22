import { describe, expect, it } from "vitest";
import { authoritativeKioskSlot } from "./kioskSlotContract";

describe("authoritativeKioskSlot", () => {
  it("accepts only a valid persisted compartment number", () => {
    expect(authoritativeKioskSlot(4)).toBe(4);
    expect(authoritativeKioskSlot("4")).toBe(4);
    expect(authoritativeKioskSlot(0)).toBeNull();
    expect(authoritativeKioskSlot(4.2)).toBeNull();
    expect(authoritativeKioskSlot(undefined)).toBeNull();
  });
});
