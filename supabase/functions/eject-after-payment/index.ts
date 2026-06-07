// eject-after-payment — runs ONLY after a confirmed Stripe payment (called by
// stripe-webhook) or by an admin tool. It (1) creates the ChargeNow rent order
// (O2), then (2) ejects the battery (C3 ejectByRent). Idempotent and guarded
// against double order / double ejection. Bounded retries → manual_review.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi } from "../_shared/db.ts";
import { ejectByRent, isChargeNowConfigured, orderCreate } from "../_shared/chargenow.ts";

const MAX_RETRIES = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  try {
    const { rentalSessionId } = await req.json();
    const { data: session } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ ok: false, error: "SESSION_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Already done — idempotent success.
    if (["ejected", "battery_taken", "active_rental", "battery_returned", "closed", "completed"].includes(session.state)) {
      return new Response(JSON.stringify({ ok: true, alreadyDone: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Must be paid (defence in depth).
    if (!["payment_succeeded", "ejecting", "chargenow_failed", "eject_failed"].includes(session.state)) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_PAID", state: session.state }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!isChargeNowConfigured()) {
      await db.from("rental_sessions").update({
        state: "needs_support", failure_code: "CHARGENOW_NOT_CONFIGURED",
        failure_message: "API ChargeNow non configurée — éjection impossible.",
      }).eq("id", session.id);
      return new Response(JSON.stringify({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const retry = Number(session.retry_count ?? 0);
    if (retry >= MAX_RETRIES) {
      await db.from("rental_sessions").update({
        state: "manual_review", failure_code: "MAX_RETRIES",
        failure_message: "Nombre maximal de tentatives atteint — revue manuelle.",
      }).eq("id", session.id);
      return new Response(JSON.stringify({ ok: false, error: "MAX_RETRIES" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Lock the row into "ejecting" only from a coherent prior state.
    await db.from("rental_sessions").update({ state: "ejecting", retry_count: retry + 1 })
      .eq("id", session.id);

    const cabinetId = session.cabinet_id || session.station_id;

    // ---- Step 1: create ChargeNow rent order (O2) if not already created ----
    let tradeNo: string | null = session.apifox_trade_no ?? null;
    if (!tradeNo) {
      const callbackURL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/chargenow-rent-callback`;
      const ord = await orderCreate({ deviceId: cabinetId, callbackURL });
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/create", method: "POST",
        status_code: ord.status, request: { cabinetId }, response: ord.data, error: ord.error,
      });
      const d = ord.data as { data?: { tradeNo?: string; orderId?: string }; tradeNo?: string } | null;
      tradeNo = d?.data?.tradeNo ?? d?.tradeNo ?? null;
      const orderId = d?.data?.orderId ?? null;

      // Upsert keeps a single ChargeNow order per session (unique index).
      await db.from("apifox_orders").upsert({
        rental_session_id: session.id, trade_no: tradeNo,
        request: { cabinetId }, response: ord.data, status: ord.ok ? "created" : "error",
      }, { onConflict: "rental_session_id" });

      if (!ord.ok || !tradeNo) {
        await db.from("rental_sessions").update({
          state: "chargenow_failed", failure_code: ord.error ?? "ORDER_FAILED",
          failure_message: "Paiement reçu mais commande ChargeNow impossible — remboursement/vérification en cours.",
        }).eq("id", session.id);
        return new Response(JSON.stringify({ ok: false, error: ord.error ?? "ORDER_FAILED" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await db.from("rental_sessions").update({
        apifox_trade_no: tradeNo, chargenow_order_id: orderId, chargenow_status: "created",
      }).eq("id", session.id);
    }

    // ---- Step 2: eject the battery (C3) ----
    const slotNum = session.selected_slot_num ?? 0;
    const res = await ejectByRent(cabinetId, slotNum, tradeNo ?? undefined);
    await logApi(db, {
      service: "chargenow", endpoint: "/cabinet/ejectByRent", method: "POST",
      status_code: res.status, request: { cabinetId, slotNum }, response: res.data, error: res.error,
    });

    if (res.ok) {
      await db.from("rental_sessions").update({
        state: "ejected", ejected_at: new Date().toISOString(),
        chargenow_status: "ejected", started_at: new Date().toISOString(),
      }).eq("id", session.id);
      return new Response(JSON.stringify({ ok: true, slotNum }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await db.from("rental_sessions").update({
      state: "eject_failed", failure_code: res.error,
      failure_message: "Éjection échouée après paiement — votre paiement est sécurisé, intervention en cours.",
    }).eq("id", session.id);
    return new Response(JSON.stringify({ ok: false, error: res.error }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
