import { ALL_SCOPES, type PlatformApiScope } from "./platformApi.ts";

export type ApiEnvironment = "test" | "live";

export function normalizeEnvironment(value: unknown): ApiEnvironment {
  return value === "live" ? "live" : "test";
}

export function normalizeClientName(value: unknown): string | null {
  const name = String(value ?? "").trim();
  return name.length >= 2 && name.length <= 120 ? name : null;
}

export function normalizeOwnerEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return null;
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizeScopes(value: unknown): PlatformApiScope[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(ALL_SCOPES);
  return [...new Set(value.map(String).filter((scope) => allowed.has(scope)))] as PlatformApiScope[];
}

export function normalizeQuota(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

export function normalizeKeyLabel(value: unknown): string {
  const label = String(value ?? "Default key").trim();
  return (label || "Default key").slice(0, 120);
}
