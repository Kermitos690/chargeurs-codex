import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { needsSupplierReleaseConfirmation } from "../_shared/ejectionResult.ts";

Deno.test("a ChargeNow HTTP 200 with an unresolved business code is physically ambiguous", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: false, status: 200, data: null, error: "HTTP_200_CODE_1055" }), true);
});

Deno.test("transport failures and confirmed results are not treated as pending release confirmation", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: false, status: 502, data: null, error: "HTTP_502" }), false);
  assertEquals(needsSupplierReleaseConfirmation({ ok: true, status: 200, data: {}, error: null }), false);
});
