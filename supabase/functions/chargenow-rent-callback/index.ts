// chargenow-rent-callback — trusted ChargeNow rent lifecycle receiver.
//
// status 0: rent/ejection failed
// status 1: battery successfully rented
// status 2: battery physically returned
//
// A return is matched only by the exact ChargeNow tradeNo. Ambiguous matches or
// a conflicting battery identifier are sent to support and never settled.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";

const MAX_BODY_BYTES = 64 * 1024;
const SETTLEMENT_ENABLED = (Deno.env.get("ENABLE_CANONICAL_SETTLEMENT_FLOW") ?? "false").toLowerCase() === "true";
const ACTIVE_TRANSITION_STATES = new Set([
  "checkout_created",
  "payment_succeeded",
  "ejected",
  "battery_taken",
  "active_rental",
]);

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function unsignedAllowed(env: (key: string) => string | undefined): boolean {
  const allow = env("ALLOW_UNSIGNED_CHARGENOW_EVENTS") === "true";
  const mode = (env("ENVIRONMENT") ?? env("DENO_ENV") ?? "production").toLowerCase();
  return allow && ["development", "test", "local"].includes(mode);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readBatteryId(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.batteryId,
    payload.battery_id,
    payload.batteryNo,
    payload.battery_no,
    payload.batterySn,
    payload.battery_sn,
  ];
  for (const value of candidates) {
    const candidate = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (/^[A-Za-z0-9:_-]{4,128}$/.test(candidate)) return candidate;
  }
  return null;
}

async function triggerSettlement(rentalSessionId: string, returnedAt: string): Promise<{
  ok: boolean;
  status: number;
  code: string | null;
}> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) return { ok: false, status: 0, code: "INTERNAL_SETTLEMENT_NOT_CONFIGURED" };

  const response = await fetch(`${supabaseUrl}/functions/v1/settle-rental-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({
      rentalSessionId,
      returnState: "normal",
      finalAt: returnedAt,
    }),
  });
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  return {
    ok: response.ok,
    status: response.status,
    code: typeof result?.error === "string" ? result.error : null,
  };
}

async function openReturnIncident(
  db: ReturnType<typeof adminClient>,
  code: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db.from("system_incidents").insert({
    type: "chargenow_return",
    severity: "high",
    message: "Le retour ChargeNow n'a pas pu être attribué avec certitude.",
    data: { code, ...details },
    resolved: false,
  }).then(() => {}, () => {});
  await auditLog(db, { action: "chargenow.return.incident", data: { code, ...details } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
  }

  const env = (key: string) => Deno.env.get(key);
  const expected = env("CHARGENOW_EVENT_SECRET");
  if (!expected) {
    if (!unsignedAllowed(env)) return json({ ok: false, error: "CONFIGURATION_ERROR" }, 503);
  } else {
    const url = new URL(req.url);
    const provided = req.headers.get("x-event-secret")
      ?? req.headers.get("x-chargenow-secret")
      ?? url.searchParams.get("secret")
      ?? "";
    if (!safeEqual(provided, expected)) return json({ ok: false, error: "INVALID_EVENT_SECRET" }, 401);
  }

  const db = adminClient();
  try {
    let status = "";
    let tradeNo = "";
    let payload: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      payload = Object.fromEntries(form.entries());
      status = String(form.get("status") ?? "").trim();
      tradeNo = String(form.get("tradeNo") ?? "").trim();
    } else {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
      }
      payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      status = String(payload.status ?? "").trim();
      tradeNo = String(payload.tradeNo ?? "").trim();
    }

    if (!["0", "1", "2"].includes(status)) {
      return json({ received: true, ignored: true, reason: "INVALID_STATUS" }, 200);
    }
    if (!/^[A-Za-z0-9:_-]{4,128}$/.test(tradeNo)) {
      return json({ received: true, ignored: true, reason: "INVALID_TRADE_NO" }, 200);
    }

    await logApi(db, {
      service: "chargenow",
      endpoint: "/rent/callback",
      method: "POST",
      status_code: 200,
      request: { status, tradeNoFingerprint: tradeNo.slice(-8) },
      response: null,
      error: null,
    });

    const { data: matches, error: lookupError } = await db.from("rental_sessions")
      .select("id,state,settlement_status,returned_at,battery_id,station_id,apifox_trade_no")
      .eq("apifox_trade_no", tradeNo)
      .order("created_at", { ascending: false })
      .limit(2);
    if (lookupError) throw lookupError;

    if (!matches?.length) {
      await auditLog(db, {
        action: "chargenow.callback.unmatched",
        data: { status, trade_no_fingerprint: tradeNo.slice(-8) },
      });
      return json({ received: true, unmatched: true }, 200);
    }
    if (matches.length > 1) {
      await openReturnIncident(db, "AMBIGUOUS_TRADE_NO", {
        trade_no_fingerprint: tradeNo.slice(-8),
        candidate_count: matches.length,
      });
      return json({ received: true, accepted_for_review: true }, 202);
    }

    const session = matches[0];
    const payloadBatteryId = readBatteryId(payload);
    const storedBatteryId = session.battery_id ? String(session.battery_id) : null;
    if (payloadBatteryId && storedBatteryId && payloadBatteryId !== storedBatteryId) {
      await db.from("rental_sessions").update({
        state: "needs_support",
        failure_code: "RETURN_BATTERY_MISMATCH",
        failure_message: "L'identifiant batterie du retour ne correspond pas à la location.",
      }).eq("id", session.id);
      await openReturnIncident(db, "RETURN_BATTERY_MISMATCH", {
        rental_session_id: session.id,
        station_id: session.station_id,
        expected_battery_id: storedBatteryId,
        observed_battery_id: payloadBatteryId,
      });
      return json({ received: true, accepted_for_review: true }, 202);
    }

    if (status === "1" && ACTIVE_TRANSITION_STATES.has(String(session.state))) {
      await db.from("rental_sessions").update({
        state: "active_rental",
        ...(payloadBatteryId && !storedBatteryId ? { battery_id: payloadBatteryId } : {}),
      }).eq("id", session.id)
        .in("state", ["ejected", "battery_taken", "payment_succeeded"]);
      await auditLog(db, { action: "chargenow.rental.active", target: session.id });
      return json({ received: true, state: "active_rental" }, 200);
    }

    if (status === "2") {
      const returnedAt = session.returned_at ?? new Date().toISOString();
      const returnPatch: Record<string, unknown> = {
        state: "battery_returned",
        returned_at: returnedAt,
      };
      if (payloadBatteryId && !storedBatteryId) returnPatch.battery_id = payloadBatteryId;

      if (ACTIVE_TRANSITION_STATES.has(String(session.state)) || session.state === "battery_returned") {
        await db.from("rental_sessions").update(returnPatch).eq("id", session.id);
      }

      if (session.settlement_status === "legacy") {
        await auditLog(db, {
          action: "chargenow.return.legacy",
          target: session.id,
          data: { trade_no_fingerprint: tradeNo.slice(-8) },
        });
        return json({ received: true, state: "battery_returned", settlement: "legacy_not_triggered" }, 200);
      }

      if (!SETTLEMENT_ENABLED) {
        await auditLog(db, {
          action: "settlement.deferred.disabled",
          target: session.id,
          data: { source: "chargenow_callback" },
        });
        return json({ received: true, state: "battery_returned", settlement: "deferred" }, 200);
      }

      const settlement = await triggerSettlement(session.id, returnedAt).catch(() => ({
        ok: false,
        status: 0,
        code: "SETTLEMENT_CALL_FAILED",
      }));

      await logApi(db, {
        service: "internal",
        endpoint: "settle-rental-payment",
        method: "POST",
        status_code: settlement.status,
        request: { rentalSessionId: session.id, source: "chargenow_return" },
        response: { code: settlement.code },
        error: settlement.ok ? null : "SETTLEMENT_NOT_COMPLETED",
      });

      if (!settlement.ok) {
        await auditLog(db, {
          action: "settlement.retry.required",
          target: session.id,
          data: { source: "chargenow_callback", status: settlement.status, code: settlement.code },
        });
      }

      return json({
        received: true,
        state: "battery_returned",
        settlement_triggered: true,
        settlement_ok: settlement.ok,
        settlement_code: settlement.code,
      }, 200);
    }

    if (status === "0" && ACTIVE_TRANSITION_STATES.has(String(session.state))) {
      await db.from("rental_sessions").update({
        state: "eject_failed",
        failure_code: "RENT_FAIL",
        failure_message: "ChargeNow a signalé un échec de location.",
      }).eq("id", session.id);
      await auditLog(db, { action: "chargenow.rental.failed", target: session.id });
      return json({ received: true, state: "eject_failed" }, 200);
    }

    return json({ received: true, ignored: true, reason: "NO_VALID_TRANSITION" }, 200);
  } catch (error) {
    await logApi(db, {
      service: "chargenow",
      endpoint: "/rent/callback:handle",
      method: "POST",
      status_code: 500,
      error: error instanceof Error ? error.message : "CALLBACK_INTERNAL_ERROR",
    }).catch(() => {});
    return json({ ok: false, error: "CALLBACK_INTERNAL_ERROR" }, 500);
  }
});
