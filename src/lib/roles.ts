// Authorization role logic — single source of truth shared by UI gating.
// Backend enforcement lives in edge functions (requireAdmin/requireSuperAdmin);
// these helpers only decide what the UI offers. Never treat them as security.

// Roles allowed to VIEW the back-office UI.
export const VIEW_ROLES = ["admin", "super_admin", "staff", "operator", "viewer"] as const;
// Roles the backend `requireAdmin` accepts for WRITE operations.
export const WRITE_ROLES = ["admin", "super_admin"] as const;

export function canView(roles: string[]): boolean {
  return roles.some((r) => (VIEW_ROLES as readonly string[]).includes(r));
}
export function canWrite(roles: string[]): boolean {
  return roles.some((r) => (WRITE_ROLES as readonly string[]).includes(r));
}
export function isSuperAdmin(roles: string[]): boolean {
  return roles.includes("super_admin");
}
