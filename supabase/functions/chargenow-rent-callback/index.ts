// chargenow-rent-callback — O2 rent callback receiver.
// ChargeNow POSTs application/x-www-form-urlencoded with:
//   status : 0-Rent Fail, 1-Rent success, 2-Return Success
//   tradeNo
// Public endpoint (called by ChargeNow servers). Idempotent.
//
// SECURITY: fail-closed. Requires CHARGENOW_EVENT_SECRET (same shared secret
// as cabinet-event-push). Unsigned requests are rejected with 503 unless
// ALLOW_UNSIGNED_CHARGENOW_EVENTS=true is explicitly set in a non-production
// runtime (dev only). Also validates that the tradeNo maps to a session in an
// expected state before applying the transition, to prevent replay/forgery
// from flipping terminal sessions.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function unsignedAllowed(env: (k: string) => string | undefined): boolean {
  const allow = env("ALLOW_UNSIGNED_CHARGENOW_EVENTS") === "true";
  const mode = (env("ENVIRONMENT") ?? env("DENO_ENV") ?? "production").toLowerCase();
  const nonProd = mode === "development" || mode === "test" || mode === "local";
  return allow && nonProd;
}

function j(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Sessions that may still legitimately transition via this callback.
const TRANSITIONABLE_STATES = new Set([
  "checkout_created", "payment_succeeded", "ejected", "battery_taken", "active_rental",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const env = (k: string) => Deno.env.get(k);
  const expected = env("CHARGENOW_EVENT_SECRET");

  if (!expected) {
    if (!unsignedAllowed(env)) {
      return j({ ok: false, error: "CONFIGURATION_ERROR", detail: "CHARGENOW_EVENT_SECRET not configured" }, 503);
    }
  } else {
    const url = new URL(req.url);
    const provided = req.headers.get("x-event-secret")
      ?? req.headers.get("x-chargenow-secret")
      ?? url.searchParams.get("secret")
      ?? "";
    if (!safeEqual(provided, expected)) {
      return j({ ok: false, error: "INVALID_EVENT_SECRET" }, 401);
    }
  }

  const db = adminClient();
  try {
    let status: string | null = null;
    let tradeNo: string | null = null;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      status = String(form.get("status") ?? "");
      tradeNo = String(form.get("tradeNo") ?? "");
    } else {
      const body = await req.json().catch(() => ({}));
      status = String(body.status ?? "");
      tradeNo = String(body.tradeNo ?? "");
    }

    await db.from("api_logs").insert({
      service: "chargenow", endpoint: "/rent/callback", method: "POST",
      status_code: 200, request: { status, tradeNo }, response: null, error: null,
    });

    if (tradeNo) {
      const { data: session } = await db.from("rental_sessions")
        .select("id, state").eq("apifox_trade_no", tradeNo)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (session && TRANSITIONABLE_STATES.has(String(session.state))) {
        if (status === "1") {
          await db.from("rental_sessions").update({ state: "active_rental" }).eq("id", session.id);
        } else if (status === "2") {
          await db.from("rental_sessions").update({
            state: "battery_returned", returned_at: new Date().toISOString(),
          }).eq("id", session.id);
        } else if (status === "0") {
          await db.from("rental_sessions").update({
            state: "eject_failed", error_code: "RENT_FAIL",
            error_message: "ChargeNow a signalé un échec de location.",
          }).eq("id", session.id);
        }
      }
    }
    return j({ received: true }, 200);
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
});
