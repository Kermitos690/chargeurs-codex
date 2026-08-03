import { describe, it, expect } from "vitest";
import { canManageFinance, canView, canWrite, isSuperAdmin } from "@/lib/roles";
import { canAccessAdminPath } from "@/pages/admin/adminNav";
import { ASSIGNABLE_ROLE_IDS, roleLabel } from "@/lib/roleCatalog";

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
    expect(canView(["partner_owner"])).toBe(false);
  });
  it("restricts generic writes to operational administrators", () => {
    expect(canWrite(["admin"])).toBe(true);
    expect(canWrite(["super_admin"])).toBe(true);
    expect(canWrite(["viewer"])).toBe(false);
    expect(canWrite(["staff"])).toBe(false);
    expect(canWrite(["operator"])).toBe(false);
    expect(canWrite([])).toBe(false);
  });

  it("separates operational, finance and user-management sections", () => {
    expect(canWrite(["operations_admin"])).toBe(true);
    expect(canWrite(["finance_admin"])).toBe(false);
    expect(canManageFinance(["finance_admin"])).toBe(true);
    expect(canAccessAdminPath("/admin/payments", ["finance_admin"])).toBe(true);
    expect(canAccessAdminPath("/admin/stations", ["finance_admin"])).toBe(false);
    expect(canAccessAdminPath("/admin/users", ["operations_admin"])).toBe(false);
    expect(canAccessAdminPath("/admin/users", ["super_admin"])).toBe(true);
  });
  it("identifies super_admin only", () => {
    expect(isSuperAdmin(["super_admin"])).toBe(true);
    expect(isSuperAdmin(["admin"])).toBe(false);
  });
  it("keeps the full requested role matrix assignable while system identities stay excluded", () => {
    expect(ASSIGNABLE_ROLE_IDS).toContain("mifi_manager");
    expect(ASSIGNABLE_ROLE_IDS).toContain("franchise_owner");
    expect(ASSIGNABLE_ROLE_IDS).toContain("venue_staff");
    expect(ASSIGNABLE_ROLE_IDS).not.toContain("kiosk_device");
    expect(roleLabel("support_manager")).toBe("Responsable support");
  });
});
