import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, logApi } from "./db.ts";
import { planSettlement, resolveSettlementStrategy } from "./settlement.ts";
import { appendRentalEvent, OrchestratorError } from "./rentalOrchestratorRuntime.ts";

const LOCK_TTL_MINUTES = 10;

type DB = ReturnType<typeof adminClient>;
type ReturnState = "normal" | "not_returned";
type Session = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function authorizedInternalCaller(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(provided, expected);
}

function cents(value: unknown): number {
  const normalized = Math.round(Number(value ?? 0));
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error("INVALID_AMOUNT");
  return normalized;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof OrchestratorError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) {
    return error.message.slice(0, 120);
  }
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

async function paymentMethodType(stripe: Stripe, intent: Stripe.PaymentIntent): Promise<string> {
  const id = typeof intent.payment_method === "string"
    ? intent.payment_method
    : intent.payment_method?.id;
  if (id) {
    try {
      const method = await stripe.paymentMethods.retrieve(id);
      if (method.type) return method.type;
    } catch (_) {
      // Fall back to the PaymentIntent-declared method type.
    }
  }
  return intent.payment_method_types?.[0] ?? "unknown";
}

async function orchestratorState(db: DB, rentalId: string): Promise<string | null> {
  const { data, error } = await db.from("rental_orchestrator_snapshots")
    .select("state")
    .eq("rental_id", rentalId)
    .maybeSingle();
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
  const { error: incidentError } = await db.from("system_incidents").insert({
    type: "payment_settlement",
    severity: code === "SUPPLEMENTAL_PAYMENT_REQUIRED" ? "warning" : "high",
    message,
    data: {
      rental_session_id: session.id,
      station_id: session.station_id,
      code,
      ...details,
    },
    resolved: false,
  });
  if (incidentError) throw incidentError;

  await auditLog(db, {
    action: "settlement.incident.opened",
    target: String(session.id),
    data: { code, ...details },
  });
}

/**
 * Records a retryable settlement problem without terminalizing the rental.
 *
 * Payment-provider, database and orchestration persistence errors can occur
 * after a Stripe side effect has already succeeded. Moving the orchestrator to
 * `failed` would make safe replay impossible. The durable Stripe idempotency
 * keys and the settlement lock allow the operator/worker to reconcile and retry
 * while the business lifecycle remains at return_detected/pricing_finalized.
 */
async function recordRetryableSettlementFailure(
  db: DB,
  session: Session,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const { error: updateError } = await db.from("rental_sessions").update({
    settlement_status: "failed",
    settlement_error: code,
    settlement_locked_at: null,
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id);
  if (updateError) throw updateError;

  await openIncident(db, session, code, message, {
    retryable: true,
    ...details,
  });
}

async function claimSettlement(db: DB, rentalSessionId: string): Promise<Session | null> {
  const { data, error } = await db.rpc("claim_rental_settlement", {
    p_rental_id: rentalSessionId,
    p_lock_ttl_minutes: LOCK_TTL_MINUTES,
  });
  if (error) throw error;
  return (data as Session | null) ?? null;
}

async function saveSupplementalRequired(
  db: DB,
  session: Session,
  input: {
    finalAmountCents: number;
    capturedCents: number;
    refundedCents: number;
    supplementalCents: number;
    strategy: string;
    paymentIntentId?: string | null;
    code: string;
    message: string;
    errorCode?: string;
  },
) {
  const { error } = await db.from("rental_sessions").update({
    final_amount_cents: input.finalAmountCents,
    captured_amount_cents: input.capturedCents,
    refunded_amount_cents: input.refundedCents,
    supplemental_amount_cents: input.supplementalCents,
    stripe_supplemental_payment_intent_id: input.paymentIntentId ?? null,
    settlement_strategy: input.strategy,
    settlement_status: "supplemental_required",
    settlement_error: input.code,
    settlement_locked_at: null,
    state: "needs_support",
  }).eq("id", session.id);
  if (error) throw error;

  await openIncident(db, session, "SUPPLEMENTAL_PAYMENT_REQUIRED", input.message, {
    supplemental_cents: input.supplementalCents,
    settlement_error: input.code,
    provider_error_code: input.errorCode ?? null,
    retryable: true,
  });
}

async function appendPricingFinalized(
  db: DB,
  session: Session,
  returnState: ReturnState,
  finalAmountCents: number,
  pricing: Record<string, unknown>,
) {
  const state = await orchestratorState(db, String(session.id));
  if (!state) throw new OrchestratorError("ORCHESTRATOR_SNAPSHOT_MISSING");
  if (![
    "return_detected",
    "non_return",
    "pricing_finalized",
    "payment_captured",
    "refunded",
    "completed",
  ].includes(state)) {
    throw new OrchestratorError("SETTLEMENT_STATE_NOT_READY", `Settlement refused from ${state}`);
  }

  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType: "pricing_finalized",
    idempotencyKey: `pricing_finalized:${session.id}:${returnState}:${finalAmountCents}`,
    paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
    stationId: String(session.station_id ?? "") || null,
    batteryId: String(session.battery_id ?? "") || null,
    finalAmountChf: finalAmountCents / 100,
    metadata: {
      returnState,
      finalAmountCents,
      pricingSnapshot: pricing,
    },
  });
}

async function appendFinancialCompletion(
  db: DB,
  session: Session,
  input: {
    returnState: ReturnState;
    strategy: string;
    finalAmountCents: number;
    capturedCents: number;
    refundedCents: number;
    supplementalCents: number;
    canceledAuthorization: boolean;
  },
) {
  const refundedPath = input.refundedCents > 0 || input.canceledAuthorization;
  const eventType = refundedPath ? "payment_refunded" : "payment_captured";
  const financialKey = refundedPath
    ? `payment_refunded:settlement:${session.id}:${input.refundedCents}:${input.canceledAuthorization}`
    : `payment_captured:settlement:${session.id}:${input.capturedCents}`;

  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType,
    idempotencyKey: financialKey,
    paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
    stationId: String(session.station_id ?? "") || null,
    batteryId: String(session.battery_id ?? "") || null,
    finalAmountChf: input.finalAmountCents / 100,
    metadata: {
      returnState: input.returnState,
      strategy: input.strategy,
      capturedCents: input.capturedCents,
      refundedCents: input.refundedCents,
      supplementalCents: input.supplementalCents,
      canceledAuthorization: input.canceledAuthorization,
    },
  });

  await appendRentalEvent(db, {
    rentalId: String(session.id),
    eventType: "rental_completed",
    idempotencyKey: `rental_completed:settlement:${session.id}:${input.finalAmountCents}`,
    paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null,
    stationId: String(session.station_id ?? "") || null,
    batteryId: String(session.battery_id ?? "") || null,
    finalAmountChf: input.finalAmountCents / 100,
    metadata: {
      returnState: input.returnState,
      strategy: input.strategy,
      netPaidCents: Math.max(0, input.capturedCents - input.refundedCents),
    },
  });
}

async function persistFinancialProgress(
  db: DB,
  session: Session,
  input: {
    capturedCents: number;
    refundedCents: number;
    supplementalCents: number;
    supplementalPaymentIntentId?: string | null;
  },
) {
  const { error } = await db.from("rental_sessions").update({
    captured_amount_cents: input.capturedCents,
    refunded_amount_cents: input.refundedCents,
    supplemental_amount_cents: input.supplementalCents,
    stripe_supplemental_payment_intent_id: input.supplementalPaymentIntentId ?? null,
  }).eq("id", session.id);
  if (error) throw error;
}

async function settle(
  db: DB,
  stripe: Stripe,
  session: Session,
  returnState: ReturnState,
  finalAt: string,
) {
  const startAt = session.started_at ?? session.ejected_at ?? session.created_at;
  const effectiveEnd = returnState === "normal" ? session.returned_at ?? finalAt : finalAt;

  const { data: pricing, error: pricingError } = await db.rpc("compute_pricing", {
    p_device: session.kiosk_device_id ?? null,
    p_station: session.station_id,
    p_shop: session.shop_id ?? null,
    p_start: startAt,
    p_end: effectiveEnd,
    p_rental_state: "active",
    p_return_state: returnState,
    p_currency: session.currency ?? "CHF",
  });

  if (pricingError || !pricing) {
    await recordRetryableSettlementFailure(
      db,
      session,
      "FINAL_PRICING_ERROR",
      "Le tarif final n'a pas pu être calculé automatiquement.",
      { pricing_error_code: pricingError?.code ?? null },
    );
    return json({ ok: false, error: "FINAL_PRICING_ERROR" }, 409);
  }

  const pricingRow = pricing as Record<string, unknown>;
  const finalAmountCents = cents(pricingRow.final_cents);
  const initialSnapshot = session.pricing_snapshot as Record<string, unknown> | null;
  const depositAmountCents = cents(
    session.deposit_amount_cents ?? initialSnapshot?.deposit_cents ?? 0,
  );
  if (depositAmountCents <= 0) {
    await recordRetryableSettlementFailure(
      db,
      session,
      "DEPOSIT_NOT_CONFIGURED",
      "La caution de la location est introuvable.",
    );
    return json({ ok: false, error: "DEPOSIT_NOT_CONFIGURED" }, 409);
  }

  const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
  if (!paymentIntentId) {
    await recordRetryableSettlementFailure(
      db,
      session,
      "PAYMENT_INTENT_MISSING",
      "Le paiement initial de la location est introuvable.",
    );
    return json({ ok: false, error: "PAYMENT_INTENT_MISSING" }, 409);
  }

  try {
    await appendPricingFinalized(db, session, returnState, finalAmountCents, pricingRow);
  } catch (error) {
    const code = safeErrorCode(error);
    await recordRetryableSettlementFailure(
      db,
      session,
      code,
      "Le règlement a été bloqué car le cycle de location n'est pas prêt pour la tarification finale.",
    );
    return json({ ok: false, error: code }, 409);
  }

  let intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const methodType = await paymentMethodType(stripe, intent);
  const storedStrategy = session.settlement_strategy === "manual_capture" ||
      session.settlement_strategy === "prepaid_refund"
    ? String(session.settlement_strategy)
    : null;
  const strategy = storedStrategy ?? resolveSettlementStrategy({
    paymentMethodType: methodType,
    captureMethod: intent.capture_method,
  });

  const alreadyCapturedCents = Math.max(
    cents(session.captured_amount_cents),
    cents(intent.amount_received),
  );
  const alreadyRefundedCents = cents(session.refunded_amount_cents);

  // A previous attempt may have captured the manual PaymentIntent before local
  // persistence failed. Treat the captured intent as prepaid on replay.
  const planningStrategy = strategy === "manual_capture" && intent.status !== "requires_capture"
    ? "prepaid_refund"
    : strategy;

  const plan = planSettlement({
    strategy: planningStrategy,
    finalAmountCents,
    depositAmountCents,
    amountCapturableCents: cents(intent.amount_capturable || depositAmountCents),
    amountCapturedCents: alreadyCapturedCents,
    amountAlreadyRefundedCents: alreadyRefundedCents,
  });

  let capturedCents = alreadyCapturedCents;
  let refundedCents = alreadyRefundedCents;
  let supplementalCapturedCents = 0;
  let supplementalPaymentIntentId = String(
    session.stripe_supplemental_payment_intent_id ?? "",
  ) || null;
  let canceledAuthorization = false;

  if (plan.cancelAuthorization && intent.status === "requires_capture") {
    intent = await stripe.paymentIntents.cancel(
      paymentIntentId,
      {},
      { idempotencyKey: `settlement_cancel_${session.id}` },
    );
    canceledAuthorization = true;
    await logApi(db, {
      service: "stripe",
      endpoint: "payment_intents.cancel",
      method: "POST",
      status_code: 200,
      request: { rentalSessionId: session.id },
      response: { id: intent.id, status: intent.status },
    });
  }

  if (plan.captureCents > 0 && intent.status === "requires_capture") {
    intent = await stripe.paymentIntents.capture(
      paymentIntentId,
      { amount_to_capture: plan.captureCents },
      { idempotencyKey: `settlement_capture_${session.id}_${plan.captureCents}` },
    );
    capturedCents = cents(intent.amount_received || plan.captureCents);
    await persistFinancialProgress(db, session, {
      capturedCents,
      refundedCents,
      supplementalCents: plan.supplementalCents,
      supplementalPaymentIntentId,
    });
    await logApi(db, {
      service: "stripe",
      endpoint: "payment_intents.capture",
      method: "POST",
      status_code: 200,
      request: { rentalSessionId: session.id, amount_cents: plan.captureCents },
      response: { id: intent.id, status: intent.status },
    });
  }

  if (plan.refundCents > 0) {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: plan.refundCents },
      { idempotencyKey: `settlement_refund_${session.id}_${plan.refundCents}` },
    );
    refundedCents = alreadyRefundedCents + plan.refundCents;
    await persistFinancialProgress(db, session, {
      capturedCents,
      refundedCents,
      supplementalCents: plan.supplementalCents,
      supplementalPaymentIntentId,
    });
    await logApi(db, {
      service: "stripe",
      endpoint: "refunds.create",
      method: "POST",
      status_code: 200,
      request: { rentalSessionId: session.id, amount_cents: plan.refundCents },
      response: { id: refund.id, status: refund.status },
    });
  }

  if (plan.supplementalCents > 0) {
    const customerId = String(session.stripe_customer_id ?? "");
    const paymentMethodId = String(session.stripe_payment_method_id ?? "");

    if (!customerId || !paymentMethodId) {
      await saveSupplementalRequired(db, session, {
        finalAmountCents,
        capturedCents,
        refundedCents,
        supplementalCents: plan.supplementalCents,
        strategy,
        code: "SAVED_PAYMENT_METHOD_MISSING",
        message: "Le montant final dépasse la caution et aucun moyen de paiement réutilisable n'est disponible.",
      });
      return json({
        ok: false,
        requires_action: true,
        error: "SUPPLEMENTAL_PAYMENT_REQUIRED",
        supplemental_cents: plan.supplementalCents,
      }, 409);
    }

    try {
      const supplemental = await stripe.paymentIntents.create({
        amount: plan.supplementalCents,
        currency: String(session.currency ?? "CHF").toLowerCase(),
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: "Chargeurs.ch — complément de location",
        metadata: {
          rental_session_id: String(session.id),
          payment_purpose: "rental_supplemental",
          final_amount_cents: String(finalAmountCents),
          deposit_amount_cents: String(depositAmountCents),
        },
      }, {
        idempotencyKey: `settlement_supplemental_${session.id}_${plan.supplementalCents}`,
      });

      supplementalPaymentIntentId = supplemental.id;
      if (supplemental.status !== "succeeded") {
        throw new Error(`SUPPLEMENTAL_${supplemental.status.toUpperCase()}`);
      }
      supplementalCapturedCents = cents(
        supplemental.amount_received || plan.supplementalCents,
      );
      await persistFinancialProgress(db, session, {
        capturedCents: capturedCents + supplementalCapturedCents,
        refundedCents,
        supplementalCents: plan.supplementalCents,
        supplementalPaymentIntentId,
      });
    } catch (error) {
      await saveSupplementalRequired(db, session, {
        finalAmountCents,
        capturedCents,
        refundedCents,
        supplementalCents: plan.supplementalCents,
        strategy,
        paymentIntentId: supplementalPaymentIntentId,
        code: "SUPPLEMENTAL_COLLECTION_FAILED",
        message: "Le complément de location nécessite une intervention ou une authentification du client.",
        errorCode: safeErrorCode(error),
      });
      return json({
        ok: false,
        requires_action: true,
        error: "SUPPLEMENTAL_COLLECTION_FAILED",
        supplemental_cents: plan.supplementalCents,
      }, 409);
    }
  }

  const totalCapturedCents = capturedCents + supplementalCapturedCents;
  const netPaidCents = Math.max(0, totalCapturedCents - refundedCents);
  const completedAt = new Date().toISOString();

  try {
    await appendFinancialCompletion(db, session, {
      returnState,
      strategy,
      finalAmountCents,
      capturedCents: totalCapturedCents,
      refundedCents,
      supplementalCents: plan.supplementalCents,
      canceledAuthorization,
    });
  } catch (error) {
    const code = "ORCHESTRATOR_FINANCIAL_COMMIT_RETRY_REQUIRED";
    await recordRetryableSettlementFailure(
      db,
      session,
      code,
      "Les opérations Stripe ont été exécutées, mais leur confirmation locale doit être rejouée.",
      {
        orchestrator_error: safeErrorCode(error),
        final_amount_cents: finalAmountCents,
        captured_amount_cents: totalCapturedCents,
        refunded_amount_cents: refundedCents,
        supplemental_amount_cents: plan.supplementalCents,
      },
    );
    return json({ ok: false, error: code }, 500);
  }

  const { error: paymentUpdateError } = await db.from("payments").update({
    status: refundedCents > 0
      ? (refundedCents >= totalCapturedCents ? "refunded" : "partially_refunded")
      : canceledAuthorization
        ? "canceled"
        : "succeeded",
    settlement_strategy: strategy,
    amount_captured_cents: totalCapturedCents,
    amount_refunded_cents: refundedCents,
  }).eq("rental_session_id", session.id);
  if (paymentUpdateError) throw paymentUpdateError;

  const { error: sessionUpdateError } = await db.from("rental_sessions").update({
    final_amount_cents: finalAmountCents,
    amount: finalAmountCents / 100,
    amount_paid: netPaidCents / 100,
    captured_amount_cents: totalCapturedCents,
    refunded_amount_cents: refundedCents,
    supplemental_amount_cents: plan.supplementalCents,
    stripe_supplemental_payment_intent_id: supplementalPaymentIntentId,
    settlement_strategy: strategy,
    settlement_status: "settled",
    settlement_error: null,
    settlement_locked_at: null,
    settled_at: completedAt,
    state: "completed",
    closed_at: completedAt,
    failure_code: null,
    failure_message: null,
  }).eq("id", session.id);
  if (sessionUpdateError) throw sessionUpdateError;

  await auditLog(db, {
    action: "settlement.completed",
    target: String(session.id),
    data: {
      return_state: returnState,
      strategy,
      payment_method_type: methodType,
      final_amount_cents: finalAmountCents,
      captured_amount_cents: totalCapturedCents,
      refunded_amount_cents: refundedCents,
      supplemental_amount_cents: plan.supplementalCents,
      canceled_authorization: canceledAuthorization,
    },
  });

  return json({
    ok: true,
    settlement_status: "settled",
    strategy,
    final_amount_cents: finalAmountCents,
    captured_amount_cents: totalCapturedCents,
    refunded_amount_cents: refundedCents,
    supplemental_amount_cents: plan.supplementalCents,
  });
}

export async function handleSettlementRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!authorizedInternalCaller(req)) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return json({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, 503);

  const db = adminClient();
  let rentalSessionId = "";

  try {
    const body = await req.json().catch(() => ({}));
    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    const returnState: ReturnState = body.returnState === "not_returned"
      ? "not_returned"
      : "normal";
    const finalAt = typeof body.finalAt === "string" && Number.isFinite(Date.parse(body.finalAt))
      ? body.finalAt
      : new Date().toISOString();

    if (!rentalSessionId) return json({ ok: false, error: "MISSING_SESSION" }, 400);

    const { data: existing, error: existingError } = await db.from("rental_sessions")
      .select("*")
      .eq("id", rentalSessionId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    if (existing.settlement_status === "settled") {
      return json({
        ok: true,
        idempotent: true,
        settlement_status: "settled",
        final_amount_cents: existing.final_amount_cents,
      });
    }

    const session = await claimSettlement(db, rentalSessionId);
    if (!session) return json({ ok: true, already_in_progress: true }, 202);

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    return await settle(db, stripe, session, returnState, finalAt);
  } catch (error) {
    const underlyingCode = safeErrorCode(error);
    if (rentalSessionId) {
      try {
        const { data: session } = await db.from("rental_sessions")
          .select("*")
          .eq("id", rentalSessionId)
          .maybeSingle();
        if (session) {
          await recordRetryableSettlementFailure(
            db,
            session,
            "SETTLEMENT_INTERNAL_ERROR",
            "Le règlement final a échoué et doit être réconcilié.",
            { error_code: underlyingCode },
          );
        }
      } catch (recordError) {
        console.error(
          "settlement failure persistence failed",
          safeErrorCode(recordError),
          rentalSessionId,
        );
      }
    }
    return json({ ok: false, error: "SETTLEMENT_INTERNAL_ERROR" }, 500);
  }
}
