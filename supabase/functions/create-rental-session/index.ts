// create-rental-session — starts a rental from the kiosk.
// SECURITY: the frontend sends ONLY stationId (+ optional kioskDeviceId, language).
// The price is ALWAYS resolved server-side by the authoritative SQL function
// public.compute_pricing(). Any amount sent by the client is ignored.
// The computed pricing is frozen as an immutable snapshot on the session.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, snapshotHash } from "../_shared/db.ts";

function shortCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return `CHG-${s}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { stationId, kioskDeviceId, language } = await req.json();
    if (!stationId) return json({ ok: false, error: "MISSING_STATION" }, 400);

    const { data: station } = await db.from("stations").select("*").eq("station_id", stationId).maybeSingle();
    if (!station) return json({ ok: false, error: "STATION_NOT_FOUND" }, 404);
    if (!station.online || station.rentable_count <= 0) {
      await auditLog(db, { action: "kiosk.rental.refused", target: stationId, data: { reason: "STATION_UNAVAILABLE" } });
      return json({ ok: false, error: "STATION_UNAVAILABLE" }, 409);
    }

    // ---- Authoritative server-side pricing (single source of truth) ----
    const { data: snapshot, error: priceErr } = await db.rpc("compute_pricing", {
      p_device: kioskDeviceId ?? null,
      p_station: stationId,
      p_shop: station.shop_id ?? null,
      p_start: new Date().toISOString(),
      p_end: null,
      p_rental_state: "created",
      p_return_state: "normal",
      p_currency: station.currency ?? null,
    });
    if (priceErr || !snapshot) {
      const code = String(priceErr?.message ?? "").includes("PRICING_NOT_CONFIGURED")
        ? "PRICING_NOT_CONFIGURED"
        : String(priceErr?.message ?? "").includes("CURRENCY_MISMATCH")
        ? "CURRENCY_MISMATCH"
        : "PRICING_ERROR";
      await auditLog(db, { action: "pricing.error", target: stationId, data: { code, detail: priceErr?.message ?? null } });
      return json({ ok: false, error: code }, 409);
    }

    const snap = snapshot as Record<string, unknown>;
    const finalCents = Number(snap.final_cents ?? 0);
    if (!Number.isFinite(finalCents) || finalCents <= 0) {
      await auditLog(db, { action: "pricing.error", target: stationId, data: { code: "INVALID_AMOUNT", finalCents } });
      return json({ ok: false, error: "PRICING_NOT_CONFIGURED" }, 409);
    }
    const amount = finalCents / 100;
    const currency = String(snap.currency ?? station.currency ?? "CHF");
    const hash = await snapshotHash(snap);
    const cabinetId = station.cabinet_id || station.station_id;

    const { data: session, error: insErr } = await db.from("rental_sessions").insert({
      station_id: stationId,
      cabinet_id: cabinetId,
      shop_id: station.shop_id ?? null,
      kiosk_device_id: kioskDeviceId ?? null,
      price_profile_id: snap.profile_id ?? null,
      price_profile_version: snap.profile_version ?? null,
      pricing_snapshot: snap,
      pricing_snapshot_hash: hash,
      state: "created",
      public_session_code: shortCode(),
      amount,
      amount_expected: amount,
      currency,
      customer_language: language ?? "fr",
    }).select().single();
    if (insErr || !session) throw insErr ?? new Error("INSERT_FAILED");

    await auditLog(db, {
      action: "kiosk.pricing.computed",
      target: session.id,
      data: {
        station_id: stationId, kiosk_device_id: kioskDeviceId ?? null,
        price_profile_id: snap.profile_id, price_profile_version: snap.profile_version,
        source: snap.source, final_cents: finalCents, currency, pricing_snapshot_hash: hash,
      },
    });

    // The ChargeNow rent order is created AFTER confirmed payment, never before.
    return json({ ok: true, session, snapshot: snap });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
