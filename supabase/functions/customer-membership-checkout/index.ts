import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog } from "../_shared/db.ts";
import { validateStripeTestRuntime } from "../_shared/stripeRuntimeConfig.ts";
import { createLaunchOfferCheckout } from "../_shared/passLaunchCheckout.ts";

const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function safeOrigin(req: Request): string | null {
  const configured = (Deno.env.get("PUBLIC_APP_URL") ?? Deno.env.get("APP_URL") ?? "").trim();
  const candidates = [configured, req.headers.get("origin") ?? ""].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase();
      const allowed = host === "chargeurs.ch"
        || host === "www.chargeurs.ch"
        || host === "chargeurs-ch-staging.vercel.app"
        || host === "localhost"
        || host === "127.0.0.1";
      if (allowed && (url.protocol === "https:" || host === "localhost" || host === "127.0.0.1")) return url.origin;
    } catch (_) { /* try next */ }
  }
  return null;
}

type Plan = {
  id: string;
  code: string;
  name: string;
  currency: string;
  annual_fee_cents: number;
  billing_interval: string;
  billing_interval_count: number;
  active: boolean;
  valid_from: string;
  valid_to: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user || !user.email_confirmed_at) return json({ ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" }, 401);

  const origin = safeOrigin(req);
  if (!origin) return json({ ok: false, error: "APP_ORIGIN_NOT_ALLOWED" }, 403);
  const stripeRuntime = validateStripeTestRuntime();
  if (!stripeRuntime.ok) return json({ ok: false, error: stripeRuntime.error }, 503);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "membership");
  const stripe = new Stripe(stripeRuntime.secretKey, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  if (action === "buy_launch_offer_45") {
    const result = await createLaunchOfferCheckout(db, stripe, user, origin);
    await auditLog(db, {
      actor: user.id,
      action: result.ok ? "pass.launch_checkout_requested" : "pass.launch_checkout_failed",
      target: "launch_offer_45",
      data: result.ok ? { already_purchased: "alreadyPurchased" in result ? result.alreadyPurchased : false } : { error: result.error },
    });
    return json(result, result.ok ? 200 : result.status);
  }

  if (action !== "membership") return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);

  const requestedCode = typeof body.planCode === "string" ? body.planCode.trim() : "";
  const nowIso = new Date().toISOString();
  let planQuery = db.from("customer_membership_plans")
    .select("id,code,name,currency,annual_fee_cents,billing_interval,billing_interval_count,active,valid_from,valid_to")
    .eq("active", true).lte("valid_from", nowIso).or(`valid_to.is.null,valid_to.gt.${nowIso}`)
    .order("valid_from", { ascending: false }).limit(1);
  if (requestedCode) planQuery = planQuery.eq("code", requestedCode);

  const { data: planRow, error: planError } = await planQuery.maybeSingle();
  if (planError) return json({ ok: false, error: "MEMBERSHIP_PLAN_UNAVAILABLE" }, 500);
  if (!planRow) return json({ ok: false, error: "MEMBERSHIP_PLAN_NOT_FOUND" }, 404);
  const plan = planRow as Plan;

  const interval = ["day", "week", "month", "year"].includes(plan.billing_interval)
    ? plan.billing_interval as "day" | "week" | "month" | "year" : null;
  const intervalCount = Number(plan.billing_interval_count);
  const feeCents = Number(plan.annual_fee_cents);
  if (!interval || !Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 36 || !Number.isInteger(feeCents) || feeCents <= 0) {
    return json({ ok: false, error: "MEMBERSHIP_PLAN_INVALID" }, 409);
  }

  const { data: currentMemberships, error: membershipReadError } = await db.from("customer_memberships")
    .select("id,plan_id,status,ends_at,renews_at,stripe_checkout_session_id,stripe_subscription_id,stripe_customer_id,updated_at")
    .eq("user_id", user.id).in("status", ["active", "past_due", "pending"])
    .order("updated_at", { ascending: false }).limit(5);
  if (membershipReadError) return json({ ok: false, error: "MEMBERSHIP_LOOKUP_FAILED" }, 500);

  const active = (currentMemberships ?? []).find((membership) => membership.status === "active" && (!membership.ends_at || Date.parse(membership.ends_at) > Date.now()));
  if (active) return json({ ok: true, alreadyActive: true, membershipId: active.id, renewsAt: active.renews_at, redirectUrl: `${origin}/compte/pass` });

  let pending = (currentMemberships ?? []).find((membership) => membership.status === "pending" && membership.plan_id === plan.id) ?? null;
  if (pending?.stripe_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(pending.stripe_checkout_session_id);
      if (existing.status === "open" && existing.url) return json({ ok: true, checkoutUrl: existing.url, membershipId: pending.id, reused: true });
    } catch (_) { /* create new */ }
  }

  if (!pending) {
    const { data: created, error: createError } = await db.from("customer_memberships")
      .insert({ user_id: user.id, plan_id: plan.id, status: "pending" })
      .select("id,plan_id,status,stripe_checkout_session_id,stripe_subscription_id,stripe_customer_id").single();
    if (createError || !created) return json({ ok: false, error: "MEMBERSHIP_CREATE_FAILED" }, 500);
    pending = created;
  }

  const metadata = {
    payment_purpose: "customer_membership",
    membership_id: String(pending.id), membership_plan_id: String(plan.id),
    membership_plan_code: String(plan.code), customer_user_id: String(user.id),
  };

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription", locale: "auto", client_reference_id: String(pending.id),
      customer_email: user.email ?? undefined, allow_promotion_codes: false,
      line_items: [{ price_data: {
        currency: String(plan.currency || "CHF").toLowerCase(), unit_amount: feeCents,
        product_data: { name: `Chargeurs+ — ${plan.name}`, description: "Adhésion Client Chargeurs. Les tarifs de location et avantages applicables sont lus depuis le plan actif." },
        recurring: { interval, interval_count: intervalCount },
      }, quantity: 1 }],
      metadata, subscription_data: { metadata },
      success_url: `${origin}/compte/pass?membership=success&checkout={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/compte/pass?membership=cancelled`,
    }, { idempotencyKey: `customer_membership_checkout:v1:${pending.id}:${plan.id}:${feeCents}:${interval}:${intervalCount}` });

    const { error: updateError } = await db.from("customer_memberships").update({ stripe_checkout_session_id: checkout.id, updated_at: new Date().toISOString() }).eq("id", pending.id).eq("user_id", user.id);
    if (updateError) throw updateError;
    await auditLog(db, { actor: user.id, action: "membership.checkout_created", target: String(pending.id), data: { plan_code: plan.code, checkout_session_id: checkout.id } });
    return json({ ok: true, checkoutUrl: checkout.url, membershipId: pending.id });
  } catch (error) {
    const stripeCode = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code).toUpperCase() : "CHECKOUT_FAILED";
    await auditLog(db, { actor: user.id, action: "membership.checkout_failed", target: String(pending.id), data: { code: stripeCode } });
    return json({ ok: false, error: `MEMBERSHIP_${stripeCode}` }, 500);
  }
});
