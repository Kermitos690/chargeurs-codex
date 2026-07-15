import { assert, assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decryptToken,
  encryptToken,
  stableWalletSerial,
  visibleDataHash,
  walletUrlForToken,
} from "../_shared/appleWallet.ts";
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

Deno.test("Wallet serial number is stable for one account and distinct across accounts", () => {
  const first = stableWalletSerial("11111111-2222-4333-8444-555555555555");
  assertEquals(first, stableWalletSerial("11111111-2222-4333-8444-555555555555"));
  assertNotEquals(first, stableWalletSerial("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"));
  assertEquals(first, "CHG-11111111222243338444555555555555");
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

Deno.test("Wallet link contains only the public app origin and opaque token", () => {
  const token = "wq_z2cJwEJeHDQbHGdGfQvKKfVw4uY3hBNQ_HjPKKJJJ6M";
  const url = walletUrlForToken("https://app.chargeurs.ch/", token);
  assertEquals(url, `https://app.chargeurs.ch/wallet/${token}`);
  assert(!url.includes("user@example.com"));
  assert(!url.includes("11111111-2222-4333-8444-555555555555"));
  assert(!url.includes("eyJ"));
});
