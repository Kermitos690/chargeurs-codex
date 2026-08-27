import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newSixDigitPairingCode, normalizeKioskBaseUrl, randomOpaque, sha256Hex, validEnrollmentRequest } from "../_shared/kioskEnrollment.ts";

Deno.test("kiosk enrollment accepts only six-digit numeric codes and UUID v4", () => {
  assert(validEnrollmentRequest(
    "004821",
    "7a0d60c8-7f31-4c92-a688-6e97d214c028",
    "1.0.0",
  ));
  for (const invalid of ["12345", "1234567", "12 456", "12.456", "ABCDEF", "kc_0123456789abcdef"]) {
    assertEquals(validEnrollmentRequest(invalid, "7a0d60c8-7f31-4c92-a688-6e97d214c028", "1.0.0"), false);
  }
  assertEquals(validEnrollmentRequest("123456", "not-a-uuid", "1.0.0"), false);
});

Deno.test("kiosk public origin is HTTPS only", () => {
  assertEquals(normalizeKioskBaseUrl("https://chargeurs.ch/"), "https://chargeurs.ch");
  assertEquals(normalizeKioskBaseUrl("http://chargeurs.ch"), null);
  assertEquals(normalizeKioskBaseUrl("https://chargeurs.ch/kiosk"), null);
  assertEquals(normalizeKioskBaseUrl("https://user@chargeurs.ch"), null);
});

Deno.test("pairing codes are six-digit cryptographic values and tokens remain opaque", async () => {
  const code = newSixDigitPairingCode();
  assert(/^\d{6}$/.test(code));
  // Leading zero is representable and must not be parsed as a number.
  assertEquals(newSixDigitPairingCode().length, 6);
  const token = randomOpaque("kt_", 18);
  assert(token.startsWith("kt_"));
  assertEquals((await sha256Hex(code)).length, 64);
});

Deno.test("pairing administration binds organization and supports audited cancellation", async () => {
  const source = await Deno.readTextFile("supabase/functions/kiosk-admin/index.ts");
  assert(source.includes('select("station_id,organization_id")'));
  assert(source.includes("STATION_ORGANIZATION_MISSING"));
  assert(source.includes('action === "cancel_pairing_code"'));
  assert(source.includes('action: "kiosk.pairing_code.cancelled"'));
  assert(source.includes('code_hash: await sha256Hex(pairingCode)'));
  assert(source.includes("newSixDigitPairingCode"));
  assert(source.includes("ttlMinutes ?? 10"));
});

Deno.test("kiosk enrollment applies a keyed source rate limit without logging plaintext", async () => {
  const source = await Deno.readTextFile("supabase/functions/kiosk-enroll/index.ts");
  const migration = await Deno.readTextFile("supabase/migrations/20260809024615_kiosk_numeric_enrollment_rate_limits.sql");
  assert(source.includes("KIOSK_ENROLLMENT_RATE_LIMIT_SALT"));
  assert(source.includes("p_source_hash: sourceHash"));
  assert(migration.includes("kiosk_enrollment_attempts"));
  assert(migration.includes("TOO_MANY_ENROLLMENT_ATTEMPTS"));
  assert(migration.includes("failed_attempt_count"));
  assertEquals(migration.includes("pairing_code text"), false);
});

Deno.test("legacy public admin bootstrap is closed by default", async () => {
  const source = await Deno.readTextFile("supabase/functions/claim-admin/index.ts");
  assert(source.includes('ADMIN_BOOTSTRAP_ENABLED") === "true"'));
  assert(source.includes("expectedSecret.length < 32"));
  assert(source.includes("ADMIN_BOOTSTRAP_DISABLED"));
});
