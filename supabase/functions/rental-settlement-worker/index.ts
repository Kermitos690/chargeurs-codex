// Asynchronous return settlement worker.
// Disabled by default; claims queued returns, computes authoritative pricing,
// settles the manual Stripe authorization, and closes the ChargeNow order.

import { adminClient, auditLog, logApi, snapshotHash } from "../_shared/db.ts";
import { isChargeNowConfigured, orderClose } from "../_shared/chargenow.ts";

const ENABLED = (Deno.env.get("ENABLE_RETURN_SETTLEMENT_WORKER") ?? "false").toLowerCase() === "true";
const WORKER_TOKEN = Deno.env.get("RENTAL_SETTLEMENT_WORKER_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function authorized(req: Request): boolean {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return Boolean(
    (WORKER_TOKEN && token && safeEqual(token, WORKER_TOKEN)) ||
    (SERVICE_ROLE && token && safeEqual(token, SERVICE_ROLE))
  );
}

async function openIncident(
  db: ReturnType<typeof adminClient>,
  rentalId: string,
  code: string,
  severity: "warning" | "critical",
  message: string,
  details: Record<string, unknown>,
) {
  await db.from("system_incidents").insert({
    type: code,
    severity,
    message,
    data: { rental_session_id: rentalId, ...details },
    resolved: false,
  }).then(() => {}, () => {});
  await db.from("rental_orchestrator_incidents").insert({
    rental_id: rentalId,
    code,
    severity,
    message,
    details,
  }).then(() => {}, () => {});
}

async function appendOrchestrator(
  db: ReturnType<typeof adminClient>,
  rentalId: string,
  eventType: string,
  state: string,
  key: string,
  metadata: Record<string, unknown>,
  finalAmountCents?: number,
) {
  const { data: snapshot } = await db.from("rental_orchestrator_snapshots")
    .select("version")
    .eq("rental_id", rentalId)
    .maybeSingle();
  if (!snapshot) return;
  await db.rpc("append_rental_orchestrator_event", {
    p_rental_id: rentalId,
    p_expected_version: Number(snapshot.version),
    p_event_type: eventType,
    p_idempotency_key: key,
    p_occurred_at: new Date().toISOString(),
    p_metadata: metadata,
    p_resulting_state: state,
    p_final_amount_chf: finalAmountCents == null ? null : finalAmountCents / 100,
  }).then(() => {}, () => {});
}

async function finishJob(
  db: ReturnType<typeof adminClient>,
  jobId: string,
  succeeded: boolean,
  result: Record<string, unknown> | null,
  error: string | null,
) {
  await db.rpc("finish_rental_settlement_job", {
    p_job_id: jobId,
    p_succeeded: succeeded,
    p_result: result,
    p_error: error,
  });
}

async function closeChargeNowOrder(
  db: ReturnType<typeof adminClient>,
  session: Record<string, unknown>,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const tradeNo = session.apifox_trade_no ? String(session.apifox_trade_no) : "";
  if (!isChargeNowConfigured()) return { ok: false, skipped: "CHARGENOW_NOT_CONFIGURED" };
  if (!tradeNo) return { ok: false, skipped: "NO_TRADE_NO" };

  const response = await orderClose({ tradeNo, orderId: tradeNo });
  await logApi(db, {
    service: "chargenow",
    endpoint: "/rent/order/close",
    method: "POST",
    status_code: response.status,
    request: { tradeNo },
    response: response.data,
    error: response.error,
  });
  return response.ok ? { ok: true } : { ok: false, error: response.error ?? "CHARGENOW_CLOSE_FAILED" };
}

async function processJob(db: ReturnType<typeof adminClient>, job: Record<string, unknown>) {
  const rentalId = String(job.rental_session_id);
  const { data: session } = await db.from("rental_sessions").select("*").eq("id", rentalId).maybeSingle();
  if (!session) throw new Error("RENTAL_NOT_FOUND");
  if (!session.returned_at || !session.started_at) throw new Error("RETURN_TIMESTAMPS_MISSING");

  if (session.settlement_status === "completed" && ["closed", "completed"].includes(String(session.state))) {
    return { rentalId, replayed: true, status: "completed" };
  }

  await db.from("rental_sessions").update({
    settlement_status: "processing",
    settlement_error: null,
  }).eq("id", rentalId);

  const { data: pricing, error: pricingError } = await db.rpc("compute_pricing", {
    p_device: session.kiosk_device_id ?? null,
    p_station: session.station_id,
    p_shop: session.shop_id ?? null,
    p_start: session.started_at,
    p_end: session.returned_at,
    p_rental_state: "battery_returned",
    p_return_state: "normal",
    p_currency: session.currency ?? "CHF",
  });
  if (pricingError || !pricing) throw new Error(`FINAL_PRICING_ERROR:${pricingError?.message ?? "EMPTY_RESULT"}`);

  const snapshot = pricing as Record<string, unknown>;
  const finalCents = Number(snapshot.final_cents ?? NaN);
  if (!Number.isInteger(finalCents) || finalCents < 0) throw new Error("FINAL_PRICING_INVALID");
  const finalHash = await snapshotHash(snapshot);

  await db.from("rental_sessions").update({
    final_pricing_snapshot: { ...snapshot, snapshot_hash: finalHash },
    final_amount_cents: finalCents,
    settlement_status: "processing",
  }).eq("id", rentalId);

  await appendOrchestrator(db, rentalId, "pricing_finalized", "pricing_finalized", `pricing:${job.id}`, {
    final_cents: finalCents,
    pricing_snapshot_hash: finalHash,
    returned_at: session.returned_at,
  }, finalCents);

  if (session.payment_flow !== "manual_authorization") {
    await db.from("rental_sessions").update({
      settlement_status: "manual_review",
      settlement_error: "LEGACY_PAYMENT_FLOW_REQUIRES_RECONCILIATION",
      state: "needs_support",
    }).eq("id", rentalId);
    await openIncident(db, rentalId, "legacy_payment_settlement_required", "warning",
      "Retour détecté sur un ancien flux de paiement ; aucun nouveau débit automatique n’a été effectué.",
      { payment_flow: session.payment_flow ?? "legacy_checkout", final_cents: finalCents });
    return { rentalId, status: "manual_review", finalCents };
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("SUPABASE_INTERNAL_CALL_NOT_CONFIGURED");
  const settlementResponse = await fetch(`${SUPABASE_URL}/functions/v1/stripe-payment-lifecycle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "X-Idempotency-Key": `return-settle:${rentalId}`,
    },
    body: JSON.stringify({
      action: "settle",
      rentalSessionId: rentalId,
      idempotencyKey: `return-settle:${rentalId}`,
      reason: "returned",
      calculatedRentalCents: finalCents,
    }),
  });
  const settlement = await settlementResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!settlementResponse.ok || settlement.ok !== true) {
    throw new Error(`STRIPE_SETTLEMENT_FAILED:${String(settlement.error ?? settlementResponse.status)}`);
  }

  const settlementStatus = String(settlement.status ?? "unknown");
  const chargeNow = await closeChargeNowOrder(db, session);

  if (!chargeNow.ok) {
    await db.from("rental_sessions").update({
      state: "needs_support",
      settlement_status: settlementStatus === "additional_payment_required" ? "additional_payment_required" : "completed",
      settlement_completed_at: settlementStatus === "additional_payment_required" ? null : new Date().toISOString(),
      settlement_error: chargeNow.skipped ?? chargeNow.error ?? "CHARGENOW_CLOSE_FAILED",
    }).eq("id", rentalId);
    await openIncident(db, rentalId, "chargenow_close_after_settlement_failed", "warning",
      "Le règlement financier a été traité mais l’ordre ChargeNow n’a pas pu être clôturé.",
      { settlement_status: settlementStatus, ...chargeNow });
    await appendOrchestrator(db, rentalId, "payment_captured", "payment_captured", `payment:${job.id}`, {
      settlement_status: settlementStatus,
      chargenow_closed: false,
    }, finalCents);
    return { rentalId, status: "needs_support", settlementStatus, finalCents, chargeNow };
  }

  if (settlementStatus === "additional_payment_required") {
    await db.from("rental_sessions").update({
      state: "needs_support",
      settlement_status: "additional_payment_required",
      settlement_error: "ADDITIONAL_PAYMENT_REQUIRED",
      closed_at: new Date().toISOString(),
    }).eq("id", rentalId);
    await openIncident(db, rentalId, "additional_payment_required", "warning",
      "La batterie est revenue et l’ordre fournisseur est clôturé, mais un complément de paiement reste requis.",
      { final_cents: finalCents, additional_amount_cents: session.additional_amount_cents ?? null });
    await appendOrchestrator(db, rentalId, "payment_captured", "payment_captured", `payment:${job.id}`, {
      settlement_status: settlementStatus,
      chargenow_closed: true,
    }, finalCents);
    return { rentalId, status: settlementStatus, finalCents, chargeNow };
  }

  const completedAt = new Date().toISOString();
  await db.from("rental_sessions").update({
    state: "completed",
    closed_at: completedAt,
    settlement_status: "completed",
    settlement_completed_at: completedAt,
    settlement_error: null,
  }).eq("id", rentalId);
  await appendOrchestrator(db, rentalId, "payment_captured", "payment_captured", `payment:${job.id}`, {
    settlement_status: settlementStatus,
    chargenow_closed: true,
  }, finalCents);
  await appendOrchestrator(db, rentalId, "completed", "completed", `completed:${job.id}`, {
    settlement_status: settlementStatus,
    chargenow_closed: true,
  }, finalCents);
  await auditLog(db, { actor: "system", action: "rental.settlement.completed", target: rentalId, data: { final_cents: finalCents, settlement_status: settlementStatus } });
  return { rentalId, status: "completed", finalCents, chargeNow };
}

Deno.serve(async (req) => {
  if (!authorized(req)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  if (!ENABLED) return json({ ok: false, error: "RETURN_SETTLEMENT_WORKER_DISABLED" }, 503);

  const db = adminClient();
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit ?? 10), 50));
    const { data: jobs, error } = await db.rpc("claim_rental_settlement_jobs", { p_limit: limit });
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs ?? []) {
      try {
        const result = await processJob(db, job as Record<string, unknown>);
        await finishJob(db, String(job.id), true, result, null);
        results.push({ jobId: job.id, ok: true, ...result });
      } catch (error) {
        const message = String((error as Error)?.message ?? error);
        await db.from("rental_sessions").update({ settlement_status: "failed", settlement_error: message })
          .eq("id", job.rental_session_id);
        await finishJob(db, String(job.id), false, null, message);
        await openIncident(db, String(job.rental_session_id), "rental_settlement_failed", "critical",
          "Le règlement automatique de la location a échoué.",
          { job_id: job.id, error: message, attempt_count: job.attempt_count });
        results.push({ jobId: job.id, rentalId: job.rental_session_id, ok: false, error: message });
      }
    }

    return json({ ok: true, claimed: (jobs ?? []).length, results });
  } catch (error) {
    return json({ ok: false, error: "SETTLEMENT_WORKER_ERROR", detail: String(error) }, 500);
  }
});
