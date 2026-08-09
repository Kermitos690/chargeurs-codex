// ChargeNow rent lifecycle callback.
//
// Provider callbacks are evidence, never physical proof. A successful release
// callback is persisted and acknowledged, but only the read-only four-slot
// reconciler may confirm battery_released / rental_activated after observing
// exactly one expected physical slot transition.
//
// Status values used by the supplier contract:
//   0 = rent/release failed
//   1 = rent/release succeeded (provider evidence only)
//   2 = battery returned
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";
import { verifyChargeNowCallback } from "../_shared/chargenowCallbackAuth.ts";
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";

type DB = ReturnType<typeof adminClient>;
type Session = Record<string, any>;

type CallbackIdentity = {
  status: string;
  tradeNo: string;
  eventId: string | null;
  stationId: string | null;
  batteryId: string | null;
  slotNum: number | null;
};

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

function parsePayload(payload: Record<string, unknown>): CallbackIdentity {
  const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : {};
  const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
    ? payload.result as Record<string, unknown>
    : {};
  const merged = { ...payload, ...result, ...nested };
  return {
    status: firstString(merged, ["status", "rentStatus", "pStatus", "pstatus"]) ?? "",
    tradeNo: firstString(merged, ["tradeNo", "trade_no", "orderNo", "pOrderid", "pOrderId", "porderid"]) ?? "",
    eventId: firstString(merged, ["messageId", "eventId", "msgId", "id"]),
    stationId: firstString(merged, [
      "deviceId", "cabinetid", "cabinetId", "stationId", "cabinetSn",
      "pCabinetid", "pCabinetId", "pcabinetid",
      "givebackDeviceId", "returnDeviceId", "returnStationId",
    ]),
    // Do not accept generic `sn`: C7/C8 use it for module/slot serials and it
    // is not a trustworthy battery identity.
    batteryId: firstString(merged, [
      "batteryId", "pBatteryid", "pBatteryId", "pbatteryid",
      "batterySN", "batterySn", "batteryCode", "bid",
    ]),
    slotNum: firstInteger(merged, [
      "slotNum", "slot", "slotId", "position", "pKakou", "pkakou",
      "pSubKakou", "psubKakou", "givebackSlot", "returnSlot",
    ]),
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

function safePayload(identity: CallbackIdentity) {
  return {
    status: identity.status,
    tradeNo: identity.tradeNo,
    eventId: identity.eventId,
    stationId: identity.stationId,
    batteryId: identity.batteryId,
    slotNum: identity.slotNum,
  };
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
  const { error } = await db.from("system_incidents").insert({
    type: "chargenow_callback",
    severity: "high",
    message,
    data: { rental_session_id: session.id, station_id: session.station_id, code, ...details },
    resolved: false,
  });
  if (error) throw error;
  await auditLog(db, {
    action: "chargenow.callback.incident",
    target: String(session.id),
    data: { code, ...details },
  });
}

async function snapshotState(db: DB, rentalId: string): Promise<string | null> {
  const { data, error } = await db.from("rental_orchestrator_snapshots")
    .select("state").eq("rental_id", rentalId).maybeSingle();
  if (error) throw error;
  return typeof data?.state === "string" ? data.state : null;
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

async function persistAcceptedCallback(
  db: DB,
  identity: CallbackIdentity,
  idempotencyKey: string,
  processed: boolean,
) {
  const { error } = await db.from("chargenow_callbacks").upsert({
    trade_no: identity.tradeNo || null,
    station_id: identity.stationId,
    status: identity.status || null,
    idempotency_key: idempotencyKey,
    raw: safePayload(identity),
    processed,
  }, { onConflict: "idempotency_key" });
  if (error) throw error;
}

async function markCallbackProcessed(db: DB, idempotencyKey: string) {
  const { error } = await db.from("chargenow_callbacks")
    .update({ processed: true })
    .eq("idempotency_key", idempotencyKey);
  if (error) throw error;
}

async function triggerSettlement(rentalSessionId: string, returnedAt: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) {
    return { ok: false, status: 0, result: null, error: "SUPABASE_INTERNAL_CONFIG_MISSING" };
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/settle-rental-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ rentalSessionId, returnState: "normal", finalAt: returnedAt }),
  });
  const result = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    result,
    error: response.ok ? null : "SETTLEMENT_NOT_COMPLETED",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  let externalEventId = "";
  let callbackKey = "";
  let session: Session | null = null;

  try {
    const rawPayload = await parseRequest(req);
    const identity = parsePayload(rawPayload);
    const sanitizedPayload = safePayload(identity);

    // This is safe observability: no token/header/raw supplier secrets are stored.
    await logApi(db, {
      service: "chargenow",
      endpoint: "/rent/callback:received",
      method: "POST",
      status_code: 200,
      request: sanitizedPayload,
      response: null,
      error: null,
    });

    if (!identity.tradeNo) {
      await logApi(db, {
        service: "chargenow",
        endpoint: "/rent/callback:ignored",
        method: "POST",
        status_code: 202,
        request: sanitizedPayload,
        error: "TRADE_NO_MISSING",
      });
      return json({ received: true, ignored: true, reason: "TRADE_NO_MISSING" }, 202);
    }

    const { data, error: sessionError } = await db.from("rental_sessions")
      .select("*").eq("apifox_trade_no", identity.tradeNo)
      .order("created_at", { ascending: false }).limit(2);
    if (sessionError) throw sessionError;
    if (!data || data.length === 0) {
      await auditLog(db, {
        action: "chargenow.callback.unmatched",
        data: { status: identity.status, trade_no_fingerprint: identity.tradeNo.slice(-8) },
      });
      return json({ received: true, unmatched: true }, 202);
    }
    if (data.length !== 1) {
      return json({ received: true, ignored: true, reason: "AMBIGUOUS_TRADE_NO" }, 202);
    }
    session = data[0] as Session;

    if (!await verifyChargeNowCallback(req, String(session.id))) {
      await logApi(db, {
        service: "chargenow",
        endpoint: "/rent/callback:rejected",
        method: "POST",
        status_code: 401,
        request: sanitizedPayload,
        error: "INVALID_CALLBACK_AUTH",
      });
      await auditLog(db, {
        action: "chargenow.callback.auth_rejected",
        target: String(session.id),
        data: { trade_no_fingerprint: identity.tradeNo.slice(-8), status: identity.status },
      });
      return json({ ok: false, error: "INVALID_CALLBACK_AUTH" }, 401);
    }

    externalEventId = `rent-callback:${identity.tradeNo}:${identity.status}:${identity.eventId ?? identity.batteryId ?? identity.slotNum ?? "default"}`;
    callbackKey = externalEventId;
    const eventType = identity.status === "2" ? "return"
      : identity.status === "1" ? "release_success"
      : identity.status === "0" ? "release_failed"
      : "unknown";

    await persistAcceptedCallback(db, identity, callbackKey, false);
    const claim = await claimExternalEvent(db, session, externalEventId, eventType, sanitizedPayload);
    if (claim === "duplicate") {
      await markCallbackProcessed(db, callbackKey);
      return json({ received: true, duplicate: true });
    }
    if (claim === "in_progress") return json({ received: true, in_progress: true }, 202);
    if (claim !== "claimed") return json({ ok: false, error: "CALLBACK_NOT_CLAIMED" }, 500);

    if (identity.status === "1") {
      // Provider success is deliberately not allowed to activate the rental.
      // The four-slot physical reconciler owns that transition and DB policy
      // rejects battery_released/rental_activated without a single_release proof.
      await auditLog(db, {
        action: "chargenow.release.provider_evidence_received",
        target: String(session.id),
        data: {
          tradeNo: identity.tradeNo,
          stationId: identity.stationId,
          batteryId: identity.batteryId,
          slotNum: identity.slotNum,
          physical_reconciliation_required: true,
        },
      });
      await finishExternalEvent(db, externalEventId, true);
      await markCallbackProcessed(db, callbackKey);
      return json({
        received: true,
        state: session.state,
        provider_release_confirmed: true,
        physical_reconciliation_required: true,
      }, 202);
    }

    if (identity.status === "0") {
      const state = await snapshotState(db, String(session.id));
      if (!["release_requested", "authorized"].includes(String(state))) {
        await openIncident(
          db,
          session,
          "RELEASE_FAILURE_STATE_CONFLICT",
          "ChargeNow annonce un échec de sortie incompatible avec l'état local.",
          { tradeNo: identity.tradeNo, orchestratorState: state },
        );
        await finishExternalEvent(db, externalEventId, false, "RELEASE_FAILURE_STATE_CONFLICT");
        return json({ received: true, ignored: true, reason: "RELEASE_FAILURE_STATE_CONFLICT" }, 202);
      }

      const { error } = await db.from("rental_sessions").update({
        state: "eject_failed",
        chargenow_status: "release_failed",
        failure_code: "CHARGENOW_RENT_FAILED",
        failure_message: "ChargeNow a signalé un échec de location. Retry ou remboursement contrôlé requis.",
      }).eq("id", session.id);
      if (error) throw error;
      await openIncident(
        db,
        session,
        "CHARGENOW_RENT_FAILED",
        "ChargeNow a confirmé l'échec de la sortie. Aucun débit supplémentaire ni nouvelle éjection n'est automatique.",
        { tradeNo: identity.tradeNo, retryable: true },
      );
      await finishExternalEvent(db, externalEventId, true);
      await markCallbackProcessed(db, callbackKey);
      return json({ received: true, state: "eject_failed", operator_action_required: true });
    }

    if (identity.status === "2") {
      const expectedBattery = String(session.battery_id ?? "").trim();
      const orchestratorState = await snapshotState(db, String(session.id));
      if (orchestratorState !== "active") {
        await openIncident(
          db,
          session,
          "RETURN_STATE_CONFLICT",
          "ChargeNow annonce un retour alors que la sortie physique n'est pas confirmée active.",
          { tradeNo: identity.tradeNo, orchestratorState },
        );
        await finishExternalEvent(db, externalEventId, false, "RETURN_STATE_CONFLICT");
        return json({ received: true, settlement_triggered: false, reason: "RETURN_STATE_CONFLICT" }, 202);
      }
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
      await markCallbackProcessed(db, callbackKey);
      return json({
        received: true,
        state: "battery_returned",
        settlement_triggered: true,
        settlement_ok: settlement.ok,
      });
    }

    await finishExternalEvent(db, externalEventId, true);
    await markCallbackProcessed(db, callbackKey);
    return json({ received: true, ignored: true, reason: "UNKNOWN_STATUS" }, 202);
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
