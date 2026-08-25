// Return kiosk journeys with server-owned pricing and active membership offer.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

type Tier = { upper_minutes: number; total_cents: number };

function normalizedTiers(snapshot: Record<string, unknown>): Tier[] {
  if (!Array.isArray(snapshot.tiers)) return [];
  return snapshot.tiers
    .map((raw) => {
      const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return { upper_minutes: Number(row.upper_minutes), total_cents: Number(row.total_cents) };
    })
    .filter((row) => Number.isInteger(row.upper_minutes) && row.upper_minutes > 0 && Number.isInteger(row.total_cents) && row.total_cents > 0)
    .sort((a, b) => a.upper_minutes - b.upper_minutes);
}

function hourlyCents(snapshot: Record<string, unknown>): number | null {
  // Linear member tariffs keep an hourly projection. Tiered guest tariffs must
  // never be flattened into a misleading CHF/hour number.
  if (snapshot.tiered === true) return null;
  const cents = Number(snapshot.price_per_period_cents);
  const minutes = Number(snapshot.period_minutes);
  if (!Number.isFinite(cents) || !Number.isFinite(minutes) || cents < 0 || minutes <= 0) return null;
  return Math.round(cents * 60 / minutes);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } },
  );
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) return reply({ ok: false, error: "INVALID_STATION" }, 400);

    const db = adminClient();
    const kiosk = await verifyKioskDevice(req, db, stationId);
    if (!kiosk.ok) return reply({ ok: false, error: kiosk.error }, kiosk.status);

    const { data: station, error: stationError } = await db
      .from("stations")
      .select("station_id,currency,status")
      .eq("station_id", stationId)
      .maybeSingle();
    if (stationError) throw stationError;
    if (!station) return reply({ ok: false, error: "STATION_NOT_FOUND" }, 404);

    const now = new Date().toISOString();
    const quote = async (segment: "guest" | "member") => {
      const { data, error } = await db.rpc("compute_customer_pricing_snapshot", {
        p_station: stationId,
        p_segment: segment,
        p_start: now,
        p_end: null,
        p_rental_state: "quote",
        p_return_state: "normal",
        // The resolved pricing profile owns currency. Do not force a stale
        // station-level field into the pricing engine.
        p_currency: null,
      });
      if (error || !data) return null;
      const snapshot = data as Record<string, unknown>;
      const tiers = normalizedTiers(snapshot);
      return {
        segment,
        currency: String(snapshot.currency ?? station.currency ?? "CHF"),
        tiered: snapshot.tiered === true,
        tiers,
        starting_cents: Number(snapshot.final_cents ?? tiers[0]?.total_cents ?? 0),
        hourly_cents: hourlyCents(snapshot),
        period_minutes: Number(snapshot.period_minutes ?? 0),
        price_per_period_cents: Number(snapshot.price_per_period_cents ?? 0),
        min_amount_cents: Number(snapshot.min_amount_cents ?? 0),
        daily_cap_cents: Number(snapshot.daily_cap_cents ?? 0),
        total_cap_cents: Number(snapshot.total_cap_cents ?? 0),
        deposit_cents: Number(snapshot.deposit_cents ?? 0),
        unreturned_after_minutes: Number(snapshot.unreturned_after_minutes ?? 0),
        unreturned_fee_cents: Number(snapshot.unreturned_fee_cents ?? 0),
        profile_name: String(snapshot.profile_name ?? ""),
        pricing_rules_version: Number(snapshot.pricing_rules_version ?? 0),
      };
    };

    const [guest, member, planResult] = await Promise.all([
      quote("guest"),
      quote("member"),
      db.from("customer_membership_plans")
        .select("id,code,name,currency,annual_fee_cents,renewal_credit_cents,hourly_cents,daily_cap_cents,valid_from,valid_to")
        .eq("active", true)
        .lte("valid_from", now)
        .or(`valid_to.is.null,valid_to.gte.${now}`)
        .order("valid_from", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!guest) return reply({ ok: false, error: "GUEST_PRICING_NOT_CONFIGURED" }, 409);
    if (planResult.error) throw planResult.error;

    const p = planResult.data;
    const membershipPlan = p ? {
      id: p.id,
      code: p.code,
      name: p.name,
      currency: p.currency,
      annual_fee_cents: Number(p.annual_fee_cents ?? 0),
      renewal_credit_cents: Number(p.renewal_credit_cents ?? 0),
      hourly_cents: Number(p.hourly_cents ?? member?.hourly_cents ?? 0),
      daily_cap_cents: Number(p.daily_cap_cents ?? member?.daily_cap_cents ?? 0),
      valid_from: p.valid_from,
      valid_to: p.valid_to,
    } : null;

    return reply({ ok: true, guest, member, memberAvailable: Boolean(member), membershipPlan });
  } catch (error) {
    console.error("kiosk-customer-options", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "CUSTOMER_OPTIONS_FAILED" }, 500);
  }
});
