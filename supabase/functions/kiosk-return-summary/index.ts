import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token",
  "Access-Control-Expose-Headers": "x-correlation-id",
};
const db = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function kioskAuth(req: Request, database: any, stationId: string) {
  const token = (req.headers.get("X-Kiosk-Token") ?? "").trim();
  if (token.length < 24) return null;
  const hash = await sha256(token);
  const { data } = await database.from("kiosk_devices")
    .select("id,station_id,active,token_revoked,token_expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || data.station_id !== stationId || !data.active || data.token_revoked) return null;
  if (data.token_expires_at && Date.parse(data.token_expires_at) < Date.now()) return null;
  return data;
}

function cents(value: unknown) {
  const normalized = Math.round(Number(value ?? 0));
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0;
}

function paymentLabel(type: string | null, wallet: string | null) {
  if (type === "twint") return "TWINT";
  if (wallet === "apple_pay") return "Apple Pay";
  if (wallet === "google_pay") return "Google Pay";
  if (wallet === "link") return "Link";
  if (type === "card") return "Carte";
  return type ? type.toUpperCase() : "Paiement";
}

async function walletType(session: any) {
  const type = String(session.stripe_payment_method_type ?? "") || null;
  if (type !== "card" || !session.stripe_payment_method_id) {
    return { type, wallet: null, label: paymentLabel(type, null) };
  }
  const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!(key.startsWith("sk_test_") || key.startsWith("rk_test_"))) {
    return { type, wallet: null, label: "Carte" };
  }
  try {
    const stripe = new Stripe(key, {
      apiVersion: "2024-12-18.acacia",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const method = await stripe.paymentMethods.retrieve(String(session.stripe_payment_method_id));
    const wallet = (method as any)?.card?.wallet?.type ?? null;
    return { type, wallet, label: paymentLabel(type, wallet) };
  } catch {
    return { type, wallet: null, label: "Carte" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify({ ...body, correlationId }),
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
    },
  );
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(stationId)) {
      return json({ ok: false, error: "MISSING_STATION" }, 400);
    }

    const database = db();
    const device = await kioskAuth(req, database, stationId);
    if (!device) return json({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);

    const ackId = typeof body.ackRentalSessionId === "string" ? body.ackRentalSessionId : "";
    if (ackId) {
      const { data: rental } = await database.from("rental_sessions")
        .select("id,return_station_id,state")
        .eq("id", ackId)
        .eq("return_station_id", stationId)
        .maybeSingle();
      if (!rental || rental.state !== "completed") {
        return json({ ok: false, error: "ACK_NOT_ALLOWED" }, 409);
      }
      const { error } = await database.from("kiosk_return_receipt_acknowledgements").upsert({
        rental_session_id: ackId,
        kiosk_device_id: device.id,
        acknowledged_at: new Date().toISOString(),
      }, { onConflict: "rental_session_id,kiosk_device_id" });
      if (error) throw error;
      return json({ ok: true, acknowledged: true });
    }

    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: rows, error } = await database.from("rental_sessions").select(
      "id,public_session_code,state,state_version,currency,customer_language,checkout_payment_mode,settlement_strategy,settlement_status,settlement_error,settlement_attempts,stripe_payment_method_type,stripe_payment_method_id,deposit_amount_cents,final_amount_cents,captured_amount_cents,refunded_amount_cents,supplemental_amount_cents,started_at,returned_at,completed_at,closed_at,return_station_id,returned_slot_num,pricing_snapshot,failure_code,failure_message",
    )
      .eq("return_station_id", stationId)
      .not("returned_at", "is", null)
      .gte("returned_at", since)
      .in("state", ["battery_returned", "completed", "needs_support"])
      .order("returned_at", { ascending: false })
      .limit(10);
    if (error) throw error;

    let selected: any = null;
    for (const row of rows ?? []) {
      if (row.state === "completed") {
        const { data: ack } = await database.from("kiosk_return_receipt_acknowledgements")
          .select("rental_session_id")
          .eq("rental_session_id", row.id)
          .eq("kiosk_device_id", device.id)
          .maybeSingle();
        if (ack) continue;
      }
      selected = row;
      break;
    }
    if (!selected) return json({ ok: true, stage: "none" });

    const { data: pricingEvent } = await database.from("rental_orchestrator_events")
      .select("metadata,occurred_at")
      .eq("rental_id", selected.id)
      .eq("event_type", "pricing_finalized")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const pricingMetadata = (pricingEvent?.metadata as any) ?? null;
    const finalPricing = pricingMetadata?.pricingSnapshot ?? null;
    const pricingReady = Boolean(finalPricing);
    const payment = await walletType(selected);
    const deposit = cents(selected.deposit_amount_cents ?? selected.pricing_snapshot?.deposit_cents);
    const captured = cents(selected.captured_amount_cents);
    const refunded = cents(selected.refunded_amount_cents);
    const finalAmount = cents(
      selected.final_amount_cents ?? finalPricing?.final_cents ?? pricingMetadata?.finalAmountCents,
    );
    const strategy = String(selected.settlement_strategy ?? "");
    const settlementConfirmed = selected.state === "completed" && selected.settlement_status === "settled";
    const released = settlementConfirmed && strategy === "manual_capture"
      ? Math.max(0, deposit - captured)
      : 0;
    const requiresSupport = selected.state === "needs_support" || [
      "failed",
      "manual_review",
      "supplemental_required",
    ].includes(String(selected.settlement_status ?? ""));
    const stage = settlementConfirmed ? "completed" : requiresSupport ? "support" : "settling";

    return json({
      ok: true,
      stage,
      summary: {
        rentalSessionId: selected.id,
        publicCode: selected.public_session_code,
        currency: selected.currency ?? "CHF",
        language: selected.customer_language ?? "fr",
        startedAt: selected.started_at,
        returnedAt: selected.returned_at,
        completedAt: selected.completed_at ?? selected.closed_at,
        returnStationId: selected.return_station_id,
        returnedSlotNum: selected.returned_slot_num,
        paymentMode: selected.checkout_payment_mode,
        settlementStrategy: strategy,
        settlementStatus: selected.settlement_status,
        settlementError: selected.settlement_error ?? null,
        settlementAttempts: Number(selected.settlement_attempts ?? 0),
        pricingReady,
        pricingFinalizedAt: pricingEvent?.occurred_at ?? null,
        paymentMethod: payment.label,
        paymentMethodType: payment.type,
        walletType: payment.wallet,
        depositCents: deposit,
        finalAmountCents: finalAmount,
        capturedCents: captured,
        refundedCents: refunded,
        releasedAuthorizationCents: released,
        supplementalCents: cents(selected.supplemental_amount_cents),
        totalMinutes: cents(finalPricing?.total_minutes),
        billedPeriods: cents(finalPricing?.billed_periods),
        periodMinutes: cents(finalPricing?.period_minutes ?? selected.pricing_snapshot?.period_minutes),
        pricePerPeriodCents: cents(finalPricing?.price_per_period_cents ?? selected.pricing_snapshot?.price_per_period_cents),
        dailyCapCents: cents(selected.pricing_snapshot?.daily_cap_cents),
        failureCode: selected.failure_code ?? null,
        failureMessage: selected.failure_message ?? null,
      },
    });
  } catch (error) {
    console.error("kiosk-return-summary", error instanceof Error ? error.message : "UNKNOWN");
    return json({ ok: false, error: "RETURN_SUMMARY_UNAVAILABLE" }, 503);
  }
});
