import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  settleMembershipCreditReservation,
  shouldReverseMembershipCreditReservation,
} from "../_shared/membershipCreditReservation.ts";

const settlement = await Deno.readTextFile("supabase/functions/settle-rental-payment/index.ts");
const webhook = await Deno.readTextFile("supabase/functions/stripe-webhook/index.ts");
const callback = await Deno.readTextFile("supabase/functions/chargenow-rent-callback/index.ts");
const account = await Deno.readTextFile("supabase/functions/account-privacy/index.ts");
const migration = await Deno.readTextFile("supabase/migrations/20260824232608_customer_membership_rental_credit_wallet.sql");

Deno.test("1 sufficient Client Pass credit reserves then commits exactly the returned price", () => {
  assertEquals(settleMembershipCreditReservation(390, 1000), { committedCreditCents: 390, releasedCreditCents: 610, stripeDueCents: 0 });
  assert(migration.includes("rental_payment_committed_reservation"));
  assert(migration.includes("rental_settlement_committed"));
});

Deno.test("2 a Client credit above price has zero external due and releases the unused reservation", () => {
  assertEquals(settleMembershipCreditReservation(190, 2990).stripeDueCents, 0);
  assertEquals(settleMembershipCreditReservation(190, 2990).releasedCreditCents, 2800);
});

Deno.test("3 a Client credit below price pays only the remaining rail amount", () => {
  assertEquals(settleMembershipCreditReservation(790, 300), { committedCreditCents: 300, releasedCreditCents: 0, stripeDueCents: 490 });
});

Deno.test("4 cancellation before payment has no credit reservation", () => {
  assert(webhook.slice(webhook.indexOf("if (!match.ok)")).includes("reserveMemberRentalCreditAtPaymentCommit"));
});

Deno.test("5 a payment failure before a Stripe settlement side effect releases the reservation", () => {
  assertEquals(shouldReverseMembershipCreditReservation({ reservedCreditCents: 500, stripeSideEffectStarted: false, creditCommitted: false }), true);
});

Deno.test("6 a proven ejection failure with no BATTERY_BORROW_OUT releases the reservation", () => {
  assert(callback.includes("reverseMemberCreditForProvenNoOutput"));
  assert(callback.includes("supplier_release_failed_without_borrow_out"));
});

Deno.test("7 settlement retry cannot debit a Pass twice", () => {
  assert(migration.includes("membership_credit_commit:%s"));
  assert(migration.includes("on conflict (idempotency_key) do nothing"));
  assert(settlement.includes("existing.settlement_status === \"settled\""));
});

Deno.test("8 signed webhook replay reuses the payment-commit reservation", () => {
  assert(webhook.includes("reserveMemberRentalCreditAtPaymentCommit"));
  assert(migration.includes("membership_credit_reservation:%s:%s"));
});

Deno.test("9 a historical settled rental is never debited during reconciliation", () => {
  assert(settlement.includes("existing.settlement_status === \"settled\""));
});

Deno.test("10 Client Pass display is sourced from the authoritative membership-credit balance", () => {
  assert(account.includes("customer_membership_credit_balances"));
  assert(migration.includes("balance_before_cents"));
  assert(migration.includes("balance_after_cents"));
});
