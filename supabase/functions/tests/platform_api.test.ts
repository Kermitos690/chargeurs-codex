import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractApiPath,
  getRequestId,
  hasApiScope,
  readApiKey,
  sha256Hex,
  type PlatformApiPrincipal,
} from "../_shared/platformApi.ts";

const principal: PlatformApiPrincipal = {
  keyId: "00000000-0000-4000-8000-000000000001",
  clientId: "00000000-0000-4000-8000-000000000002",
  clientName: "Tests",
  environment: "test",
  scopes: ["stations:read", "rentals:*"],
  rateLimitPerMinute: 120,
  keyPrefix: "chg_test_example",
};

Deno.test("reads a bearer API key", () => {
  const req = new Request("https://example.test/functions/v1/platform-api/v1/me", {
    headers: { Authorization: "Bearer chg_test_abcdefghijklmnopqrstuvwxyz" },
  });
  assertEquals(readApiKey(req), "chg_test_abcdefghijklmnopqrstuvwxyz");
});

Deno.test("X-API-Key takes precedence", () => {
  const req = new Request("https://example.test", {
    headers: {
      Authorization: "Bearer ignored",
      "X-API-Key": "chg_test_directkeyvalue",
    },
  });
  assertEquals(readApiKey(req), "chg_test_directkeyvalue");
});

Deno.test("extracts the versioned path behind the Supabase function prefix", () => {
  const req = new Request("https://project.supabase.co/functions/v1/platform-api/v1/stations/DTA21269/availability?x=1");
  assertEquals(extractApiPath(req), "/v1/stations/DTA21269/availability");
});

Deno.test("supports exact and namespace wildcard scopes", () => {
  assert(hasApiScope(principal, "stations:read"));
  assert(hasApiScope(principal, "rentals:read"));
  assert(hasApiScope(principal, "rentals:write"));
  assertEquals(hasApiScope(principal, "inventory:read"), false);
});

Deno.test("global wildcard grants every scope", () => {
  assert(hasApiScope({ ...principal, scopes: ["*"] }, "payments:write"));
});

Deno.test("SHA-256 hashing is deterministic without exposing the source value", async () => {
  const first = await sha256Hex("chg_test_secret-value");
  const second = await sha256Hex("chg_test_secret-value");
  assertEquals(first, second);
  assertEquals(first.length, 64);
  assertNotEquals(first, "chg_test_secret-value");
});

Deno.test("keeps a valid caller request ID and generates one otherwise", () => {
  const valid = "00000000-0000-4000-8000-000000000123";
  assertEquals(getRequestId(new Request("https://example.test", { headers: { "X-Request-Id": valid } })), valid);
  const generated = getRequestId(new Request("https://example.test"));
  assert(/^[0-9a-f-]{36}$/i.test(generated));
});
