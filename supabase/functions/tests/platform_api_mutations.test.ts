import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canAccessRental,
  mutationGate,
  mutationRequestHash,
  readIdempotencyKey,
  stripeSecretMode,
} from "../_shared/platformApiMutations.ts";
import type { PlatformApiPrincipal } from "../_shared/platformApi.ts";

const testPrincipal: PlatformApiPrincipal = {
  keyId: "00000000-0000-4000-8000-000000000001",
  clientId: "00000000-0000-4000-8000-000000000002",
  clientName: "Partner test",
  environment: "test",
  scopes: ["rentals:read", "rentals:write", "payments:write"],
  rateLimitPerMinute: 120,
  keyPrefix: "chg_test_example",
};

Deno.test("requires a normalized idempotency key", () => {
  const valid = new Request("https://example.test", { headers: { "X-Idempotency-Key": "order_2026-0001" } });
  const invalid = new Request("https://example.test", { headers: { "X-Idempotency-Key": "bad key" } });
  assertEquals(readIdempotencyKey(valid), "order_2026-0001");
  assertEquals(readIdempotencyKey(invalid), null);
});

Deno.test("request hashing is canonical across object key order", async () => {
  const first = await mutationRequestHash("POST", "/v1/rentals", { stationId: "DTA21269", language: "fr" });
  const second = await mutationRequestHash("POST", "/v1/rentals", { language: "fr", stationId: "DTA21269" });
  assertEquals(first, second);
  assertEquals(first.length, 64);
});

Deno.test("mutations fail closed until explicitly enabled", () => {
  const result = mutationGate(testPrincipal, "database", () => undefined);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.code, "API_MUTATIONS_DISABLED");
});

Deno.test("test API clients cannot use a live Stripe key", () => {
  const env = (key: string) => ({
    PLATFORM_API_MUTATIONS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_example",
  } as Record<string, string>)[key];
  const result = mutationGate(testPrincipal, "stripe", env);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.code, "STRIPE_ENVIRONMENT_MISMATCH");
});

Deno.test("live mutations require a second explicit gate", () => {
  const live = { ...testPrincipal, environment: "live" as const };
  const env = (key: string) => ({
    PLATFORM_API_MUTATIONS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_example",
  } as Record<string, string>)[key];
  const result = mutationGate(live, "stripe", env);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.code, "LIVE_MUTATIONS_DISABLED");
});

Deno.test("Stripe key mode detection never exposes the key", () => {
  assertEquals(stripeSecretMode("sk_test_example"), "test");
  assertEquals(stripeSecretMode("sk_live_example"), "live");
  assertEquals(stripeSecretMode(""), "unknown");
});

Deno.test("rental access is client-owned by default", () => {
  assert(canAccessRental(testPrincipal, { api_client_id: testPrincipal.clientId }, "read"));
  assertEquals(canAccessRental(testPrincipal, { api_client_id: "another-client" }, "read"), false);
  assert(canAccessRental({ ...testPrincipal, scopes: ["*"] }, { api_client_id: "another-client" }, "write"));
});
