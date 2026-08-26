import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260827020000_member_prepaid_payment_rail.sql"),
  "utf8",
);
const acceptance = readFileSync(
  resolve(process.cwd(), "supabase/functions/kiosk-customer-options/index.ts"),
  "utf8",
);
const vercelConfig = readFileSync(resolve(process.cwd(), "vercel.json"), "utf8");

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

  it("attempts prepaid authorization only after acceptance and never creates Stripe from that path", () => {
    expect(acceptance).not.toContain("stripe.paymentIntents");
    expect(acceptance).not.toContain("STRIPE_SECRET_KEY");
    expect(acceptance).toContain("authorize_member_prepaid_rental");
    expect(acceptance).toContain("prepaidAuthorized");
    expect(acceptance).toContain("eject-after-payment");
  });

  it("routes contract acceptance through the existing kiosk function to stay within the free Edge-function cap", () => {
    expect(vercelConfig).toContain('"source": "/api/kiosk/record-rental-contract-acceptance"');
    expect(vercelConfig).toContain('functions/v1/kiosk-customer-options');
  });
});
