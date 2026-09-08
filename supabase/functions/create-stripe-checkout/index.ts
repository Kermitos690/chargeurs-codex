// create-stripe-checkout — real hosted Stripe Checkout for the kiosk QR.
// QR remains a first-class rail. The backend atomically claims QR before any new Stripe side effect.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kiosk-token, x-idempotency-key",
  "Access-Control-Expose-Headers": "x-correlation-id",
};
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`).join(",")}}`;
}
async function snapshotHash(value: unknown) { return sha256(canonicalize(value)); }

async function auth(req: Request, db: any, stationId: string) {
  const token = (req.headers.get("X-Kiosk-Token") ?? "").trim();
  if (token.length < 24) return null;
  const hash = await sha256(token);
  const { data } = await db.from("kiosk_devices").select("id,station_id,active,token_revoked,token_expires_at").eq("token_hash", hash).maybeSingle();
  if (!data || data.station_id !== stationId || !data.active || data.token_revoked) return null;
  if (data.token_expires_at && Date.parse(data.token_expires_at) < Date.now()) return null;
  return data;
}
function safeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.endsWith(".supabase.co")) return null;
    return url.origin;
  } catch { return null; }
}

async function loadOrCreateOrchestrator(db: any, session: any) {
  const read = async () => {
    const { data, error } = await db.from("rental_orchestrator_snapshots").select("state,version").eq("rental_id", session.id).maybeSingle();
    if (error) throw error;
    return data;
  };
  let orchestrator = await read();
  if (orchestrator) return orchestrator;
  const { data: created, error: createError } = await db.from("rental_orchestrator_snapshots").insert({ rental_id: session.id, state: "created", version: 0, station_id: session.station_id ?? null, battery_id: session.battery_id ?? null }).select("state,version").maybeSingle();
  if (!createError && created) return created;
  if (createError && createError.code !== "23505") throw createError;
  orchestrator = await read();
  if (!orchestrator) throw new Error("ORCHESTRATOR_SNAPSHOT_CREATE_FAILED");
  return orchestrator;
}
async function ensurePaymentStarted(db: any, session: any) {
  const orchestrator = await loadOrCreateOrchestrator(db, session);
  if (String(orchestrator.state) === "payment_pending") return;
  if (String(orchestrator.state) !== "created") throw new Error(`PAYMENT_STATE_${String(orchestrator.state).toUpperCase()}`);
  const { error: appendError } = await db.rpc("append_rental_orchestrator_event", {
    p_rental_id: session.id,
    p_expected_version: Number(orchestrator.version ?? 0),
    p_event_type: "payment_started",
    p_idempotency_key: `payment_started:direct_stripe:${session.id}`,
    p_occurred_at: new Date().toISOString(),
    p_metadata: { source: "kiosk_direct_stripe_checkout", payment_rail: "QR" },
    p_resulting_state: "payment_pending",
    p_payment_intent_id: null,
    p_station_id: session.station_id ?? null,
    p_battery_id: session.battery_id ?? null,
    p_final_amount_chf: null,
    p_failure_reason: null,
  });
  if (appendError && !String(appendError.message ?? "").includes("IDEMPOTENCY_KEY_CONFLICT")) throw appendError;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const correlationId = crypto.randomUUID();
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify({ ...body, correlationId }), { status, headers: { ...headers, "Content-Type": "application/json", "X-Correlation-Id": correlationId } });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  let db: any = null;
  let rentalSessionId = "";
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "";
    if (!rentalSessionId) return json({ ok: false, error: "MISSING_SESSION" }, 400);

    db = admin();
    const { data: session, error } = await db.from("rental_sessions").select("*").eq("id", rentalSessionId).maybeSingle();
    if (error) throw error;
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);

    const stationId = String(session.station_id ?? "");
    const device = await auth(req, db, stationId);
    if (!device) return json({ ok: false, error: "KIOSK_AUTH_INVALID" }, 401);
    if (String(session.kiosk_device_id ?? "") !== String(device.id)) return json({ ok: false, error: "KIOSK_DEVICE_MISMATCH" }, 403);
    if (session.expires_at && Date.parse(session.expires_at) < Date.now()) return json({ ok: false, error: "SESSION_EXPIRED" }, 410);
    if (session.paid_at) return json({ ok: false, error: "SESSION_ALREADY_PAID" }, 409);

    const secretKey = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
    if (!(secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_"))) return json({ ok: false, error: "STRIPE_TEST_KEY_REQUIRED" }, 503);

    const appOrigin = safeOrigin(body.origin) ?? safeOrigin(Deno.env.get("PUBLIC_APP_URL"));
    if (!appOrigin) return json({ ok: false, error: "PUBLIC_APP_URL_NOT_CONFIGURED" }, 503);

    const snapshot = session.pricing_snapshot as Record<string, unknown> | null;
    const depositCents = Math.round(Number(session.deposit_amount_cents ?? snapshot?.deposit_cents ?? 0));
    if (!snapshot || !Number.isInteger(depositCents) || depositCents <= 0) return json({ ok: false, error: "PRICING_NOT_CONFIGURED" }, 409);
    const storedHash = typeof session.pricing_snapshot_hash === "string" ? session.pricing_snapshot_hash : "";
    if (storedHash && await snapshotHash(snapshot) !== storedHash) return json({ ok: false, error: "SNAPSHOT_INVALID" }, 409);

    // First-rail-wins is established BEFORE any Stripe Checkout create/retrieve side effect.
    const { error: railError } = await db.rpc("claim_rental_payment_rail", {
      p_rental_id: session.id,
      p_rail: "qr_checkout",
      p_correlation_id: correlationId,
      p_metadata: { source: "create_stripe_checkout", station_id: stationId },
    });
    if (railError) {
      const message = String(railError.message ?? "");
      if (message.includes("PAYMENT_RAIL_ALREADY_CLAIMED")) return json({ ok: false, error: "PAYMENT_RAIL_ALREADY_CLAIMED" }, 409);
      throw railError;
    }

    const stripe = new Stripe(secretKey, { apiVersion: "2025-09-30.clover" as any, httpClient: Stripe.createFetchHttpClient() });

    if (session.stripe_checkout_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(String(session.stripe_checkout_session_id));
        if (existing.status === "open" && existing.url) {
          return json({ ok: true, paymentRail: "QR", checkout_url: existing.url, checkout_id: existing.id, public_session_code: session.public_session_code, expires_at: existing.expires_at ? new Date(existing.expires_at * 1000).toISOString() : session.checkout_url_expires_at, status: "awaiting_payment", deposit_cents: depositCents });
        }
      } catch { /* fresh Checkout below */ }
    }

    await ensurePaymentStarted(db, session);
    const lang = session.customer_language === "de" || session.customer_language === "en" ? session.customer_language : "fr";
    const currency = String(session.currency ?? "CHF").toLowerCase();
    if (currency !== "chf") return json({ ok: false, error: "TWINT_REQUIRES_CHF" }, 409);
    const publicCode = String(session.public_session_code ?? "");
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
    const pricingHash = storedHash || await snapshotHash(snapshot);
    const metadata: Record<string, string> = {
      rental_session_id: String(session.id), public_session_code: publicCode, station_id: stationId,
      kiosk_device_id: String(session.kiosk_device_id ?? ""), pricing_snapshot_hash: pricingHash,
      deposit_amount_cents: String(depositCents), payment_purpose: "rental_guarantee", payment_rail: "qr_checkout",
    };

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: lang,
      client_reference_id: String(session.id),
      customer_creation: "always",
      payment_method_types: ["card", "twint"],
      payment_method_options: { card: { capture_method: "manual", setup_future_usage: "off_session" } },
      payment_intent_data: { description: "Chargeurs.ch — garantie de location", metadata },
      expires_at: expiresAt,
      line_items: [{ price_data: { currency, product_data: { name: "Chargeurs.ch — Garantie de location", description: "30 CHF de garantie. Le prix réel est calculé au retour de la batterie." }, unit_amount: depositCents }, quantity: 1 }],
      metadata,
      custom_text: { submit: { message: "Le prix final est calculé au retour. Carte et wallets compatibles : réservation bancaire temporaire. TWINT : débit puis remboursement de la différence." } },
      success_url: `${appOrigin}/pay/${encodeURIComponent(String(session.id))}/success?c=${encodeURIComponent(publicCode)}&lang=${lang}`,
      cancel_url: `${appOrigin}/pay/${encodeURIComponent(String(session.id))}/cancel?c=${encodeURIComponent(publicCode)}&lang=${lang}`,
    } as any, { idempotencyKey: `rental_direct_checkout:v8:${session.id}:${pricingHash}` });

    const expiresIso = new Date(expiresAt * 1000).toISOString();
    const { error: updateError } = await db.from("rental_sessions").update({ stripe_checkout_session_id: checkout.id, checkout_url: checkout.url, checkout_url_expires_at: expiresIso, expires_at: expiresIso, state: "checkout_created", amount: depositCents / 100, amount_expected: depositCents / 100, deposit_amount_cents: depositCents, settlement_status: "pending", settlement_error: null, updated_at: new Date().toISOString() }).eq("id", session.id);
    if (updateError) throw updateError;
    const { error: paymentError } = await db.from("payments").upsert({ rental_session_id: session.id, stripe_session_id: checkout.id, amount: depositCents / 100, currency: session.currency, status: "pending", amount_authorized_cents: 0, amount_captured_cents: 0, amount_refunded_cents: 0 }, { onConflict: "stripe_session_id" });
    if (paymentError) throw paymentError;

    await db.from("audit_logs").insert({ action: "stripe.checkout.direct_created", target: String(session.id), data: { stripe_checkout_session_id: checkout.id, station_id: stationId, deposit_cents: depositCents, currency, pricing_snapshot_hash: pricingHash, qr_target: "stripe_checkout", payment_rail: "QR", payment_methods: ["card", "twint"], card_capture: "manual", twint_capture: "automatic", stripe_api_version: "2025-09-30.clover", correlation_id: correlationId } }).then(() => {}, () => {});

    return json({ ok: true, paymentRail: "QR", checkout_url: checkout.url, checkout_id: checkout.id, public_session_code: session.public_session_code, expires_at: expiresIso, status: "awaiting_payment", deposit_cents: depositCents });
  } catch (error) {
    const raw = error as any;
    const errorCode = typeof raw?.code === "string" ? raw.code : (error instanceof Error ? error.message : "UNKNOWN");
    const errorMessage = typeof raw?.message === "string" ? raw.message : (error instanceof Error ? error.message : "");
    console.error("create-stripe-checkout direct", { name: error instanceof Error ? error.name : "error", code: raw?.code ?? null, param: raw?.param ?? null, message: errorMessage.slice(0, 500), correlationId });
    if (db && rentalSessionId) await db.from("audit_logs").insert({ action: "stripe.checkout.failed", target: rentalSessionId, data: { code: String(errorCode).slice(0, 120), message: errorMessage.slice(0, 500), stripe_param: typeof raw?.param === "string" ? raw.param.slice(0, 120) : null, error_type: typeof raw?.type === "string" ? raw.type.slice(0, 80) : null, correlation_id: correlationId } }).then(() => {}, () => {});
    return json({ ok: false, error: typeof raw?.code === "string" ? `STRIPE_${raw.code.toUpperCase()}` : "STRIPE_CHECKOUT_FAILED" }, 500);
  }
});
