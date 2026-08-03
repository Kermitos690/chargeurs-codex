import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRentalPublicCode, isRentalPublicCode } from "../_shared/rentalPublicCode.ts";

Deno.test("rental public codes use the CHG prefix and twelve unbiased symbols", () => {
  const code = createRentalPublicCode((bytes) => {
    bytes.fill(0);
    return bytes;
  });
  assertEquals(code, "CHG-AAAAAAAAAAAA");
  assertMatch(code, /^CHG-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
  assert(isRentalPublicCode(code));
});

Deno.test("rental public code validator keeps existing six-symbol sessions readable", () => {
  assert(isRentalPublicCode("CHG-ABC234"));
  assert(!isRentalPublicCode("CHG-AAAAA"));
  assert(!isRentalPublicCode("CHG-ILLEGAL"));
});
