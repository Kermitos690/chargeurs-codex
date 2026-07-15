import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { adminClient, auditLog, logApi } from "./db.ts";
import { planFailedReleaseCompensation } from "./depositCompensationPlan.ts";

const REQUIRED_DEPOSIT_CENTS = 3_000;
const LIVE_ENABLED = (Deno.env.get("ENABLE_CANONICAL_SETTLEMENT_LIVE") ?? "false").toLowerCase() === "true";

type DB = ReturnType<typeof adminClient>;
type Session = Record<string, unknown>;

export type FailedReleaseCompensationResult = {
  ok: boolean;
  action: "cancel_authorization" | "refund_captured_balance" | "already_compensated" | "manual_review";
  capturedCents: number;
  refundedCents: number;
  code: string;
};

function cents(value: unknown): number {
  const normalized = Math.round(Number(value ?? 0));
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error("INVALID_AMOUNT");
  return normalized;
}

async function openIncident(
  db: DB,
  session: Session,
  code: string,
  details: Record<string, unknown>,
): Promise<void> {
  const rentalSessionId = String(session.id);
  const { data: existing } = await db.from("system_incidents")
    .select("id")
    .eq("type", "eject_failed_after_payment")
    .eq("resolved", false)
    .contains("data", { rental_session_id: rentalSessionId, code })
    .limit(1)
    .maybeSingle();

  if (!existing) {
    await db.from("system_incidents").insert({
      type: "eject_failed_after_payment",
      severity: "high",
      message: "La batterie n'a pas été délivrée. La caution a été annulée ou remboursée lorsque Stripe le permettait.",
      data: {
        rental_session_id: rentalSessionId,
        station_id: session.station_id ?? null,
        code,
        ...details,
      },
      resolved: false,
    });
  }
}

async function markManualReview(
  db: DB,
  session: Session,
  code: string,
  details: Record<string, unknown> = {},
): Promise<FailedReleaseCompensationResult> {
  await db.from("rental_sessions").update({
    state: "needs_support",
    settlement_status: "manual_review",
    settlement_error: code,
    settlement_locked_at: null,
    failure_code: code,
    failure_message: "La caution doit être vérifiée manuellement après l'échec de délivrance.",
  }).eq("id", session.id).neq("settlement_status", "legacy");
  await openIncident(db, session, code, details);
  await auditLog(db, {
    action: "deposit.compensation.manual_review",
    target: String(session.id),
    data: { code, ...details },
  });
  return { ok: false, action: "manual_review", capturedCents: 0, refundedCents: 0, code };
}

export async function compensateFailedRelease(
  db: DB,
  session: Session,
  failureCode: string,
): Promise<FailedReleaseCompensationResult> {
  const rentalSessionId = String(session.id ?? "");
  if (!rentalSessionId) throw new Error("SESSION_ID_MISSING");
  if (session.settlement_status === "legacy") {
    return await markManualReview(db, session, "LEGACY_PAYMENT_COMPENSATION_BLOCKED", { failure_code: failureCode });
  }

  const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
  if (!paymentIntentId) {
    return await markManualReview(db, session, "PAYMENT_INTENT_MISSING", { failure_code: failureCode });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) {
    return await markManualReview(db, session, "STRIPE_NOT_CONFIGURED", { failure_code: failureCode });
  }
  if (stripeKey.startsWith("sk_live_") && !LIVE_ENABLED) {
    return await markManualReview(db, session, "LIVE_SETTLEMENT_DISABLED", { failure_code: failureCode });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (intent.metadata?.rental_session_id !== rentalSessionId) {
    return await markManualReview(db, session, "PAYMENT_INTENT_OWNERSHIP_MISMATCH", {
      failure_code: failureCode,
      payment_intent: paymentIntentId,
    });
  }
  if (intent.currency.toLowerCase() !== String(session.currency ?? "CHF").toLowerCase()) {
    return await markManualReview(db, session, "PAYMENT_CURRENCY_MISMATCH", { failure_code: failureCode });
  }
  if (cents(intent.amount) !== REQUIRED_DEPOSIT_CENTS || cents(session.deposit_amount_cents) !== REQUIRED_DEPOSIT_CENTS) {
    return await markManualReview(db, session, "DEPOSIT_AMOUNT_MISMATCH", {
      failure_code: failureCode,
      provider_amount_cents: intent.amount,
      stored_amount_cents: session.deposit_amount_cents,
    });
  }

  let providerRefundedCents = 0;
  const latestChargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  if (latestChargeId) {
    try {
      const charge = await stripe.charges.retrieve(latestChargeId);
      providerRefundedCents = cents(charge.amount_refunded);
    } catch {
      // Session values remain the fallback; ambiguous provider states fail at the plan stage if no safe action exists.
    }
  }

  const alreadyRefundedCents = Math.max(cents(session.refunded_amount_cents), providerRefundedCents);
  const plan = planFailedReleaseCompensation({
    paymentIntentStatus: intent.status,
    amountReceivedCents: cents(intent.amount_received),
    amountCapturableCents: cents(intent.amount_capturable),
    amountAlreadyRefundedCents: alreadyRefundedCents,
  });

  let refundedCents = alreadyRefundedCents;
  let compensationReference: string | null = null;

  if (plan.action === "manual_review") {
    return await markManualReview(db, session, "UNSAFE_PAYMENT_INTENT_STATE", {
      failure_code: failureCode,
      payment_intent_status: intent.status,
    });
  }

  if (plan.action === "cancel_authorization") {
    const cancelled = await stripe.paymentIntents.cancel(
      paymentIntentId,
      {},
      { idempotencyKey: `failed_release_cancel_${rentalSessionId}` },
    );
    compensationReference = cancelled.id;
    await logApi(db, {
      service: "stripe",
      endpoint: "payment_intents.cancel",
      method: "POST",
      status_code: 200,
      request: { rentalSessionId, failureCode },
      response: { id: cancelled.id, status: cancelled.status },
    });
  }

  if (plan.action === "refund_captured_balance") {
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: plan.refundCents,
        reason: "requested_by_customer",
        metadata: {
          rental_session_id: rentalSessionId,
          compensation_reason: "battery_not_delivered",
          failure_code: failureCode,
        },
      },
      { idempotencyKey: `failed_release_refund_${rentalSessionId}_${plan.refundCents}` },
    );
    compensationReference = refund.id;
    refundedCents = alreadyRefundedCents + plan.refundCents;

    const { data: existingRefund } = await db.from("refunds")
      .select("id")
      .eq("stripe_refund_id", refund.id)
      .maybeSingle();
    if (!existingRefund) {
      await db.from("refunds").insert({
        rental_session_id: rentalSessionId,
        amount: plan.refundCents / 100,
        currency: session.currency ?? "CHF",
        status: refund.status === "succeeded" ? "succeeded" : "processing",
        reason: failureCode,
        created_by: "system",
        stripe_refund_id: refund.id,
      });
    }

    await logApi(db, {
      service: "stripe",
      endpoint: "refunds.create",
      method: "POST",
      status_code: 200,
      request: { rentalSessionId, failureCode, amount_cents: plan.refundCents },
      response: { id: refund.id, status: refund.status },
    });
  }

  const capturedCents = cents(intent.amount_received);
  const fullyRefunded = capturedCents > 0 && refundedCents >= capturedCents;
  const finalState = fullyRefunded ? "refunded" : "eject_failed";
  const failureMessage = plan.action === "cancel_authorization"
    ? "La batterie n'a pas été délivrée et l'autorisation de 30 CHF a été annulée."
    : fullyRefunded
      ? "La batterie n'a pas été délivrée et la caution capturée a été remboursée."
      : "La batterie n'a pas été délivrée. La compensation Stripe est déjà enregistrée.";

  const paymentPatch: Record<string, unknown> = {
    amount_captured_cents: capturedCents,
    amount_refunded_cents: refundedCents,
  };
  if (fullyRefunded) paymentPatch.status = "refunded";
  if (plan.action === "cancel_authorization") paymentPatch.status = "cancelled";
  await db.from("payments").update(paymentPatch).eq("stripe_payment_intent_id", paymentIntentId);

  const { error: sessionError } = await db.from("rental_sessions").update({
    state: finalState,
    captured_amount_cents: capturedCents,
    refunded_amount_cents: refundedCents,
    amount_paid: Math.max(0, capturedCents - refundedCents) / 100,
    settlement_status: "failed",
    settlement_error: failureCode,
    settlement_locked_at: null,
    failure_code: failureCode,
    failure_message: failureMessage,
  }).eq("id", rentalSessionId).neq("settlement_status", "legacy");
  if (sessionError) throw sessionError;

  await openIncident(db, session, failureCode, {
    action: plan.action,
    payment_intent: paymentIntentId,
    compensation_reference: compensationReference,
    captured_cents: capturedCents,
    refunded_cents: refundedCents,
  });
  await auditLog(db, {
    action: `deposit.compensation.${plan.action}`,
    target: rentalSessionId,
    data: {
      failure_code: failureCode,
      payment_intent: paymentIntentId,
      compensation_reference: compensationReference,
      captured_cents: capturedCents,
      refunded_cents: refundedCents,
    },
  });

  return {
    ok: true,
    action: plan.action,
    capturedCents,
    refundedCents,
    code: failureCode,
  };
}
