// ChargeNow rent callback receiver. Public, fail-closed and idempotent.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";
import { markReturnAndEnqueue } from "../_shared/returnSettlement.ts";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function unsignedAllowed(env: (k: string) => string | undefined): boolean {
  const allow = env("ALLOW_UNSIGNED_CHARGENOW_EVENTS") === "true";
  const mode = (env("ENVIRONMENT") ?? env("DENO_ENV") ?? "production").toLowerCase();
  return allow && ["development", "test", "local"].includes(mode);
}

function j(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TRANSITIONABLE_STATES = new Set([
  "checkout_created", "payment_processing", "payment_succeeded", "authorized",
  "ejected", "battery_taken", "active_rental",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const env = (key: string) => Deno.env.get(key);
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
    if (!safeEqual(provided, expected)) return j({ ok: false, error: "INVALID_EVENT_SECRET" }, 401);
  }

  const db = adminClient();
  try {
    let status = "";
    let tradeNo = "";
    let payload: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      status = String(form.get("status") ?? "");
      tradeNo = String(form.get("tradeNo") ?? "");
      payload = Object.fromEntries(form.entries());
    } else {
      payload = await req.json().catch(() => ({}));
      status = String(payload.status ?? "");
      tradeNo = String(payload.tradeNo ?? "");
    }

    await db.from("api_logs").insert({
      service: "chargenow", endpoint: "/rent/callback", method: "POST",
      status_code: 200, request: { status, tradeNo }, response: null, error: null,
    });

    if (!tradeNo) return j({ received: true, ignored: true, reason: "TRADE_NO_MISSING" }, 200);

    const { data: session } = await db.from("rental_sessions")
      .select("id,state,station_id,battery_id,apifox_trade_no")
      .eq("apifox_trade_no", tradeNo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!session) return j({ received: true, ignored: true, reason: "RENTAL_NOT_FOUND" }, 200);

    if (status === "1" && TRANSITIONABLE_STATES.has(String(session.state))) {
      await db.from("rental_sessions").update({ state: "active_rental" })
        .eq("id", session.id)
        .in("state", ["ejected", "battery_taken", "payment_succeeded", "authorized"]);
      await db.from("rental_orchestrator_snapshots").update({ state: "active" })
        .eq("rental_id", session.id).then(() => {}, () => {});
      return j({ received: true, rentalId: session.id, state: "active_rental" }, 200);
    }

    if (status === "2") {
      const externalEventId = `rent-callback:${tradeNo}:return`;
      const result = await markReturnAndEnqueue(db, {
        source: "chargenow_callback",
        payload: { ...payload, tradeNo, stationId: session.station_id, batteryId: payload.batteryId ?? session.battery_id },
        externalEventId,
        exactRentalId: session.id,
      });
      return j({ received: true, return: result }, result.ok ? 200 : 202);
    }

    if (status === "0" && TRANSITIONABLE_STATES.has(String(session.state))) {
      await db.from("rental_sessions").update({
        state: "eject_failed",
        error_code: "RENT_FAIL",
        error_message: "ChargeNow a signalé un échec de location.",
      }).eq("id", session.id);
      return j({ received: true, rentalId: session.id, state: "eject_failed" }, 200);
    }

    return j({ received: true, ignored: true, reason: "STATE_OR_STATUS_NOT_TRANSITIONABLE" }, 200);
  } catch (error) {
    return j({ ok: false, error: String(error) }, 500);
  }
});
