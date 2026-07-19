// Deno unit tests for the Platform API v1 helpers. No live network calls.
import { assertEquals, assertMatch, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALL_SCOPES,
  ensureScope,
  extractKey,
  generateApiKey,
  nextIncidentOffset,
  parseIncidentListQuery,
  sha256Hex,
  signPayload,
  toIncidentPublic,
  type AuthedClient,
} from "../_shared/platformApi.ts";

Deno.test("scopes are limited to the frozen read-only v1 set", () => {
  assertEquals([...ALL_SCOPES], [
    "health:read",
    "stations:read",
    "inventory:read",
    "pricing:read",
    "rentals:read",
    "incidents:read",
  ]);
});

Deno.test("generateApiKey emits unique high-entropy test/live keys", () => {
  const testA = generateApiKey("test");
  const testB = generateApiKey("test");
  const live = generateApiKey("live");
  assertMatch(testA.raw, /^chg_test_[a-f0-9]{48}$/);
  assertMatch(live.raw, /^chg_live_[a-f0-9]{48}$/);
  assertEquals(testA.prefix, "chg_test_");
  assertEquals(live.prefix, "chg_live_");
  assertEquals(testA.publicId.length, 12);
  assertNotEquals(testA.raw, testB.raw);
});

Deno.test("sha256Hex is deterministic and does not expose the raw key", async () => {
  const raw = "chg_test_" + "a".repeat(48);
  const first = await sha256Hex(raw);
  const second = await sha256Hex(raw);
  assertEquals(first, second);
  assertEquals(first.length, 64);
  assertNotEquals(first, raw);
});

Deno.test("extractKey accepts Bearer and X-API-Key", () => {
  const bearer = new Request("http://x", {
    headers: { authorization: "Bearer chg_test_" + "a".repeat(32) },
  });
  const direct = new Request("http://x", {
    headers: { "x-api-key": "chg_live_" + "b".repeat(32) },
  });
  assertMatch(extractKey(bearer) ?? "", /^chg_test_/);
  assertMatch(extractKey(direct) ?? "", /^chg_live_/);
});

Deno.test("extractKey rejects malformed, short and unrelated credentials", () => {
  const malformed = new Request("http://x", { headers: { authorization: "Bearer not-a-key" } });
  const short = new Request("http://x", { headers: { "x-api-key": "chg_test_short" } });
  const none = new Request("http://x");
  assertEquals(extractKey(malformed), null);
  assertEquals(extractKey(short), null);
  assertEquals(extractKey(none), null);
});

Deno.test("X-API-Key takes precedence over Bearer", () => {
  const request = new Request("http://x", {
    headers: {
      "x-api-key": "chg_test_" + "a".repeat(32),
      authorization: "Bearer chg_live_" + "b".repeat(32),
    },
  });
  assertEquals(extractKey(request), "chg_test_" + "a".repeat(32));
});

Deno.test("ensureScope enforces per-scope isolation", () => {
  const client: AuthedClient = {
    clientId: "client",
    keyId: "key",
    environment: "test",
    scopes: ["stations:read", "pricing:read"],
    quotaPerMinute: 60,
    quotaPerDay: 100,
  };
  assertEquals(ensureScope(client, "stations:read"), true);
  assertEquals(ensureScope(client, "pricing:read"), true);
  assertEquals(ensureScope(client, "rentals:read"), false);
  assertEquals(ensureScope(client, "incidents:read"), false);
  assertEquals(ensureScope(client, "inventory:read"), false);
});

Deno.test("incident list query defaults are bounded", () => {
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents")), {
    ok: true,
    value: {
      limit: 50,
      offset: 0,
      resolved: null,
      severity: null,
      type: null,
    },
  });
});

Deno.test("incident list query accepts only strict filters and pagination", () => {
  assertEquals(
    parseIncidentListQuery(new URL(
      "https://api.example/v1/incidents?limit=25&offset=50&resolved=false&severity=high&type=eject_failed_after_payment",
    )),
    {
      ok: true,
      value: {
        limit: 25,
        offset: 50,
        resolved: false,
        severity: "high",
        type: "eject_failed_after_payment",
      },
    },
  );
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?limit=101")).ok, false);
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?limit=1e2")).ok, false);
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?limit=0x10")).ok, false);
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?offset=")).ok, false);
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?offset=-1")).ok, false);
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?offset=9951&limit=50")).ok, false);
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?offset=9999&limit=1")).ok, true);
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?resolved=yes")).ok, false);
  assertEquals(parseIncidentListQuery(new URL("https://api.example/v1/incidents?type=bad%20type")).ok, false);
});

Deno.test("incident pagination never returns an unusable next offset", () => {
  assertEquals(nextIncidentOffset(50, 25, 26), 75);
  assertEquals(nextIncidentOffset(50, 25, 25), null);
  assertEquals(nextIncidentOffset(9_950, 50, 51), null);
});

Deno.test("public incidents exclude operator messages and arbitrary metadata", () => {
  assertEquals(toIncidentPublic({
    id: "incident-id",
    type: "eject_failed_after_payment",
    severity: "high",
    resolved: false,
    created_at: "2026-07-19T10:00:00Z",
    updated_at: "2026-07-19T10:01:00Z",
    message: "provider response contained sensitive details",
    data: { token: "secret", raw_response: "private" },
  }), {
    id: "incident-id",
    type: "eject_failed_after_payment",
    severity: "high",
    resolved: false,
    created_at: "2026-07-19T10:00:00Z",
    updated_at: "2026-07-19T10:01:00Z",
  });
});

Deno.test("signPayload emits t=<timestamp>,v1=<hex64>", async () => {
  const signature = await signPayload("shhh", "{\"ping\":true}", 1_700_000_000);
  assertMatch(signature, /^t=1700000000,v1=[a-f0-9]{64}$/);
});
