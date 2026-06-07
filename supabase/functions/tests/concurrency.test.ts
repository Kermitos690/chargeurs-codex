// CONCURRENCY tests — real parallel invocations (Promise.all) proving that
// critical idempotency is enforced by the unique-constraint layer, not just an
// in-memory pre-check. NOTE: true multi-connection DB races require the isolated
// staging DB (manual phase); here the unique-key guarantee is exercised directly.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeDb } from "./_fakes.ts";
import { handleEvent } from "../cabinet-event-push/index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SECRET = "test-secret-" + crypto.randomUUID();
const env = (k: string) => ({ CHARGENOW_EVENT_SECRET: SECRET, ENVIRONMENT: "test" } as Record<string, string>)[k];
const asClient = (d: FakeDb) => d as unknown as SupabaseClient;
function req(body: unknown) {
  return new Request("https://x.test", {
    method: "POST", headers: { "Content-Type": "application/json", "x-event-secret": SECRET },
    body: JSON.stringify(body),
  });
}

Deno.test("two identical BATTERY_IN callbacks in parallel => one row, one effect", async () => {
  const d = new FakeDb();
  d.uniqueCols["cabinet_events"] = "external_event_id";
  d.seed("stations", [{ station_id: "S1" }]);
  d.seed("rental_sessions", [{ id: "rs1", station_id: "S1", state: "active_rental", created_at: "2026-01-01" }]);
  const e = { eventType: "BATTERY_IN", deviceId: "S1", messageId: "race-1" };
  const [r1, r2] = await Promise.all([
    handleEvent(req(e), asClient(d), env),
    handleEvent(req(e), asClient(d), env),
  ]);
  const codes = [r1.status, r2.status].sort();
  assertEquals(codes, [200, 200]);
  assertEquals(d.tables["cabinet_events"].length, 1);
  assertEquals(d.tables["rental_sessions"][0].state, "battery_returned");
  // Exactly one state-advancing update was applied.
  const advanced = d.updates.filter((u) => u.table === "rental_sessions" && u.patch.state === "battery_returned");
  assertEquals(advanced.length, 1);
});

Deno.test("two DIFFERENT events in parallel => two rows, both processed", async () => {
  const d = new FakeDb();
  d.uniqueCols["cabinet_events"] = "external_event_id";
  d.seed("stations", [{ station_id: "S1", online: false, status: "offline" }]);
  const [r1, r2] = await Promise.all([
    handleEvent(req({ eventType: "CABINET_ONLINE", deviceId: "S1", messageId: "a" }), asClient(d), env),
    handleEvent(req({ eventType: "CABINET_OFFLINE", deviceId: "S1", messageId: "b" }), asClient(d), env),
  ]);
  assertEquals(r1.status, 200);
  assertEquals(r2.status, 200);
  assertEquals(d.tables["cabinet_events"].length, 2);
});

Deno.test("ten parallel duplicates => exactly one inserted, nine deduplicated", async () => {
  const d = new FakeDb();
  d.uniqueCols["cabinet_events"] = "external_event_id";
  d.seed("stations", [{ station_id: "S1" }]);
  const e = { eventType: "CABINET_STATUS", deviceId: "S1", messageId: "storm" };
  const results = await Promise.all(Array.from({ length: 10 }, () => handleEvent(req(e), asClient(d), env)));
  const bodies = await Promise.all(results.map((r) => r.json()));
  const dedups = bodies.filter((b) => b.deduplicated).length;
  assertEquals(d.tables["cabinet_events"].length, 1);
  assertEquals(dedups, 9);
});
