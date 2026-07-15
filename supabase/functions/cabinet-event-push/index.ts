// ChargeNow hardware event receiver. Stores events, updates station state and
// queues a return settlement only when the rental can be correlated safely.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";
import { markReturnAndEnqueue } from "../_shared/returnSettlement.ts";
import { parseReturnIdentity } from "../_shared/returnCorrelation.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

const MAX_BODY_BYTES = 64 * 1024;
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export interface EventPayload {
  eventType?: string; type?: string; event?: string;
  deviceId?: string; cabinetid?: string; cabinetId?: string; stationId?: string;
  timestamp?: string | number; ts?: string | number; eventTime?: string | number; time?: string | number;
  messageId?: string | number; eventId?: string | number; msgId?: string | number; id?: string | number;
  [key: string]: unknown;
}

export function unsignedAllowed(env: (key: string) => string | undefined = (key) => Deno.env.get(key)): boolean {
  const allow = env("ALLOW_UNSIGNED_CHARGENOW_EVENTS") === "true";
  const mode = (env("ENVIRONMENT") ?? env("DENO_ENV") ?? "production").toLowerCase();
  return allow && ["development", "test", "local"].includes(mode);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function j(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallbackEventId(eventType: string, identity: ReturnType<typeof parseReturnIdentity>, timestamp: unknown): string {
  return [eventType, identity.stationId ?? "unknown", identity.batteryId ?? "unknown", identity.slotNum ?? "unknown", String(timestamp ?? "none")].join(":");
}

export async function handleEvent(
  req: Request,
  db: SupabaseClient,
  env: (key: string) => string | undefined = (key) => Deno.env.get(key),
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expectedSecret = env("CHARGENOW_EVENT_SECRET");
  if (!expectedSecret) {
    if (!unsignedAllowed(env)) {
      return j({ ok: false, error: "CONFIGURATION_ERROR", detail: "CHARGENOW_EVENT_SECRET not configured" }, 503);
    }
  } else {
    const url = new URL(req.url);
    const provided = req.headers.get("x-event-secret")
      ?? req.headers.get("x-chargenow-secret")
      ?? url.searchParams.get("secret")
      ?? "";
    if (!safeEqual(provided, expectedSecret)) return j({ ok: false, error: "INVALID_EVENT_SECRET" }, 401);
  }

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return j({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    let payload: EventPayload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return j({ ok: false, error: "INVALID_JSON" }, 400);
    }

    const eventType = payload.eventType ?? payload.type ?? payload.event ?? "UNKNOWN";
    const identity = parseReturnIdentity(payload);
    const stationId = identity.stationId;
    const timestamp = payload.timestamp ?? payload.ts ?? payload.eventTime ?? payload.time ?? null;
    if (timestamp != null) {
      const parsed = typeof timestamp === "number"
        ? (timestamp < 1e12 ? timestamp * 1000 : timestamp)
        : Date.parse(String(timestamp));
      if (!Number.isNaN(parsed) && Math.abs(Date.now() - parsed) > REPLAY_WINDOW_MS) {
        return j({ ok: false, error: "STALE_EVENT" }, 408);
      }
    }

    const externalEventId = identity.eventId ?? fallbackEventId(eventType, identity, timestamp);
    const { error: insertError } = await db.from("cabinet_events").insert({
      station_id: stationId,
      event_type: eventType,
      severity: SEVERITY[eventType] ?? "info",
      payload,
      external_event_id: externalEventId,
    });
    if (insertError) {
      if ((insertError as { code?: string }).code === "23505") return j({ received: true, deduplicated: true }, 200);
      return j({ ok: false, error: "INSERT_FAILED", detail: insertError.message }, 500);
    }

    if (stationId && eventType === "CABINET_ONLINE") {
      await db.from("stations").update({ online: true, status: "online" }).eq("station_id", stationId);
    } else if (stationId && eventType === "CABINET_OFFLINE") {
      await db.from("stations").update({ online: false, status: "offline" }).eq("station_id", stationId);
    } else if (eventType === "BATTERY_IN") {
      const result = await markReturnAndEnqueue(db, {
        source: "cabinet_event",
        payload,
        externalEventId,
      });
      return j({ received: true, return: result }, result.ok ? 200 : 202);
    }

    return j({ received: true }, 200);
  } catch (error) {
    return j({ ok: false, error: String(error) }, 500);
  }
}

Deno.serve((req) => handleEvent(req, adminClient()));
