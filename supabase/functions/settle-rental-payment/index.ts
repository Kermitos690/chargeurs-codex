// settle-rental-payment — finalizes the financial side of a rental after a
// trusted return signal or a non-return decision.
//
// Internal endpoint only. It computes the final price server-side, then:
//  - card/manual capture: captures only the final amount from the 30 CHF hold;
//  - TWINT/automatic capture: refunds the unused part of the 30 CHF prepayment;
//  - final amount above 30 CHF: attempts an off-session supplemental payment;
//  - if supplemental collection cannot complete safely, opens an incident and
//    keeps the session in supplemental_required/manual review.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog, logApi } from "../_shared/db.ts";
import { planSettlement, resolveSettlementStrategy } from "../_shared/settlement.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOCK_TTL_MINUTES = 10;

type DB = ReturnType<typeof adminClient>;
type ReturnState = "normal" | "not_returned";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function authorizedInternalCaller(req: Request): boolean {
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(provided, SERVICE_ROLE_KEY);
}

function amount(value: unknown): number {
  const result = Math.round(Number(value ?? 0));
  if (!Number.isFinite(result) || result < 0) throw new Error("INVALID_AMOUNT");
  return result;
}

async function paymentMethodType(stripe: Stripe, intent: Stripe.PaymentIntent): Promise<string> {
  const id = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (id) {
    try {
      const method = await stripe.paymentMethods.retrieve(id);
      if (method.type) return method.type;
    } catch (_) { /* use the PaymentIntent fallback */ }
  }
  return intent.payment_method_types?.[0] ?? "unknown";
}

async function openIncident(
  db: DB,
  session: Record<string, unknown>,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  await db.from("system_incidents").insert({
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
  await auditLog(db, {
    action: "settlement.incident.opened",
    target: String(session.id),
    data: { code, ...details },
  });
}

async function failSettlement(
  db: DB,
  session: Record<string, unknown>,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  await db.from("rental_sessions").update({
    settlement_status: "failed",
    settlement_error: code,
    settlement_locked_at: null,
    state: "needs_support",
    failure_code: code,
    failure_message: message,
  }).eq("id", session.id);
  await openIncident(db, session, code, message, details);
}

async function claimSettlement(db: DB, rentalSessionId: string) {
  const staleBefore = new Date(Date.now() - LOCK_TTL_MINUTES * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await db.from("rental_sessions").update({
    settlement_status: "settling",
    settlement_locked_at: now,
  }).eq("id", rentalSessionId)
    .in("settlement_status", ["pending", "authorized", "prepaid", "failed", "supplemental_required"])
    .or(`settlement_locked_at.is.null,settlement_locked_at.lt.${staleBefore}`)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizedInternalCaller(req)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  if (!STRIPE_KEY) return json({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, 503);

  const db = adminClient();
  let rentalSessionId = "";

  try {
    const body = await req.json();
    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    const returnState: ReturnState = body.returnState === "not_returned" ? "not_returned" : "normal";
    const finalAt = typeof body.finalAt === "string" && Number.isFinite(Date.parse(body.finalAt))
      ? body.finalAt
      : new Date().toISOString();

    if (!rentalSessionId) return json({ ok: false, error: "MISSING_SESSION" }, 400);

    const { data: existing } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
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
    if (!session) {
      return json({ ok: true, already_in_progress: true }, 202);
    }

    await db.from("rental_sessions").update({
      settlement_attempts: Number(session.settlement_attempts ?? 0) + 1,
    }).eq("id", session.id);

    const startAt = session.started_at ?? session.ejected_at ?? session.created_at;
    const effectiveEnd = returnState === "normal"
      ? session.returned_at ?? finalAt
      : finalAt;

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
      await failSettlement(
        db,
        session,
        "FINAL_PRICING_ERROR",
        "Le tarif final n'a pas pu être calculé automatiquement.",
        { pricing_error: pricingError?.message ?? null },
      );
      return json({ ok: false, error: "FINAL_PRICING_ERROR" }, 409);
    }

    const finalAmountCents = amount((pricing as Record<string, unknown>).final_cents);
    const depositAmountCents = amount(
      session.deposit_amount_cents ??
      (session.pricing_snapshot as Record<string, unknown> | null)?.deposit_cents ??
      0,
    );
    if (depositAmountCents <= 0) {
      await failSettlement(db, session, "DEPOSIT_NOT_CONFIGURED", "La caution de la location est introuvable.");
      return json({ ok: false, error: "DEPOSIT_NOT_CONFIGURED" }, 409);
    }

    const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
    if (!paymentIntentId) {
      await failSettlement(db, session, "PAYMENT_INTENT_MISSING", "Le paiement initial de la location est introuvable.");
      return json({ ok: false, error: "PAYMENT_INTENT_MISSING" }, 409);
    }

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    let intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const methodType = await paymentMethodType(stripe, intent);
    const storedStrategy = session.settlement_strategy === "manual_capture" || session.settlement_strategy === "prepaid_refund"
      ? session.settlement_strategy
      : null;
    const strategy = storedStrategy ?? resolveSettlementStrategy({
      paymentMethodType: methodType,
      captureMethod: intent.capture_method,
    });

    const alreadyCapturedCents = Math.max(
      amount(session.captured_amount_cents),
      amount(intent.amount_received),
    );
    const alreadyRefundedCents = amount(session.refunded_amount_cents);

    // A previously captured manual PaymentIntent must be treated as captured on
    // retry. This prevents a second capture after a DB/network failure.
    const planningStrategy = strategy === "manual_capture" && intent.status !== "requires_capture"
      ? "prepaid_refund"
      : strategy;

    const plan = planSettlement({
      strategy: planningStrategy,
      finalAmountCents,
      depositAmountCents,
      amountCapturableCents: amount(intent.amount_capturable || depositAmountCents),
      amountCapturedCents: alreadyCapturedCents,
      amountAlreadyRefundedCents: alreadyRefundedCents,
    });

    let capturedCents = alreadyCapturedCents;
    let refundedCents = alreadyRefundedCents;
    let supplementalCapturedCents = 0;
    let supplementalPaymentIntentId: string | null = session.stripe_supplemental_payment_intent_id ?? null;

    if (plan.cancelAuthorization && intent.status === "requires_capture") {
      intent = await stripe.paymentIntents.cancel(
        paymentIntentId,
        {},
        { idempotencyKey: `settlement_cancel_${session.id}` },
      );
      await logApi(db, {
        service: "stripe", endpoint: "payment_intents.cancel", method: "POST", status_code: 200,
        request: { rentalSessionId: session.id }, response: { id: intent.id, status: intent.status },
      });
    }

    if (plan.captureCents > 0 && intent.status === "requires_capture") {
      intent = await stripe.paymentIntents.capture(
        paymentIntentId,
        { amount_to_capture: plan.captureCents },
        { idempotencyKey: `settlement_capture_${session.id}_${plan.captureCents}` },
      );
      capturedCents = amount(intent.amount_received || plan.captureCents);
      await logApi(db, {
        service: "stripe", endpoint: "payment_intents.capture", method: "POST", status_code: 200,
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
        service: "stripe", endpoint: "refunds.create", method: "POST", status_code: 200,
        request: { rentalSessionId: session.id, amount_cents: plan.refundCents },
        response: { id: refund.id, status: refund.status },
      });
    }

    if (plan.supplementalCents > 0) {
      const customerId = String(session.stripe_customer_id ?? "");
      const paymentMethodId = String(session.stripe_payment_method_id ?? "");
      if (!customerId || !paymentMethodId) {
        await db.from("rental_sessions").update({
          final_amount_cents: finalAmountCents,
          captured_amount_cents: capturedCents,
          refunded_amount_cents: refundedCents,
          supplemental_amount_cents: plan.supplementalCents,
          settlement_strategy: strategy,
          settlement_status: "supplemental_required",
          settlement_error: "SAVED_PAYMENT_METHOD_MISSING",
          settlement_locked_at: null,
          state: "needs_support",
        }).eq("id", session.id);
        await openIncident(
          db,
          session,
          "SUPPLEMENTAL_PAYMENT_REQUIRED",
          "Le montant final dépasse la caution et aucun moyen de paiement réutilisable n'est disponible.",
          { supplemental_cents: plan.supplementalCents },
        );
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
        }, { idempotencyKey: `settlement_supplemental_${session.id}_${plan.supplementalCents}` });

        supplementalPaymentIntentId = supplemental.id;
        if (supplemental.status === "succeeded") {
          supplementalCapturedCents = amount(supplemental.amount_received || plan.supplementalCents);
        } else {
          throw new Error(`SUPPLEMENTAL_${supplemental.status.toUpperCase()}`);
        }
      } catch (error) {
        await db.from("rental_sessions").update({
          final_amount_cents: finalAmountCents,
          captured_amount_cents: capturedCents,
          refunded_amount_cents: refundedCents,
          supplemental_amount_cents: plan.supplementalCents,
          stripe_supplemental_payment_intent_id: supplementalPaymentIntentId,
          settlement_strategy: strategy,
          settlement_status: "supplemental_required",
          settlement_error: "SUPPLEMENTAL_COLLECTION_FAILED",
          settlement_locked_at: null,
          state: "needs_support",
        }).eq("id", session.id);
        await openIncident(
          db,
          session,
          "SUPPLEMENTAL_PAYMENT_REQUIRED",
          "Le complément de location nécessite une intervention ou une authentification du client.",
          { supplemental_cents: plan.supplementalCents, error: String(error) },
        );
        return json({
          ok: false,
          requires_action: true,
          error: "SUPPLEMENTAL_COLLECTION_FAILED",
          supplemental_cents: plan.supplementalCents,
        }, 409);
      }
    }

    const totalCapturedCents = capturedCents + supplementalCapturedCents;
    const completedAt = new Date().toISOString();

    await db.from("payments").update({
      status: refundedCents > 0
        ? (refundedCents >= totalCapturedCents ? "refunded" : "partially_refunded")
        : "succeeded",
      settlement_strategy: strategy,
      amount_captured_cents: totalCapturedCents,
      amount_refunded_cents: refundedCents,
    }).eq("rental_session_id", session.id);

    await db.from("rental_sessions").update({
      final_amount_cents: finalAmountCents,
      amount: finalAmountCents / 100,
      amount_paid: (totalCapturedCents - refundedCents) / 100,
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
    }).eq("id", session.id);

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
  } catch (error) {
    if (rentalSessionId) {
      const { data: session } = await db.from("rental_sessions")
        .select("*").eq("id", rentalSessionId).maybeSingle();
      if (session) {
        await failSettlement(
          db,
          session,
          "SETTLEMENT_INTERNAL_ERROR",
          "Le règlement final a échoué et doit être réconcilié.",
          { error: String(error) },
        );
      }
    }
    return json({ ok: false, error: "SETTLEMENT_INTERNAL_ERROR" }, 500);
  }
});
