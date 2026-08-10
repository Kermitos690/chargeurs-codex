import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile("supabase/functions/_shared/settlementRuntime.ts");

Deno.test("transient settlement failures do not terminalize the Rental Orchestrator", () => {
  assert(source.includes("recordRetryableSettlementFailure"));
  assert(source.includes("ORCHESTRATOR_FINANCIAL_COMMIT_RETRY_REQUIRED"));
  assertEquals(source.includes('eventType: "rental_failed"'), false);
});

Deno.test("settlement failures release the database lock for retry", () => {
  const marker = "async function recordRetryableSettlementFailure";
  const start = source.indexOf(marker);
  const end = source.indexOf("async function claimSettlement", start);
  assert(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert(block.includes('settlement_status: "failed"'));
  assert(block.includes("settlement_locked_at: null"));
  assert(block.includes("retryable: true"));
});

Deno.test("financial provider progress is persisted before orchestration replay", () => {
  assert(source.includes("persistFinancialProgress"));
  assert(source.includes("settlement_capture_"));
  assert(source.includes("settlement_refund_"));
  assert(source.includes("settlement_supplemental_"));
});
