// cabinet-event-push — receiver for ChargeNow hardware events.
// Stores raw events and classifies severity. Online/offline events update the
// station directly. BATTERY_IN is never assigned heuristically: a complete
// trade/battery/station/slot identity is delegated to the canonical, inbox-
// backed ChargeNow rental callback and Rental Orchestrator.
//
// SECURITY: this endpoint MUTATES business state (station status, rental
// returns), so it is FAIL-CLOSED by default. Without CHARGENOW_EVENT_SECRET it
// rejects every request (503) unless ALLOW_UNSIGNED_CHARGENOW_EVENTS=true is
// explicitly set (dev only). With the secret set, the request must present a
// matching token (constant-time compare). Replay/oversize requests are dropped.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/db.ts";
import { buildChargeNowCallbackUrl } from "../_shared/chargenowCallbackAuth.ts";
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
export function unsignedAllowed(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): boolean {
  const allow = env("ALLOW_UNSIGNED_CHARGENOW_EVENTS") === "true";
  const mode = (env("ENVIRONMENT") ?? env("DENO_ENV") ?? "production").toLowerCase();
  const nonProd = mode === "development" || mode === "test" || mode === "local";
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

function mergedPayload(payload: EventPayload): Record<string, unknown> {
  const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : {};
  return { ...payload, ...nested };
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstInteger(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = source[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

async function returnIncident(
  db: SupabaseClient,
  code: string,
  details: Record<string, unknown>,
) {
  const { error } = await db.from("system_incidents").insert({
    type: "uncorrelated_battery_return",
    severity: "high",
    message: "Un événement BATTERY_IN n'a pas pu être corrélé de façon exacte; aucun état de location n'a été modifié.",
    data: { code, ...details },
    resolved: false,
  });
  if (error) throw error;
}

async function delegateBatteryReturn(
  db: SupabaseClient,
  payload: EventPayload,
  eventId: string | null,
  env: (key: string) => string | undefined,
  rawDuplicate: boolean,
): Promise<Response> {
  const merged = mergedPayload(payload);
  const stationId = firstString(merged, [
    "deviceId", "cabinetid", "cabinetId", "stationId", "cabinetSn",
    "givebackDeviceId", "returnDeviceId", "returnStationId",
  ]);
  const tradeNo = firstString(merged, ["tradeNo", "trade_no", "orderNo"]);
  const batteryId = firstString(merged, [
    "batteryId", "pBatteryid", "batterySN", "batterySn", "batteryCode", "sn", "bid",
  ]);
  const slotNum = firstInteger(merged, [
    "slotNum", "slot", "slotId", "position", "givebackSlot", "returnSlot",
  ]);

  if (!eventId || !stationId || !tradeNo || !batteryId || slotNum == null) {
    if (rawDuplicate) {
      return j({
        received: true,
        deduplicated: true,
        settlement_triggered: false,
        requires_reconciliation: true,
        reason: "RETURN_IDENTITY_INCOMPLETE",
      }, 200);
    }
    await returnIncident(db, "RETURN_IDENTITY_INCOMPLETE", {
      external_event_id: eventId,
      station_id: stationId,
      trade_no_fingerprint: tradeNo?.slice(-8) ?? null,
      battery_id: batteryId,
      slot_num: slotNum,
    });
    return j({
      received: true,
      settlement_triggered: false,
      requires_reconciliation: true,
      reason: "RETURN_IDENTITY_INCOMPLETE",
    }, 202);
  }

  // A return station can differ from the origin station. The immutable rent
  // order plus battery identity is the exact business correlation key.
  const { data: matches, error: matchError } = await db.from("rental_sessions")
    .select("id,apifox_trade_no,battery_id")
    .eq("apifox_trade_no", tradeNo)
    .eq("battery_id", batteryId)
    .limit(2);
  if (matchError) throw matchError;

  if (!matches || matches.length !== 1) {
    const code = matches && matches.length > 1 ? "RETURN_IDENTITY_AMBIGUOUS" : "RETURN_RENTAL_NOT_FOUND";
    await returnIncident(db, code, {
      external_event_id: eventId,
      station_id: stationId,
      trade_no_fingerprint: tradeNo.slice(-8),
      battery_id: batteryId,
      slot_num: slotNum,
      match_count: matches?.length ?? 0,
    });
    return j({
      received: true,
      settlement_triggered: false,
      requires_reconciliation: true,
      reason: code,
    }, 202);
  }

  const supabaseUrl = env("SUPABASE_URL") ?? "";
  if (!supabaseUrl) {
    await returnIncident(db, "SUPABASE_INTERNAL_CONFIG_MISSING", {
      external_event_id: eventId,
      rental_session_id: matches[0].id,
    });
    return j({ ok: false, error: "SUPABASE_INTERNAL_CONFIG_MISSING" }, 503);
  }

  const callbackUrl = await buildChargeNowCallbackUrl(supabaseUrl, String(matches[0].id));
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "2",
      tradeNo,
      eventId: `cabinet-event:${eventId}`,
      stationId,
      batteryId,
      slotNum,
    }),
  });
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    return j({ ok: false, error: "CANONICAL_RETURN_PIPELINE_FAILED" }, 502);
  }
  return j({
    received: true,
    delegated: true,
    duplicate: result?.duplicate === true,
    settlement_triggered: result?.settlement_triggered === true,
    settlement_ok: result?.settlement_ok === true,
  }, response.status);
}

// Core request handler — exported and dependency-injected so the full signed
// branch (secret gate, replay window, size cap, atomic dedup, state machine)
// can be exercised by the automated integration harness with a fake db and a
// temporary in-process secret. Production wires it to the real admin client.
export async function handleEvent(
  req: Request,
  db: SupabaseClient,
  env: (k: string) => string | undefined = (k) => Deno.env.get(k),
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expectedSecret = env("CHARGENOW_CALLBACK_SECRET") ?? env("CHARGENOW_EVENT_SECRET");
  const allowUnsigned = unsignedAllowed(env);

  // ---- Fail-closed auth gate ----
  if (!expectedSecret) {
    if (!allowUnsigned) {
      return j({ ok: false, error: "CONFIGURATION_ERROR", detail: "ChargeNow callback secret not configured" }, 503);
    }
    // else: explicit dev override in a non-production runtime — proceed unauthenticated.
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
    let payload: EventPayload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { return j({ ok: false, error: "INVALID_JSON" }, 400); }

    const flattened = mergedPayload(payload);
    const eventType = firstString(flattened, ["eventType", "type", "event"]) ?? "UNKNOWN";
    const stationId = firstString(flattened, ["deviceId", "cabinetid", "cabinetId", "stationId"]);

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
    const eventId = firstString(flattened, ["messageId", "eventId", "msgId", "id"]);

    const { error: insErr } = await db.from("cabinet_events").insert({
      station_id: stationId,
      event_type: eventType,
      severity: SEVERITY[eventType] ?? "info",
      payload,
      external_event_id: eventId,
    });
    const duplicate = (insErr as { code?: string } | null)?.code === "23505";
    if (insErr && !duplicate) {
      return j({ ok: false, error: "INSERT_FAILED", detail: insErr.message }, 500);
    }

    // The canonical return inbox owns retry/dedup state. Even when the raw
    // cabinet event already exists, delegate a complete BATTERY_IN again so a
    // previously failed canonical handler can be reclaimed safely.
    if (eventType === "BATTERY_IN") {
      return await delegateBatteryReturn(db, payload, eventId, env, duplicate);
    }
    if (duplicate) return j({ received: true, deduplicated: true }, 200);

    if (stationId) {
      if (eventType === "CABINET_ONLINE") {
        await db.from("stations").update({ online: true, status: "online" }).eq("station_id", stationId);
      } else if (eventType === "CABINET_OFFLINE") {
        await db.from("stations").update({ online: false, status: "offline" }).eq("station_id", stationId);
      }
    }

    return j({ received: true }, 200);
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handleEvent(req, adminClient()));
