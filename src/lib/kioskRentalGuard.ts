export type KioskRentalReadiness = {
  quotePresent: boolean;
  available: number;
  configured: boolean | null;
  slotNum: number | null;
};

/**
 * The kiosk may begin a rental only from a server-validated pricing quote,
 * a known configured cabinet, and an explicitly selectable battery slot.
 */
export function isKioskRentalReady({
  quotePresent,
  available,
  configured,
  slotNum,
}: KioskRentalReadiness): boolean {
  return quotePresent && available > 0 && configured === true && slotNum !== null;
}
