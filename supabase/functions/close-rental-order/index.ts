// close-rental-order — closes a ChargeNow rent order after battery return.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, requireAdmin } from "../_shared/db.ts";
import { isChargeNowConfigured, orderClose } from "../_shared/chargenow.ts";
import { chargeNowCloseFailure } from "../_shared/chargenowSafety.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  // Admin-gated to avoid abuse.
  const adminId = await requireAdmin(req, db);
  if (!adminId) {
    return new Response(JSON.stringify({ ok: false, error: "FORBIDDEN" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { rentalSessionId } = await req.json();
    const { data: session } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ ok: false, error: "SESSION_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await db.from("rental_sessions").update({ state: "closing_order" }).eq("id", session.id);

    let closeFailure: string | null = null;
    let providerAttempted = false;
    if (!isChargeNowConfigured()) {
      closeFailure = "CHARGENOW_NOT_CONFIGURED";
    } else if (!session.apifox_trade_no) {
      closeFailure = "NO_TRADE_NO";
    } else {
      providerAttempted = true;
      const res = await orderClose({ tradeNo: session.apifox_trade_no });
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/close", method: "POST",
        status_code: res.status, request: { tradeNo: session.apifox_trade_no }, response: res.data, error: res.error,
      });
      closeFailure = chargeNowCloseFailure(res);
    }

    if (closeFailure) {
      // Orphaned-order risk: the ChargeNow side was NOT closed. We must NOT mark
      // the session as normally closed. Instead raise a tracked incident and put
      // the session into needs_support for explicit operator reconciliation.
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/close", method: "POST",
        status_code: 0, request: { rentalSessionId, by: adminId }, response: null,
        error: `CLOSE_REFUSED:${closeFailure}`,
      });
      await db.from("system_incidents").insert({
        type: "orphan_order_close",
        severity: providerAttempted ? "high" : "warning",
        message: `Clôture non confirmée côté ChargeNow (${closeFailure}) pour la location ${session.public_session_code ?? session.id}.`,
        data: {
          rental_session_id: session.id,
          close_failure: closeFailure,
          provider_attempted: providerAttempted,
          station_id: session.station_id,
          trade_no: session.apifox_trade_no,
          by: adminId,
        },
        resolved: false,
      });
      await db.from("rental_sessions").update({
        state: "needs_support",
        failure_code: "CHARGENOW_CLOSE_UNCONFIRMED",
        failure_message: `Ordre non clôturé côté ChargeNow (${closeFailure}). Réconciliation opérateur requise.`,
      }).eq("id", session.id);

      return new Response(JSON.stringify({
        ok: false,
        chargenow_skipped: !providerAttempted,
        close_failure: closeFailure,
        requires_review: true, state: "needs_support",
      }), {
        status: providerAttempted ? 502 : 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await db.from("rental_sessions").update({
      state: "closed", closed_at: new Date().toISOString(),
    }).eq("id", session.id);

    return new Response(JSON.stringify({ ok: true, chargenow_skipped: false, close_failure: null }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
