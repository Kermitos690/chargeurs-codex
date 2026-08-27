import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const originalV3Migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260827010000_pilot_pricing_rules_v3.sql"),
  "utf8",
);
const finalMemberMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260827030000_member_pricing_v3_final.sql"),
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

const finalPricingDocs = [
  readFileSync(resolve(process.cwd(), "README.md"), "utf8"),
  readFileSync(resolve(process.cwd(), "PRICING_ENGINE.md"), "utf8"),
  readFileSync(resolve(process.cwd(), "docs/PRE_PRODUCTION_CANONICAL_OVERVIEW.md"), "utf8"),
].join("\n");

describe("approved pilot pricing v3", () => {
  it("keeps Express public tiers unchanged", () => {
    expect(originalV3Migration).toContain("values (30,190),(120,390),(360,590),(1440,790)");
    expect(originalV3Migration).not.toContain("delete from public.price_profile_tiers");
    expect(finalMemberMigration).toContain("(VALUES (30,190),(120,390),(360,590),(1440,790))");
  });

  it("encodes CHF 2 through 2h then +CHF 1 per started hour with a CHF 5.90 daily cap", () => {
    expect(finalMemberMigration).toContain("initial_fee_cents = 100");
    expect(finalMemberMigration).toContain("included_minutes = 60");
    expect(finalMemberMigration).toContain("period_minutes = 60");
    expect(finalMemberMigration).toContain("price_per_period_cents = 100");
    expect(finalMemberMigration).toContain("daily_cap_cents = 590");
    expect(finalMemberMigration).toContain("min_amount_cents = 200");
    expect(v3Tests).toContain("[120, 200]");
    expect(v3Tests).toContain("[121, 300]");
    expect(v3Tests).toContain("[301, 590]");
    expect(finalPricingDocs).toMatch(/(?:2,00|2\.00) CHF/);
    expect(finalPricingDocs).toMatch(/(?:1,00|1\.00) CHF/);
  });

  it("tests both authoritative DB calculators at all commercial boundaries", () => {
    expect(finalMemberMigration).toContain("compute_customer_pricing_snapshot");
    expect(finalMemberMigration).toContain("customer_wallet_pricing_state");
    expect(finalMemberMigration).toContain("(1441,1180)");
    expect(finalMemberMigration).toContain("(4319,1770)");
    expect(finalMemberMigration).toContain("(4320,3000)");
  });

  it("defines non-return at 72h as CHF 30 total, not an additive penalty", () => {
    expect(finalMemberMigration).toContain("unreturned_fee_cents = 3000");
    expect(finalMemberMigration).toContain("unreturned_after_minutes = 4320");
    expect(frozenPricing).toContain('type: "non_return_total"');
    expect(v3Tests).toContain("assertEquals(result.final_cents, 3000)");
  });

  it("corrects new rentals without rewriting historical rental snapshots", () => {
    expect(frozenPricing).toContain("pricingRulesVersion: 1 | 2 | 3");
    expect(frozenPricing).toContain("Preserve v2 historical semantics exactly");
    expect(finalMemberMigration).toContain("does not touch rental_sessions");
    expect(finalMemberMigration).not.toMatch(/UPDATE\s+public\.rental_sessions/i);
  });

  it("keeps all three pilot stations mapped for guest and member pricing", () => {
    expect(finalMemberMigration).toContain("('DTA21269'),('DTA21277'),('DTA22032')");
    expect(finalMemberMigration).toContain("('guest'),('member')");
  });
});
