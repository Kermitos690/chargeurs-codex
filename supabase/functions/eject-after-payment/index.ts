// eject-after-payment — releases a battery via ChargeNow ejectByRent.
// Called ONLY by stripe-webhook after confirmed payment, or by admin tools.
// Guards against double ejection for the same rental session.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi } from "../_shared/db.ts";
import { ejectByRent, isChargeNowConfigured } from "../_shared/chargenow.ts";

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

    // Must be paid; refuse otherwise (defence in depth).
    if (session.state !== "payment_succeeded" && session.state !== "ejecting") {
      return new Response(JSON.stringify({ ok: false, error: "NOT_PAID" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Prevent double ejection.
    if (["ejected", "battery_taken", "active_rental", "closed"].includes(session.state)) {
      return new Response(JSON.stringify({ ok: true, alreadyEjected: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await db.from("rental_sessions").update({ state: "ejecting" }).eq("id", session.id);

    if (!isChargeNowConfigured()) {
      await db.from("rental_sessions").update({
        state: "needs_support", error_code: "CHARGENOW_NOT_CONFIGURED",
        error_message: "API ChargeNow non configurée — éjection impossible.",
      }).eq("id", session.id);
      return new Response(JSON.stringify({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const cabinetId = session.cabinet_id || session.station_id;
    const slotNum = session.selected_slot_num ?? 0;
    const res = await ejectByRent(cabinetId, slotNum, session.apifox_trade_no ?? undefined);
    await logApi(db, {
      service: "chargenow", endpoint: "/cabinet/ejectByRent", method: "POST",
      status_code: res.status, request: { cabinetId, slotNum }, response: res.data, error: res.error,
    });

    if (res.ok) {
      await db.from("rental_sessions").update({
        state: "ejected", ejected_at: new Date().toISOString(),
      }).eq("id", session.id);
      return new Response(JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await db.from("rental_sessions").update({
      state: "eject_failed", error_code: res.error,
      error_message: "Éjection échouée après paiement — support requis.",
    }).eq("id", session.id);
    return new Response(JSON.stringify({ ok: false, error: res.error }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
