// Return the two kiosk customer journeys with server-owned pricing.
// Blue = guest/express. Green = verified Chargeurs account.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

function hourlyCents(snapshot: Record<string, unknown>): number | null {
  const cents = Number(snapshot.price_per_period_cents);
  const minutes = Number(snapshot.period_minutes);
  if (!Number.isFinite(cents) || !Number.isFinite(minutes) || cents < 0 || minutes <= 0) return null;
  return Math.round((cents * 60) / minutes);
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

    const { data: station, error: stationError } = await db.from("stations")
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
        p_currency: station.currency ?? null,
      });
      if (error || !data) return null;
      const snapshot = data as Record<string, unknown>;
      return {
        segment,
        currency: String(snapshot.currency ?? station.currency ?? "CHF"),
        hourly_cents: hourlyCents(snapshot),
        period_minutes: Number(snapshot.period_minutes ?? 0),
        price_per_period_cents: Number(snapshot.price_per_period_cents ?? 0),
        daily_cap_cents: Number(snapshot.daily_cap_cents ?? 0),
        profile_name: String(snapshot.profile_name ?? ""),
      };
    };

    const [guest, member] = await Promise.all([quote("guest"), quote("member")]);
    if (!guest) return reply({ ok: false, error: "GUEST_PRICING_NOT_CONFIGURED" }, 409);

    return reply({
      ok: true,
      guest,
      member,
      memberAvailable: Boolean(member),
    });
  } catch (error) {
    console.error("kiosk-customer-options", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return reply({ ok: false, error: "CUSTOMER_OPTIONS_FAILED" }, 500);
  }
});
