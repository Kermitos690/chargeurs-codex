// kiosk-resume-state — recover a recent kiosk transaction after WebView/app reboot.
//
// The browser is never authoritative for financial or hardware state. This
// endpoint is authenticated with the same station-bound kiosk device token as
// the rental flow and returns only the minimum UI projection needed to resume
// a RECENT customer transaction. It never mutates a rental and never calls
// Stripe or ChargeNow.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, verifyKioskDevice } from "../_shared/db.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};

const RECENT_WINDOW_MINUTES = 45;
const RECENT_SUCCESS_MINUTES = 8;
const RESUMABLE_STATES = new Set([
  "created",
  "payment_pending",
  "payment_succeeded",
  "ejecting",
  "needs_support",
  "ejected",
  "battery_taken",
]);

function validStationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,32}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
    },
  );

  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    if (!validStationId(stationId)) return json({ ok: false, error: "INVALID_STATION" }, 400);

    const db = adminClient();
    const auth = await verifyKioskDevice(req, db, stationId);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const cutoff = new Date(Date.now() - RECENT_WINDOW_MINUTES * 60_000).toISOString();
    const { data, error } = await db.from("rental_sessions")
      .select("id,public_session_code,state,state_version,selected_slot_num,failure_code,checkout_url,checkout_url_expires_at,expires_at,created_at,updated_at,ejected_at")
      .eq("station_id", stationId)
      .eq("kiosk_device_id", auth.device.id)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw error;

    const now = Date.now();
    const candidate = (data ?? []).find((row) => {
      const state = String(row.state ?? "");
      if (!RESUMABLE_STATES.has(state)) return false;

      // A release/success screen is useful only for the customer who is still
      // standing at the cabinet. Never resurrect an older active rental and
      // block the station for the next customer after a reboot.
      if (["ejected", "battery_taken"].includes(state)) {
        const eventAt = Date.parse(String(row.ejected_at ?? row.updated_at ?? row.created_at));
        return Number.isFinite(eventAt) && now - eventAt <= RECENT_SUCCESS_MINUTES * 60_000;
      }

      // Expired unpaid sessions are not resumed. Paid/ejection/support states
      // remain visible even if the original Checkout URL has expired.
      if (["created", "payment_pending"].includes(state)) {
        const sessionExpiry = Date.parse(String(row.expires_at ?? ""));
        if (Number.isFinite(sessionExpiry) && sessionExpiry <= now) return false;
      }
      return true;
    });

    if (!candidate) {
      return json({ ok: true, active: false, session: null });
    }

    const state = String(candidate.state ?? "");
    const checkoutExpiryMs = Date.parse(String(candidate.checkout_url_expires_at ?? ""));
    const checkoutUsable = ["created", "payment_pending"].includes(state)
      && typeof candidate.checkout_url === "string"
      && candidate.checkout_url.length > 0
      && (!Number.isFinite(checkoutExpiryMs) || checkoutExpiryMs > now);

    return json({
      ok: true,
      active: true,
      session: {
        id: candidate.id,
        publicCode: candidate.public_session_code,
        state,
        stateVersion: Number(candidate.state_version ?? 0),
        selectedSlotNum: candidate.selected_slot_num ?? null,
        failureCode: candidate.failure_code ?? null,
        checkoutUrl: checkoutUsable ? candidate.checkout_url : null,
        checkoutExpiresAt: checkoutUsable ? candidate.checkout_url_expires_at : null,
        expiresAt: candidate.expires_at ?? null,
      },
    });
  } catch (error) {
    console.error("kiosk-resume-state", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ ok: false, error: "RESUME_STATE_UNAVAILABLE" }, 503);
  }
});
