export const TERMINAL_ACCOUNT_RENTAL_STATES = new Set([
  "completed", "closed", "refunded", "partially_refunded", "cancelled",
  "payment_cancelled", "payment_failed", "payment_expired", "expired",
]);

export function accountDeletionBlocked(states: string[]): boolean {
  return states.some((state) => !TERMINAL_ACCOUNT_RENTAL_STATES.has(state));
}

export function safeDeletedEmail(userId: string): string {
  return `deleted+${userId.replace(/[^0-9a-f-]/gi, "")}@invalid.chargeurs.ch`;
}
