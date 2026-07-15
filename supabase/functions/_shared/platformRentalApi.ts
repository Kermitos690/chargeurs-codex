import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { auditLog, snapshotHash } from "./db.ts";
import type { PlatformApiPrincipal } from "./platformApi.ts";
import { canAccessRental, mutationGate } from "./platformApiMutations.ts";

const RENTAL_SESSION_TTL_MINUTES = 20;

export type RentalServiceError = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

export type RentalServiceSuccess<T> = { ok: true; value: T };
export type RentalServiceResult<T> = RentalServiceSuccess<T> | RentalServiceError;

export function uuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function rentalCodeLike(value: string): boolean {
  return /^CHG-[A-Z0-9]{6,16}$/.test(value);
}

export function stationIdLike(value: string): boolean {
  return /^[A-Za-z0-9_-]{4,32}$/.test(value);
}

function emailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

function shortCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "CHG-";
  for (let index = 0; index < 8; index++) result += alphabet[Math.floor(Math.random() * alphabet.length)];
  return result;
}

export function safeRentalSession(session: Record<string, unknown>) {
  return {
    id: session.id,
    publicSessionCode: session.public_session_code,
    externalReference: session.external_reference,
    createdVia: session.created_via,
    stationId: session.station_id,
    state: session.state,
    currency: session.currency,
    amountExpected: session.amount_expected,
    amountPaid: session.amount_paid,
    startedAt: session.started_at,
    paidAt: session.paid_at,
    ejectedAt: session.ejected_at,
    returnedAt: session.returned_at,
    closedAt: session.closed_at,
    cancelledAt: session.cancelled_at,
    expiresAt: session.expires_at,
    failureCode: session.failure_code,
    failureMessage: session.failure_message,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

export async function findPlatformRental(
  db: SupabaseClient,
  identifierInput: string,
): Promise<Record<string, unknown> | null> {
  const identifier = decodeURIComponent(identifierInput).toUpperCase();
  let query = db.from("rental_sessions").select("*");
  if (uuidLike(identifier)) query = query.eq("id", identifier.toLowerCase());
  else if (rentalCodeLike(identifier)) query = query.eq("public_session_code", identifier);
  else return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`DATABASE_ERROR:${error.message}`);
  return data as Record<string, unknown> | null;
}

async function appendTransition(
  db: SupabaseClient,
  input: {
    rentalId: string;
    eventType: string;
    targetState: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    failureReason?: string | null;
  },
): Promise<void> {
  const { data: snapshot } = await db.from("rental_orchestrator_snapshots")
    .select("rental_id,state,version")
    .eq("rental_id", input.rentalId)
    .maybeSingle();
  if (!snapshot || snapshot.state === input.targetState) return;

  const { error } = await db.rpc("append_rental_orchestrator_event", {
    p_rental_id: input.rentalId,
    p_expected_version: Number(snapshot.version),
    p_event_type: input.eventType,
    p_idempotency_key: input.idempotencyKey,
    p_occurred_at: new Date().toISOString(),
    p_metadata: input.metadata ?? {},
    p_resulting_state: input.targetState,
    p_payment_intent_id: null,
    p_station_id: null,
    p_battery_id: null,
    p_final_amount_chf: null,
    p_failure_reason: input.failureReason ?? null,
  });

  if (error && !String(error.message).includes("IDEMPOTENCY_KEY_CONFLICT")) {
    await db.from("rental_orchestrator_incidents").insert({
      rental_id: input.rentalId,
      code: "PLATFORM_API_TRANSITION_FAILED",
      severity: "warning",
      message: `Platform API could not append ${input.eventType}.`,
      details: { target_state: input.targetState, error: error.message },
    });
  }
}

export async function createPlatformRental(
  db: SupabaseClient,
  principal: PlatformApiPrincipal,
  input: Record<string, unknown>,
  idempotencyKey: string,
): Promise<RentalServiceResult<Record<string, unknown>>> {
  const stationId = typeof input.stationId === "string" ? input.stationId.trim() : "";
  const language = typeof input.language === "string" ? input.language.toLowerCase().slice(0, 8) : "fr";
  const customerEmail = typeof input.customerEmail === "string" ? input.customerEmail.trim().toLowerCase() : "";
  const externalReference = typeof input.externalReference === "string" ? input.externalReference.trim().slice(0, 200) : "";

  if (!stationIdLike(stationId)) return { ok: false, status: 400, code: "INVALID_STATION_ID", message: "Invalid station identifier." };
  if (!["fr", "en", "de", "it", "es"].includes(language)) {
    return { ok: false, status: 400, code: "INVALID_LANGUAGE", message: "Supported languages are fr, en, de, it and es." };
  }
  if (customerEmail && !emailLike(customerEmail)) return { ok: false, status: 400, code: "INVALID_EMAIL", message: "Invalid customer email." };

  const { data: station, error: stationError } = await db.from("stations")
    .select("station_id,cabinet_id,shop_id,status,online,rentable_count,currency")
    .eq("station_id", stationId)
    .maybeSingle();
  if (stationError) return { ok: false, status: 500, code: "DATABASE_ERROR", message: "Unable to load station." };
  if (!station) return { ok: false, status: 404, code: "STATION_NOT_FOUND", message: "Station not found." };
  if (station.status === "maintenance" || !station.online || Number(station.rentable_count ?? 0) <= 0) {
    return { ok: false, status: 409, code: "STATION_UNAVAILABLE", message: "Station is offline, in maintenance or has no rentable battery." };
  }

  const { data: pricing, error: pricingError } = await db.rpc("compute_pricing", {
    p_device: null,
    p_station: stationId,
    p_shop: station.shop_id ?? null,
    p_start: new Date().toISOString(),
    p_end: null,
    p_rental_state: "created",
    p_return_state: "normal",
    p_currency: station.currency ?? null,
  });
  if (pricingError || !pricing) {
    const message = String(pricingError?.message ?? "Pricing unavailable.");
    const code = message.includes("PRICING_NOT_CONFIGURED") ? "PRICING_NOT_CONFIGURED" : "PRICING_ERROR";
    return { ok: false, status: 409, code, message };
  }

  const pricingSnapshot = pricing as Record<string, unknown>;
  const finalCents = Number(pricingSnapshot.final_cents ?? 0);
  if (!Number.isFinite(finalCents) || finalCents <= 0) {
    return { ok: false, status: 409, code: "PRICING_NOT_CONFIGURED", message: "Pricing produced no payable amount." };
  }

  const amount = finalCents / 100;
  const currency = String(pricingSnapshot.currency ?? station.currency ?? "CHF").toUpperCase();
  const hash = await snapshotHash(pricingSnapshot);
  const platformIdempotencyKey = `platform:${principal.keyId}:${idempotencyKey}`;
  const expiresAt = new Date(Date.now() + RENTAL_SESSION_TTL_MINUTES * 60_000).toISOString();
  const profileCandidate = String(pricingSnapshot.profile_id ?? "");
  const profileId = uuidLike(profileCandidate) ? profileCandidate : null;

  const { data: createdRaw, error } = await db.rpc("create_platform_api_rental_session", {
    p_station_id: stationId,
    p_cabinet_id: station.cabinet_id ?? stationId,
    p_shop_id: station.shop_id ?? null,
    p_api_client_id: principal.clientId,
    p_api_key_id: principal.keyId,
    p_external_reference: externalReference || null,
    p_customer_email: customerEmail || null,
    p_customer_language: language,
    p_idempotency_key: platformIdempotencyKey,
    p_public_session_code: shortCode(),
    p_price_profile_id: profileId,
    p_price_profile_version: Number(pricingSnapshot.profile_version ?? 0) || null,
    p_pricing_snapshot: pricingSnapshot,
    p_pricing_snapshot_hash: hash,
    p_amount: amount,
    p_currency: currency,
    p_expires_at: expiresAt,
  });

  if (error || !createdRaw) {
    const message = String(error?.message ?? "");
    const externalConflict = message.includes("rental_sessions_api_client_external_ref_uidx");
    return externalConflict
      ? { ok: false, status: 409, code: "EXTERNAL_REFERENCE_CONFLICT", message: "The external reference is already used by this API client." }
      : { ok: false, status: 500, code: "RENTAL_CREATE_FAILED", message: "Unable to create rental session." };
  }

  const created = (Array.isArray(createdRaw) ? createdRaw[0] : createdRaw) as Record<string, unknown>;
  await auditLog(db, {
    action: "platform_api.rental.created",
    target: String(created.id),
    data: {
      api_client_id: principal.clientId,
      api_key_id: principal.keyId,
      station_id: stationId,
      external_reference: externalReference || null,
      amount_cents: finalCents,
      currency,
    },
  });
  return { ok: true, value: created };
}

async function callCheckoutFunction(sessionId: string): Promise<RentalServiceResult<Record<string, unknown>>> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) {
    return { ok: false, status: 503, code: "INTERNAL_FUNCTION_CONFIGURATION_ERROR", message: "Internal function routing is not configured." };
  }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/create-stripe-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRole}` },
    body: JSON.stringify({ rentalSessionId: sessionId, origin: Deno.env.get("PUBLIC_APP_URL") ?? null }),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, status: 502, code: "INVALID_INTERNAL_RESPONSE", message: "Checkout service returned invalid data." };
  }
  if (!data.ok || !data.checkout_url) {
    return {
      ok: false,
      status: response.status >= 400 ? response.status : 502,
      code: String(data.error ?? "CHECKOUT_CREATE_FAILED"),
      message: "Unable to create Stripe Checkout.",
    };
  }
  return { ok: true, value: data };
}

export async function createPlatformCheckout(
  db: SupabaseClient,
  principal: PlatformApiPrincipal,
  session: Record<string, unknown>,
  idempotencyKey: string,
): Promise<RentalServiceResult<Record<string, unknown>>> {
  if (!canAccessRental(principal, session, "write")) {
    return { ok: false, status: 403, code: "RENTAL_FORBIDDEN", message: "This API client does not own the rental." };
  }
  if (!["created", "checkout_created", "payment_expired"].includes(String(session.state))) {
    return {
      ok: false,
      status: 409,
      code: "INVALID_RENTAL_STATE",
      message: "Checkout cannot be created in the current rental state.",
      details: { state: session.state },
    };
  }

  const result = await callCheckoutFunction(String(session.id));
  if (!result.ok) return result;
  await appendTransition(db, {
    rentalId: String(session.id),
    eventType: "payment_started",
    targetState: "payment_pending",
    idempotencyKey: `api:${principal.keyId}:${idempotencyKey}:payment_started`,
    metadata: { checkoutSessionId: result.value.checkout_id ?? null },
  });
  return result;
}

export async function cancelPlatformRental(
  db: SupabaseClient,
  principal: PlatformApiPrincipal,
  session: Record<string, unknown>,
  idempotencyKey: string,
  reasonInput: unknown,
): Promise<RentalServiceResult<{ rental: Record<string, unknown>; alreadyCancelled: boolean }>> {
  if (!canAccessRental(principal, session, "write")) {
    return { ok: false, status: 403, code: "RENTAL_FORBIDDEN", message: "This API client does not own the rental." };
  }
  if (["payment_cancelled", "cancelled"].includes(String(session.state))) {
    return { ok: true, value: { rental: session, alreadyCancelled: true } };
  }
  if (!["created", "checkout_created", "payment_expired"].includes(String(session.state))) {
    return {
      ok: false,
      status: 409,
      code: "INVALID_RENTAL_STATE",
      message: "Paid, active or completed rentals cannot be cancelled by this endpoint.",
      details: { state: session.state },
    };
  }

  if (session.stripe_checkout_session_id) {
    const stripeGate = mutationGate(principal, "stripe");
    if (!stripeGate.ok) return { ok: false, status: 503, code: stripeGate.code, message: stripeGate.message };
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    try {
      const checkoutId = String(session.stripe_checkout_session_id);
      const checkout = await stripe.checkout.sessions.retrieve(checkoutId);
      if (checkout.status === "open") {
        await stripe.checkout.sessions.expire(checkoutId, { idempotencyKey: `expire_${session.id}` });
      }
    } catch (error) {
      return { ok: false, status: 502, code: "STRIPE_CANCEL_FAILED", message: "Unable to expire Stripe Checkout.", details: String(error) };
    }
  }

  const reason = typeof reasonInput === "string" && reasonInput.trim()
    ? reasonInput.trim().slice(0, 500)
    : "cancelled_by_api_client";
  const { data: cancelled, error } = await db.from("rental_sessions").update({
    state: "payment_cancelled",
    cancelled_at: new Date().toISOString(),
    failure_code: "API_CANCELLED",
    failure_message: reason,
  }).eq("id", session.id).in("state", ["created", "checkout_created", "payment_expired"]).select("*").maybeSingle();
  if (error || !cancelled) {
    return { ok: false, status: 409, code: "CANCEL_CONFLICT", message: "Rental state changed while cancellation was processed." };
  }

  await appendTransition(db, {
    rentalId: String(session.id),
    eventType: "rental_failed",
    targetState: "failed",
    idempotencyKey: `api:${principal.keyId}:${idempotencyKey}:cancelled`,
    metadata: { reason },
    failureReason: reason,
  });
  await auditLog(db, {
    action: "platform_api.rental.cancelled",
    target: String(session.id),
    data: { api_client_id: principal.clientId, api_key_id: principal.keyId, reason },
  });
  return { ok: true, value: { rental: cancelled as Record<string, unknown>, alreadyCancelled: false } };
}
