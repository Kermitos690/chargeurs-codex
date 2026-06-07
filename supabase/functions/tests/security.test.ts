// SECURITY tests — defense-in-depth invariants that must hold in code.
//  - Secret redaction: api_logs/audit never persist secrets/tokens.
//  - Fail-closed defaults: unsigned callback mode is OFF unless explicitly
//    enabled in a NON-production runtime.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { unsignedAllowed } from "../cabinet-event-push/index.ts";

Deno.test("unsigned callback mode is OFF by default (no env)", () => {
  assertEquals(unsignedAllowed(() => undefined), false);
});

Deno.test("unsigned callback mode stays OFF in production even if flag set", () => {
  assertEquals(unsignedAllowed((k) => ({ ALLOW_UNSIGNED_CHARGENOW_EVENTS: "true", ENVIRONMENT: "production" } as Record<string, string>)[k]), false);
});

Deno.test("unsigned callback mode allowed ONLY in dev/test/local with explicit flag", () => {
  for (const e of ["development", "test", "local"]) {
    assertEquals(unsignedAllowed((k) => ({ ALLOW_UNSIGNED_CHARGENOW_EVENTS: "true", ENVIRONMENT: e } as Record<string, string>)[k]), true);
  }
  // Flag missing => off even in dev.
  assertEquals(unsignedAllowed((k) => ({ ENVIRONMENT: "development" } as Record<string, string>)[k]), false);
});

Deno.test("redact hides secret-bearing keys before logging", async () => {
  // logApi uses redact() internally; we test redact behavior via a fake db that
  // captures the persisted row, proving tokens never reach storage.
  const captured: Record<string, unknown>[] = [];
  const fakeDb = {
    from: () => ({ insert: (row: Record<string, unknown>) => { captured.push(row); return Promise.resolve({ error: null }); } }),
  };
  const { logApi } = await import("../_shared/db.ts");
  // deno-lint-ignore no-explicit-any
  await logApi(fakeDb as any, {
    service: "chargenow", endpoint: "/x", method: "POST",
    request: { Authorization: "Basic SUPERSECRET", token: "abc", nested: { api_key: "k" }, deviceId: "S1" },
  });
  const req = captured[0].request as Record<string, unknown>;
  assertEquals(req.Authorization, "***");
  assertEquals(req.token, "***");
  assertEquals((req.nested as Record<string, unknown>).api_key, "***");
  assert(req.deviceId === "S1"); // non-secret preserved
});
