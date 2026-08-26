import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260827020000_member_prepaid_payment_rail.sql"),
  "utf8",
);
const endpoint = readFileSync(
  resolve(process.cwd(), "supabase/functions/authorize-member-prepaid-rental/index.ts"),
  "utf8",
);

describe("member prepaid payment rail", () => {
  it("is a first-class mutually exclusive payment rail", () => {
    expect(migration).toContain("'membership_prepaid'");
    expect(migration).toContain("PAYMENT_RAIL_ALREADY_CLAIMED");
    expect(migration).toContain("stripe_checkout_session_id");
    expect(migration).toContain("stripe_payment_intent_id");
  });

  it("requires exactly CHF 30 available and only v3 member snapshots", () => {
    expect(migration).toContain("v_required constant bigint := 3000");
    expect(migration).toContain("pricing_rules_version");
    expect(migration).toContain("<> 3");
    expect(migration).toContain("unreturned_after_minutes");
    expect(migration).toContain("<> 4320");
    expect(migration).toContain("INSUFFICIENT_PREPAID_BALANCE");
  });

  it("requires the current rental-contract acceptance before financial authority", () => {
    expect(migration).toContain("terms-2026-08-26-preproduction-v2");
    expect(migration).toContain("privacy-2026-08-26-preproduction-v2");
    expect(migration).toContain("CONTRACT_ACCEPTANCE_REQUIRED");
  });

  it("advances through the canonical orchestrator payment states", () => {
    expect(migration).toContain("'payment_started'");
    expect(migration).toContain("'payment_pending'");
    expect(migration).toContain("'payment_authorized'");
    expect(migration).toContain("'authorized'");
  });

  it("settles a normal return entirely from the internal ledger", () => {
    expect(migration).toContain("customer_wallet_pricing_state");
    expect(migration).toContain("commit_customer_membership_credit_for_rental");
    expect(migration).toContain("'membership_prepaid.rental_settled'");
    expect(migration).toContain("'released_cents', 3000 - v_final");
  });

  it("does not create or mutate Stripe from the prepaid authorization endpoint", () => {
    expect(endpoint).not.toContain("stripe.paymentIntents");
    expect(endpoint).not.toContain("STRIPE_SECRET_KEY");
    expect(endpoint).toContain("authorize_member_prepaid_rental");
    expect(endpoint).toContain("eject-after-payment");
  });
});
