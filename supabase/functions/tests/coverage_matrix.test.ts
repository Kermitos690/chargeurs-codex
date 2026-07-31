// Coverage completeness — asserts the chargenow-admin dispatcher implements
// every one of the 35 documented ChargeNow operations, and that the matrix
// codes stay in sync with the dispatcher. Pure source-level test (no network).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const EXPECTED = [
  "A1",
  "O1", "O2", "O3", "O4", "O5", "O6", "O7",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12",
  "S1", "S2", "S3", "S4", "S5",
  "P1", "P2", "P3", "P4", "P5", "P6",
  "R1",
  "E1", "E2", "E3",
];

const src = await Deno.readTextFile(
  new URL("../chargenow-admin/index.ts", import.meta.url),
);

Deno.test("dispatcher implements all 35 documented operations", () => {
  assertEquals(EXPECTED.length, 35);
  for (const code of EXPECTED) {
    assert(
      src.includes(`case "${code}":`),
      `Missing dispatcher case for ChargeNow op ${code}`,
    );
  }
});

Deno.test("every dangerous code is gated in the DANGEROUS set", () => {
  // Destructive ops must be explicitly listed so they require maintenance mode.
  const dangerous = ["C1", "C2", "C3", "C9", "C10", "C11", "C12", "S5", "P4", "E1"];
  const m = src.match(/const DANGEROUS = new Set\(\[([\s\S]*?)\]\)/);
  assert(m, "DANGEROUS set not found");
  for (const code of dangerous) {
    assert(m![1].includes(`"${code}"`), `Dangerous op ${code} not gated`);
  }
});

Deno.test("safe-live list contains only the explicitly approved documented read", () => {
  const m = src.match(/const SAFE_LIVE = \[([\s\S]*?)\]/);
  assert(m, "SAFE_LIVE list not found");
  assertEquals(m![1].trim(), '"O1"');
  assert(src.includes('case "O7": return { ok: false, status: 0, data: null, error: "PROVIDER_ENDPOINT_MISSING" }'));
  assert(src.includes('const APPROVED_LIVE_READS = new Set(["O1"])'));
  assert(src.includes('error: DANGEROUS.has(code) ? "PROVIDER_MUTATION_DISABLED" : "PROVIDER_ENDPOINT_MISSING"'));
});
