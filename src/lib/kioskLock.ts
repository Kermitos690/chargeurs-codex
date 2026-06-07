// Cabinet lock — binds an installed kiosk PWA to a single cabinet id.
// The lock survives app close, tablet reboot, PWA update, network loss and
// page reloads because it lives in localStorage. It only ever changes via an
// explicit operator action (forceSetStation) from the protected diagnostics.
const KEY = "kiosk_locked_station";
// Cabinet ids look like DTA21269 — conservative allow-list to avoid garbage.
const VALID = /^[A-Za-z0-9_-]{4,32}$/;

export function isValidStationId(id: string | undefined | null): id is string {
  return !!id && VALID.test(id);
}

export function getLockedStation(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return isValidStationId(v) ? v : null;
  } catch {
    return null;
  }
}

// First-write lock: persists the cabinet only if none is locked yet. Returns
// the cabinet that is effectively in force.
export function lockStationIfUnset(id: string): string | null {
  if (!isValidStationId(id)) return getLockedStation();
  try {
    const cur = localStorage.getItem(KEY);
    if (!isValidStationId(cur)) {
      localStorage.setItem(KEY, id);
      return id;
    }
    return cur;
  } catch {
    return id;
  }
}

// Operator-only override (from protected diagnostics) to re-bind the tablet.
export function forceSetStation(id: string): void {
  if (!isValidStationId(id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function clearLockedStation(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
