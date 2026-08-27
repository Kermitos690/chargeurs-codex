import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const finalPricingMigration = read("supabase/migrations/20260827030000_member_pricing_v3_final.sql");
const prepaidMigration = read("supabase/migrations/20260827020000_member_prepaid_payment_rail.sql");
const pricingTests = read("supabase/functions/tests/pricing_settlement_v3.test.ts");
const prepaidTests = read("src/test/memberPrepaidRail.test.ts");
const readme = read("README.md");
const canonical = read("docs/PRE_PRODUCTION_CANONICAL_OVERVIEW.md");
const testing = read("TESTING.md");
const workflow = read(".github/workflows/pre-production-v3-financial-ci.yml");

const failures = [];

function requireContains(label, content, needle) {
  if (!content.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}

function requireNotContains(label, content, needle) {
  if (content.includes(needle)) failures.push(`${label}: stale/forbidden ${JSON.stringify(needle)}`);
}

for (const [needle, label] of [
  ["initial_fee_cents = 100", "member initial fee"],
  ["included_minutes = 60", "member included hour"],
  ["period_minutes = 60", "member period"],
  ["price_per_period_cents = 100", "member hourly increment"],
  ["daily_cap_cents = 590", "member daily cap"],
  ["min_amount_cents = 200", "member minimum"],
]) {
  requireContains(`final pricing migration (${label})`, finalPricingMigration, needle);
}

for (const needle of [
  "[120, 200]",
  "[121, 300]",
  "[180, 300]",
  "[181, 400]",
  "[240, 400]",
  "[241, 500]",
  "[300, 500]",
  "[301, 590]",
  "assertEquals(price(memberSnapshot(), 4320).final_cents, 3000)",
]) {
  requireContains("v3 pricing vectors", pricingTests, needle);
}

for (const needle of [
  "'membership_prepaid'",
  "v_required constant bigint := 3000",
  "authorize_member_prepaid_rental",
  "settle_member_prepaid_on_return",
  "PAYMENT_RAIL_ALREADY_CLAIMED",
  "INSUFFICIENT_PREPAID_BALANCE",
]) {
  requireContains("prepaid migration", prepaidMigration, needle);
}

for (const needle of [
  "authorize_member_prepaid_rental",
  "eject-after-payment",
  "functions/v1/kiosk-customer-options",
]) {
  requireContains("prepaid regression test", prepaidTests, needle);
}

requireContains("README", readme, "2,00 CHF");
requireContains("README", readme, "5,90 CHF");
requireContains("canonical overview", canonical, "2.00 CHF");
requireContains("canonical overview", canonical, "5.90 CHF");

for (const [label, content] of [["README", readme], ["canonical overview", canonical]]) {
  requireContains(label, content, "72");
  requireContains(label, content, "30 CHF");
  requireNotContains(label, content, "1.00 CHF covers the first 30 min");
  requireNotContains(label, content, "+0.40 CHF per additional started 30 min");
  requireNotContains(label, content, "1 CHF first 30");
}

requireContains("TESTING.md", testing, "Validation ciblée préproduction v3");
requireContains("CI workflow", workflow, "Chargeurs.ch Pre-production V3 CI");
requireContains("CI workflow", workflow, "node scripts/check-preproduction-v3-contract.mjs");
requireContains("CI workflow", workflow, "npm ci");
requireContains("CI workflow", workflow, "npm run typecheck");
requireContains("CI workflow", workflow, "npm run build");

if (failures.length > 0) {
  console.error("Pre-production v3 contract check FAILED:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Pre-production v3 contract check PASS");
console.log("Canonical member pricing: CHF 2.00 through 2h, then +CHF 1.00 per started hour, cap CHF 5.90/24h.");
console.log("Canonical non-return: CHF 30 total at 72h for new v3 rentals.");
console.log("Prepaid rail markers, tests, docs and safe CI entrypoint are present.");
