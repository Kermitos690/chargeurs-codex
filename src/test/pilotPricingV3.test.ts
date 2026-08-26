import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260827010000_pilot_pricing_rules_v3.sql"),
  "utf8",
);
const frozenPricing = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/pricingSnapshot.ts"),
  "utf8",
);
const v3Tests = readFileSync(
  resolve(process.cwd(), "supabase/functions/tests/pricing_settlement_v3.test.ts"),
  "utf8",
);

describe("approved pilot pricing v3", () => {
  it("keeps Express public tiers unchanged", () => {
    expect(migration).toContain("values (30,190),(120,390),(360,590),(1440,790)");
    expect(migration).not.toContain("delete from public.price_profile_tiers");
  });

  it("encodes member pricing as CHF 1 then +CHF 0.40 per started 30 minutes with CHF 5.90 daily cap", () => {
    expect(migration).toContain("initial_fee_cents = 60");
    expect(migration).toContain("period_minutes = 30");
    expect(migration).toContain("price_per_period_cents = 40");
    expect(migration).toContain("daily_cap_cents = 590");
    expect(migration).toContain("min_amount_cents = 100");
    expect(v3Tests).toContain("[30, 100]");
    expect(v3Tests).toContain("[31, 140]");
    expect(v3Tests).toContain("[420, 590]");
  });

  it("defines non-return at 72h as CHF 30 total, not an additive penalty", () => {
    expect(migration).toContain("unreturned_fee_cents = 3000");
    expect(migration).toContain("unreturned_after_minutes = 4320");
    expect(migration).toContain("'type', 'non_return_total'");
    expect(frozenPricing).toContain('type: "non_return_total"');
    expect(v3Tests).toContain("assertEquals(result.final_cents, 3000)");
  });

  it("introduces v3 without reinterpreting existing v1/v2 rental snapshots", () => {
    expect(frozenPricing).toContain("pricingRulesVersion: 1 | 2 | 3");
    expect(frozenPricing).toContain("Preserve v2 historical semantics exactly");
    expect(migration).toContain("Existing rental_sessions are never rewritten");
    expect(migration).not.toContain("update public.rental_sessions");
  });

  it("keeps all three pilot stations mapped for guest and member pricing", () => {
    expect(migration).toContain("('DTA21269'),('DTA21277'),('DTA22032')");
    expect(migration).toContain("('guest'),('member')");
  });
});
