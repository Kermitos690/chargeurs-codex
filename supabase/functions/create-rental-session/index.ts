// create-rental-session — starts a rental from the kiosk.
// SECURITY: the frontend sends ONLY stationId, shopId? and priceProfileId.
// The price is ALWAYS resolved server-side from public.price_profiles.
// Any amount sent by the client is ignored. No mock fallback.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";

function shortCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return `CHG-${s}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  try {
    const { stationId, priceProfileId, language } = await req.json();
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

    // ---- Resolve price SERVER-SIDE (never trust client amount) ----
    let profile: { id: string; amount: number; currency: string; name: string } | null = null;
    if (priceProfileId) {
      const { data } = await db.from("price_profiles")
        .select("id, amount, currency, name, active").eq("id", priceProfileId).maybeSingle();
      if (data && data.active !== false) profile = data as typeof profile;
    }
    if (!profile) {
      const { data } = await db.from("price_profiles")
        .select("id, amount, currency, name, active").eq("is_default", true).maybeSingle();
      if (data) profile = data as typeof profile;
    }

    const amount = Number(profile?.amount ?? station.price_per_period ?? 2.0);
    const currency = profile?.currency ?? station.currency ?? "CHF";
    const cabinetId = station.cabinet_id || station.station_id;

    const { data: session, error: insErr } = await db.from("rental_sessions").insert({
      station_id: stationId,
      cabinet_id: cabinetId,
      shop_id: station.shop_id ?? null,
      price_profile_id: profile?.id ?? null,
      state: "created",
      public_session_code: shortCode(),
      amount,
      amount_expected: amount,
      currency,
      customer_language: language ?? "fr",
    }).select().single();
    if (insErr || !session) throw insErr ?? new Error("INSERT_FAILED");

    // NOTE: the ChargeNow rent order is created AFTER confirmed payment
    // (in the Stripe webhook → eject-after-payment), never before.
    return new Response(JSON.stringify({ ok: true, session }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
