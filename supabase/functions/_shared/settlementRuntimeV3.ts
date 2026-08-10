import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { validateStripeTestRuntime } from "./stripeRuntimeConfig.ts";
import { adminClient, auditLog, logApi, snapshotHash } from "./db.ts";
import { planSettlement, resolveSettlementStrategy, type SettlementStrategy } from "./settlement.ts";
import { appendRentalEvent, OrchestratorError } from "./rentalOrchestratorRuntime.ts";
import { computeFinalPricingFromSnapshot, PricingSnapshotError } from "./pricingSnapshot.ts";

const STRIPE_API_VERSION = "2025-09-30.clover" as any;
const LOCK_TTL_MINUTES = 10;
type DB = ReturnType<typeof adminClient>;
type ReturnState = "normal" | "not_returned";
type Session = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function authorized(req: Request) {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(provided, expected);
}
function cents(value: unknown) {
  const n = Math.round(Number(value ?? 0));
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_AMOUNT");
  return n;
}
function errorCode(error: unknown) {
  if (error instanceof OrchestratorError) return error.code;
  if (error instanceof PricingSnapshotError) return error.code;
  const e = error as any;
  const rawCode = typeof e?.code === "string" ? e.code.trim() : "";
  const stripeLike = typeof e?.type === "string" && e.type.startsWith("Stripe");
  if (rawCode) return `${stripeLike ? "STRIPE" : "DB"}_${rawCode.toUpperCase()}`.slice(0, 120);
  if (error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)) return error.message.slice(0, 120);
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}
function diagnostic(error: unknown) {
  const e = error as any;
  const clean = (v: unknown, max = 240) => typeof v === "string"
    ? v.replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+/g, "[REDACTED_KEY]")
      .replace(/whsec_[A-Za-z0-9]+/g, "[REDACTED_WEBHOOK_SECRET]").slice(0, max)
    : null;
  return {
    type: clean(e?.type, 80), code: clean(e?.code, 120), decline_code: clean(e?.decline_code, 120),
    param: clean(e?.param, 120), request_id: clean(e?.requestId, 120), message: clean(e?.message, 320),
  };
}
async function paymentMethodType(stripe: Stripe, intent: Stripe.PaymentIntent) {
  const id = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (id) try { const method = await stripe.paymentMethods.retrieve(id); if (method.type) return method.type; } catch {}
  return intent.payment_method_types?.[0] ?? "unknown";
}
function cardCaptureMethod(intent: Stripe.PaymentIntent) {
  const value = (intent.payment_method_options as any)?.card?.capture_method;
  return typeof value === "string" ? value : null;
}
function resolveStrategy(session: Session, intent: Stripe.PaymentIntent, method: string): SettlementStrategy {
  if (session.settlement_strategy === "manual_capture" || session.settlement_strategy === "prepaid_refund") return session.settlement_strategy;
  if (method === "card" && intent.status === "requires_capture" && cents(intent.amount_capturable) > 0) return "manual_capture";
  if (method === "card" && cardCaptureMethod(intent) === "manual") return "manual_capture";
  return resolveSettlementStrategy({ paymentMethodType: method, captureMethod: intent.capture_method });
}
async function orchestratorState(db: DB, rentalId: string): Promise<string | null> {
  const { data, error } = await db.from("rental_orchestrator_snapshots").select("state").eq("rental_id", rentalId).maybeSingle();
  if (error) throw error;
  return typeof data?.state === "string" ? data.state : null;
}
async function openIncident(db: DB, session: Session, code: string, message: string, details: Record<string, unknown> = {}) {
  const { error } = await db.from("system_incidents").insert({ type: "payment_settlement", severity: code === "SUPPLEMENTAL_PAYMENT_REQUIRED" ? "warning" : "high", message, data: { rental_session_id: session.id, station_id: session.station_id, code, ...details }, resolved: false });
  if (error) throw error;
  await auditLog(db, { action: "settlement.incident.opened", target: String(session.id), data: { code, ...details } });
}
async function recordFailure(db: DB, session: Session, code: string, message: string, details: Record<string, unknown> = {}) {
  const { error } = await db.from("rental_sessions").update({ settlement_status: "failed", settlement_error: code, settlement_locked_at: null, failure_code: code, failure_message: message }).eq("id", session.id);
  if (error) throw error;
  await openIncident(db, session, code, message, { retryable: true, ...details });
}
async function recordPricingFailure(db: DB, session: Session, code: string, message: string) {
  const { error } = await db.from("rental_sessions").update({ settlement_status: "manual_review", settlement_error: code, settlement_locked_at: null, state: "needs_support", failure_code: code, failure_message: message }).eq("id", session.id);
  if (error) throw error;
  await openIncident(db, session, code, message, { retryable: false });
}
async function claimSettlement(db: DB, rentalId: string): Promise<Session | null> {
  const { data, error } = await db.rpc("claim_rental_settlement", { p_rental_id: rentalId, p_lock_ttl_minutes: LOCK_TTL_MINUTES });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  // PostgREST can serialize a SQL NULL composite as an object whose fields are
  // all null. Treat it as "not claimed" instead of attempting id=null queries.
  if (!row || typeof row.id !== "string" || !row.id) return null;
  return row as Session;
}
async function appendPricingFinalized(db: DB, session: Session, returnState: ReturnState, finalAmountCents: number, pricing: Record<string, unknown>) {
  const state = await orchestratorState(db, String(session.id));
  if (!state) throw new OrchestratorError("ORCHESTRATOR_SNAPSHOT_MISSING");
  if (!["return_detected", "non_return", "pricing_finalized", "payment_captured", "refunded", "completed"].includes(state)) throw new OrchestratorError("SETTLEMENT_STATE_NOT_READY", `Settlement refused from ${state}`);
  await appendRentalEvent(db, { rentalId: String(session.id), eventType: "pricing_finalized", idempotencyKey: `pricing_finalized:${session.id}:${returnState}:${finalAmountCents}`, paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null, stationId: String(session.station_id ?? "") || null, batteryId: String(session.battery_id ?? "") || null, finalAmountChf: finalAmountCents / 100, metadata: { returnState, finalAmountCents, pricingSnapshot: pricing } });
}
async function persistFinancialProgress(db: DB, session: Session, input: { capturedCents: number; refundedCents: number; supplementalCents: number; supplementalPaymentIntentId?: string | null }) {
  const { error } = await db.from("rental_sessions").update({ captured_amount_cents: input.capturedCents, refunded_amount_cents: input.refundedCents, supplemental_amount_cents: input.supplementalCents, stripe_supplemental_payment_intent_id: input.supplementalPaymentIntentId ?? null }).eq("id", session.id);
  if (error) throw error;
}
async function saveSupplementalRequired(db: DB, session: Session, input: { finalAmountCents: number; capturedCents: number; refundedCents: number; supplementalCents: number; strategy: SettlementStrategy; paymentIntentId?: string | null; code: string; message: string; provider?: Record<string, unknown> }) {
  const { error } = await db.from("rental_sessions").update({ final_amount_cents: input.finalAmountCents, captured_amount_cents: input.capturedCents, refunded_amount_cents: input.refundedCents, supplemental_amount_cents: input.supplementalCents, stripe_supplemental_payment_intent_id: input.paymentIntentId ?? null, settlement_strategy: input.strategy, settlement_status: "supplemental_required", settlement_error: input.code, settlement_locked_at: null, state: "needs_support", failure_code: input.code, failure_message: input.message }).eq("id", session.id);
  if (error) throw error;
  await openIncident(db, session, "SUPPLEMENTAL_PAYMENT_REQUIRED", input.message, { supplemental_cents: input.supplementalCents, provider: input.provider ?? null, retryable: true });
}
async function appendFinancialCompletion(db: DB, session: Session, input: { returnState: ReturnState; strategy: SettlementStrategy; finalAmountCents: number; capturedCents: number; refundedCents: number; supplementalCents: number; canceledAuthorization: boolean }) {
  let state = await orchestratorState(db, String(session.id));
  if (state === "completed") return;
  if (state === "pricing_finalized" || state === "non_return") {
    const refundedPath = input.refundedCents > 0 || input.canceledAuthorization;
    await appendRentalEvent(db, { rentalId: String(session.id), eventType: refundedPath ? "payment_refunded" : "payment_captured", idempotencyKey: refundedPath ? `payment_refunded:settlement:${session.id}:${input.refundedCents}:${input.canceledAuthorization}` : `payment_captured:settlement:${session.id}:${input.capturedCents}`, paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null, stationId: String(session.station_id ?? "") || null, batteryId: String(session.battery_id ?? "") || null, finalAmountChf: input.finalAmountCents / 100, metadata: { returnState: input.returnState, strategy: input.strategy, capturedCents: input.capturedCents, refundedCents: input.refundedCents, supplementalCents: input.supplementalCents, canceledAuthorization: input.canceledAuthorization } });
  }
  state = await orchestratorState(db, String(session.id));
  if (state === "completed") return;
  if (!["payment_captured", "refunded", "non_return"].includes(String(state))) throw new OrchestratorError("ORCHESTRATOR_FINANCIAL_STATE_INVALID", String(state));
  await appendRentalEvent(db, { rentalId: String(session.id), eventType: "rental_completed", idempotencyKey: `rental_completed:settlement:${session.id}:${input.finalAmountCents}`, paymentIntentId: String(session.stripe_payment_intent_id ?? "") || null, stationId: String(session.station_id ?? "") || null, batteryId: String(session.battery_id ?? "") || null, finalAmountChf: input.finalAmountCents / 100, metadata: { returnState: input.returnState, strategy: input.strategy, netPaidCents: Math.max(0, input.capturedCents - input.refundedCents) } });
}
function captureAmountDetails(amountCents: number) {
  return {
    enforce_arithmetic_validation: true,
    line_items: [{ product_name: "Chargeurs.ch location", product_code: "RENTAL", quantity: 1, unit_cost: amountCents }],
  };
}

async function settle(db: DB, stripe: Stripe, session: Session, returnState: ReturnState, finalAt: string) {
  const startAt = session.started_at ?? session.ejected_at ?? session.created_at;
  const effectiveEnd = returnState === "normal" ? session.returned_at ?? finalAt : finalAt;
  const snapshot = session.pricing_snapshot as Record<string, unknown> | null;
  const storedHash = typeof session.pricing_snapshot_hash === "string" ? session.pricing_snapshot_hash : "";
  if (!snapshot || !storedHash) { await recordPricingFailure(db, session, "PRICING_SNAPSHOT_MISSING", "Le snapshot tarifaire immuable de la location est absent."); return json({ ok: false, error: "PRICING_SNAPSHOT_MISSING" }, 409); }
  if (await snapshotHash(snapshot) !== storedHash) { await recordPricingFailure(db, session, "PRICING_SNAPSHOT_HASH_MISMATCH", "Le snapshot tarifaire de la location ne correspond plus à son empreinte d'origine."); return json({ ok: false, error: "PRICING_SNAPSHOT_HASH_MISMATCH" }, 409); }
  if (session.price_profile_id && String(snapshot.profile_id ?? "") !== String(session.price_profile_id)) { await recordPricingFailure(db, session, "PRICING_SNAPSHOT_PROFILE_MISMATCH", "Le profil du snapshot tarifaire ne correspond pas à la location."); return json({ ok: false, error: "PRICING_SNAPSHOT_PROFILE_MISMATCH" }, 409); }
  if (session.price_profile_version != null && Number(snapshot.profile_version) !== Number(session.price_profile_version)) { await recordPricingFailure(db, session, "PRICING_SNAPSHOT_VERSION_MISMATCH", "La version du snapshot tarifaire ne correspond pas à la location."); return json({ ok: false, error: "PRICING_SNAPSHOT_VERSION_MISMATCH" }, 409); }

  let pricing: Record<string, unknown>;
  try { pricing = computeFinalPricingFromSnapshot({ snapshot, expectedCurrency: String(session.currency ?? "CHF"), startAt, endAt: effectiveEnd, returnState }); }
  catch (error) { const c = errorCode(error); await recordPricingFailure(db, session, c, "Le snapshot tarifaire est incomplet ou invalide; aucun tarif courant n'a été utilisé en remplacement."); return json({ ok: false, error: c }, 409); }

  const finalAmountCents = cents(pricing.final_cents);
  const depositCents = cents(session.deposit_amount_cents ?? snapshot.deposit_cents ?? 0);
  const paymentIntentId = String(session.stripe_payment_intent_id ?? "");
  if (depositCents <= 0) { await recordFailure(db, session, "DEPOSIT_NOT_CONFIGURED", "La caution de la location est introuvable."); return json({ ok: false, error: "DEPOSIT_NOT_CONFIGURED" }, 409); }
  if (!paymentIntentId) { await recordFailure(db, session, "PAYMENT_INTENT_MISSING", "Le paiement initial de la location est introuvable."); return json({ ok: false, error: "PAYMENT_INTENT_MISSING" }, 409); }
  try { await appendPricingFinalized(db, session, returnState, finalAmountCents, pricing); }
  catch (error) { const c = errorCode(error); await recordFailure(db, session, c, "Le cycle de location n'est pas prêt pour la tarification finale."); return json({ ok: false, error: c }, 409); }

  let intent: Stripe.PaymentIntent;
  try { intent = await stripe.paymentIntents.retrieve(paymentIntentId); }
  catch (error) { const c = errorCode(error); await recordFailure(db, session, c, "Stripe n'a pas pu relire l'autorisation de paiement.", { provider: diagnostic(error), operation: "retrieve_payment_intent" }); return json({ ok: false, error: c }, 502); }

  const method = await paymentMethodType(stripe, intent);
  const strategy = resolveStrategy(session, intent, method);
  const alreadyCaptured = Math.max(cents(session.captured_amount_cents), cents(intent.amount_received));
  const alreadyRefunded = cents(session.refunded_amount_cents);
  const capturable = cents(intent.amount_capturable);
  const planningStrategy: SettlementStrategy = strategy === "manual_capture" && intent.status !== "requires_capture" ? "prepaid_refund" : strategy;
  const plan = planSettlement({ strategy: planningStrategy, finalAmountCents, depositAmountCents: depositCents, amountCapturableCents: capturable, amountCapturedCents: alreadyCaptured, amountAlreadyRefundedCents: alreadyRefunded });

  let captured = alreadyCaptured;
  let refunded = alreadyRefunded;
  let supplementalCaptured = 0;
  let supplementalPI = String(session.stripe_supplemental_payment_intent_id ?? "") || null;
  let canceledAuthorization = false;

  if (plan.cancelAuthorization && intent.status === "requires_capture") {
    try { intent = await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey: `settlement_cancel_${session.id}` }); canceledAuthorization = true; await logApi(db, { service: "stripe", endpoint: "payment_intents.cancel", method: "POST", status_code: 200, request: { rentalSessionId: session.id }, response: { id: intent.id, status: intent.status } }); }
    catch (error) { const c = errorCode(error); await recordFailure(db, session, c, "L'autorisation Stripe n'a pas pu être libérée.", { provider: diagnostic(error), operation: "cancel_authorization" }); return json({ ok: false, error: c }, 502); }
  }

  if (plan.captureCents > 0 && intent.status === "requires_capture") {
    try {
      const params: any = { amount_to_capture: plan.captureCents, final_capture: true, amount_details: captureAmountDetails(plan.captureCents) };
      intent = await stripe.paymentIntents.capture(paymentIntentId, params, { idempotencyKey: `settlement_capture_v2_${session.id}_${plan.captureCents}` });
      captured = cents(intent.amount_received || plan.captureCents);
      await persistFinancialProgress(db, session, { capturedCents: captured, refundedCents: refunded, supplementalCents: plan.supplementalCents, supplementalPaymentIntentId: supplementalPI });
      await logApi(db, { service: "stripe", endpoint: "payment_intents.capture", method: "POST", status_code: 200, request: { rentalSessionId: session.id, amount_cents: plan.captureCents, line_items_total_cents: plan.captureCents }, response: { id: intent.id, status: intent.status, amount_received: intent.amount_received, amount_capturable: intent.amount_capturable, card_capture_method: cardCaptureMethod(intent), stripe_api_version: "2025-09-30.clover" } });
    } catch (error) {
      const c = errorCode(error);
      await logApi(db, { service: "stripe", endpoint: "payment_intents.capture", method: "POST", status_code: 502, request: { rentalSessionId: session.id, amount_cents: plan.captureCents, line_items_total_cents: plan.captureCents }, error: c });
      await recordFailure(db, session, c, "La capture du montant final Stripe a échoué et doit être réconciliée.", { provider: diagnostic(error), operation: "capture", intent_status: intent.status, amount_capturable_cents: capturable, card_capture_method: cardCaptureMethod(intent), top_level_capture_method: intent.capture_method, stripe_api_version: "2025-09-30.clover" });
      return json({ ok: false, error: c }, 502);
    }
  }

  if (plan.refundCents > 0) {
    try { const refund = await stripe.refunds.create({ payment_intent: paymentIntentId, amount: plan.refundCents }, { idempotencyKey: `settlement_refund_${session.id}_${plan.refundCents}` }); refunded = alreadyRefunded + plan.refundCents; await persistFinancialProgress(db, session, { capturedCents: captured, refundedCents: refunded, supplementalCents: plan.supplementalCents, supplementalPaymentIntentId: supplementalPI }); await logApi(db, { service: "stripe", endpoint: "refunds.create", method: "POST", status_code: 200, request: { rentalSessionId: session.id, amount_cents: plan.refundCents }, response: { id: refund.id, status: refund.status } }); }
    catch (error) { const c = errorCode(error); await recordFailure(db, session, c, "Le remboursement Stripe de la différence a échoué.", { provider: diagnostic(error), operation: "refund" }); return json({ ok: false, error: c }, 502); }
  }

  if (plan.supplementalCents > 0) {
    const customerId = String(session.stripe_customer_id ?? "");
    const paymentMethodId = String(session.stripe_payment_method_id ?? "");
    if (!customerId || !paymentMethodId) { await saveSupplementalRequired(db, session, { finalAmountCents, capturedCents: captured, refundedCents: refunded, supplementalCents: plan.supplementalCents, strategy, code: "SAVED_PAYMENT_METHOD_MISSING", message: "Le montant final dépasse la garantie et aucun moyen de paiement réutilisable n'est disponible." }); return json({ ok: false, requires_action: true, error: "SUPPLEMENTAL_PAYMENT_REQUIRED", supplemental_cents: plan.supplementalCents }, 409); }
    try {
      const supplemental = await stripe.paymentIntents.create({ amount: plan.supplementalCents, currency: String(session.currency ?? "CHF").toLowerCase(), customer: customerId, payment_method: paymentMethodId, off_session: true, confirm: true, description: "Chargeurs.ch — complément de location", metadata: { rental_session_id: String(session.id), payment_purpose: "rental_supplemental", final_amount_cents: String(finalAmountCents), deposit_amount_cents: String(depositCents) } }, { idempotencyKey: `settlement_supplemental_${session.id}_${plan.supplementalCents}` });
      supplementalPI = supplemental.id;
      if (supplemental.status !== "succeeded") throw new Error(`SUPPLEMENTAL_${supplemental.status.toUpperCase()}`);
      supplementalCaptured = cents(supplemental.amount_received || plan.supplementalCents);
      await persistFinancialProgress(db, session, { capturedCents: captured + supplementalCaptured, refundedCents: refunded, supplementalCents: plan.supplementalCents, supplementalPaymentIntentId: supplementalPI });
    } catch (error) { await saveSupplementalRequired(db, session, { finalAmountCents, capturedCents: captured, refundedCents: refunded, supplementalCents: plan.supplementalCents, strategy, paymentIntentId: supplementalPI, code: "SUPPLEMENTAL_COLLECTION_FAILED", message: "Le complément de location nécessite une intervention ou une authentification du client.", provider: diagnostic(error) }); return json({ ok: false, requires_action: true, error: "SUPPLEMENTAL_COLLECTION_FAILED", supplemental_cents: plan.supplementalCents }, 409); }
  }

  const totalCaptured = captured + supplementalCaptured;
  const netPaid = Math.max(0, totalCaptured - refunded);
  const completedAt = new Date().toISOString();
  try { await appendFinancialCompletion(db, session, { returnState, strategy, finalAmountCents, capturedCents: totalCaptured, refundedCents: refunded, supplementalCents: plan.supplementalCents, canceledAuthorization }); }
  catch (error) { await recordFailure(db, session, "ORCHESTRATOR_FINANCIAL_COMMIT_RETRY_REQUIRED", "Les opérations Stripe ont été exécutées, mais leur confirmation locale doit être rejouée.", { orchestrator_error: errorCode(error), final_amount_cents: finalAmountCents, captured_amount_cents: totalCaptured, refunded_amount_cents: refunded, supplemental_amount_cents: plan.supplementalCents }); return json({ ok: false, error: "ORCHESTRATOR_FINANCIAL_COMMIT_RETRY_REQUIRED" }, 500); }

  const { error: paymentUpdateError } = await db.from("payments").update({ status: refunded > 0 ? (refunded >= totalCaptured ? "refunded" : "partially_refunded") : canceledAuthorization ? "canceled" : "succeeded", settlement_strategy: strategy, amount_captured_cents: totalCaptured, amount_refunded_cents: refunded }).eq("rental_session_id", session.id);
  if (paymentUpdateError) throw paymentUpdateError;
  const { error: sessionUpdateError } = await db.from("rental_sessions").update({ final_amount_cents: finalAmountCents, amount: finalAmountCents / 100, amount_paid: netPaid / 100, captured_amount_cents: totalCaptured, refunded_amount_cents: refunded, supplemental_amount_cents: plan.supplementalCents, stripe_supplemental_payment_intent_id: supplementalPI, settlement_strategy: strategy, settlement_status: "settled", settlement_error: null, settlement_locked_at: null, settled_at: completedAt, state: "completed", closed_at: completedAt, failure_code: null, failure_message: null }).eq("id", session.id);
  if (sessionUpdateError) throw sessionUpdateError;
  await auditLog(db, { action: "settlement.completed", target: String(session.id), data: { return_state: returnState, strategy, payment_method_type: method, final_amount_cents: finalAmountCents, captured_amount_cents: totalCaptured, refunded_amount_cents: refunded, supplemental_amount_cents: plan.supplementalCents, canceled_authorization: canceledAuthorization, stripe_api_version: "2025-09-30.clover" } });
  return json({ ok: true, settlement_status: "settled", strategy, final_amount_cents: finalAmountCents, captured_amount_cents: totalCaptured, refunded_amount_cents: refunded, supplemental_amount_cents: plan.supplementalCents });
}

export async function handleSettlementRequestV3(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!authorized(req)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  const runtime = validateStripeTestRuntime();
  if (!runtime.ok) return json({ ok: false, error: runtime.error }, 503);
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
    if (existing.settlement_status === "settled") return json({ ok: true, idempotent: true, settlement_status: "settled", final_amount_cents: existing.final_amount_cents });
    const session = await claimSettlement(db, rentalId);
    if (!session) return json({ ok: true, already_in_progress: true }, 202);
    const stripe = new Stripe(runtime.secretKey, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
    return await settle(db, stripe, session, returnState, finalAt);
  } catch (error) {
    const c = errorCode(error);
    if (rentalId) try { const { data: session } = await db.from("rental_sessions").select("*").eq("id", rentalId).maybeSingle(); if (session) await recordFailure(db, session, "SETTLEMENT_INTERNAL_ERROR", "Le règlement final a échoué et doit être réconcilié.", { underlying_code: c, provider: diagnostic(error), stripe_api_version: "2025-09-30.clover" }); } catch {}
    return json({ ok: false, error: "SETTLEMENT_INTERNAL_ERROR" }, 500);
  }
}
