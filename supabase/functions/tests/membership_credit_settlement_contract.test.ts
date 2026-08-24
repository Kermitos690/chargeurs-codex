import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile("supabase/functions/settle-rental-payment/index.ts");
const migration = await Deno.readTextFile("supabase/migrations/20260824232608_customer_membership_rental_credit_wallet.sql");

Deno.test("rental credit is reserved, committed, and never used for the guarantee", () => {
  assert(migration.includes("rental_reservation"));
  assert(migration.includes("rental_settlement_committed"));
  assert(migration.includes("commit_customer_membership_credit_for_rental"));
  assert(source.includes("reserveMembershipRentalCredit"));
  assert(source.includes("stripeAmountAfterMembershipCredit"));
  assert(source.includes("commitMembershipRentalCredit"));
  assert(source.includes("shouldReverseMembershipCreditReservation"));
  assert(source.includes("stripeAmountDueCents"));
});

Deno.test("a Stripe call makes the credit reservation reconcile-only", () => {
  const reversal = source.slice(source.lastIndexOf("shouldReverseMembershipCreditReservation"));
  assert(reversal.includes("stripeSideEffectStarted"));
  assert(reversal.includes("membershipCreditCommitted"));
  assert(reversal.includes("markMembershipCreditForReconciliation"));
});
