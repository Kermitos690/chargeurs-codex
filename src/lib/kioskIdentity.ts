// Canonical kiosk identity resolution.
//
// PHYSICAL SOURCE OF TRUTH (pilot fleet):
//   DTA21269 — cabinet WITH a payment terminal (Stripe Terminal / WisePad).
//   DTA21277 — cabinet WITH a payment terminal (Stripe Terminal / WisePad).
//   DTA22032 — cabinet WITHOUT a payment terminal.
//
// A single cabinet id must never appear on two tablets. Historically the route
// param was trusted blindly and the localStorage lock was first-write-only, so
// a stale/cloned lock (or an operator who once opened another cabinet URL on
// this tablet) could keep showing a foreign cabinet id. This module makes the
// identity explicit, allow-listed and self-cleaning. No station is ever a
// default: an unknown/absent identity is a hard configuration error.
import { clearLockedStation, forceSetStation, getLockedStation, isValidStationId } from "@/lib/kioskLock";

export const PILOT_STATION_IDS = ["DTA21269", "DTA21277", "DTA22032"] as const;
export type PilotStationId = (typeof PILOT_STATION_IDS)[number];

/** Cabinets physically equipped with a payment terminal. */
const TERMINAL_STATION_IDS: readonly string[] = ["DTA21269", "DTA21277"];

/**
 * FIELD_REPAIR — temporary provisioning repair for the physical DTA22032 tablet.
 *
 * Backend evidence on 2026-08-23 showed this exact device was enrolled as
 * DTA21269 while the real DTA21269 Terminal device remained independently
 * active. Until the native APK is re-provisioned, the web runtime must repair
 * this one known device identity instead of trusting its stale native station.
 *
 * This is deliberately keyed by the immutable per-install devicePublicId and
 * MUST NEVER be used as a generic fallback for unknown devices.
 */
const FIELD_REPAIR_STATION_BY_DEVICE_ID: Readonly<Record<string, PilotStationId>> = {
  "aceb691f-e88d-4332-b667-b53ad313a832": "DTA22032",
};

export type KioskIdentityError =
  | "STATION_MISSING"
  | "STATION_NOT_IN_PILOT_FLEET"
  | "STATION_DEVICE_MISMATCH";

export type KioskIdentity = {
  /** Canonical cabinet id used for every backend call, QR and UI label. */
  stationId: PilotStationId | null;
  /** Cabinet id declared by the native wrapper configuration, if any. */
  nativeStationId: PilotStationId | null;
  /** Canonical id differs from the route param → the route must be corrected. */
  redirectTo: string | null;
  /** Terminal presence is derived from the canonical identity only. */
  terminalAvailable: boolean;
  error: KioskIdentityError | null;
};

type NativeStationBridge = { getStationBinding?: () => string };
type NativeWindow = Window & { ChargeursNative?: NativeStationBridge };
type NativeBinding = { stationId: PilotStationId | null; deviceId: string | null };

export function normalizeStationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return isValidStationId(normalized) ? normalized : null;
}

export function isPilotStationId(value: unknown): value is PilotStationId {
  const normalized = normalizeStationId(value);
  return normalized !== null && (PILOT_STATION_IDS as readonly string[]).includes(normalized);
}

/** Terminal presence — never inferred from the bridge alone. */
export function stationHasPaymentTerminal(stationId: unknown): boolean {
  const normalized = normalizeStationId(stationId);
  return normalized !== null && TERMINAL_STATION_IDS.includes(normalized);
}

function readNativeBinding(win: Window = window): NativeBinding | null {
  const bridge = (win as NativeWindow).ChargeursNative;
  if (!bridge?.getStationBinding) return null;
  try {
    const parsed = JSON.parse(bridge.getStationBinding()) as { stationId?: unknown; deviceId?: unknown };
    const stationId = isPilotStationId(parsed?.stationId)
      ? (normalizeStationId(parsed.stationId) as PilotStationId)
      : null;
    const deviceId = typeof parsed?.deviceId === "string" && parsed.deviceId.trim().length > 0
      ? parsed.deviceId.trim().toLowerCase()
      : null;
    return { stationId, deviceId };
  } catch {
    return null;
  }
}

export function readNativeStationBinding(win: Window = window): PilotStationId | null {
  return readNativeBinding(win)?.stationId ?? null;
}

/**
 * Resolve the one identity in force for this tablet.
 *
 * Precedence: explicit field repair for a known physical device > native
 * wrapper configuration > route param > persisted lock.
 * The winning identity is written back to the lock, wiping any inconsistent
 * legacy value so a cloned tablet image can never contaminate a cabinet.
 */
export function resolveKioskIdentity(
  routeStationId: string | null | undefined,
  win: Window = window,
): KioskIdentity {
  const nativeBinding = readNativeBinding(win);
  const nativeReported = nativeBinding?.stationId ?? null;
  const repairedStation = nativeBinding?.deviceId
    ? FIELD_REPAIR_STATION_BY_DEVICE_ID[nativeBinding.deviceId] ?? null
    : null;
  const canonicalNative = repairedStation ?? nativeReported;
  const route = normalizeStationId(routeStationId);
  const locked = normalizeStationId(getLockedStation());

  const base = { nativeStationId: nativeReported, redirectTo: null, terminalAvailable: false } as const;

  // A known field-repair device must override its stale native station binding.
  // This is what repairs the physical DTA22032 tablet currently reporting 21269.
  if (repairedStation) {
    if (locked && locked !== repairedStation) clearLockedStation();
    forceSetStation(repairedStation);
    if (route !== repairedStation) {
      return {
        ...base,
        stationId: repairedStation,
        redirectTo: `/kiosk/${repairedStation}`,
        terminalAvailable: stationHasPaymentTerminal(repairedStation),
        error: null,
      };
    }
    return {
      ...base,
      stationId: repairedStation,
      terminalAvailable: stationHasPaymentTerminal(repairedStation),
      error: null,
    };
  }

  // A normal native cabinet configuration is authoritative and self-healing.
  if (canonicalNative) {
    if (locked && locked !== canonicalNative) clearLockedStation();
    forceSetStation(canonicalNative);
    if (route && route !== canonicalNative) {
      return {
        ...base,
        stationId: canonicalNative,
        redirectTo: `/kiosk/${canonicalNative}`,
        terminalAvailable: stationHasPaymentTerminal(canonicalNative),
        error: null,
      };
    }
    return {
      ...base,
      stationId: canonicalNative,
      terminalAvailable: stationHasPaymentTerminal(canonicalNative),
      error: null,
    };
  }

  // Browser/PWA installation: the explicit route identity wins over any lock.
  if (route) {
    if (!isPilotStationId(route)) {
      return { ...base, stationId: null, error: "STATION_NOT_IN_PILOT_FLEET" };
    }
    if (locked && locked !== route) clearLockedStation();
    forceSetStation(route);
    return {
      ...base,
      stationId: route as PilotStationId,
      terminalAvailable: stationHasPaymentTerminal(route),
      error: null,
    };
  }

  // No explicit identity: only a valid pilot lock may be reused, never a default.
  if (locked && isPilotStationId(locked)) {
    return {
      ...base,
      stationId: locked as PilotStationId,
      redirectTo: `/kiosk/${locked}`,
      terminalAvailable: stationHasPaymentTerminal(locked),
      error: null,
    };
  }
  if (locked) clearLockedStation();
  return { ...base, stationId: null, error: "STATION_MISSING" };
}
