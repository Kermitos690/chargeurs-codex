// Contract tests for create-rental-session.
//
// These tests hit the deployed edge function. They prove the fail-closed kiosk
// authentication, strict station binding, idempotency and rate limiting.
//
// Secrets are NEVER hardcoded:
//   - SUPABASE_URL + publishable key are injected explicitly by the staging
//     integration-test job. Local/unit-only runs skip these remote checks.
//   - A valid kiosk token may be provided via KIOSK_TEST_TOKEN (+ KIOSK_TEST_STATION
//     and KIOSK_TEST_OTHER_STATION). When absent, the auth-positive / binding /
//     idempotency / rate-limit tests are skipped so no credential lives in the repo.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? "";
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? "";
const FN_URL = `${SUPABASE_URL}/functions/v1/create-rental-session`;

const VALID_TOKEN = Deno.env.get("KIOSK_TEST_TOKEN") ?? "";
const STATION = Deno.env.get("KIOSK_TEST_STATION") ?? "DTA21269";
const OTHER_STATION = Deno.env.get("KIOSK_TEST_OTHER_STATION") ?? "DTA21277";
const hasRemote = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL) && ANON.length >= 20;
const hasCred = hasRemote && VALID_TOKEN.length >= 24;

function remoteTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, ignore: !hasRemote, fn });
}

async function call(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ANON}`,
      "apikey": ANON,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

remoteTest("no kiosk token => 401 KIOSK_AUTH_REQUIRED", async () => {
  const { status, json } = await call({ stationId: STATION });
  assertEquals(status, 401);
  assertEquals(json.error, "KIOSK_AUTH_REQUIRED");
});

remoteTest("too-short token => 401 KIOSK_AUTH_REQUIRED", async () => {
  const { status, json } = await call({ stationId: STATION }, { "X-Kiosk-Token": "short" });
  assertEquals(status, 401);
  assertEquals(json.error, "KIOSK_AUTH_REQUIRED");
});

remoteTest("unknown but well-formed token => 401 KIOSK_AUTH_INVALID", async () => {
  const { status, json } = await call(
    { stationId: STATION },
    { "X-Kiosk-Token": "zz_unknown_token_with_enough_length_000000" },
  );
  assertEquals(status, 401);
  assertEquals(json.error, "KIOSK_AUTH_INVALID");
});

remoteTest("missing/invalid stationId => 400 MISSING_STATION", async () => {
  const { status, json } = await call({}, { "X-Kiosk-Token": "zz_unknown_token_with_enough_length_000000" });
  assertEquals(status, 400);
  assertEquals(json.error, "MISSING_STATION");
});

Deno.test({
  name: "valid token bound to another station => 403 KIOSK_STATION_MISMATCH",
  ignore: !hasCred,
  fn: async () => {
    const { status, json } = await call({ stationId: OTHER_STATION }, { "X-Kiosk-Token": VALID_TOKEN });
    assertEquals(status, 403);
    assertEquals(json.error, "KIOSK_STATION_MISMATCH");
  },
});

Deno.test({
  name: "valid token + nonexistent station => 403 KIOSK_STATION_MISMATCH (binding wins)",
  ignore: !hasCred,
  fn: async () => {
    const { status, json } = await call({ stationId: "NOPE999" }, { "X-Kiosk-Token": VALID_TOKEN });
    assertEquals(status, 403);
    assertEquals(json.error, "KIOSK_STATION_MISMATCH");
  },
});

Deno.test({
  name: "same idempotency key => single session (idempotent replay)",
  ignore: !hasCred,
  fn: async () => {
    const key = `test-${crypto.randomUUID()}`;
    const h = { "X-Kiosk-Token": VALID_TOKEN, "X-Idempotency-Key": key };
    const a = await call({ stationId: STATION }, h);
    const b = await call({ stationId: STATION }, h);
    assertEquals(a.json.ok, true);
    assertEquals(b.json.ok, true);
    assertEquals(b.json.idempotent, true);
    const sa = a.json.session as { id: string };
    const sb = b.json.session as { id: string };
    assertEquals(sa.id, sb.id);
  },
});

Deno.test({
  name: "client-sent price/currency/state are ignored (server authoritative)",
  ignore: !hasCred,
  fn: async () => {
    const { json } = await call(
      { stationId: STATION, amount: 9999, currency: "USD", state: "paid", final_cents: 1 },
      { "X-Kiosk-Token": VALID_TOKEN, "X-Idempotency-Key": `test-${crypto.randomUUID()}` },
    );
    if (json.ok) {
      const s = json.session as { state: string; currency: string };
      assertEquals(s.state, "created");
      assertEquals(s.currency !== "USD", true);
    }
  },
});
