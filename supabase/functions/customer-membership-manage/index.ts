import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, auditLog } from "../_shared/db.ts";
import { syncMembershipSubscription } from "../_shared/membershipStripe.ts";
import { validateStripeTestRuntime } from "../_shared/stripeRuntimeConfig.ts";

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
  for (const candidate of [configured, req.headers.get("origin") ?? ""].filter(Boolean)) {
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase();
      const allowed = host === "chargeurs.ch"
        || host === "www.chargeurs.ch"
        || host === "chargeurs-ch-staging.vercel.app"
        || host === "localhost"
        || host === "127.0.0.1";
      if (allowed && (url.protocol === "https:" || host === "localhost" || host === "127.0.0.1")) return url.origin;
    } catch (_) {
      // Try next candidate.
    }
  }
  return null;
}

type Action = "portal" | "cancel_at_period_end" | "resume";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const db = adminClient();
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user || !user.email_confirmed_at) return json({ ok: false, error: "VERIFIED_ACCOUNT_REQUIRED" }, 401);

  const runtime = validateStripeTestRuntime();
  if (!runtime.ok) return json({ ok: false, error: runtime.error }, 503);
  const stripe = new Stripe(runtime.secretKey, {
    apiVersion: "2024-12-18.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "portal") as Action;
  if (!["portal", "cancel_at_period_end", "resume"].includes(action)) {
    return json({ ok: false, error: "MEMBERSHIP_ACTION_INVALID" }, 400);
  }

  const { data: membership, error: membershipError } = await db.from("customer_memberships")
    .select("id,status,stripe_customer_id,stripe_subscription_id,cancel_at_period_end,stripe_current_period_end,ends_at,updated_at")
    .eq("user_id", user.id)
    .in("status", ["active", "past_due", "pending"])
    .not("stripe_subscription_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (membershipError) return json({ ok: false, error: "MEMBERSHIP_LOOKUP_FAILED" }, 500);
  if (!membership?.stripe_subscription_id) return json({ ok: false, error: "MEMBERSHIP_SUBSCRIPTION_NOT_FOUND" }, 404);

  let subscription: any;
  try {
    subscription = await stripe.subscriptions.retrieve(String(membership.stripe_subscription_id));
  } catch {
    return json({ ok: false, error: "MEMBERSHIP_STRIPE_UNAVAILABLE" }, 502);
  }

  if (action === "portal") {
    const origin = safeOrigin(req);
    if (!origin) return json({ ok: false, error: "APP_ORIGIN_NOT_ALLOWED" }, 403);
    const customerId = typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? membership.stripe_customer_id;
    if (!customerId) return json({ ok: false, error: "MEMBERSHIP_CUSTOMER_NOT_FOUND" }, 409);
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: String(customerId),
        return_url: `${origin}/compte/pass`,
      });
      await auditLog(db, {
        actor: user.id,
        action: "membership.portal_opened",
        target: membership.id,
      });
      return json({ ok: true, portalUrl: portal.url });
    } catch {
      return json({ ok: false, error: "MEMBERSHIP_PORTAL_UNAVAILABLE" }, 502);
    }
  }

  if (["canceled", "incomplete_expired"].includes(String(subscription.status ?? ""))) {
    return json({ ok: false, error: "MEMBERSHIP_ALREADY_TERMINAL" }, 409);
  }

  try {
    const updated = await stripe.subscriptions.update(String(membership.stripe_subscription_id), {
      cancel_at_period_end: action === "cancel_at_period_end",
    });
    await syncMembershipSubscription(
      db,
      updated,
      `membership_api:${action}:${crypto.randomUUID()}`,
      false,
    );
    await auditLog(db, {
      actor: user.id,
      action: action === "cancel_at_period_end" ? "membership.cancellation_scheduled" : "membership.renewal_resumed",
      target: membership.id,
      data: {
        stripe_subscription_id: membership.stripe_subscription_id,
        cancel_at_period_end: Boolean(updated.cancel_at_period_end),
        current_period_end: typeof updated.current_period_end === "number"
          ? new Date(updated.current_period_end * 1000).toISOString()
          : null,
      },
    });
    return json({
      ok: true,
      cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
      periodEnd: typeof updated.current_period_end === "number"
        ? new Date(updated.current_period_end * 1000).toISOString()
        : null,
      status: updated.status,
    });
  } catch {
    return json({ ok: false, error: "MEMBERSHIP_UPDATE_FAILED" }, 502);
  }
});
