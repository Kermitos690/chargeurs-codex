import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createCustomerPairingToken,
  pairingTokenHash,
  validPairingToken,
} from "../_shared/customerPairing.ts";

Deno.test("customer pairing tokens are high entropy URL-safe bearer values", () => {
  const first = createCustomerPairingToken();
  const second = createCustomerPairingToken();
  assert(validPairingToken(first));
  assert(validPairingToken(second));
  assertNotEquals(first, second);
  assertEquals(first.includes("="), false);
  assertEquals(first.includes("+"), false);
  assertEquals(first.includes("/"), false);
});

Deno.test("customer pairing storage uses an irreversible SHA-256 digest", async () => {
  const token = createCustomerPairingToken();
  const digest = await pairingTokenHash(token);
  assertEquals(digest.length, 64);
  assert(/^[0-9a-f]{64}$/.test(digest));
  assertNotEquals(digest, token);
  assertEquals(await pairingTokenHash(token), digest);
});

Deno.test("malformed pairing tokens are rejected", () => {
  assertEquals(validPairingToken(""), false);
  assertEquals(validPairingToken("short"), false);
  assertEquals(validPairingToken("../../etc/passwd"), false);
  assertEquals(validPairingToken("A".repeat(90)), false);
});
