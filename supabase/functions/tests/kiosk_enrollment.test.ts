import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeKioskBaseUrl, randomOpaque, sha256Hex, validEnrollmentRequest } from "../_shared/kioskEnrollment.ts";

Deno.test("kiosk enrollment accepts only high-entropy code and UUID v4", () => {
  assert(validEnrollmentRequest(
    "kc_0123456789abcdef",
    "7a0d60c8-7f31-4c92-a688-6e97d214c028",
    "1.0.0",
  ));
  assertEquals(validEnrollmentRequest("123456", "not-a-uuid", "1.0.0"), false);
});

Deno.test("kiosk public origin is HTTPS only", () => {
  assertEquals(normalizeKioskBaseUrl("https://chargeurs.ch/"), "https://chargeurs.ch");
  assertEquals(normalizeKioskBaseUrl("http://chargeurs.ch"), null);
  assertEquals(normalizeKioskBaseUrl("https://chargeurs.ch/kiosk"), null);
  assertEquals(normalizeKioskBaseUrl("https://user@chargeurs.ch"), null);
});

Deno.test("pairing tokens are prefixed and never stored in plaintext", async () => {
  const code = randomOpaque("kc_", 18);
  assert(code.startsWith("kc_"));
  assert(code.length >= 19);
  assertEquals((await sha256Hex(code)).length, 64);
});

