// Deno unit tests for the Platform API v1 helpers. No network access,
// no live Supabase calls — the client is stubbed.
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALL_SCOPES,
  ensureScope,
  extractKey,
  generateApiKey,
  sha256Hex,
  signPayload,
  type AuthedClient,
} from "../_shared/platformApi.ts";

Deno.test("scopes are the frozen v1 set", () => {
  assertEquals([...ALL_SCOPES], [
    "health:read",
    "stations:read",
    "inventory:read",
    "pricing:read",
    "rentals:read",
  ]);
});

Deno.test("generateApiKey emits chg_test_ / chg_live_ prefixed keys", () => {
  const t = generateApiKey("test");
  const l = generateApiKey("live");
  assertMatch(t.raw, /^chg_test_[a-f0-9]{48}$/);
  assertMatch(l.raw, /^chg_live_[a-f0-9]{48}$/);
  assertEquals(t.prefix, "chg_test_");
  assertEquals(l.prefix, "chg_live_");
  assertEquals(t.publicId.length, 12);
});

Deno.test("sha256Hex is deterministic and 64 chars", async () => {
  const h1 = await sha256Hex("chg_test_abc");
  const h2 = await sha256Hex("chg_test_abc");
  assertEquals(h1, h2);
  assertEquals(h1.length, 64);
});

Deno.test("extractKey accepts only well-formed Bearer tokens", () => {
  const good = new Request("http://x", {
    headers: { authorization: "Bearer chg_test_" + "a".repeat(32) },
  });
  const bad = new Request("http://x", {
    headers: { authorization: "Bearer not-a-key" },
  });
  const none = new Request("http://x");
  assertMatch(extractKey(good) ?? "", /^chg_test_/);
  assertEquals(extractKey(bad), null);
  assertEquals(extractKey(none), null);
});

Deno.test("ensureScope enforces per-scope isolation", () => {
  const c: AuthedClient = {
    clientId: "c", keyId: "k", environment: "test",
    scopes: ["stations:read", "pricing:read"],
    quotaPerMinute: 60, quotaPerDay: 100,
  };
  assertEquals(ensureScope(c, "stations:read"), true);
  assertEquals(ensureScope(c, "pricing:read"), true);
  assertEquals(ensureScope(c, "rentals:read"), false);
  assertEquals(ensureScope(c, "inventory:read"), false);
});

Deno.test("signPayload emits t=<ts>,v1=<hex64>", async () => {
  const sig = await signPayload("shhh", "{\"ping\":true}", 1_700_000_000);
  assertMatch(sig, /^t=1700000000,v1=[a-f0-9]{64}$/);
});
