import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { validateStripeTestRuntime } from "./stripeRuntimeConfig.ts";
import { adminClient, auditLog, logApi, snapshotHash } from "./db.ts";
import { planSettlement, resolveSettlementStrategy, type SettlementStrategy } from "./settlement.ts";
import { appendRentalEvent, OrchestratorError } from "./rentalOrchestratorRuntime.ts";
import { computeFinalPricingFromSnapshot, PricingSnapshotError } from "./pricingSnapshot.ts";

// Checkout uses Clover because card capture is configured per payment method
// (payment_method_options.card.capture_method = manual) while TWINT remains
// automatic. Settlement MUST use the same API generation; older Acacia clients
// can expose the PaymentIntent's global capture_method as automatic_async even
// though the card-specific method is manual and the intent is requires_capture.
const STRIPE_API_VERSION = "2025-09-30.clover" as any;
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
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function authorizedInternalCaller(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(provided, expected);
}

function cents(value: unknown): number {
  const n = Math.round(Number(value ?? 0));
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_AMOUNT");
  return n;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof OrchestratorError) return error.code;
  if (error instanceof PricingSnapshotError) return error.code;
  const e = error as any;
  if (typeof e?.code === "string" && e.code.trim()) return `STRIPE_${e.code.toUpperCase()}`.slice(0, 120);
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return error.message.slice(0, 120);
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function safeStripeDiagnostic(error: unknown) {
  const e = error as any;
  const clean = (value: unknown, max = 240) => typeof value === "string"
    ? value
      .replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+/g, "[REDACTED_KEY]")
      .replace(/whsec_[A-Za-z0-9]+/g, "[REDACTED_WEBHOOK_SECRET]")
      .slice(0, max)
    : null;
  return {
    type: clean(e?.type, 80),
    code: clean(e?.code, 120),
    decline_code: clean(e?.decline_code, 120),
    param: clean(e?.param, 120),
    request_id: clean(e?.requestId, 120),
    message: clean(e?.message, 300),
  };
}

async function paymentMethodType(stripe: Stripe, intent: Stripe.PaymentIntent): Promise<string> {
  const id = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (id) {
    try {
      const method = await stripe.paymentMethods.retrieve(id);
      if (method.type) return method.type;
    } catch (_) {
      // Retrieval is advisory only; fall back to PaymentIntent-declared methods.
    }
  }
  return intent.payment_method_types?.[0] ?? "unknown";
}

function cardSpecificCaptureMethod(intent: Stripe.PaymentIntent): string | null {
  const value = (intent.payment_method_options as any)?.card?.capture_method;
  return typeof value === "string" ? value : null;
}

function resolveEffectiveStrategy(
  session: Session,
  intent: Stripe.PaymentIntent,
  methodType: string,
): SettlementStrategy {
  if (session.settlement_strategy === "manual_capture" || session.settlement_strategy === "prepaid_refund") {
    return session.settlement_strategy;
  }
  // The PaymentIntent state is authoritative. Clover can keep the top-level
  // capture_method at automatic_async while card-specific capture is manual.
  if (methodType === "card" && intent.status === "requires_capture" && cents(intent.amount_capturable) > 0) {
    return "manual_capture";
  }
  const cardCapture = cardSpecificCaptureMethod(intent);
  if (methodType === "card" && cardCapture === "manual") return "manual_capture";
  return resolveSettlementStrategy({ paymentMethodType: methodType, captureMethod: intent.capture_method });
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
    type: "payment_settlement",
    severity: code === "SUPPLEMENTAL_PAYMENT_REQUIRED" ? "warning" : "high",
    message,
    data: { rental_session_id: session.id, station_id: session.station_id, code, ...details },
    resolved: false,
  });
  if (error) throw error;
  await auditLog(db, { action: "settlement.incident.opened", target: String(session.id), data: { code, ...details } });
}

async function recordRetryableFailure(
  db: DB,
  session: Session,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await db.from("rental_sessions").update({
    settlement_status: "failed",
    settlement_error: code,
    settlement_locked_at: null,
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id);
  if (error) throw error;
  await openIncident(db, session, code, message, { retryable: true, ...details });
}

async function recordPricingFailure(
  db: DB,
  session: Session,
  code: string,
  message: string,
) {
  const { error } = await db.from("rental_sessions").update({
    settlement_status: "manual_review",
    settlement_error: code,
    settlement_locked_at: null,
    state: "needs_support",
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id);
  if (error) throw error;
  await openIncident(db, session, code, message, { retryable: false });
}

async function claimSettlement(db: DB, rentalId: string): Promise<Session | null> {
  const { data, error } = await db.rpc("claim_rental_settlement", {
    p_rental_id: rentalId,
    p_lock_ttl_minutes: LOCK_TTL_MINUTES,
  });
  if (error) throw error;
  return (data as Session | null) ?? null;
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
  if (!["return_detected", "non_return", "pricing_finalized", "payment_captured", "refunded", "completed"].includes(state)) {
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
    metadata: { returnState, finalAmountCents, pricingSnapshot: pricing },
  });
}

async function persistFinancialProgress(
  db: DB,
  session: Session,
  input: { capturedCents: number; refundedCents: number; supplementalCents: number; supplementalPaymentIntentId?: string | null },
) {
  const { error } = await db.from("rental_sessions").update({
    captured_amount_cents: input.capturedCents,
    refunded_amount_cents: input.refundedCents,
    supplemental_amount_cents: input.supplementalCents,
    stripe_supplemental_payment_intent_id: input.supplementalPaymentIntentId ?? null,
  }).eq("id", session.id);
  if (error) throw error;
}

async function saveSupplementalRequired(
  db: DB,
  session: Session,
  input: {
    finalAmountCents: number; capturedCents: number; refundedCents: number;
    supplementalCents: number; strategy: SettlementStrategy; paymentIntentId?: string | null;
    code: string; message: string; diagnostic?: Record<string, unknown>;
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
    failure_code: input.code,
    failure_message: input.message,
  }).eq("id", session.id);
  if (error) throw error;
  await openIncident(db, session, "SUPPLEMENTAL_PAYMENT_REQUIRED", input.message, {
    supplemental_cents: input.supplementalCents,
    provider: input.diagnostic ?? null,
    retryable: true,
  });
}

async function appendFinancialCompletion(
  db: DB,
  session: Session,
  input: {
    returnState: ReturnState; strategy: SettlementStrategy; finalAmountCents: number;
    capturedCents: number; refundedCents: number; supplementalCents: number;
    canceledAuthorization: boolean;
  },
) {
  const state = await orchestratorState(db, String(session.id));
  if (state === "completed") return;

  if (state === "pricing_finalized" || state === "non_return") {
    const refundedPath = input.refundedCents > 0 || input.canceledAuthorization;
    await appendRentalEvent(db, {
      rentalId: String(session.id),
      eventType: refundedPath ? "payment_refunded" : "payment_captured",
      idempotencyKey: refundedPath
        ? `payment_refunded:settlement:${session.id}:${input.refundedCents}:${input.canceledAuthorization}`
        : `payment_captured:settlement:${session.id}:${input.capturedCents}`,
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
  }

  const afterFinancial = await orchestratorState(db, String(session.id));
  if (afterFinancial === "completed") return;
  if (!["payment_captured", "refunded", "non_return"].includes(String(afterFinancial))) {
    throw new OrchestratorError("ORCHESTRATOR_FINANCIAL_STATE_INVALID", String(afterFinancial));
  }
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

async function settle(
  db: DB,
  stripe: Stripe,
  session: Session,
  returnState: ReturnState,
  finalAt: string,
) {
  const startAt = session.started_at ?? session.ejected_at ?? session.created_at;
  const effectiveEnd = returnState === "normal" ? session.returned_at ?? finalAt : finalAt;
  const snapshot = session.pricing_snapshot as Record<string, unknown> | null;
  const storedHash = typeof session.pricing_snapshot_hash === "string" ? session.pricing_snapshot_hash : "";
  if (!snapshot || !storedHash) {
    await recordPricingFailure(db, session, "PRICING_SNAPSHOT_MISSING", "Le snapshot tarifaire immuable de la location est absent.");
    return json({ ok: false, error: "PRICING_SNAPSHOT_MISSING" }, 409);
  }
  if (await snapshotHash(snapshot) !== storedHash) {
    await recordPricingFailure(db, session, "PRICING_SNAPSHOT_HASH_MISMATCH", "Le snapshot tarifaire de la location ne correspond plus à son empreinte d'origine.");
    return json({ ok: false, error: "PRICING_SNAPSHOT_HASH_MISMATCH" }, 409);
  }
  if (session.price_profile_id && String(snapshot.profile_id ?? "") !== String(session.price_profile_id)) {
    await recordPricingFailure(db, session, "PRICING_SNAPSHOT_PROFILE_MISMATCH", "Le profil du snapshot tarifaire ne correspond pas à la location.");
    return json({ ok: false, error: "PRICING_SNAPSHOT_PROFILE_MISMATCH" }, 409);
  }
  if (session.price_profile_version != null && Number(snapshot.profile_version) !== Number(session.price_profile_version)) {
    await recordPricingFailure(db, session, "PRICING_SNAPSHOT_VERSION_MISMATCH", "La version du snapshot tarifaire ne correspond pas à la location.");
    return json({ ok: false, error: "PRICING_SNAPSHOT_VERSION_MISMATCH" }, 409);
  }

  let pricing: Record<string, unknown>;
  try {
    pricing = computeFinalPricingFromSnapshot({
      snapshot,
      expectedCurrency: String(session.currency ?? "CHF"),
      startAt,
      endAt: effectiveEnd,
      returnState,
    });
  } catch (error) {
    const code = safeErrorCode(error);
    await recordPricingFailure(db, session, code, "Le snapshot tarifaire est incomplet ou invalide; aucun tarif courant n'a été utilisé en remplacement.");
    return json({ ok: false, error: code }, 409);
  }

  const finalAmountCents = cents(pricing.final_cents);
  const depositCents = cents(session.deposit_amount_cents ?? snapshot.deposit_cents ?? 0);
  if (depositCents <= 0) {
    await recordRetryableFailure(db, session, "DEPOSIT_NOT_CONFIGURED", "La caution de la location est introuvable.");
    return json({ ok: false, error: "DEPOSIT_NOT_CONFIGURED" }, 409);
  }
  const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
  if (!paymentIntentId) {
    await recordRetryableFailure(db, session, "PAYMENT_INTENT_MISSING", "Le paiement initial de la location est introuvable.");
    return json({ ok: false, error: "PAYMENT_INTENT_MISSING" }, 409);
  }

  try {
    await appendPricingFinalized(db, session, returnState, finalAmountCents, pricing);
  } catch (error) {
    const code = safeErrorCode(error);
    await recordRetryableFailure(db, session, code, "Le cycle de location n'est pas prêt pour la tarification finale.");
    return json({ ok: false, error: code }, 409);
  }

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (error) {
    const diagnostic = safeStripeDiagnostic(error);
    await recordRetryableFailure(db, session, safeErrorCode(error), "Stripe n'a pas pu relire l'autorisation de paiement.", { provider: diagnostic, operation: "retrieve_payment_intent" });
    return json({ ok: false, error: safeErrorCode(error) }, 502);
  }

  const methodType = await paymentMethodType(stripe, intent);
  const strategy = resolveEffectiveStrategy(session, intent, methodType);
  const alreadyCaptured = Math.max(cents(session.captured_amount_cents), cents(intent.amount_received));
  const alreadyRefunded = cents(session.refunded_amount_cents);
  const currentlyCapturable = cents(intent.amount_capturable);

  // If a previous capture succeeded at Stripe but local persistence failed,
  // don't capture again. Re-plan from the amount already received.
  const planningStrategy: SettlementStrategy = strategy === "manual_capture" && intent.status !== "requires_capture"
    ? "prepaid_refund"
    : strategy;
  const plan = planSettlement({
    strategy: planningStrategy,
    finalAmountCents,
    depositAmountCents: depositCents,
    amountCapturableCents: currentlyCapturable,
    amountCapturedCents: alreadyCaptured,
    amountAlreadyRefundedCents: alreadyRefunded,
  });

  let capturedCents = alreadyCaptured;
  let refundedCents = alreadyRefunded;
  let supplementalCapturedCents = 0;
  let supplementalPaymentIntentId = String(session.stripe_supplemental_payment_intent_id ?? "") || null;
  let canceledAuthorization = false;

  if (plan.cancelAuthorization && intent.status === "requires_capture") {
    try {
      intent = await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey: `settlement_cancel_${session.id}` });
      canceledAuthorization = true;
      await logApi(db, { service: "stripe", endpoint: "payment_intents.cancel", method: "POST", status_code: 200, request: { rentalSessionId: session.id }, response: { id: intent.id, status: intent.status } });
    } catch (error) {
      const diagnostic = safeStripeDiagnostic(error);
      await recordRetryableFailure(db, session, safeErrorCode(error), "L'autorisation Stripe n'a pas pu être libérée.", { provider: diagnostic, operation: "cancel_authorization" });
      return json({ ok: false, error: safeErrorCode(error) }, 502);
    }
  }

  if (plan.captureCents > 0 && intent.status === "requires_capture") {
    try {
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
        response: {
          id: intent.id,
          status: intent.status,
          amount_received: intent.amount_received,
          amount_capturable: intent.amount_capturable,
          effective_card_capture_method: cardSpecificCaptureMethod(intent),
          stripe_api_version: "2025-09-30.clover",
        },
      });
    } catch (error) {
      const diagnostic = safeStripeDiagnostic(error);
      await logApi(db, { service: "stripe", endpoint: "payment_intents.capture", method: "POST", status_code: 502, request: { rentalSessionId: session.id, amount_cents: plan.captureCents }, response: null, error: safeErrorCode(error) });
      await recordRetryableFailure(db, session, safeErrorCode(error), "La capture du montant final Stripe a échoué et doit être réconciliée.", {
        provider: diagnostic,
        operation: "capture",
        intent_status: intent.status,
        amount_capturable_cents: currentlyCapturable,
        card_capture_method: cardSpecificCaptureMethod(intent),
        top_level_capture_method: intent.capture_method,
        stripe_api_version: "2025-09-30.clover",
      });
      return json({ ok: false, error: safeErrorCode(error) }, 502);
    }
  }

  if (plan.refundCents > 0) {
    try {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId, amount: plan.refundCents },
        { idempotencyKey: `settlement_refund_${session.id}_${plan.refundCents}` },
      );
      refundedCents = alreadyRefunded + plan.refundCents;
      await persistFinancialProgress(db, session, {
        capturedCents,
        refundedCents,
        supplementalCents: plan.supplementalCents,
        supplementalPaymentIntentId,
      });
      await logApi(db, { service: "stripe", endpoint: "refunds.create", method: "POST", status_code: 200, request: { rentalSessionId: session.id, amount_cents: plan.refundCents }, response: { id: refund.id, status: refund.status } });
    } catch (error) {
      const diagnostic = safeStripeDiagnostic(error);
      await recordRetryableFailure(db, session, safeErrorCode(error), "Le remboursement Stripe de la différence a échoué.", { provider: diagnostic, operation: "refund" });
      return json({ ok: false, error: safeErrorCode(error) }, 502);
    }
  }

  if (plan.supplementalCents > 0) {
    const customerId = String(session.stripe_customer_id ?? "");
    const paymentMethodId = String(session.stripe_payment_method_id ?? "");
    if (!customerId || !paymentMethodId) {
      await saveSupplementalRequired(db, session, {
        finalAmountCents, capturedCents, refundedCents,
        supplementalCents: plan.supplementalCents, strategy,
        code: "SAVED_PAYMENT_METHOD_MISSING",
        message: "Le montant final dépasse la garantie et aucun moyen de paiement réutilisable n'est disponible.",
      });
      return json({ ok: false, requires_action: true, error: "SUPPLEMENTAL_PAYMENT_REQUIRED", supplemental_cents: plan.supplementalCents }, 409);
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
          deposit_amount_cents: String(depositCents),
        },
      }, { idempotencyKey: `settlement_supplemental_${session.id}_${plan.supplementalCents}` });
      supplementalPaymentIntentId = supplemental.id;
      if (supplemental.status !== "succeeded") throw new Error(`SUPPLEMENTAL_${supplemental.status.toUpperCase()}`);
      supplementalCapturedCents = cents(supplemental.amount_received || plan.supplementalCents);
      await persistFinancialProgress(db, session, {
        capturedCents: capturedCents + supplementalCapturedCents,
        refundedCents,
        supplementalCents: plan.supplementalCents,
        supplementalPaymentIntentId,
      });
    } catch (error) {
      const diagnostic = safeStripeDiagnostic(error);
      await saveSupplementalRequired(db, session, {
        finalAmountCents, capturedCents, refundedCents,
        supplementalCents: plan.supplementalCents, strategy,
        paymentIntentId: supplementalPaymentIntentId,
        code: "SUPPLEMENTAL_COLLECTION_FAILED",
        message: "Le complément de location nécessite une intervention ou une authentification du client.",
        diagnostic,
      });
      return json({ ok: false, requires_action: true, error: "SUPPLEMENTAL_COLLECTION_FAILED", supplemental_cents: plan.supplementalCents }, 409);
    }
  }

  const totalCaptured = capturedCents + supplementalCapturedCents;
  const netPaid = Math.max(0, totalCaptured - refundedCents);
  const completedAt = new Date().toISOString();

  try {
    await appendFinancialCompletion(db, session, {
      returnState,
      strategy,
      finalAmountCents,
      capturedCents: totalCaptured,
      refundedCents,
      supplementalCents: plan.supplementalCents,
      canceledAuthorization,
    });
  } catch (error) {
    await recordRetryableFailure(db, session, "ORCHESTRATOR_FINANCIAL_COMMIT_RETRY_REQUIRED", "Les opérations Stripe ont été exécutées, mais leur confirmation locale doit être rejouée.", {
      orchestrator_error: safeErrorCode(error),
      final_amount_cents: finalAmountCents,
      captured_amount_cents: totalCaptured,
      refunded_amount_cents: refundedCents,
      supplemental_amount_cents: plan.supplementalCents,
    });
    return json({ ok: false, error: "ORCHESTRATOR_FINANCIAL_COMMIT_RETRY_REQUIRED" }, 500);
  }

  const { error: paymentUpdateError } = await db.from("payments").update({
    status: refundedCents > 0
      ? (refundedCents >= totalCaptured ? "refunded" : "partially_refunded")
      : canceledAuthorization ? "canceled" : "succeeded",
    settlement_strategy: strategy,
    amount_captured_cents: totalCaptured,
    amount_refunded_cents: refundedCents,
  }).eq("rental_session_id", session.id);
  if (paymentUpdateError) throw paymentUpdateError;

  const { error: sessionUpdateError } = await db.from("rental_sessions").update({
    final_amount_cents: finalAmountCents,
    amount: finalAmountCents / 100,
    amount_paid: netPaid / 100,
    captured_amount_cents: totalCaptured,
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
      captured_amount_cents: totalCaptured,
      refunded_amount_cents: refundedCents,
      supplemental_amount_cents: plan.supplementalCents,
      canceled_authorization: canceledAuthorization,
      stripe_api_version: "2025-09-30.clover",
    },
  });

  return json({
    ok: true,
    settlement_status: "settled",
    strategy,
    final_amount_cents: finalAmountCents,
    captured_amount_cents: totalCaptured,
    refunded_amount_cents: refundedCents,
    supplemental_amount_cents: plan.supplementalCents,
  });
}

export async function handleSettlementRequestV2(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!authorizedInternalCaller(req)) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const stripeRuntime = validateStripeTestRuntime();
  if (!stripeRuntime.ok) return json({ ok: false, error: stripeRuntime.error }, 503);

  const db = adminClient();
  let rentalId = "";
  try {
    const body = await req.json().catch(() => ({}));
    rentalId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    const returnState: ReturnState = body.returnState === "not_returned" ? "not_returned" : "normal";
    const finalAt = typeof body.finalAt === "string" && Number.isFinite(Date.parse(body.finalAt)) ? body.finalAt : new Date().toISOString();
    if (!rentalId) return json({ ok: false, error: "MISSING_SESSION" }, 400);

    const { data: existing, error } = await db.from("rental_sessions").select("*").eq("id", rentalId).maybeSingle();
    if (error) throw error;
    if (!existing) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    if (existing.settlement_status === "settled") {
      return json({ ok: true, idempotent: true, settlement_status: "settled", final_amount_cents: existing.final_amount_cents });
    }

    const session = await claimSettlement(db, rentalId);
    if (!session) return json({ ok: true, already_in_progress: true }, 202);

    const stripe = new Stripe(stripeRuntime.secretKey, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });
    return await settle(db, stripe, session, returnState, finalAt);
  } catch (error) {
    const code = safeErrorCode(error);
    if (rentalId) {
      try {
        const { data: session } = await db.from("rental_sessions").select("*").eq("id", rentalId).maybeSingle();
        if (session) {
          await recordRetryableFailure(db, session, "SETTLEMENT_INTERNAL_ERROR", "Le règlement final a échoué et doit être réconcilié.", {
            underlying_code: code,
            provider: safeStripeDiagnostic(error),
            stripe_api_version: "2025-09-30.clover",
          });
        }
      } catch (_) {
        // Never mask the original failure response.
      }
    }
    return json({ ok: false, error: "SETTLEMENT_INTERNAL_ERROR" }, 500);
  }
}
