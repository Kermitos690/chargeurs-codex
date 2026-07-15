import { assert, assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decryptToken, encryptToken, visibleDataHash } from "../_shared/appleWallet.ts";
import { sha256Hex } from "../_shared/db.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));

Deno.test("Wallet tokens round-trip through AES-256-GCM without plaintext storage", async () => {
  const token = "wq_abcdefghijklmnopqrstuvwxyz0123456789ABCDE";
  const encrypted = await encryptToken(token, KEY);
  assertNotEquals(encrypted, token);
  assert(!encrypted.includes("wq_"));
  assertEquals(await decryptToken(encrypted, KEY), token);
});

Deno.test("Wallet token encryption uses a fresh nonce", async () => {
  const token = "wq_abcdefghijklmnopqrstuvwxyz0123456789ABCDE";
  const first = await encryptToken(token, KEY);
  const second = await encryptToken(token, KEY);
  assertNotEquals(first, second);
  assertEquals(await decryptToken(first, KEY), token);
  assertEquals(await decryptToken(second, KEY), token);
});

Deno.test("Invalid Wallet encryption key is rejected", async () => {
  await assertRejects(() => encryptToken("secret", btoa("short")), Error, "exactly 32 bytes");
});

Deno.test("Visible pass hash changes only when visible data changes", async () => {
  const base = {
    memberName: "Membre Chargeurs.ch",
    memberNumber: "CHG-ABC123",
    accountStatus: "active",
    subscriptionName: null,
    creditCents: null,
    totalRentals: 1,
    activeRental: null,
    lastRentalAt: "2026-07-16T00:00:00.000Z",
  };
  const first = await visibleDataHash(base);
  const same = await visibleDataHash({ ...base });
  const changed = await visibleDataHash({ ...base, totalRentals: 2 });
  assertEquals(first, same);
  assertNotEquals(first, changed);
});

Deno.test("Opaque QR hash does not expose account data", async () => {
  const qrToken = "wq_z2cJwEJeHDQbHGdGfQvKKfVw4uY3hBNQ_HjPKKJJJ6M";
  const hash = await sha256Hex(qrToken);
  assertEquals(hash.length, 64);
  assert(!hash.includes("@"));
  assert(!hash.includes("CHG-"));
  assert(!hash.includes("wq_"));
});
