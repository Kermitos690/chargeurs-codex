// Privileged rental operations:
//   retry_chargenow | reconcile | retry_settlement | declare_non_return |
//   refund | manual_review
//
// operator+: retry/reconcile/manual review
// super_admin: full refund and explicit non-return declaration
//
// No automatic non-return deadline is invented. A 99 CHF non-return settlement
// starts only after an explicit, audited super-admin decision.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";
import { appendRentalEvent, OrchestratorError } from "../_shared/rentalOrchestratorRuntime.ts";
import { refundPaymentIntentBalance } from "../_shared/stripeRefundRuntime.ts";
import { validateStripeTestRuntime } from "../_shared/stripeRuntimeConfig.ts";
import { stagingAuthorizationReleaseAllowed } from "../_shared/checkoutCancellation.ts";

type DB = ReturnType<typeof adminClient>;
type Session = Record<string, any>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function safeCode(error: unknown): string {
  if (error instanceof OrchestratorError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return error.message.slice(0, 120);
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

async function rolesOf(req: Request, db: DB): Promise<{ uid: string | null; roles: string[] }> {
  const auth = req.headers.get("Authorization");
  if (!auth) return { uid: null, roles: [] };
  const { data: { user } } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return { uid: null, roles: [] };
  const { data, error } = await db.from("user_roles").select("role").eq("user_id", user.id);
  if (error) throw error;
  return { uid: user.id, roles: (data ?? []).map((row: { role: string }) => row.role) };
}

async function callInternalFunction(
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; result: unknown }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) {
    return { ok: false, status: 503, result: { error: "SUPABASE_INTERNAL_CONFIG_MISSING" } };
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({ error: `HTTP_${response.status}` }));
  return { ok: response.ok, status: response.status, result };
}

async function callSettlement(
  rentalSessionId: string,
  returnState: "normal" | "not_returned",
  finalAt: string,
) {
  return callInternalFunction("settle-rental-payment", { rentalSessionId, returnState, finalAt });
}

function parsedTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
    const value = source[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function parseReturnEvidence(payload: unknown) {
  const root = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const nested = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown> : {};
  const order = nested.order && typeof nested.order === "object" && !Array.isArray(nested.order)
    ? nested.order as Record<string, unknown> : {};
  const merged = { ...root, ...nested, ...order };
  return {
    returnedAt: parsedTimestamp(
      merged.pGivebackTime ?? merged.givebackTime ?? merged.returnTime ?? merged.pReturnTime,
    ),
    returnStationId: firstString(merged, [
      "pGivebackDeviceid", "givebackDeviceId", "returnDeviceId", "returnCabinetId",
      "returnStationId", "deviceId", "cabinetId",
    ]),
    batteryId: firstString(merged, [
      "batteryId", "pBatteryid", "batterySN", "batterySn", "batteryCode", "sn", "bid",
    ]),
    slotNum: firstInteger(merged, [
      "pGivebackSlotid", "pGivebackSlot", "givebackSlotId", "givebackSlot",
      "returnSlot", "slotNum", "slotId", "position",
    ]),
  };
}

async function orchestratorState(db: DB, rentalId: string): Promise<string | null> {
  const { data, error } = await db.from("rental_orchestrator_snapshots")
    .select("state").eq("rental_id", rentalId).maybeSingle();
  if (error) throw error;
  return typeof data?.state === "string" ? data.state : null;
}

async function openIncident(
  db: DB,
  session: Session,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await db.from("system_incidents").insert({
    type: "rental_admin_action",
    severity: "high",
    message,
    data: { rental_session_id: session.id, station_id: session.station_id, code, ...details },
    resolved: false,
  });
  if (error) throw error;
  await auditLog(db, {
    action: "rental.admin.incident",
    target: String(session.id),
    data: { code, ...details },
  });
}

async function applyReconciledReturn(
  db: DB,
  session: Session,
  input: { uid: string; returnedAt: string; returnStationId: string; batteryId: string; slotNum: number },
) {
  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType: "return_detected",
    idempotencyKey: `return_detected:admin_reconcile:${session.apifox_trade_no}:${input.batteryId}:${input.returnStationId}:${input.slotNum}`,
    paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
    stationId: input.returnStationId,
    batteryId: input.batteryId,
    occurredAt: input.returnedAt,
    metadata: {
      source: "admin_reconcile", actor: input.uid, tradeNo: session.apifox_trade_no,
      returnStationId: input.returnStationId, returnedSlotNum: input.slotNum,
    },
  });
  const { error } = await db.from("rental_sessions").update({
    state: "battery_returned",
    chargenow_status: "returned",
    returned_at: session.returned_at ?? input.returnedAt,
    return_station_id: input.returnStationId,
    returned_slot_num: input.slotNum,
  }).eq("id", session.id);
  if (error) throw error;
}

async function appendAdministrativeRefund(
  db: DB,
  session: Session,
  uid: string,
  refundedCents: number,
  providerIds: string[],
) {
  const state = await orchestratorState(db, String(session.id));
  if (!state) throw new OrchestratorError("ORCHESTRATOR_SNAPSHOT_MISSING");
  if (state === "completed") {
    await auditLog(db, {
      actor: uid,
      action: "rental.post_completion_refund",
      target: String(session.id),
      data: { refunded_cents: refundedCents, provider_ids: providerIds },
    });
    return;
  }
  if (state === "refunded") return;
  if (!["authorized", "release_requested", "pricing_finalized", "payment_captured"].includes(state)) {
    throw new OrchestratorError("ADMIN_REFUND_STATE_NOT_ALLOWED", `Refund refused from ${state}`);
  }
  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType: "payment_refunded",
    idempotencyKey: `payment_refunded:admin:${session.id}:${refundedCents}`,
    paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
    stationId: String(session.station_id ?? "") || null,
    batteryId: String(session.battery_id ?? "") || null,
    finalAmountChf: Number(session.final_amount_cents ?? 0) / 100,
    metadata: { actor: uid, refundedCents, providerIds },
  });
  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType: "rental_completed",
    idempotencyKey: `rental_completed:admin_refund:${session.id}`,
    paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
    stationId: String(session.station_id ?? "") || null,
    batteryId: String(session.battery_id ?? "") || null,
    finalAmountChf: 0,
    metadata: { actor: uid, reason: "admin_full_refund" },
  });
}

/**
 * A legacy Checkout row can be missing its PaymentIntent linkage even though
 * Stripe has created a TEST manual-capture authorization.  A prepared release
 * reservation is not physical evidence by itself, but every other result is.
 */
async function assertNoPhysicalReleaseEvidence(db: DB, rentalSessionId: string) {
  const { data: attempts, error } = await db.from("hardware_release_attempts")
    .select("id,result,command_sent_at,reconciled_at,released_slot_nums,released_battery_ids")
    .eq("rental_session_id", rentalSessionId);
  if (error) throw error;

  for (const attempt of attempts ?? []) {
    const releasedSlots = Array.isArray(attempt.released_slot_nums) ? attempt.released_slot_nums : [];
    const releasedBatteries = Array.isArray(attempt.released_battery_ids) ? attempt.released_battery_ids : [];
    if (
      attempt.result !== "prepared" || attempt.command_sent_at || attempt.reconciled_at ||
      releasedSlots.length > 0 || releasedBatteries.length > 0
    ) {
      throw new OrchestratorError("PHYSICAL_RELEASE_EVIDENCE_PRESENT");
    }
  }
}

async function cancelVerifiedUnlinkedTestAuthorization(
  db: DB,
  stripe: Stripe,
  session: Session,
  payment: Record<string, any>,
  uid: string,
) {
  const rentalSessionId = String(session.id);
  const stationId = String(session.station_id ?? "");
  const checkoutId = String(session.stripe_checkout_session_id ?? "").trim();
  const expectedAmountCents = Number(session.deposit_amount_cents ?? 0);

  if (
    String(session.state ?? "") !== "expired" || String(session.failure_code ?? "") !== "SESSION_EXPIRED" ||
    !checkoutId || !Number.isInteger(expectedAmountCents) || expectedAmountCents <= 0 ||
    session.paid_at || session.ejected_at || session.returned_at || session.completed_at ||
    session.apifox_trade_no || session.chargenow_order_id ||
    String(payment.status ?? "pending") !== "pending" ||
    Number(payment.amount_authorized_cents ?? 0) !== 0 ||
    Number(payment.amount_captured_cents ?? 0) !== 0 ||
    Number(payment.amount_refunded_cents ?? 0) !== 0
  ) {
    return null;
  }

  await assertNoPhysicalReleaseEvidence(db, rentalSessionId);
  const checkout = await stripe.checkout.sessions.retrieve(checkoutId);
  const rawIntent = checkout.payment_intent;
  const paymentIntentId = typeof rawIntent === "string" ? rawIntent : rawIntent?.id;
  if (
    checkout.livemode || Number(checkout.amount_total ?? 0) !== expectedAmountCents ||
    String(checkout.client_reference_id ?? "") !== rentalSessionId ||
    typeof paymentIntentId !== "string" || !paymentIntentId
  ) {
    throw new OrchestratorError("UNLINKED_TEST_AUTHORIZATION_NOT_VERIFIED");
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const allowed = stagingAuthorizationReleaseAllowed({
    requested: true,
    confirmedNoHardwareRelease: true,
    confirmedTestAuthorizationRelease: true,
    recoveryReason: "operator_confirmed_no_hardware_release",
    intent,
    expectedRentalSessionId: rentalSessionId,
    expectedStationId: stationId,
    expectedAmountCents,
  });
  const alreadyCanceled = intent.status === "canceled" && intent.livemode === false
    && Number(intent.amount) === expectedAmountCents && Number(intent.amount_received) === 0
    && String(intent.metadata?.rental_session_id ?? "") === rentalSessionId
    && String(intent.metadata?.station_id ?? "") === stationId;
  if (!allowed && !alreadyCanceled) {
    throw new OrchestratorError("UNLINKED_TEST_AUTHORIZATION_NOT_VERIFIED");
  }

  const canceledIntent = intent.status === "requires_capture"
    ? await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: "requested_by_customer" })
    : intent;
  if (canceledIntent.status !== "canceled") {
    throw new OrchestratorError("PAYMENT_RECONCILIATION_REQUIRED");
  }

  // Stripe is now authoritative.  Every following database operation is
  // replay-safe: a retry sees Stripe's canceled intent and completes it.
  const now = new Date().toISOString();
  const { error: paymentError } = await db.from("payments").update({
    stripe_payment_intent_id: intent.id,
    status: "canceled",
    amount_authorized_cents: 0,
    amount_captured_cents: 0,
    amount_refunded_cents: 0,
    refunded_at: null,
  }).eq("id", payment.id);
  if (paymentError) throw paymentError;

  const { error: reservationError } = await db.from("station_slot_reservations")
    .update({ state: "released", released_at: now, release_reason: "admin_test_authorization_cancelled", updated_at: now })
    .eq("rental_session_id", rentalSessionId)
    .eq("state", "reserved");
  if (reservationError) throw reservationError;

  const { error: railError } = await db.rpc("release_rental_payment_rail_claim", {
    p_rental_id: rentalSessionId,
    p_expected_rail: "qr_checkout",
    p_reason: "staging_admin_authorization_released_no_ejection",
  });
  if (railError) throw railError;

  const { error: sessionError } = await db.from("rental_sessions").update({
    stripe_payment_intent_id: intent.id,
    state: "expired",
    cancelled_at: now,
    checkout_url: null,
    checkout_url_expires_at: null,
    failure_code: "STAGING_ADMIN_AUTHORIZATION_RELEASED_NO_EJECTION",
    failure_message: "Autorisation Stripe TEST annulée après vérification de l'absence de commande matérielle",
    updated_at: now,
  }).eq("id", rentalSessionId).eq("state", "expired").is("paid_at", null);
  if (sessionError) throw sessionError;

  await auditLog(db, {
    actor: uid,
    action: "stripe.test_authorization_released",
    target: rentalSessionId,
    data: {
      station_id: stationId,
      checkout_id: checkoutId,
      payment_intent_id: intent.id,
      amount_cents: expectedAmountCents,
      prepared_release_without_command: true,
      no_ejection: true,
    },
  });
  return { paymentIntentId: intent.id, alreadyCanceled };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const db = adminClient();

  try {
    const { uid, roles } = await rolesOf(req, db);
    if (!uid) return json({ ok: false, error: "FORBIDDEN" }, 403);
    const isAdmin = roles.includes("admin") || roles.includes("super_admin");
    const isOperator = isAdmin || roles.includes("operations_admin") || roles.includes("operator");
    const isSuper = roles.includes("super_admin");
    if (!isOperator) return json({ ok: false, error: "FORBIDDEN" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!action || !rentalSessionId) return json({ ok: false, error: "MISSING_PARAMS" }, 400);

    const { data: session, error: sessionError } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    if (action === "retry_chargenow") {
      const result = await callInternalFunction("eject-after-payment", { rentalSessionId });
      await logApi(db, {
        service: "admin", endpoint: "retry_chargenow", method: "POST",
        status_code: result.status, request: { rentalSessionId, by: uid }, response: result.result,
      });
      return json({ ok: result.ok, result: result.result }, result.ok ? 200 : result.status);
    }

    if (action === "manual_review") {
      const { error } = await db.from("rental_sessions").update({
        state: "manual_review",
        settlement_status: session.settlement_status === "settled" ? "settled" : "manual_review",
        failure_message: "Placée en revue manuelle par un opérateur.",
      }).eq("id", rentalSessionId);
      if (error) throw error;
      await auditLog(db, { actor: uid, action: "rental.manual_review", target: rentalSessionId });
      return json({ ok: true });
    }

    if (action === "retry_settlement") {
      const state = await orchestratorState(db, rentalSessionId);
      const nonReturn = state === "non_return" || Boolean(session.non_return_declared_at);
      if (!nonReturn && (
        !session.returned_at || !session.battery_id || !session.return_station_id ||
        session.returned_slot_num == null
      )) {
        return json({ ok: false, error: "RETURN_CORRELATION_INCOMPLETE" }, 409);
      }
      const finalAt = nonReturn
        ? String(session.non_return_declared_at ?? new Date().toISOString())
        : String(session.returned_at);
      const settlement = await callSettlement(
        rentalSessionId, nonReturn ? "not_returned" : "normal", finalAt,
      );
      await logApi(db, {
        service: "admin", endpoint: "retry_settlement", method: "POST",
        status_code: settlement.status,
        request: { rentalSessionId, by: uid, returnState: nonReturn ? "not_returned" : "normal" },
        response: settlement.result,
      });
      return json({ ok: settlement.ok, settlement: settlement.result }, settlement.ok ? 200 : settlement.status);
    }

    if (action === "declare_non_return") {
      if (!isSuper) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED" }, 403);
      if (session.returned_at || session.state === "battery_returned") {
        return json({ ok: false, error: "BATTERY_ALREADY_RETURNED" }, 409);
      }
      if (session.settlement_status === "settled") {
        return json({ ok: false, error: "SETTLEMENT_ALREADY_FINAL" }, 409);
      }
      if (!session.battery_id || !(session.started_at || session.ejected_at)) {
        return json({ ok: false, error: "BATTERY_RELEASE_NOT_CONFIRMED" }, 409);
      }
      const declaredAt = String(session.non_return_declared_at ?? new Date().toISOString());
      await appendRentalEvent(db, {
        rentalId: rentalSessionId,
        eventType: "non_return_declared",
        idempotencyKey: `non_return_declared:${rentalSessionId}`,
        paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
        stationId: String(session.station_id ?? "") || null,
        batteryId: String(session.battery_id),
        occurredAt: declaredAt,
        metadata: { actor: uid, targetTotalCents: 9900 },
      });
      const { error: declarationError } = await db.from("rental_sessions").update({
        non_return_declared_at: declaredAt,
        non_return_declared_by: uid,
      }).eq("id", rentalSessionId);
      if (declarationError) throw declarationError;
      await auditLog(db, {
        actor: uid, action: "rental.non_return.declared", target: rentalSessionId,
        data: { previous_state: session.state, declared_at: declaredAt, target_total_cents: 9900 },
      });
      const settlement = await callSettlement(rentalSessionId, "not_returned", declaredAt);
      await logApi(db, {
        service: "admin", endpoint: "declare_non_return", method: "POST",
        status_code: settlement.status, request: { rentalSessionId, by: uid },
        response: settlement.result,
      });
      return json({
        ok: settlement.ok, non_return_declared: true, settlement: settlement.result,
      }, settlement.ok ? 200 : settlement.status);
    }

    if (action === "reconcile") {
      if (!session.apifox_trade_no) {
        return json({ ok: true, chargenow_skipped: true, reason: "NO_TRADE_NO" });
      }
      const { orderQuery } = await import("../_shared/chargenow.ts");
      const provider = await orderQuery(session.apifox_trade_no);
      if (!provider.ok) {
        await db.from("rental_sessions").update({ chargenow_status: "query_error" }).eq("id", rentalSessionId);
        await logApi(db, {
          service: "admin", endpoint: "reconcile", method: "POST", status_code: 502,
          request: { rentalSessionId, by: uid }, response: { ok: false }, error: "CHARGENOW_QUERY_ERROR",
        });
        return json({ ok: false, error: "CHARGENOW_QUERY_ERROR" }, 502);
      }
      const evidence = parseReturnEvidence(provider.data);
      if (!evidence.returnedAt) {
        await db.from("rental_sessions").update({ chargenow_status: "borrowing" }).eq("id", rentalSessionId);
        return json({ ok: true, returned: false, chargenow_status: "borrowing" });
      }
      if (!evidence.returnStationId || !evidence.batteryId || evidence.slotNum == null) {
        await openIncident(
          db, session, "RETURN_IDENTITY_INCOMPLETE",
          "ChargeNow indique un retour mais ne fournit pas la batterie, la borne et le slot nécessaires à un règlement automatique.",
          { tradeNo: session.apifox_trade_no },
        );
        return json({ ok: false, error: "RETURN_IDENTITY_INCOMPLETE" }, 409);
      }
      if (!session.battery_id || String(session.battery_id) !== evidence.batteryId) {
        await openIncident(
          db, session, "RETURN_BATTERY_MISMATCH",
          "La batterie indiquée par ChargeNow ne correspond pas à celle délivrée.",
          { expectedBattery: session.battery_id ?? null, observedBattery: evidence.batteryId,
            tradeNo: session.apifox_trade_no },
        );
        return json({ ok: false, error: "RETURN_BATTERY_MISMATCH" }, 409);
      }
      await applyReconciledReturn(db, session, {
        uid, returnedAt: evidence.returnedAt, returnStationId: evidence.returnStationId,
        batteryId: evidence.batteryId, slotNum: evidence.slotNum,
      });
      const settlement = await callSettlement(rentalSessionId, "normal", evidence.returnedAt);
      await logApi(db, {
        service: "admin", endpoint: "reconcile:return", method: "POST",
        status_code: settlement.status, request: { rentalSessionId, by: uid, fromState: session.state },
        response: { ...evidence, settlementOk: settlement.ok },
      });
      return json({ ok: settlement.ok, returned: true, evidence, settlement: settlement.result },
        settlement.ok ? 200 : settlement.status);
    }

    if (action === "refund") {
      if (!isSuper) return json({ ok: false, error: "FORBIDDEN_SUPER_ADMIN_REQUIRED" }, 403);
      const stripeRuntime = validateStripeTestRuntime();
      if (!stripeRuntime.ok) return json({ ok: false, error: stripeRuntime.error }, 503);
      const state = await orchestratorState(db, rentalSessionId);
      if (["released", "active"].includes(String(state)) && !session.returned_at) {
        return json({ ok: false, error: "BATTERY_NOT_RETURNED" }, 409);
      }
      if (["return_detected", "non_return"].includes(String(state))) {
        return json({ ok: false, error: "FINAL_PRICING_REQUIRED_BEFORE_REFUND" }, 409);
      }

      const { data: payment, error: paymentReadError } = await db.from("payments").select("*")
        .eq("rental_session_id", rentalSessionId).order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (paymentReadError) throw paymentReadError;
      if (!payment) return json({ ok: false, error: "NO_PAYMENT_INTENT" }, 409);

      const stripe = new Stripe(stripeRuntime.secretKey, {
        apiVersion: "2024-12-18.acacia", httpClient: Stripe.createFetchHttpClient(),
      });
      if (!payment.stripe_payment_intent_id && !session.stripe_payment_intent_id) {
        const releasedAuthorization = await cancelVerifiedUnlinkedTestAuthorization(
          db, stripe, session, payment, uid,
        );
        if (releasedAuthorization) {
          return json({
            ok: true,
            authorization_canceled: true,
            payment_intent_id: releasedAuthorization.paymentIntentId,
            already_canceled: releasedAuthorization.alreadyCanceled,
          });
        }
      }

      const paymentIntentId = String(payment.stripe_payment_intent_id ?? session.stripe_payment_intent_id ?? "");
      if (!paymentIntentId) return json({ ok: false, error: "NO_PAYMENT_INTENT" }, 409);
      const providerIds: string[] = [];
      const initialRefund = await refundPaymentIntentBalance(
        stripe,
        paymentIntentId,
        `admin_refund_${rentalSessionId}_initial`,
      );
      providerIds.push(...initialRefund.providerIds);
      let refundedCents = initialRefund.refundedCents;

      const supplementalId = String(session.stripe_supplemental_payment_intent_id ?? "");
      if (supplementalId) {
        const supplementalRefund = await refundPaymentIntentBalance(
          stripe,
          supplementalId,
          `admin_refund_${rentalSessionId}_supplemental`,
        );
        providerIds.push(...supplementalRefund.providerIds);
        refundedCents += supplementalRefund.refundedCents;
      }
      if (providerIds.length === 0 && payment.status === "refunded") {
        return json({ ok: true, alreadyRefunded: true });
      }

      await appendAdministrativeRefund(db, session, uid, refundedCents, providerIds);
      const now = new Date().toISOString();
      const { error: paymentUpdateError } = await db.from("payments").update({
        status: "refunded", refund_id: providerIds[0] ?? payment.refund_id,
        refunded_at: now, amount_refunded_cents: refundedCents,
      }).eq("id", payment.id);
      if (paymentUpdateError) throw paymentUpdateError;
      const { error: sessionUpdateError } = await db.from("rental_sessions").update({
        state: "refunded", settlement_status: "settled", settlement_error: null,
        settlement_locked_at: null, settled_at: now, refunded_amount_cents: refundedCents,
        closed_at: now,
      }).eq("id", rentalSessionId);
      if (sessionUpdateError) throw sessionUpdateError;
      await auditLog(db, {
        actor: uid, action: "rental.refunded", target: rentalSessionId,
        data: { provider_ids: providerIds, refunded_cents: refundedCents },
      });
      return json({ ok: true, provider_ids: providerIds, refunded_cents: refundedCents });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    const code = safeCode(error);
    console.error("rental-admin-action failed", code);
    return json({ ok: false, error: code === "UNKNOWN_ERROR" ? "ADMIN_ACTION_INTERNAL_ERROR" : code }, 500);
  }
});
