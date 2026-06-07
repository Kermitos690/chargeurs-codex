// close-rental-order — closes a ChargeNow rent order after battery return.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, requireAdmin } from "../_shared/db.ts";
import { isChargeNowConfigured, orderClose } from "../_shared/chargenow.ts";

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

    let chargenowSkipped = false;
    let skipReason: string | null = null;
    if (!isChargeNowConfigured()) {
      chargenowSkipped = true;
      skipReason = "CHARGENOW_NOT_CONFIGURED";
    } else if (!session.apifox_trade_no) {
      chargenowSkipped = true;
      skipReason = "NO_TRADE_NO";
    } else {
      const res = await orderClose({ tradeNo: session.apifox_trade_no, orderId: session.apifox_trade_no });
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/close", method: "POST",
        status_code: res.status, request: { tradeNo: session.apifox_trade_no }, response: res.data, error: res.error,
      });
    }

    if (chargenowSkipped) {
      // Orphaned-order risk: the ChargeNow side was NOT closed. We must NOT mark
      // the session as normally closed. Instead raise a tracked incident and put
      // the session into needs_support for explicit operator reconciliation.
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/close", method: "POST",
        status_code: 0, request: { rentalSessionId, by: adminId }, response: null,
        error: `CLOSE_SKIPPED:${skipReason}`,
      });
      await db.from("system_incidents").insert({
        type: "orphan_order_close",
        severity: "warning",
        message: `Clôture impossible côté ChargeNow (${skipReason}) pour la location ${session.public_session_code ?? session.id}.`,
        data: { rental_session_id: session.id, skip_reason: skipReason, station_id: session.station_id, trade_no: session.apifox_trade_no, by: adminId },
        resolved: false,
      });
      await db.from("rental_sessions").update({
        state: "needs_support",
        failure_code: "CLOSE_SKIPPED",
        failure_message: `Ordre non clôturé côté ChargeNow (${skipReason}). Réconciliation opérateur requise.`,
      }).eq("id", session.id);

      return new Response(JSON.stringify({
        ok: false, chargenow_skipped: true, skip_reason: skipReason,
        requires_review: true, state: "needs_support",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await db.from("rental_sessions").update({
      state: "closed", closed_at: new Date().toISOString(),
    }).eq("id", session.id);

    return new Response(JSON.stringify({ ok: true, chargenow_skipped: false, skip_reason: null }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
