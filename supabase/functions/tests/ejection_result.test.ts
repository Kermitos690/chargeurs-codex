import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { needsSupplierReleaseConfirmation } from "../_shared/ejectionResult.ts";

Deno.test("a ChargeNow HTTP 200 with an unresolved business code is physically ambiguous", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: false, status: 200, data: null, error: "HTTP_200_CODE_1055" }, null), true);
});

Deno.test("a 2xx reply without a battery identity remains pending even when its business code is successful", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: true, status: 200, data: {}, error: null }, null), true);
});

Deno.test("even a provider-identified 2xx release requires the four-slot physical delta", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: true, status: 200, data: {}, error: null }, "F0F000503E"), true);
});

Deno.test("transport failures are not mistaken for normal provider confirmation pending", () => {
  assertEquals(needsSupplierReleaseConfirmation({ ok: false, status: 502, data: null, error: "HTTP_502" }, null), false);
});
