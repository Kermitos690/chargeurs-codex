// CALLBACK tests — full signed branch of cabinet-event-push via the exported
// handler with an injected fake db and a TEMPORARY in-process secret.
// Proves: fail-closed (503), production guard, signature gate, replay window,
// size cap, invalid JSON, atomic dedup (23505), state-machine advancement.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeDb } from "./_fakes.ts";
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

Deno.test("dedup: same external_event_id twice => second is deduplicated, single row", async () => {
  const d = db();
  const e = { eventType: "BATTERY_IN", deviceId: "DTA-TST", messageId: "dup-1" };
  d.seed("rental_sessions", [{ id: "rs1", station_id: "DTA-TST", state: "active_rental", created_at: "2026-01-01" }]);
  const r1 = await handleEvent(req(e, { "x-event-secret": SECRET }), asClient(d), env());
  const r2 = await handleEvent(req(e, { "x-event-secret": SECRET }), asClient(d), env());
  assertEquals(r1.status, 200);
  assertEquals((await r2.json()).deduplicated, true);
  assertEquals(d.tables["cabinet_events"].length, 1);
  // Exactly one business effect: the session advanced once.
  assertEquals(d.tables["rental_sessions"][0].state, "battery_returned");
});

Deno.test("state machine: BATTERY_IN does NOT regress a terminal session", async () => {
  const d = db();
  d.seed("rental_sessions", [{ id: "rs2", station_id: "DTA-TST", state: "refunded", created_at: "2026-01-01" }]);
  await handleEvent(
    req({ eventType: "BATTERY_IN", deviceId: "DTA-TST", messageId: "x9" }, { "x-event-secret": SECRET }),
    asClient(d), env());
  assertEquals(d.tables["rental_sessions"][0].state, "refunded");
});
