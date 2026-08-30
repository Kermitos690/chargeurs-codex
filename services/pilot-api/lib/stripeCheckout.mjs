import Stripe from "stripe";
import { snapshotHash } from "./rentals.mjs";
import { getStation } from "./data.mjs";

function testStripe() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!(key.startsWith("sk_test_") || key.startsWith("rk_test_"))) return null;
  return new Stripe(key, { apiVersion: "2025-09-30.clover" });
}

function safeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

export async function createTestCheckout(pool, auth, body) {
  const rentalSessionId = typeof body.rentalSessionId === "string" ? body.rentalSessionId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(rentalSessionId)) return { ok: false, status: 400, error: "MISSING_SESSION" };

  const sessionResult = await pool.query("select * from rental_sessions where id=$1 limit 1", [rentalSessionId]);
  const session = sessionResult.rows[0];
  if (!session) return { ok: false, status: 404, error: "SESSION_NOT_FOUND" };
  if (session.station_id !== auth.stationId) return { ok: false, status: 403, error: "KIOSK_STATION_MISMATCH" };
  if (String(session.kiosk_device_id) !== String(auth.device.id)) return { ok: false, status: 403, error: "KIOSK_DEVICE_MISMATCH" };
  if (session.expires_at && Date.parse(session.expires_at) < Date.now()) return { ok: false, status: 410, error: "SESSION_EXPIRED" };
  if (session.paid_at) return { ok: false, status: 409, error: "SESSION_ALREADY_PAID" };

  const station = await getStation(pool, session.station_id);
  if (!station?.pilot_enabled) return { ok: false, status: 409, error: "PILOT_STATION_NOT_ENABLED" };

  const stripe = testStripe();
  if (!stripe) return { ok: false, status: 503, error: "STRIPE_TEST_KEY_REQUIRED" };

  const origin = safeOrigin(body.origin) || safeOrigin(process.env.PUBLIC_APP_URL);
  if (!origin) return { ok: false, status: 503, error: "PUBLIC_APP_URL_NOT_CONFIGURED" };

  const snapshot = session.pricing_snapshot;
  if (!snapshot || snapshotHash(snapshot) !== session.pricing_snapshot_hash) {
    return { ok: false, status: 409, error: "SNAPSHOT_INVALID" };
  }
  const depositCents = Number(session.deposit_amount_cents || snapshot.deposit_cents || 0);
  if (!Number.isInteger(depositCents) || depositCents <= 0) return { ok: false, status: 409, error: "PRICING_NOT_CONFIGURED" };
  if (String(session.currency || "CHF").toLowerCase() !== "chf") return { ok: false, status: 409, error: "CURRENCY_MISMATCH" };

  if (session.stripe_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(session.stripe_checkout_session_id);
      if (existing.status === "open" && existing.url) {
        return {
          ok: true,
          status: 200,
          checkout_url: existing.url,
          checkout_id: existing.id,
          public_session_code: session.public_session_code,
          expires_at: existing.expires_at ? new Date(existing.expires_at * 1000).toISOString() : session.checkout_url_expires_at,
          deposit_cents: depositCents,
          reused: true,
        };
      }
    } catch {
      // A stale Checkout id is harmless; create a fresh TEST session below.
    }
  }

  const lang = ["fr", "de", "en"].includes(session.customer_language) ? session.customer_language : "fr";
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const metadata = {
    rental_session_id: String(session.id),
    public_session_code: String(session.public_session_code),
    station_id: String(session.station_id),
    kiosk_device_id: String(session.kiosk_device_id),
    pricing_snapshot_hash: String(session.pricing_snapshot_hash),
    deposit_amount_cents: String(depositCents),
    payment_purpose: "rental_guarantee",
    environment: "pilot_selfhost_test",
  };

  // Card-only for the first field qualification. Stripe Checkout still exposes
  // compatible Apple Pay / Google Pay wallets through the card rail. TWINT is
  // intentionally deferred because its capture/refund semantics differ.
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    locale: lang,
    client_reference_id: String(session.id),
    customer_creation: "always",
    payment_method_types: ["card"],
    payment_method_options: {
      card: { capture_method: "manual", setup_future_usage: "off_session" },
    },
    payment_intent_data: {
      description: "Chargeurs.ch — garantie de location TEST",
      metadata,
    },
    expires_at: expiresAt,
    line_items: [{
      price_data: {
        currency: "chf",
        product_data: {
          name: "Chargeurs.ch — Garantie de location",
          description: "Mode pilote TEST. Le prix réel de location est calculé au retour.",
        },
        unit_amount: depositCents,
      },
      quantity: 1,
    }],
    metadata,
    success_url: `${origin}/pilot/pay/${encodeURIComponent(String(session.id))}?c=${encodeURIComponent(String(session.public_session_code))}&result=success&lang=${lang}`,
    cancel_url: `${origin}/pilot/pay/${encodeURIComponent(String(session.id))}?c=${encodeURIComponent(String(session.public_session_code))}&result=cancel&lang=${lang}`,
  }, { idempotencyKey: `pilot_checkout:v1:${session.id}:${session.pricing_snapshot_hash}` });

  const expiresIso = new Date(expiresAt * 1000).toISOString();
  await pool.query("begin");
  try {
    await pool.query(
      `update rental_sessions
          set stripe_checkout_session_id=$2, checkout_url=$3, checkout_url_expires_at=$4,
              expires_at=$4, state='checkout_created', state_version=state_version+1,
              payment_status='awaiting_payment', updated_at=now()
        where id=$1`,
      [session.id, checkout.id, checkout.url, expiresIso],
    );
    await pool.query(
      `insert into payments(rental_session_id,stripe_checkout_session_id,status,currency)
       values($1,$2,'pending',$3)
       on conflict(rental_session_id) do update set stripe_checkout_session_id=excluded.stripe_checkout_session_id,status='pending',updated_at=now()`,
      [session.id, checkout.id, session.currency],
    );
    await pool.query(
      `insert into audit_logs(action,target,data) values ('stripe.checkout.test_created',$1,$2::jsonb)`,
      [session.id, JSON.stringify({ checkout_id: checkout.id, station_id: session.station_id, deposit_cents: depositCents, payment_methods: ["card"], capture_method: "manual", hardware_ejection_triggered: false })],
    );
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }

  return {
    ok: true,
    status: 200,
    checkout_url: checkout.url,
    checkout_id: checkout.id,
    public_session_code: session.public_session_code,
    expires_at: expiresIso,
    deposit_cents: depositCents,
    reused: false,
  };
}

async function markWebhookEvent(pool, event, rentalSessionId) {
  const inserted = await pool.query(
    `insert into stripe_webhook_events(event_id,event_type,object_id,rental_session_id,processing_status)
     values($1,$2,$3,$4,'received')
     on conflict(event_id) do nothing
     returning event_id`,
    [event.id, event.type, event.data?.object?.id || null, rentalSessionId || null],
  );
  return Boolean(inserted.rows[0]);
}

export async function processStripeWebhook(pool, rawBody, signature) {
  const stripe = testStripe();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripe || !webhookSecret.startsWith("whsec_")) return { ok: false, status: 503, error: "STRIPE_TEST_WEBHOOK_NOT_CONFIGURED" };
  if (!signature) return { ok: false, status: 400, error: "STRIPE_SIGNATURE_REQUIRED" };

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return { ok: false, status: 400, error: "STRIPE_SIGNATURE_INVALID" };
  }

  const object = event.data.object;
  const metadata = object?.metadata || {};
  const rentalSessionId = typeof metadata.rental_session_id === "string"
    ? metadata.rental_session_id
    : typeof object?.client_reference_id === "string" ? object.client_reference_id : null;

  const firstHandler = await markWebhookEvent(pool, event, rentalSessionId);
  if (!firstHandler) return { ok: true, status: 200, duplicate: true };

  try {
    if (event.type === "checkout.session.completed") {
      const checkout = object;
      if (!rentalSessionId) throw new Error("RENTAL_SESSION_METADATA_MISSING");
      const sessionResult = await pool.query("select * from rental_sessions where id=$1 limit 1", [rentalSessionId]);
      const session = sessionResult.rows[0];
      if (!session) throw new Error("SESSION_NOT_FOUND");
      if (String(checkout.metadata?.pricing_snapshot_hash || "") !== String(session.pricing_snapshot_hash)) throw new Error("SNAPSHOT_MISMATCH");
      if (String(checkout.metadata?.station_id || "") !== String(session.station_id)) throw new Error("STATION_MISMATCH");

      const intentId = typeof checkout.payment_intent === "string" ? checkout.payment_intent : checkout.payment_intent?.id;
      if (!intentId) throw new Error("PAYMENT_INTENT_MISSING");
      const intent = await stripe.paymentIntents.retrieve(intentId);
      const expectedCents = Number(session.deposit_amount_cents);
      const observedCents = Number(intent.amount || 0);
      if (intent.currency !== "chf" || observedCents !== expectedCents) throw new Error("DEPOSIT_PAYMENT_MISMATCH");
      if (intent.status !== "requires_capture") throw new Error(`PAYMENT_NOT_AUTHORIZED_${String(intent.status).toUpperCase()}`);

      const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
      let paymentMethodType = "card";
      if (paymentMethodId) {
        try { paymentMethodType = (await stripe.paymentMethods.retrieve(paymentMethodId)).type || "card"; } catch { /* card-only pilot */ }
      }

      await pool.query("begin");
      try {
        await pool.query(
          `update rental_sessions
              set state='payment_authorized', state_version=state_version+1, payment_status='authorized',
                  stripe_payment_intent_id=$2, stripe_payment_method_type=$3,
                  payment_authorized_cents=$4, paid_at=coalesce(paid_at,now()), updated_at=now()
            where id=$1 and state in ('created','checkout_created','payment_pending','payment_authorized')`,
          [session.id, intent.id, paymentMethodType, Number(intent.amount_capturable || intent.amount || expectedCents)],
        );
        await pool.query(
          `insert into payments(rental_session_id,stripe_checkout_session_id,stripe_payment_intent_id,status,currency,amount_authorized_cents,payment_method_type)
           values($1,$2,$3,'authorized','CHF',$4,$5)
           on conflict(rental_session_id) do update set stripe_payment_intent_id=excluded.stripe_payment_intent_id,status='authorized',amount_authorized_cents=excluded.amount_authorized_cents,payment_method_type=excluded.payment_method_type,updated_at=now()`,
          [session.id, checkout.id, intent.id, Number(intent.amount_capturable || intent.amount || expectedCents), paymentMethodType],
        );
        await pool.query(
          `insert into audit_logs(action,target,data) values ('stripe.payment.test_authorized',$1,$2::jsonb)`,
          [session.id, JSON.stringify({ event_id: event.id, payment_intent_id: intent.id, amount_authorized_cents: Number(intent.amount_capturable || intent.amount || expectedCents), hardware_ejection_triggered: false })],
        );
        await pool.query("commit");
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
    } else if (event.type === "checkout.session.expired" && rentalSessionId) {
      await pool.query(
        `update rental_sessions set state='payment_expired',state_version=state_version+1,payment_status='expired',updated_at=now()
          where id=$1 and paid_at is null`,
        [rentalSessionId],
      );
    } else if (event.type === "payment_intent.payment_failed" && rentalSessionId) {
      await pool.query(
        `update rental_sessions set state='payment_failed',state_version=state_version+1,payment_status='failed',failure_code='PAYMENT_INTENT_FAILED',updated_at=now()
          where id=$1 and paid_at is null`,
        [rentalSessionId],
      );
    }

    await pool.query(
      "update stripe_webhook_events set processing_status='processed',processed_at=now() where event_id=$1",
      [event.id],
    );
    return { ok: true, status: 200, received: true };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : "WEBHOOK_PROCESSING_FAILED";
    await pool.query(
      "update stripe_webhook_events set processing_status='failed',failure_code=$2 where event_id=$1",
      [event.id, code],
    ).catch(() => undefined);
    return { ok: false, status: 500, error: "STRIPE_WEBHOOK_PROCESSING_FAILED" };
  }
}
