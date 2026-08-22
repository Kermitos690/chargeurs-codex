/**
 * Once the server has reserved a rental, it is the only authority for the
 * compartment presented to the customer. A malformed value must stop before
 * a payment rail can be selected.
 */
export function authoritativeKioskSlot(value: unknown): number | null {
  const slot = typeof value === "number" ? value : Number(value);
  return Number.isInteger(slot) && slot >= 1 && slot <= 128 ? slot : null;
}
