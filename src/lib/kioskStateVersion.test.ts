import { describe, expect, it } from "vitest";
import { acceptsKioskStateVersion } from "./kioskStateVersion";

describe("kiosk state-version projection", () => {
  it("rejects an out-of-order poll after a newer state has been accepted", () => {
    expect(acceptsKioskStateVersion(4, 5)).toBe(true);
    expect(acceptsKioskStateVersion(5, 4)).toBe(false);
  });

  it("allows legacy projections without a version during the staged migration window", () => {
    expect(acceptsKioskStateVersion(5, null)).toBe(true);
  });
});
