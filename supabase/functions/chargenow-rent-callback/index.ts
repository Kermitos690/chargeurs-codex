// chargenow-rent-callback — ChargeNow rent lifecycle receiver.
//
// Expected status values:
//   0 = rent failed
//   1 = rent succeeded / active
//   2 = battery returned
//
// A trusted return immediately starts the idempotent financial settlement.
// Callback acknowledgement remains 200 even when settlement needs manual review,
// preventing provider retry storms; the failure is logged and tracked internally.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function unsignedAllowed(env: (key: string) => string | undefined): boolean {
  const allow = env("ALLOW_UNSIGNED_CHARGENOW_EVENTS") === "true";
  const mode = (env("ENVIRONMENT") ?? env("DENO_ENV") ?? "production").toLowerCase();
  return allow && ["development", "test", "local"].includes(mode);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ACTIVE_TRANSITION_STATES = new Set([
  "checkout_created",
  "payment_succeeded",
  "ejected",
  "battery_taken",
  "active_rental",
]);

async function triggerSettlement(rentalSessionId: string, returnedAt: string) {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/settle-rental-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      rentalSessionId,
      returnState: "normal",
      finalAt: returnedAt,
    }),
  });
  const result = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, result };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const env = (key: string) => Deno.env.get(key);
  const expected = env("CHARGENOW_EVENT_SECRET");

  if (!expected) {
    if (!unsignedAllowed(env)) {
      return json({ ok: false, error: "CONFIGURATION_ERROR", detail: "CHARGENOW_EVENT_SECRET not configured" }, 503);
    }
  } else {
    const url = new URL(req.url);
    const provided = req.headers.get("x-event-secret")
      ?? req.headers.get("x-chargenow-secret")
      ?? url.searchParams.get("secret")
      ?? "";
    if (!safeEqual(provided, expected)) {
      return json({ ok: false, error: "INVALID_EVENT_SECRET" }, 401);
    }
  }

  const db = adminClient();

  try {
    let status = "";
    let tradeNo = "";
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      status = String(form.get("status") ?? "");
      tradeNo = String(form.get("tradeNo") ?? "");
    } else {
      const body = await req.json().catch(() => ({}));
      status = String(body.status ?? "");
      tradeNo = String(body.tradeNo ?? "");
    }

    await logApi(db, {
      service: "chargenow",
      endpoint: "/rent/callback",
      method: "POST",
      status_code: 200,
      request: { status, tradeNo },
      response: null,
      error: null,
    });

    if (!tradeNo) return json({ received: true, ignored: "MISSING_TRADE_NO" }, 200);

    const { data: session } = await db.from("rental_sessions")
      .select("id,state,settlement_status,returned_at")
      .eq("apifox_trade_no", tradeNo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      await auditLog(db, {
        action: "chargenow.callback.unmatched",
        data: { status, trade_no_fingerprint: tradeNo.slice(-8) },
      });
      return json({ received: true, unmatched: true }, 200);
    }

    if (status === "1" && ACTIVE_TRANSITION_STATES.has(String(session.state))) {
      await db.from("rental_sessions").update({ state: "active_rental" }).eq("id", session.id);
      await auditLog(db, { action: "chargenow.rental.active", target: session.id });
      return json({ received: true, state: "active_rental" }, 200);
    }

    if (status === "2") {
      // Replayed return callbacks are useful: if settlement previously failed or
      // was interrupted, they safely retrigger the idempotent settlement engine.
      const returnedAt = session.returned_at ?? new Date().toISOString();
      if (ACTIVE_TRANSITION_STATES.has(String(session.state))) {
        await db.from("rental_sessions").update({
          state: "battery_returned",
          returned_at: returnedAt,
        }).eq("id", session.id);
      }

      const settlement = await triggerSettlement(session.id, returnedAt).catch((error) => ({
        ok: false,
        status: 0,
        result: { error: String(error) },
      }));

      await logApi(db, {
        service: "internal",
        endpoint: "settle-rental-payment",
        method: "POST",
        status_code: settlement.status,
        request: { rentalSessionId: session.id, source: "chargenow_return" },
        response: settlement.result,
        error: settlement.ok ? null : "SETTLEMENT_NOT_COMPLETED",
      });

      if (!settlement.ok) {
        await auditLog(db, {
          action: "settlement.retry.required",
          target: session.id,
          data: { source: "chargenow_callback", status: settlement.status },
        });
      }

      return json({
        received: true,
        state: "battery_returned",
        settlement_triggered: true,
        settlement_ok: settlement.ok,
      }, 200);
    }

    if (status === "0" && ACTIVE_TRANSITION_STATES.has(String(session.state))) {
      await db.from("rental_sessions").update({
        state: "eject_failed",
        failure_code: "RENT_FAIL",
        failure_message: "ChargeNow a signalé un échec de location.",
      }).eq("id", session.id);
      await auditLog(db, { action: "chargenow.rental.failed", target: session.id });
      return json({ received: true, state: "eject_failed" }, 200);
    }

    return json({ received: true, ignored: "NO_VALID_TRANSITION" }, 200);
  } catch (error) {
    await logApi(db, {
      service: "chargenow",
      endpoint: "/rent/callback:handle",
      method: "POST",
      status_code: 500,
      error: String(error),
    });
    return json({ ok: false, error: "CALLBACK_INTERNAL_ERROR" }, 500);
  }
});
