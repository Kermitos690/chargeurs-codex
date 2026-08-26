import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
const TERMS_VERSION = "terms-2026-08-26-preproduction-v2",
  PRIVACY_VERSION = "privacy-2026-08-26-preproduction-v2";
const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-correlation-id",
};
const admin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
function loc(v: unknown): "fr" | "de" | "en" {
  return v === "de" || v === "en" ? v : "fr";
}
function portal(
  id: string,
  code: string,
  lang: string,
  view: "choose" | "progress",
) {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/payment-portal?rental=${encodeURIComponent(id)}&c=${encodeURIComponent(code)}&lang=${lang}&view=${view}`;
}
function copy(lang: "fr" | "de" | "en", mode: "card_hold" | "twint_prepaid") {
  const x = {
    fr: {
      card: {
        name: "Chargeurs.ch — Garantie bancaire de location",
        desc: "30,00 CHF sont temporairement réservés. Au retour, seul le prix réel est capturé et le solde de l’autorisation est libéré.",
        submit:
          "Autorisation bancaire de 30 CHF. Seul le coût final de la location sera capturé au retour. Le moyen de paiement est enregistré pour les montants contractuellement dus dépassant la garantie ou en cas de non-retour.",
      },
      twint: {
        name: "Chargeurs.ch — Garantie TWINT de location",
        desc: "30,00 CHF sont débités via TWINT. Au retour, le prix réel est calculé et la différence est remboursée automatiquement.",
        submit:
          "TWINT débite 30 CHF maintenant. Après le retour, Chargeurs.ch conserve uniquement le prix réel et rembourse automatiquement la différence.",
      },
    },
    de: {
      card: {
        name: "Chargeurs.ch — Bankgarantie für Miete",
        desc: "CHF 30.00 werden vorübergehend reserviert. Bei Rückgabe wird nur der tatsächliche Mietpreis belastet und der Rest freigegeben.",
        submit:
          "Bankautorisierung über CHF 30. Bei Rückgabe wird nur der tatsächliche Mietpreis eingezogen. Das Zahlungsmittel wird für vertraglich geschuldete Zusatzbeträge bzw. Nichtrückgabe gespeichert.",
      },
      twint: {
        name: "Chargeurs.ch — TWINT-Mietgarantie",
        desc: "CHF 30.00 werden via TWINT belastet. Nach der Rückgabe wird der tatsächliche Mietpreis berechnet und die Differenz automatisch zurückerstattet.",
        submit:
          "TWINT belastet jetzt CHF 30. Nach Rückgabe behält Chargeurs.ch nur den tatsächlichen Mietpreis und erstattet die Differenz.",
      },
    },
    en: {
      card: {
        name: "Chargeurs.ch — Rental bank guarantee",
        desc: "CHF 30.00 is temporarily authorised. On return, only the actual rental cost is captured and the remaining authorisation is released.",
        submit:
          "CHF 30 bank authorisation. Only the final rental cost is captured on return. The payment method is saved for contractually due amounts above the guarantee or non-return charges.",
      },
      twint: {
        name: "Chargeurs.ch — TWINT rental guarantee",
        desc: "CHF 30.00 is charged through TWINT. On return, the actual rental price is calculated and the difference is automatically refunded.",
        submit:
          "TWINT charges CHF 30 now. After return, Chargeurs.ch keeps only the actual rental price and automatically refunds the difference.",
      },
    },
  };
  return mode === "card_hold" ? x[lang].card : x[lang].twint;
}
async function ensurePaymentStarted(d: any, s: any) {
  const { data: o, error } = await d
    .from("rental_orchestrator_snapshots")
    .select("state,version")
    .eq("rental_id", s.id)
    .maybeSingle();
  if (error) throw error;
  if (!o) throw new Error("ORCHESTRATOR_SNAPSHOT_MISSING");
  if (String(o.state) === "payment_pending") return;
  if (String(o.state) !== "created")
    throw new Error(`PAYMENT_STATE_${String(o.state).toUpperCase()}`);
  const { error: e } = await d.rpc("append_rental_orchestrator_event", {
    p_rental_id: s.id,
    p_expected_version: Number(o.version ?? 0),
    p_event_type: "payment_started",
    p_idempotency_key: `payment_started:public:${s.id}`,
    p_occurred_at: new Date().toISOString(),
    p_metadata: { source: "public_payment_choice" },
    p_resulting_state: "payment_pending",
    p_payment_intent_id: null,
    p_station_id: s.station_id ?? null,
    p_battery_id: s.battery_id ?? null,
    p_final_amount_chf: null,
    p_failure_reason: null,
  });
  if (e && !String(e.message ?? "").includes("IDEMPOTENCY_KEY_CONFLICT"))
    throw e;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const cid = crypto.randomUUID(),
    json = (body: Record<string, unknown>, status = 200) =>
      new Response(JSON.stringify({ ...body, correlationId: cid }), {
        status,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Correlation-Id": cid,
        },
      });
  if (req.method !== "POST")
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const d = admin();
  try {
    const body = await req.json().catch(() => ({})),
      id = typeof body.rentalSessionId === "string" ? body.rentalSessionId : "",
      code = typeof body.publicCode === "string" ? body.publicCode.trim() : "",
      mode =
        body.paymentMode === "twint_prepaid"
          ? "twint_prepaid"
          : body.paymentMode === "card_hold"
            ? "card_hold"
            : null,
      accepted = body.accepted === true;
    if (!id || code.length < 4 || !mode || !accepted)
      return json({ ok: false, error: "INVALID_PAYMENT_REQUEST" }, 400);
    const { data: s, error } = await d
      .from("rental_sessions")
      .select("*")
      .eq("id", id)
      .eq("public_session_code", code)
      .maybeSingle();
    if (error) throw error;
    if (!s) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    const lang = loc(s.customer_language ?? body.language),
      progressUrl = portal(String(s.id), code, lang, "progress");
    if (s.expires_at && Date.parse(s.expires_at) < Date.now())
      return json({ ok: false, error: "SESSION_EXPIRED" }, 410);
    if (
      s.paid_at ||
      [
        "payment_succeeded",
        "ejecting",
        "ejected",
        "active_rental",
        "battery_taken",
        "battery_returned",
        "completed",
      ].includes(String(s.state))
    )
      return json({ ok: true, alreadyPaid: true, progressUrl });
    if (s.stripe_checkout_session_id) {
      if (s.checkout_payment_mode !== mode)
        return json({ ok: false, error: "PAYMENT_MODE_ALREADY_SELECTED" }, 409);
      if (
        s.checkout_url &&
        s.checkout_url_expires_at &&
        Date.parse(s.checkout_url_expires_at) > Date.now()
      )
        return json({
          ok: true,
          checkoutUrl: s.checkout_url,
          expiresAt: s.checkout_url_expires_at,
          paymentMode: mode,
        });
    }
    const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
    if (!(key.startsWith("sk_test_") || key.startsWith("rk_test_")))
      return json({ ok: false, error: "STRIPE_TEST_KEY_REQUIRED" }, 503);
    const snap = s.pricing_snapshot as Record<string, unknown> | null,
      deposit = Math.round(
        Number(s.deposit_amount_cents ?? snap?.deposit_cents ?? 0),
      );
    if (!snap || !Number.isInteger(deposit) || deposit <= 0)
      return json({ ok: false, error: "PRICING_NOT_CONFIGURED" }, 409);
    const acceptedAt = new Date().toISOString();
    const { error: acceptanceError } = await d
      .from("rental_sessions")
      .update({
        contract_terms_version: TERMS_VERSION,
        contract_privacy_version: PRIVACY_VERSION,
        contract_accepted_at: acceptedAt,
        updated_at: acceptedAt,
      })
      .eq("id", s.id);
    if (acceptanceError) throw acceptanceError;
    await d.from("audit_logs").insert({
      action: "rental.contract.accepted",
      target: String(s.id),
      data: { terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, surface: "web", language: lang },
    }).then(() => {}, () => {});
    await ensurePaymentStarted(d, s);
    const text = copy(lang, mode),
      stripe = new Stripe(key, {
        apiVersion: "2024-12-18.acacia",
        httpClient: Stripe.createFetchHttpClient(),
      }),
      metadata = {
        rental_session_id: String(s.id),
        public_session_code: code,
        station_id: String(s.station_id ?? ""),
        pricing_snapshot_hash: String(s.pricing_snapshot_hash ?? ""),
        deposit_amount_cents: String(deposit),
        payment_purpose: "rental_guarantee",
        payment_mode: mode,
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
      },
      expiresAt = Math.floor(Date.now() / 1000) + 30 * 60,
      pi: any = { description: text.name, metadata };
    if (mode === "card_hold") {
      pi.capture_method = "manual";
      pi.setup_future_usage = "off_session";
    }
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        locale: lang,
        client_reference_id: String(s.id),
        customer_creation: "always",
        payment_method_types: mode === "card_hold" ? ["card"] : ["twint"],
        payment_intent_data: pi,
        expires_at: expiresAt,
        line_items: [
          {
            price_data: {
              currency: String(s.currency ?? "CHF").toLowerCase(),
              product_data: { name: text.name, description: text.desc },
              unit_amount: deposit,
            },
            quantity: 1,
          },
        ],
        metadata,
        custom_text: { submit: { message: text.submit } },
        success_url: progressUrl,
        cancel_url: portal(String(s.id), code, lang, "choose"),
      },
      {
        idempotencyKey: `rental_guarantee_checkout:v3:${s.id}:${mode}:${s.pricing_snapshot_hash ?? "nohash"}`,
      },
    );
    const expiresIso = new Date(expiresAt * 1000).toISOString(),
      now = new Date().toISOString();
    const { error: u } = await d
      .from("rental_sessions")
      .update({
        stripe_checkout_session_id: checkout.id,
        checkout_url: checkout.url,
        checkout_url_expires_at: expiresIso,
        state: "checkout_created",
        amount: deposit / 100,
        amount_expected: deposit / 100,
        deposit_amount_cents: deposit,
        checkout_payment_mode: mode,
        contract_terms_version: TERMS_VERSION,
        contract_privacy_version: PRIVACY_VERSION,
        contract_accepted_at: now,
        settlement_status: "pending",
        settlement_error: null,
      })
      .eq("id", s.id);
    if (u) throw u;
    const { error: p } = await d
      .from("payments")
      .upsert(
        {
          rental_session_id: s.id,
          stripe_session_id: checkout.id,
          amount: deposit / 100,
          currency: s.currency,
          status: "pending",
          amount_authorized_cents: 0,
          amount_captured_cents: 0,
          amount_refunded_cents: 0,
        },
        { onConflict: "stripe_session_id" },
      );
    if (p) throw p;
    await d
      .from("audit_logs")
      .insert({
        action: "stripe.checkout.public_choice_created",
        target: String(s.id),
        data: {
          payment_mode: mode,
          terms_version: TERMS_VERSION,
          privacy_version: PRIVACY_VERSION,
          correlation_id: cid,
        },
      })
      .then(
        () => {},
        () => {},
      );
    return json({
      ok: true,
      checkoutUrl: checkout.url,
      expiresAt: expiresIso,
      paymentMode: mode,
    });
  } catch (e) {
    const raw = e as any;
    console.error("public-stripe-checkout", {
      name: e instanceof Error ? e.name : "error",
      code: raw?.code ?? null,
      param: raw?.param ?? null,
    });
    return json(
      {
        ok: false,
        error:
          typeof raw?.code === "string"
            ? `STRIPE_${raw.code.toUpperCase()}`
            : "STRIPE_CHECKOUT_FAILED",
      },
      500,
    );
  }
});
