// eject-after-payment — runs ONLY after a confirmed Stripe payment (called by
// stripe-webhook) or by an admin tool. State machine (release lifecycle):
//   payment_succeeded → ejecting (release_requested) → ejected (release_confirmed)
//   on failure → chargenow_failed / eject_failed (release_failed) → refund_pending → refunded
// (1) creates the ChargeNow rent order (O2), then (2) ejects the battery (C3).
// Idempotent and guarded against double order / double ejection. On unrecoverable
// failure after payment it triggers an IDEMPOTENT refund (never exceeding the
// captured amount), opens an incident, and logs a full audit trail.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, logApi, auditLog } from "../_shared/db.ts";
import { ejectByRent, isChargeNowConfigured, orderCreate } from "../_shared/chargenow.ts";

const MAX_RETRIES = 3;

type DB = ReturnType<typeof adminClient>;

// Idempotent refund (or wallet credit) after a post-payment failure.
// Never refunds twice and never exceeds the captured amount.
async function refundOnFailure(db: DB, session: Record<string, unknown>, code: string) {
  const sessionId = session.id as string;
  // 1. Idempotency guard — a refund row already exists for this session.
  const { data: existing } = await db.from("refunds")
    .select("id,status").eq("rental_session_id", sessionId)
    .in("status", ["pending", "succeeded", "processing"]).maybeSingle();
  if (existing) {
    await auditLog(db, { action: "refund.skipped.duplicate", target: sessionId, data: { code } });
    return;
  }

  // 2. Always open an incident for human follow-up.
  await db.from("system_incidents").insert({
    type: "eject_failed_after_payment", severity: "high",
    message: `Échec post-paiement (${code}) — remboursement automatique déclenché.`,
    data: { rental_session_id: sessionId, code, station_id: session.station_id },
  });

  const pi = session.stripe_payment_intent_id as string | null;
  const capturedCents = Math.round(Number(session.amount_paid ?? session.amount_expected ?? 0) * 100);
  if (!pi || capturedCents <= 0) {
    // Nothing captured yet — mark for manual review, no money to refund.
    await db.from("rental_sessions").update({ state: "needs_support" }).eq("id", sessionId);
    await auditLog(db, { action: "refund.not_applicable", target: sessionId, data: { code, capturedCents } });
    return;
  }

  await db.from("rental_sessions").update({ state: "refund_pending" }).eq("id", sessionId);
  const { data: refundRow } = await db.from("refunds").insert({
    rental_session_id: sessionId, amount: capturedCents / 100,
    currency: session.currency ?? "CHF", status: "pending",
    reason: code, created_by: "system",
  }).select().single();

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) {
    await auditLog(db, { action: "refund.error", target: sessionId, data: { code: "STRIPE_NOT_CONFIGURED" } });
    return;
  }
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia", httpClient: Stripe.createFetchHttpClient() });
  try {
    // Stripe refund without an explicit amount = full captured amount → cannot exceed it.
    // Idempotency key bound to the session prevents accidental double refunds.
    const refund = await stripe.refunds.create(
      { payment_intent: pi, reason: "requested_by_customer" },
      { idempotencyKey: `refund_${sessionId}` },
    );
    await db.from("refunds").update({
      status: refund.status === "succeeded" ? "succeeded" : "processing",
      stripe_refund_id: refund.id,
    }).eq("id", refundRow?.id);
    await db.from("payments").update({
      status: "refunded", refund_id: refund.id, refunded_at: new Date().toISOString(),
    }).eq("stripe_payment_intent_id", pi);
    await db.from("rental_sessions").update({
      state: refund.status === "succeeded" ? "refunded" : "refund_pending",
    }).eq("id", sessionId);
    await auditLog(db, {
      action: "refund.issued", target: sessionId,
      data: { code, stripe_refund_id: refund.id, amount_cents: capturedCents, status: refund.status },
    });
  } catch (e) {
    await db.from("refunds").update({ status: "error" }).eq("id", refundRow?.id);
    await auditLog(db, { action: "refund.error", target: sessionId, data: { code, error: String(e) } });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = adminClient();
  const ok = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { rentalSessionId } = await req.json();
    const { data: session } = await db.from("rental_sessions")
      .select("*").eq("id", rentalSessionId).maybeSingle();
    if (!session) return ok({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    // Already released — idempotent success.
    if (["ejected", "battery_taken", "active_rental", "battery_returned", "closed", "completed"].includes(session.state)) {
      return ok({ ok: true, alreadyDone: true });
    }
    // Already refunded / refunding — do not re-eject.
    if (["refund_pending", "refunded"].includes(session.state)) {
      return ok({ ok: true, refunded: true, state: session.state });
    }
    // Must be paid (defence in depth).
    if (!["payment_succeeded", "ejecting", "chargenow_failed", "eject_failed"].includes(session.state)) {
      return ok({ ok: false, error: "NOT_PAID", state: session.state }, 409);
    }

    if (!isChargeNowConfigured()) {
      await db.from("rental_sessions").update({
        state: "chargenow_failed", failure_code: "CHARGENOW_NOT_CONFIGURED",
        failure_message: "API ChargeNow non configurée — éjection impossible.",
      }).eq("id", session.id);
      await refundOnFailure(db, session, "CHARGENOW_NOT_CONFIGURED");
      return ok({ ok: false, error: "CHARGENOW_NOT_CONFIGURED" });
    }

    const retry = Number(session.retry_count ?? 0);
    if (retry >= MAX_RETRIES) {
      await db.from("rental_sessions").update({
        state: "eject_failed", failure_code: "MAX_RETRIES",
        failure_message: "Nombre maximal de tentatives atteint.",
      }).eq("id", session.id);
      await refundOnFailure(db, session, "MAX_RETRIES");
      return ok({ ok: false, error: "MAX_RETRIES" });
    }

    // Lock the row into "ejecting" (release_requested) atomically — guards double ejection.
    const { data: locked } = await db.from("rental_sessions")
      .update({ state: "ejecting", retry_count: retry + 1 })
      .eq("id", session.id)
      .in("state", ["payment_succeeded", "chargenow_failed", "eject_failed"])
      .select();
    if (!locked || locked.length === 0) {
      // Someone else already moved it (e.g. concurrent ejecting). No double ejection.
      return ok({ ok: true, alreadyInProgress: true });
    }

    const cabinetId = session.cabinet_id || session.station_id;

    // ---- Step 1: create ChargeNow rent order (O2) if not already created ----
    let tradeNo: string | null = session.apifox_trade_no ?? null;
    if (!tradeNo) {
      const callbackURL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/chargenow-rent-callback`;
      const ord = await orderCreate({ deviceId: cabinetId, callbackURL });
      await logApi(db, {
        service: "chargenow", endpoint: "/rent/order/create", method: "POST",
        status_code: ord.status, request: { cabinetId }, response: ord.data, error: ord.error,
      });
      const d = ord.data as { data?: { tradeNo?: string; orderId?: string }; tradeNo?: string } | null;
      tradeNo = d?.data?.tradeNo ?? d?.tradeNo ?? null;
      const orderId = d?.data?.orderId ?? null;

      await db.from("apifox_orders").upsert({
        rental_session_id: session.id, trade_no: tradeNo,
        request: { cabinetId }, response: ord.data, status: ord.ok ? "created" : "error",
      }, { onConflict: "rental_session_id" });

      if (!ord.ok || !tradeNo) {
        await db.from("rental_sessions").update({
          state: "chargenow_failed", failure_code: ord.error ?? "ORDER_FAILED",
          failure_message: "Paiement reçu mais commande ChargeNow impossible — remboursement en cours.",
        }).eq("id", session.id);
        await refundOnFailure(db, session, ord.error ?? "ORDER_FAILED");
        return ok({ ok: false, error: ord.error ?? "ORDER_FAILED" });
      }
      await db.from("rental_sessions").update({
        apifox_trade_no: tradeNo, chargenow_order_id: orderId, chargenow_status: "created",
      }).eq("id", session.id);
    }

    // ---- Step 2: eject the battery (C3) ----
    const slotNum = session.selected_slot_num ?? 0;
    const res = await ejectByRent(cabinetId, slotNum, tradeNo ?? undefined);
    await logApi(db, {
      service: "chargenow", endpoint: "/cabinet/ejectByRent", method: "POST",
      status_code: res.status, request: { cabinetId, slotNum }, response: res.data, error: res.error,
    });

    if (res.ok) {
      // release_confirmed — rental activated only now.
      await db.from("rental_sessions").update({
        state: "ejected", ejected_at: new Date().toISOString(),
        chargenow_status: "ejected", started_at: new Date().toISOString(),
      }).eq("id", session.id);
      await auditLog(db, { action: "rental.released", target: session.id, data: { cabinetId, slotNum, tradeNo } });
      return ok({ ok: true, slotNum });
    }

    // release_failed — money captured but no battery → refund.
    await db.from("rental_sessions").update({
      state: "eject_failed", failure_code: res.error,
      failure_message: "Éjection échouée après paiement — remboursement automatique en cours.",
    }).eq("id", session.id);
    const { data: fresh } = await db.from("rental_sessions").select("*").eq("id", session.id).maybeSingle();
    await refundOnFailure(db, fresh ?? session, res.error ?? "EJECT_FAILED");
    return ok({ ok: false, error: res.error });
  } catch (e) {
    return ok({ ok: false, error: String(e) }, 500);
  }
});
