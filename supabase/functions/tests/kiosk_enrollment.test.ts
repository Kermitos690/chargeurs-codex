import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeKioskBaseUrl,
  randomOpaque,
  sha256Hex,
  validEnrollmentRequest,
  validRequestedTestToken,
} from "../_shared/kioskEnrollment.ts";

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

Deno.test("device-proposed tokens use the diagnostic-only format", () => {
  assert(validRequestedTestToken(
    "kt_test_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
  ));
  assertEquals(validRequestedTestToken("kt_live_not_allowed"), false);
  assertEquals(validRequestedTestToken("kt_test_too-short"), false);
});

Deno.test("direct activation is pinned to staging diagnostic pilot stations", async () => {
  const source = await Deno.readTextFile("supabase/functions/kiosk-enroll/index.ts");
  const migration = await Deno.readTextFile(
    "supabase/migrations/20260724031000_staging_kiosk_self_enrollment.sql",
  );

  assert(source.includes('projectOrigin() === STAGING_SUPABASE_ORIGIN'));
  assert(source.includes('appVersion.endsWith("-staging-diagnostic")'));
  assert(source.includes('body.testSelfEnroll === true'));
  assert(source.includes('db.rpc("self_enroll_staging_kiosk"'));
  assert(migration.includes("environment = 'staging'"));
  assert(migration.includes("is_pilot = true"));
  assert(migration.includes("now() + interval '7 days'"));
  assert(migration.includes("grant execute on function public.self_enroll_staging_kiosk"));
});

Deno.test("pairing administration binds organization and supports audited cancellation", async () => {
  const source = await Deno.readTextFile("supabase/functions/kiosk-admin/index.ts");
  assert(source.includes('select("station_id,organization_id")'));
  assert(source.includes("STATION_ORGANIZATION_MISSING"));
  assert(source.includes('action === "cancel_pairing_code"'));
  assert(source.includes('action: "kiosk.pairing_code.cancelled"'));
  assert(source.includes('code_hash: await sha256Hex(pairingCode)'));
});

Deno.test("legacy public admin bootstrap is closed by default", async () => {
  const source = await Deno.readTextFile("supabase/functions/claim-admin/index.ts");
  assert(source.includes('ADMIN_BOOTSTRAP_ENABLED") === "true"'));
  assert(source.includes("expectedSecret.length < 32"));
  assert(source.includes("ADMIN_BOOTSTRAP_DISABLED"));
});
