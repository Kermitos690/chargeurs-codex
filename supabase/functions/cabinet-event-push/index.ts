// cabinet-event-push — receiver for ChargeNow hardware events.
// Stores raw events, classifies severity, updates station state and closes
// rentals on battery return. Public endpoint (called by ChargeNow servers).
//
// SECURITY: this endpoint MUTATES business state (station status, rental
// returns), so it is FAIL-CLOSED by default. Without CHARGENOW_EVENT_SECRET it
// rejects every request (503) unless ALLOW_UNSIGNED_CHARGENOW_EVENTS=true is
// explicitly set (dev only). With the secret set, the request must present a
// matching token (constant-time compare). Replay/oversize requests are dropped.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";

const SEVERITY: Record<string, string> = {
  CABINET_ONLINE: "info",
  CABINET_OFFLINE: "warning",
  CABINET_STATUS: "info",
  BATTERY_IN: "info",
  BATTERY_BORROW_OUT: "info",
  BATTERY_ABNORMAL_WARNING: "error",
  BATTERY_POPUP: "info",
  POS_INFO_STATUS: "info",
};

const MAX_BODY_BYTES = 64 * 1024; // 64 KB cap on the inbound payload.
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // accept events at most 5 min old/future.

// Tolerant typed view of an inbound ChargeNow hardware event payload.
export interface EventPayload {
  eventType?: string; type?: string; event?: string;
  deviceId?: string; cabinetid?: string; cabinetId?: string; stationId?: string;
  timestamp?: string | number; ts?: string | number; eventTime?: string | number; time?: string | number;
  messageId?: string | number; eventId?: string | number; msgId?: string | number; id?: string | number;
  [k: string]: unknown;
}

// Production safety: the unsigned dev override is ONLY honored when the runtime
// is EXPLICITLY marked as a non-production environment. If ENVIRONMENT is unset
// or anything other than development/test/local, we treat the runtime as
// production and the unsigned override has NO effect (fail-closed by default).
export function unsignedAllowed(): boolean {
  const allow = Deno.env.get("ALLOW_UNSIGNED_CHARGENOW_EVENTS") === "true";
  const env = (Deno.env.get("ENVIRONMENT") ?? Deno.env.get("DENO_ENV") ?? "production").toLowerCase();
  const nonProd = env === "development" || env === "test" || env === "local";
  return allow && nonProd;
}

// Constant-time string comparison (avoids timing side-channels).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function j(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();

  const expectedSecret = Deno.env.get("CHARGENOW_EVENT_SECRET");
  const allowUnsigned = Deno.env.get("ALLOW_UNSIGNED_CHARGENOW_EVENTS") === "true";

  // ---- Fail-closed auth gate ----
  if (!expectedSecret) {
    if (!allowUnsigned) {
      // No secret AND unsigned mode not explicitly enabled → refuse everything.
      return j({ ok: false, error: "CONFIGURATION_ERROR", detail: "CHARGENOW_EVENT_SECRET not configured" }, 503);
    }
    // else: explicit dev override — proceed unauthenticated.
  } else {
    const url = new URL(req.url);
    const provided = req.headers.get("x-event-secret")
      ?? req.headers.get("x-chargenow-secret")
      ?? url.searchParams.get("secret")
      ?? "";
    if (!safeEqual(provided, expectedSecret)) {
      return j({ ok: false, error: "INVALID_EVENT_SECRET" }, 401);
    }
  }

  try {
    // ---- Size guard ----
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return j({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    let payload: Record<string, any> = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { return j({ ok: false, error: "INVALID_JSON" }, 400); }

    const eventType: string = payload.eventType ?? payload.type ?? payload.event ?? "UNKNOWN";
    const stationId: string | null =
      payload.deviceId ?? payload.cabinetid ?? payload.cabinetId ?? payload.stationId ?? null;

    // ---- Replay window (only enforced when a timestamp is present) ----
    const tsRaw = payload.timestamp ?? payload.ts ?? payload.eventTime ?? payload.time ?? null;
    if (tsRaw != null) {
      const tsMs = typeof tsRaw === "number"
        ? (tsRaw < 1e12 ? tsRaw * 1000 : tsRaw) // seconds vs ms
        : Date.parse(String(tsRaw));
      if (!Number.isNaN(tsMs) && Math.abs(Date.now() - tsMs) > REPLAY_WINDOW_MS) {
        return j({ ok: false, error: "STALE_EVENT" }, 408);
      }
    }

    // ---- Atomic idempotency via a UNIQUE DB constraint ----
    // We rely on the partial UNIQUE index cabinet_events_external_event_id_uniq.
    // Two simultaneous duplicate callbacks race on the INSERT; exactly one wins,
    // the other gets a unique-violation (23505) and is treated as a no-op.
    const idKey = ["messageId", "eventId", "msgId", "id"].find((k) => payload[k] != null) ?? null;
    const eventId = idKey ? String(payload[idKey]) : null;

    const { error: insErr } = await db.from("cabinet_events").insert({
      station_id: stationId,
      event_type: eventType,
      severity: SEVERITY[eventType] ?? "info",
      payload,
      external_event_id: eventId,
    });
    if (insErr) {
      // 23505 = unique_violation → duplicate event already processed.
      if ((insErr as { code?: string }).code === "23505") {
        return j({ received: true, deduplicated: true }, 200);
      }
      return j({ ok: false, error: "INSERT_FAILED", detail: insErr.message }, 500);
    }

    if (stationId) {
      if (eventType === "CABINET_ONLINE") {
        await db.from("stations").update({ online: true, status: "online" }).eq("station_id", stationId);
      } else if (eventType === "CABINET_OFFLINE") {
        await db.from("stations").update({ online: false, status: "offline" }).eq("station_id", stationId);
      } else if (eventType === "BATTERY_IN") {
        // Battery physically returned — advance the most recent active rental.
        // Idempotent: the state filter prevents re-processing already-returned
        // or terminal sessions (closed/refunded/manual_review/needs_support).
        const { data: active } = await db.from("rental_sessions")
          .select("id").eq("station_id", stationId)
          .in("state", ["active_rental", "battery_taken", "ejected"])
          .order("created_at", { ascending: false }).limit(1);
        if (active && active[0]) {
          await db.from("rental_sessions").update({
            state: "battery_returned", returned_at: new Date().toISOString(),
          }).eq("id", active[0].id);
        }
      }
    }

    return j({ received: true }, 200);
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
});
