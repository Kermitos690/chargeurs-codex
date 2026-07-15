import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, logApi } from "./db.ts";
import { planSettlement, resolveSettlementStrategy } from "./settlement.ts";

const LOCK_TTL_MINUTES = 10;
const REQUIRED_DEPOSIT_CENTS = 3_000;
const FLOW_ENABLED = (Deno.env.get("ENABLE_CANONICAL_SETTLEMENT_FLOW") ?? "false").toLowerCase() === "true";
const LIVE_ENABLED = (Deno.env.get("ENABLE_CANONICAL_SETTLEMENT_LIVE") ?? "false").toLowerCase() === "true";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DB = ReturnType<typeof adminClient>;
type ReturnState = "normal" | "not_returned";
type Session = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function authorizedInternalCaller(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return safeEqual(provided, expected);
}

function isLiveStripeKey(key: string): boolean {
  return key.startsWith("sk_live_");
}

function cents(value: unknown): number {
  const result = Math.round(Number(value ?? 0));
  if (!Number.isFinite(result) || result < 0) throw new Error("INVALID_AMOUNT");
  return result;
}

function normalizeComposite(value: unknown): Session | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && typeof raw === "object" ? raw as Session : null;
}

async function paymentMethodType(stripe: Stripe, intent: Stripe.PaymentIntent): Promise<string> {
  const id = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (id) {
    try {
      const method = await stripe.paymentMethods.retrieve(id);
      if (method.type) return method.type;
    } catch {
      // Fall back to PaymentIntent types.
    }
  }
  return intent.payment_method_types?.[0] ?? "unknown";
}

async function openIncident(
  db: DB,
  session: Session,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const incidentData = {
    rental_session_id: String(session.id),
    station_id: session.station_id ?? null,
    code,
    ...details,
  };

  const { data: existing } = await db.from("system_incidents")
    .select("id")
    .eq("type", "payment_settlement")
    .eq("resolved", false)
    .contains("data", { rental_session_id: String(session.id), code })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    await db.from("system_incidents").insert({
      type: "payment_settlement",
      severity: code === "SUPPLEMENTAL_PAYMENT_REQUIRED" ? "warning" : "high",
      message,
      data: incidentData,
      resolved: false,
    });
  }

  await auditLog(db, {
    action: "settlement.incident.opened",
    target: String(session.id),
    data: { code, ...details, duplicate_suppressed: Boolean(existing) },
  });
}

async function failSettlement(
  db: DB,
  session: Session,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.from("rental_sessions").update({
    settlement_status: "failed",
    settlement_error: code,
    settlement_locked_at: null,
    state: "needs_support",
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id).neq("settlement_status", "legacy");
  await openIncident(db, session, code, message, details);
}

async function claimSettlement(db: DB, rentalSessionId: string): Promise<Session | null> {
  const { data, error } = await db.rpc("claim_rental_settlement", {
    p_rental_id: rentalSessionId,
    p_lock_ttl_minutes: LOCK_TTL_MINUTES,
  });
  if (error) throw error;
  return normalizeComposite(data);
}

function paymentStatus(capturedCents: number, refundedCents: number): string | null {
  if (refundedCents > 0) return refundedCents >= capturedCents ? "refunded" : "partially_refunded";
  if (capturedCents > 0) return "succeeded";
  return null;
}

async function updatePaymentTotals(
  db: DB,
  session: Session,
  strategy: string,
  capturedCents: number,
  refundedCents: number,
): Promise<void> {
  const patch: Record<string, unknown> = {
    settlement_strategy: strategy,
    amount_captured_cents: capturedCents,
    amount_refunded_cents: refundedCents,
  };
  const status = paymentStatus(capturedCents, refundedCents);
  if (status) patch.status = status;

  const { error } = await db.from("payments").update(patch).eq("rental_session_id", session.id);
  if (error) throw error;
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
  },
): Promise<void> {
  await updatePaymentTotals(db, session, input.strategy, input.capturedCents, input.refundedCents);

  const { error } = await db.from("rental_sessions").update({
    final_amount_cents: input.finalAmountCents,
    captured_amount_cents: input.capturedCents,
    refunded_amount_cents: input.refundedCents,
    supplemental_amount_cents: input.supplementalCents,
    settlement_strategy: input.strategy,
    settlement_status: "supplemental_required",
    settlement_error: "SUPPLEMENTAL_PAYMENT_REQUIRED",
    settlement_locked_at: null,
    state: "needs_support",
    failure_code: "SUPPLEMENTAL_PAYMENT_REQUIRED",
    failure_message: "Le montant final dépasse la caution et nécessite une confirmation de paiement complémentaire.",
  }).eq("id", session.id).neq("settlement_status", "legacy");
  if (error) throw error;

  await openIncident(
    db,
    session,
    "SUPPLEMENTAL_PAYMENT_REQUIRED",
    "Le montant final dépasse la caution. Aucun débit hors session n'a été exécuté automatiquement.",
    {
      final_amount_cents: input.finalAmountCents,
      captured_amount_cents: input.capturedCents,
      refunded_amount_cents: input.refundedCents,
      supplemental_cents: input.supplementalCents,
    },
  );
}

async function settle(
  db: DB,
  stripe: Stripe,
  session: Session,
  returnState: ReturnState,
  finalAt: string,
): Promise<Response> {
  if (session.settlement_status === "legacy") return json({ ok: false, error: "LEGACY_RENTAL_NOT_SETTLEABLE" }, 409);
  if (returnState === "normal" && !session.returned_at) {
    await failSettlement(db, session, "RETURN_NOT_CONFIRMED", "Le retour physique de la batterie n'est pas confirmé.");
    return json({ ok: false, error: "RETURN_NOT_CONFIRMED" }, 409);
  }

  const startAt = session.started_at ?? session.ejected_at ?? session.created_at;
  const effectiveEnd = returnState === "normal" ? session.returned_at : finalAt;
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
    await failSettlement(db, session, "FINAL_PRICING_ERROR", "Le tarif final n'a pas pu être calculé automatiquement.", {
      pricing_error: pricingError?.message ?? null,
    });
    return json({ ok: false, error: "FINAL_PRICING_ERROR" }, 409);
  }

  const finalAmountCents = cents((pricing as Record<string, unknown>).final_cents);
  const depositAmountCents = cents(session.deposit_amount_cents);
  if (depositAmountCents !== REQUIRED_DEPOSIT_CENTS) {
    await failSettlement(db, session, "DEPOSIT_NOT_CONFIGURED", "La caution de 30 CHF est absente ou incohérente.");
    return json({ ok: false, error: "DEPOSIT_NOT_CONFIGURED" }, 409);
  }

  const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
  if (!paymentIntentId) {
    await failSettlement(db, session, "PAYMENT_INTENT_MISSING", "Le paiement initial de la location est introuvable.");
    return json({ ok: false, error: "PAYMENT_INTENT_MISSING" }, 409);
  }

  let intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.currency.toLowerCase() !== String(session.currency ?? "CHF").toLowerCase()) {
    await failSettlement(db, session, "PAYMENT_CURRENCY_MISMATCH", "La devise du PaymentIntent est incohérente.");
    return json({ ok: false, error: "PAYMENT_CURRENCY_MISMATCH" }, 409);
  }

  const methodType = await paymentMethodType(stripe, intent);
  const storedStrategy = session.settlement_strategy === "manual_capture" || session.settlement_strategy === "prepaid_refund"
    ? String(session.settlement_strategy)
    : null;
  const strategy = storedStrategy ?? resolveSettlementStrategy({
    paymentMethodType: methodType,
    captureMethod: intent.capture_method,
  });

  const alreadyCapturedCents = Math.max(cents(session.captured_amount_cents), cents(intent.amount_received));
  const alreadyRefundedCents = cents(session.refunded_amount_cents);
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

  if (plan.cancelAuthorization && intent.status === "requires_capture") {
    intent = await stripe.paymentIntents.cancel(
      paymentIntentId,
      {},
      { idempotencyKey: `settlement_cancel_${session.id}` },
    );
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
    await saveSupplementalRequired(db, session, {
      finalAmountCents,
      capturedCents,
      refundedCents,
      supplementalCents: plan.supplementalCents,
      strategy,
    });
    return json({
      ok: false,
      requires_action: true,
      error: "SUPPLEMENTAL_PAYMENT_REQUIRED",
      final_amount_cents: finalAmountCents,
      captured_amount_cents: capturedCents,
      refunded_amount_cents: refundedCents,
      supplemental_cents: plan.supplementalCents,
    }, 409);
  }

  await updatePaymentTotals(db, session, strategy, capturedCents, refundedCents);

  const netPaidCents = Math.max(0, capturedCents - refundedCents);
  const completedAt = new Date().toISOString();
  const finalState = returnState === "normal" ? "completed" : "non_return";
  const { error: sessionUpdateError } = await db.from("rental_sessions").update({
    final_amount_cents: finalAmountCents,
    amount: finalAmountCents / 100,
    amount_paid: netPaidCents / 100,
    captured_amount_cents: capturedCents,
    refunded_amount_cents: refundedCents,
    supplemental_amount_cents: 0,
    settlement_strategy: strategy,
    settlement_status: "settled",
    settlement_error: null,
    settlement_locked_at: null,
    settled_at: completedAt,
    state: finalState,
    closed_at: completedAt,
  }).eq("id", session.id).neq("settlement_status", "legacy");
  if (sessionUpdateError) throw sessionUpdateError;

  await auditLog(db, {
    action: "settlement.completed",
    target: String(session.id),
    data: {
      return_state: returnState,
      strategy,
      payment_method_type: methodType,
      final_amount_cents: finalAmountCents,
      captured_amount_cents: capturedCents,
      refunded_amount_cents: refundedCents,
    },
  });

  return json({
    ok: true,
    settlement_status: "settled",
    state: finalState,
    strategy,
    final_amount_cents: finalAmountCents,
    captured_amount_cents: capturedCents,
    refunded_amount_cents: refundedCents,
    supplemental_amount_cents: 0,
  });
}

export async function handleSettlementRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!authorizedInternalCaller(req)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  if (!FLOW_ENABLED) return json({ ok: false, error: "CANONICAL_SETTLEMENT_FLOW_DISABLED" }, 503);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return json({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, 503);
  if (isLiveStripeKey(stripeKey) && !LIVE_ENABLED) return json({ ok: false, error: "LIVE_SETTLEMENT_DISABLED" }, 503);

  const db = adminClient();
  let rentalSessionId = "";

  try {
    const body = await req.json().catch(() => ({}));
    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId.trim() : "";
    if (!UUID_RE.test(rentalSessionId)) return json({ ok: false, error: "INVALID_SESSION" }, 400);
    if (body.returnState !== "normal" && body.returnState !== "not_returned") {
      return json({ ok: false, error: "INVALID_RETURN_STATE" }, 400);
    }
    const returnState = body.returnState as ReturnState;
    const parsedFinalAt = typeof body.finalAt === "string" ? Date.parse(body.finalAt) : Date.now();
    if (!Number.isFinite(parsedFinalAt) || parsedFinalAt > Date.now() + 5 * 60_000) {
      return json({ ok: false, error: "INVALID_FINAL_AT" }, 400);
    }
    const finalAt = new Date(parsedFinalAt).toISOString();

    const { data: existing, error: existingError } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    if (existing.settlement_status === "legacy") return json({ ok: false, error: "LEGACY_RENTAL_NOT_SETTLEABLE" }, 409);
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
    const code = error instanceof Error ? error.message : "SETTLEMENT_INTERNAL_ERROR";
    if (rentalSessionId) {
      const { data: session } = await db.from("rental_sessions")
        .select("*").eq("id", rentalSessionId).maybeSingle();
      if (session && session.settlement_status !== "legacy") {
        await failSettlement(
          db,
          session,
          "SETTLEMENT_INTERNAL_ERROR",
          "Le règlement final a échoué et doit être réconcilié.",
          { provider_error: code },
        );
      }
    }
    await logApi(db, {
      service: "stripe",
      endpoint: "settlement",
      method: "POST",
      status_code: 500,
      request: { rentalSessionId },
      error: code,
    }).catch(() => {});
    return json({ ok: false, error: "SETTLEMENT_INTERNAL_ERROR" }, 500);
  }
}
