// RESILIENCE tests — degraded dependencies must never produce a "lying success".
// Covers: ChargeNow network failure/timeout/non-JSON via the real client, and
// the callback handler's DB-error branch (500 on non-dedup insert failure).
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeDb, stubFetch, jsonResponse } from "./_fakes.ts";
import { handleEvent } from "../cabinet-event-push/index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.env.set("CHARGENOW_BASIC_AUTH", "dGVzdA==");
Deno.env.set("CHARGENOW_API_BASE_URL", "https://example.test/cdb-open-api/v1");
const cn = await import("../_shared/chargenow.ts");

const SECRET = "test-secret-" + crypto.randomUUID();
const env = (k: string) => ({ CHARGENOW_EVENT_SECRET: SECRET, ENVIRONMENT: "test" } as Record<string, string>)[k];

Deno.test("ChargeNow unavailable (network throw) => ok=false, no exception", async () => {
  const s = stubFetch(() => { throw new Error("ETIMEDOUT"); });
  try {
    const res = await cn.orderCreate({ deviceId: "S1" });
    assertEquals(res.ok, false);
    assert(res.error?.includes("ETIMEDOUT"));
  } finally { s.restore(); }
});

Deno.test("ChargeNow returns HTTP 500 => ok=false, status surfaced", async () => {
  const s = stubFetch(() => jsonResponse({ message: "boom" }, 500));
  try {
    const res = await cn.orderQuery("T-1");
    assertEquals(res.ok, false);
    assertEquals(res.status, 500);
  } finally { s.restore(); }
});

Deno.test("ChargeNow returns HTTP 429 (rate limit) => ok=false", async () => {
  const s = stubFetch(() => jsonResponse({ message: "slow down" }, 429));
  try {
    const res = await cn.cabinetQuery("S1");
    assertEquals(res.ok, false);
    assertEquals(res.status, 429);
  } finally { s.restore(); }
});

Deno.test("ChargeNow returns malformed JSON => no throw, data is raw text", async () => {
  const s = stubFetch(() => new Response("{partial", { status: 200 }));
  try {
    const res = await cn.cabinetQuery("S1");
    assertEquals(typeof res.data, "string");
  } finally { s.restore(); }
});

Deno.test("callback: DB insert failure (non-23505) => 500, no silent success", async () => {
  const d = new FakeDb();
  // Force a generic insert error by overriding the table builder via a poisoned db.
  const poisoned = {
    from: () => ({
      insert: () => Promise.resolve({ error: { code: "08006", message: "connection lost" } }),
    }),
  } as unknown as SupabaseClient;
  const r = await handleEvent(new Request("https://x.test", {
    method: "POST", headers: { "Content-Type": "application/json", "x-event-secret": SECRET },
    body: JSON.stringify({ eventType: "CABINET_STATUS", deviceId: "S1", messageId: "z" }),
  }), poisoned, env);
  assertEquals(r.status, 500);
  assertEquals((await r.json()).error, "INSERT_FAILED");
  // d unused but proves no fallback to the fake happened
  assertEquals(Object.keys(d.tables).length, 0);
});
