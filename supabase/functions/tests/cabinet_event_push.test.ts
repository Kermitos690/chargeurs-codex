// CALLBACK tests — full signed branch of cabinet-event-push via the exported
// handler with an injected fake db and a TEMPORARY in-process secret.
// Proves: fail-closed (503), production guard, signature gate, replay window,
// size cap, invalid JSON, atomic dedup (23505), and exact return delegation.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeDb, jsonResponse, stubFetch } from "./_fakes.ts";
import { handleEvent, unsignedAllowed } from "../cabinet-event-push/index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SECRET = "test-secret-" + crypto.randomUUID(); // never logged, process-only

function db(): FakeDb {
  const d = new FakeDb();
  d.uniqueCols["cabinet_events"] = "external_event_id";
  d.seed("stations", [{ station_id: "DTA-TST", online: false, status: "offline" }]);
  return d;
}
function asClient(d: FakeDb) { return d as unknown as SupabaseClient; }
function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://x.test/cabinet-event-push", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
// env factory: secret configured + non-production unless overridden.
const env = (over: Record<string, string> = {}) =>
  (k: string) => ({ CHARGENOW_EVENT_SECRET: SECRET, ENVIRONMENT: "test", ...over })[k];

Deno.test("fail-closed: no server secret AND prod => 503", async () => {
  const r = await handleEvent(req({ eventType: "CABINET_ONLINE" }), asClient(db()),
    (k) => ({ ENVIRONMENT: "production" } as Record<string, string>)[k]);
  assertEquals(r.status, 503);
});

Deno.test("production guard: ALLOW_UNSIGNED has NO effect in production", async () => {
  const r = await handleEvent(req({ eventType: "CABINET_ONLINE" }), asClient(db()),
    (k) => ({ ALLOW_UNSIGNED_CHARGENOW_EVENTS: "true", ENVIRONMENT: "production" } as Record<string, string>)[k]);
  assertEquals(r.status, 503);
  assertEquals(unsignedAllowed((k) => ({ ALLOW_UNSIGNED_CHARGENOW_EVENTS: "true", ENVIRONMENT: "production" } as Record<string, string>)[k]), false);
  assertEquals(unsignedAllowed((k) => ({ ALLOW_UNSIGNED_CHARGENOW_EVENTS: "true", ENVIRONMENT: "development" } as Record<string, string>)[k]), true);
});

Deno.test("signature: missing header => 401", async () => {
  const r = await handleEvent(req({ eventType: "CABINET_ONLINE" }), asClient(db()), env());
  assertEquals(r.status, 401);
});

Deno.test("signature: wrong secret => 401", async () => {
  const r = await handleEvent(req({ eventType: "CABINET_ONLINE" }, { "x-event-secret": "nope" }), asClient(db()), env());
  assertEquals(r.status, 401);
});

Deno.test("signature: correct secret => 200 and station updated online", async () => {
  const d = db();
  const r = await handleEvent(
    req({ eventType: "CABINET_ONLINE", deviceId: "DTA-TST", messageId: "m1" }, { "x-event-secret": SECRET }),
    asClient(d), env());
  assertEquals(r.status, 200);
  assertEquals(d.tables["stations"][0].online, true);
});

Deno.test("size cap: payload > 64KB => 413", async () => {
  const big = JSON.stringify({ eventType: "X", pad: "a".repeat(70 * 1024) });
  const r = await handleEvent(req(big, { "x-event-secret": SECRET }), asClient(db()), env());
  assertEquals(r.status, 413);
});

Deno.test("invalid JSON => 400", async () => {
  const r = await handleEvent(req("{not json", { "x-event-secret": SECRET }), asClient(db()), env());
  assertEquals(r.status, 400);
});

Deno.test("replay window: timestamp older than 5min => 408", async () => {
  const old = Date.now() - 10 * 60 * 1000;
  const r = await handleEvent(
    req({ eventType: "CABINET_ONLINE", deviceId: "DTA-TST", timestamp: old }, { "x-event-secret": SECRET }),
    asClient(db()), env());
  assertEquals(r.status, 408);
});

Deno.test("incomplete BATTERY_IN never mutates the latest rental", async () => {
  const d = db();
  const e = { eventType: "BATTERY_IN", deviceId: "DTA-TST", messageId: "dup-1" };
  d.seed("rental_sessions", [{ id: "rs1", station_id: "DTA-TST", state: "active_rental", created_at: "2026-01-01" }]);
  const r1 = await handleEvent(req(e, { "x-event-secret": SECRET }), asClient(d), env());
  const r2 = await handleEvent(req(e, { "x-event-secret": SECRET }), asClient(d), env());
  assertEquals(r1.status, 202);
  assertEquals((await r2.json()).deduplicated, true);
  assertEquals(d.tables["cabinet_events"].length, 1);
  assertEquals(d.tables["rental_sessions"][0].state, "active_rental");
  assertEquals(d.tables["system_incidents"].length, 1);
});

Deno.test("complete BATTERY_IN is delegated to the canonical return inbox", async () => {
  const d = db();
  const rentalId = "11111111-1111-4111-8111-111111111111";
  d.seed("rental_sessions", [{
    id: rentalId,
    station_id: "ORIGIN",
    apifox_trade_no: "T-EXACT-1",
    battery_id: "BAT-EXACT-1",
    state: "active_rental",
  }]);
  Deno.env.set("CHARGENOW_CALLBACK_SIGNING_KEY", "callback-test-signing-key");
  const fetchStub = stubFetch((_url, init) => {
    const forwarded = JSON.parse(String(init?.body));
    assertEquals(forwarded, {
      status: "2",
      tradeNo: "T-EXACT-1",
      eventId: "cabinet-event:return-exact-1",
      stationId: "RETURN-STATION",
      batteryId: "BAT-EXACT-1",
      slotNum: 4,
    });
    return jsonResponse({ received: true, settlement_triggered: true, settlement_ok: true });
  });
  try {
    const response = await handleEvent(req({
      eventType: "BATTERY_IN",
      deviceId: "RETURN-STATION",
      messageId: "return-exact-1",
      tradeNo: "T-EXACT-1",
      batteryId: "BAT-EXACT-1",
      slotNum: 4,
    }, { "x-event-secret": SECRET }), asClient(d), env({ SUPABASE_URL: "https://project.supabase.co" }));
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.delegated, true);
    assertEquals(body.settlement_triggered, true);
    assertEquals(fetchStub.calls.length, 1);
    assertEquals(fetchStub.calls[0].url.includes("/functions/v1/chargenow-rent-callback"), true);
  } finally {
    fetchStub.restore();
    Deno.env.delete("CHARGENOW_CALLBACK_SIGNING_KEY");
  }
});

Deno.test("state machine: BATTERY_IN does NOT regress a terminal session", async () => {
  const d = db();
  d.seed("rental_sessions", [{ id: "rs2", station_id: "DTA-TST", state: "refunded", created_at: "2026-01-01" }]);
  const response = await handleEvent(
    req({ eventType: "BATTERY_IN", deviceId: "DTA-TST", messageId: "x9" }, { "x-event-secret": SECRET }),
    asClient(d), env());
  assertEquals(response.status, 202);
  assertEquals(d.tables["rental_sessions"][0].state, "refunded");
});
