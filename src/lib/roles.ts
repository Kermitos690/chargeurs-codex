// Authorization role logic — single source of truth shared by UI gating.
// Backend enforcement lives in edge functions (requireAdmin/requireSuperAdmin);
// these helpers only decide what the UI offers. Never treat them as security.

// Roles allowed to VIEW the back-office UI.
export const VIEW_ROLES = [
  "super_admin", "operations_admin", "finance_admin", "support_agent",
  "maintenance_technician",
  // Legacy roles remain readable during migration.
  "admin", "staff", "operator", "viewer",
] as const;
// Operational mutations accepted by the backend `requireAdmin` helper.
export const WRITE_ROLES = ["admin", "super_admin", "operations_admin"] as const;
export const FINANCE_WRITE_ROLES = ["admin", "super_admin", "finance_admin"] as const;

export function canView(roles: string[]): boolean {
  return roles.some((r) => (VIEW_ROLES as readonly string[]).includes(r));
}
export function canWrite(roles: string[]): boolean {
  return roles.some((r) => (WRITE_ROLES as readonly string[]).includes(r));
}
export function canManageFinance(roles: string[]): boolean {
  return roles.some((r) => (FINANCE_WRITE_ROLES as readonly string[]).includes(r));
}
export function isSuperAdmin(roles: string[]): boolean {
  return roles.includes("super_admin");
}
