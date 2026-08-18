const CANONICAL_UUID_RE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

/**
 * Compatibility only for the staging reconcile-pending-ejection v9 validator.
 *
 * That deployed validator accidentally expects 37 characters after accepting
 * only hex/hyphens. PostgreSQL still canonicalizes an extra hyphen inserted
 * after a four-hex group to the same UUID. The kiosk always tries the canonical
 * id first and only uses this representation after the server explicitly
 * returns INVALID_RECONCILIATION_REQUEST.
 *
 * The endpoint is read-only and never sends/retries an eject command.
 */
export function legacyReconciliationUuid(value: string): string | null {
  const match = CANONICAL_UUID_RE.exec(value);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5].slice(0, 4)}-${match[5].slice(4)}`;
}
