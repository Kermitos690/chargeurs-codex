// create-rental-session — starts a rental. Creates the DB session, optionally
// creates the ChargeNow rent order (stores tradeNo), then defers to Stripe
// checkout creation. No mock fallback: requires real configuration.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi } from "../_shared/db.ts";
import { isChargeNowConfigured, orderCreate } from "../_shared/chargenow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  try {
    const { stationId, language } = await req.json();
    if (!stationId) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_STATION" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: station } = await db.from("stations")
      .select("*").eq("station_id", stationId).maybeSingle();
    if (!station) {
      return new Response(JSON.stringify({ ok: false, error: "STATION_NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!station.online || station.rentable_count <= 0) {
      return new Response(JSON.stringify({ ok: false, error: "STATION_UNAVAILABLE" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const cabinetId = station.cabinet_id || station.station_id;

    // 1. Create rental session row
    const { data: session, error: insErr } = await db.from("rental_sessions").insert({
      station_id: stationId,
      cabinet_id: cabinetId,
      state: "created",
      amount: station.price_per_period ?? 2.0,
      currency: station.currency ?? "CHF",
      customer_language: language ?? "fr",
    }).select().single();
    if (insErr || !session) throw insErr ?? new Error("INSERT_FAILED");

    // 2. Optionally create ChargeNow rent order (best-effort; tradeNo stored)
    if (isChargeNowConfigured()) {
      const callbackURL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/chargenow-rent-callback`;
      const res = await orderCreate({ deviceId: cabinetId, callbackURL });
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/create", method: "POST",
        status_code: res.status, request: { cabinetId }, response: res.data, error: res.error,
      });
      const tradeNo = (res.data as any)?.data?.tradeNo ?? (res.data as any)?.tradeNo ?? null;
      await db.from("apifox_orders").insert({
        rental_session_id: session.id, trade_no: tradeNo,
        request: { cabinetId }, response: res.data, status: res.ok ? "created" : "error",
      });
      if (tradeNo) {
        await db.from("rental_sessions").update({
          apifox_trade_no: tradeNo, state: "apifox_order_created",
        }).eq("id", session.id);
        session.apifox_trade_no = tradeNo;
      }
    }

    return new Response(JSON.stringify({ ok: true, session }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
