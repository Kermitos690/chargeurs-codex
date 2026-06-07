// Rental state machine — canonical transition guard.
// Mirrors the server-side rules enforced in edge functions
// (eject-after-payment, stripe-webhook, cabinet-event-push,
//  rental-admin-action, close-rental-order). Used for UI hints and tested
// to lock the documented invariants:
//  - terminal states never regress
//  - battery_returned only reachable from an active/ejected state
//  - transitions are idempotent (same state -> same state allowed as no-op)

export type RentalState =
  | "created"
  | "quote_created"
  | "payment_pending"
  | "payment_succeeded"
  | "payment_failed"
  | "checkout_expired"
  | "ejecting"
  | "chargenow_failed"
  | "eject_failed"
  | "ejected"
  | "battery_taken"
  | "active_rental"
  | "battery_returned"
  | "closing"
  | "closed"
  | "refund_pending"
  | "partially_refunded"
  | "refunded"
  | "cancelled"
  | "needs_support";

export const TERMINAL_STATES: RentalState[] = [
  "closed",
  "refunded",
  "cancelled",
];

// Allowed forward transitions (excluding idempotent self and escalation to
// needs_support, which is always allowed from any non-terminal state).
const TRANSITIONS: Record<RentalState, RentalState[]> = {
  created: ["quote_created", "payment_pending", "cancelled"],
  quote_created: ["payment_pending", "cancelled"],
  payment_pending: ["payment_succeeded", "payment_failed", "checkout_expired", "cancelled"],
  payment_succeeded: ["ejecting", "refund_pending"],
  payment_failed: ["payment_pending", "cancelled"],
  checkout_expired: ["cancelled"],
  ejecting: ["ejected", "chargenow_failed", "eject_failed"],
  chargenow_failed: ["refund_pending", "needs_support"],
  eject_failed: ["refund_pending", "needs_support"],
  ejected: ["battery_taken", "active_rental", "battery_returned"],
  battery_taken: ["active_rental", "battery_returned"],
  active_rental: ["battery_returned"],
  battery_returned: ["closing", "closed", "refund_pending"],
  closing: ["closed", "needs_support"],
  closed: [],
  refund_pending: ["partially_refunded", "refunded", "needs_support"],
  partially_refunded: ["refunded", "closed"],
  refunded: [],
  cancelled: [],
  needs_support: ["closing", "closed", "refund_pending", "refunded"],
};

export function isTerminal(s: RentalState): boolean {
  return TERMINAL_STATES.includes(s);
}

/** True if `to` is a legal transition from `from`. Idempotent self-transitions
 *  are allowed (no-op). Escalation to needs_support is allowed from any
 *  non-terminal state. Terminal states never transition (except identity). */
export function canTransition(from: RentalState, to: RentalState): boolean {
  if (from === to) return true; // idempotent no-op
  if (isTerminal(from)) return false; // terminal never regresses
  if (to === "needs_support") return true; // escalation always allowed
  return TRANSITIONS[from]?.includes(to) ?? false;
}
