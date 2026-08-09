import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { needsSupplierReleaseConfirmation } from "../_shared/ejectionResult.ts";

Deno.test("a ChargeNow HTTP 200 with an unresolved business code is physically ambiguous", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: false, status: 200, data: null, error: "HTTP_200_CODE_1055" }, null), true);
});

Deno.test("a 2xx reply without a battery identity remains pending even when its business code is successful", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: true, status: 200, data: {}, error: null }, null), true);
});

Deno.test("transport failures and identity-confirmed results are not treated as pending release confirmation", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: false, status: 502, data: null, error: "HTTP_502" }, null), false);
  assertEquals(needsSupplierReleaseConfirmation({ ok: true, status: 200, data: {}, error: null }, "F0F000503E"), false);
});
