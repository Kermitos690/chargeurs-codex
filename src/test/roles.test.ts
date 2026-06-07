import { describe, it, expect } from "vitest";
import { canView, canWrite, isSuperAdmin } from "@/lib/roles";

describe("auth role gating", () => {
  it("grants view to back-office roles", () => {
    expect(canView(["viewer"])).toBe(true);
    expect(canView(["staff"])).toBe(true);
    expect(canView(["operator"])).toBe(true);
    expect(canView(["admin"])).toBe(true);
    expect(canView(["super_admin"])).toBe(true);
  });
  it("denies view to anonymous / unknown roles", () => {
    expect(canView([])).toBe(false);
    expect(canView(["customer"])).toBe(false);
  });
  it("restricts write to admin and super_admin only", () => {
    expect(canWrite(["admin"])).toBe(true);
    expect(canWrite(["super_admin"])).toBe(true);
    expect(canWrite(["viewer"])).toBe(false);
    expect(canWrite(["staff"])).toBe(false);
    expect(canWrite(["operator"])).toBe(false);
    expect(canWrite([])).toBe(false);
  });
  it("identifies super_admin only", () => {
    expect(isSuperAdmin(["super_admin"])).toBe(true);
    expect(isSuperAdmin(["admin"])).toBe(false);
  });
});
