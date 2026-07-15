// ChargeNow rent lifecycle callback.
//
// Status values:
//   0 = rent/release failed
//   1 = rent/release succeeded
//   2 = battery returned
//
// Returns are accepted only when trade number, battery, destination station and
// destination slot are sufficiently correlated. A callback never assigns the
// return to the latest rental merely because it came from the same station.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";
import { verifyChargeNowCallback } from "../_shared/chargenowCallbackAuth.ts";
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";

type DB = ReturnType<typeof adminClient>;
type Session = Record<string, any>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

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
    const value = source[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function parsePayload(payload: Record<string, unknown>) {
  const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : {};
  const merged = { ...payload, ...nested };
  return {
    status: firstString(merged, ["status", "rentStatus"]) ?? "",
    tradeNo: firstString(merged, ["tradeNo", "trade_no", "orderNo"]) ?? "",
    eventId: firstString(merged, ["messageId", "eventId", "msgId", "id"]),
    stationId: firstString(merged, ["deviceId", "cabinetid", "cabinetId", "stationId", "cabinetSn"]),
    batteryId: firstString(merged, ["batteryId", "batterySN", "batterySn", "batteryCode", "sn", "bid"]),
    slotNum: firstInteger(merged, ["slotNum", "slot", "slotId", "position"]),
  };
}

async function parseRequest(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    return Object.fromEntries(form.entries());
  }
  return await req.json().catch(() => ({}));
}

function safeCode(error: unknown): string {
  if (error instanceof OrchestratorError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return error.message.slice(0, 120);
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

async function openIncident(
  db: DB,
  session: Session,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  await db.from("system_incidents").insert({
    type: "chargenow_callback",
    severity: "high",
    message,
    data: {
      rental_session_id: session.id,
      station_id: session.station_id,
      code,
      ...details,
    },
    resolved: false,
  });
  await auditLog(db, {
    action: "chargenow.callback.incident",
    target: String(session.id),
    data: { code, ...details },
  });
}

async function claimExternalEvent(
  db: DB,
  session: Session,
  externalEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await db.rpc("claim_rental_external_event", {
    p_source: "chargenow",
    p_external_event_id: externalEventId,
    p_rental_id: session.id,
    p_event_type: eventType,
    p_payload: payload,
    p_lock_ttl_minutes: 10,
  });
  if (error) throw error;
  return String(data ?? "");
}

async function finishExternalEvent(
  db: DB,
  externalEventId: string,
  succeeded: boolean,
  errorCode?: string,
) {
  const { error } = await db.rpc("finish_rental_external_event", {
    p_source: "chargenow",
    p_external_event_id: externalEventId,
    p_succeeded: succeeded,
    p_error_code: errorCode ?? null,
  });
  if (error) throw error;
}

async function triggerSettlement(rentalSessionId: string, returnedAt: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) return { ok: false, status: 0, error: "SUPABASE_INTERNAL_CONFIG_MISSING" };

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
  const result = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, result, error: response.ok ? null : "SETTLEMENT_NOT_COMPLETED" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  let externalEventId = "";
  let session: Session | null = null;

  try {
    const rawPayload = await parseRequest(req);
    const identity = parsePayload(rawPayload);
    if (!identity.tradeNo) return json({ received: true, ignored: true, reason: "TRADE_NO_MISSING" });

    const { data, error: sessionError } = await db.from("rental_sessions")
      .select("*")
      .eq("apifox_trade_no", identity.tradeNo)
      .order("created_at", { ascending: false })
      .limit(2);
    if (sessionError) throw sessionError;
    if (!data || data.length === 0) {
      await auditLog(db, {
        action: "chargenow.callback.unmatched",
        data: { status: identity.status, trade_no_fingerprint: identity.tradeNo.slice(-8) },
      });
      return json({ received: true, unmatched: true });
    }
    if (data.length !== 1) {
      return json({ received: true, ignored: true, reason: "AMBIGUOUS_TRADE_NO" }, 202);
    }
    session = data[0] as Session;

    if (!await verifyChargeNowCallback(req, String(session.id))) {
      return json({ ok: false, error: "INVALID_CALLBACK_AUTH" }, 401);
    }

    externalEventId = `rent-callback:${identity.tradeNo}:${identity.status}:${identity.eventId ?? identity.batteryId ?? identity.slotNum ?? "default"}`;
    const eventType = identity.status === "2"
      ? "return"
      : identity.status === "1"
        ? "release_success"
        : identity.status === "0"
          ? "release_failed"
          : "unknown";

    const sanitizedPayload = {
      status: identity.status,
      tradeNo: identity.tradeNo,
      eventId: identity.eventId,
      stationId: identity.stationId,
      batteryId: identity.batteryId,
      slotNum: identity.slotNum,
    };
    const claim = await claimExternalEvent(db, session, externalEventId, eventType, sanitizedPayload);
    if (claim === "duplicate") return json({ received: true, duplicate: true });
    if (claim === "in_progress") return json({ received: true, in_progress: true }, 202);
    if (claim !== "claimed") return json({ ok: false, error: "CALLBACK_NOT_CLAIMED" }, 500);

    await logApi(db, {
      service: "chargenow",
      endpoint: "/rent/callback",
      method: "POST",
      status_code: 200,
      request: sanitizedPayload,
      response: null,
      error: null,
    });

    if (identity.status === "1") {
      const { data: snapshot, error: snapshotError } = await db.from("rental_orchestrator_snapshots")
        .select("state")
        .eq("rental_id", session.id)
        .maybeSingle();
      if (snapshotError) throw snapshotError;
      if (snapshot?.state === "released") {
        await appendRentalEvent(db, {
          rentalId: String(session.id),
          eventType: "rental_activated",
          idempotencyKey: `rental_activated:callback:${identity.tradeNo}`,
          paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
          stationId: String(session.station_id ?? "") || null,
          batteryId: String(session.battery_id ?? "") || null,
          metadata: { tradeNo: identity.tradeNo, source: "chargenow_callback" },
        });
      }
      await db.from("rental_sessions").update({ state: "active_rental" })
        .eq("id", session.id)
        .in("state", ["ejected", "battery_taken"]);
      await auditLog(db, { action: "chargenow.rental.active", target: session.id });
      await finishExternalEvent(db, externalEventId, true);
      return json({ received: true, state: "active_rental" });
    }

    if (identity.status === "0") {
      const { data: snapshot, error: snapshotError } = await db.from("rental_orchestrator_snapshots")
        .select("state")
        .eq("rental_id", session.id)
        .maybeSingle();
      if (snapshotError) throw snapshotError;
      if (snapshot?.state === "release_requested") {
        await appendRentalEvent(db, {
          rentalId: String(session.id),
          eventType: "rental_failed",
          idempotencyKey: `release_failed:callback:${identity.tradeNo}`,
          paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
          stationId: String(session.station_id ?? "") || null,
          failureReason: "CHARGENOW_RENT_FAILED",
          metadata: { tradeNo: identity.tradeNo },
        });
      }
      await db.from("rental_sessions").update({
        state: "needs_support",
        failure_code: "CHARGENOW_RENT_FAILED",
        failure_message: "ChargeNow a signalé un échec de location.",
      }).eq("id", session.id);
      await openIncident(
        db,
        session,
        "CHARGENOW_RENT_FAILED",
        "ChargeNow a signalé un échec après création de la commande. Vérifier le matériel et la compensation financière.",
        { tradeNo: identity.tradeNo },
      );
      await finishExternalEvent(db, externalEventId, true);
      return json({ received: true, state: "needs_support" });
    }

    if (identity.status === "2") {
      const expectedBattery = String(session.battery_id ?? "").trim();
      if (!identity.batteryId || !identity.stationId || identity.slotNum == null) {
        await openIncident(
          db,
          session,
          "RETURN_IDENTITY_INCOMPLETE",
          "Le retour annoncé par ChargeNow ne contient pas la batterie, la borne et le slot nécessaires à une corrélation exacte.",
          sanitizedPayload,
        );
        await finishExternalEvent(db, externalEventId, false, "RETURN_IDENTITY_INCOMPLETE");
        return json({ received: true, settlement_triggered: false, reason: "RETURN_IDENTITY_INCOMPLETE" }, 202);
      }
      if (!expectedBattery || expectedBattery !== identity.batteryId) {
        await openIncident(
          db,
          session,
          "RETURN_BATTERY_MISMATCH",
          "L'identifiant de la batterie retournée ne correspond pas à la batterie délivrée.",
          { expectedBattery, observedBattery: identity.batteryId, tradeNo: identity.tradeNo },
        );
        await finishExternalEvent(db, externalEventId, false, "RETURN_BATTERY_MISMATCH");
        return json({ received: true, settlement_triggered: false, reason: "RETURN_BATTERY_MISMATCH" }, 202);
      }

      const returnedAt = session.returned_at ?? new Date().toISOString();
      await appendRentalEvent(db, {
        rentalId: String(session.id),
        eventType: "return_detected",
        idempotencyKey: `return_detected:${identity.tradeNo}:${identity.batteryId}:${identity.stationId}:${identity.slotNum}`,
        paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
        stationId: identity.stationId,
        batteryId: identity.batteryId,
        occurredAt: returnedAt,
        metadata: {
          tradeNo: identity.tradeNo,
          returnStationId: identity.stationId,
          returnedSlotNum: identity.slotNum,
          externalEventId,
        },
      });

      const { error: returnUpdateError } = await db.from("rental_sessions").update({
        state: "battery_returned",
        returned_at: returnedAt,
        return_station_id: identity.stationId,
        returned_slot_num: identity.slotNum,
        return_external_event_id: externalEventId,
      }).eq("id", session.id);
      if (returnUpdateError) throw returnUpdateError;

      const settlement = await triggerSettlement(String(session.id), returnedAt);
      await logApi(db, {
        service: "internal",
        endpoint: "settle-rental-payment",
        method: "POST",
        status_code: settlement.status,
        request: { rentalSessionId: session.id, source: "chargenow_return" },
        response: settlement.ok ? { ok: true } : { ok: false },
        error: settlement.error,
      });
      if (!settlement.ok) {
        await openIncident(
          db,
          session,
          "SETTLEMENT_RETRY_REQUIRED",
          "Le retour est corrélé mais le règlement financier doit être rejoué.",
          { settlementStatus: settlement.status, externalEventId },
        );
      }

      await finishExternalEvent(db, externalEventId, true);
      return json({
        received: true,
        state: "battery_returned",
        settlement_triggered: true,
        settlement_ok: settlement.ok,
      });
    }

    await finishExternalEvent(db, externalEventId, true);
    return json({ received: true, ignored: true, reason: "UNKNOWN_STATUS" });
  } catch (error) {
    const code = safeCode(error);
    if (externalEventId) {
      await finishExternalEvent(db, externalEventId, false, code).catch(() => {});
    }
    await logApi(db, {
      service: "chargenow",
      endpoint: "/rent/callback:handle",
      method: "POST",
      status_code: 500,
      error: code,
      response: session ? { rental_id: session.id } : null,
    }).catch(() => {});
    return json({ ok: false, error: "CALLBACK_INTERNAL_ERROR" }, 500);
  }
});
