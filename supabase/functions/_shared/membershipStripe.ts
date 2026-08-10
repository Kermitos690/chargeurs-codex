import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { auditLog } from "./db.ts";

type DB = SupabaseClient;

type MembershipRow = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  stripe_subscription_id: string | null;
};

function isoFromUnix(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

function subscriptionStatus(status: Stripe.Subscription.Status, deleted = false) {
  if (deleted || status === "canceled") return "cancelled";
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid" || status === "paused") return "past_due";
  if (status === "incomplete_expired") return "expired";
  return "pending";
}

async function findMembership(
  db: DB,
  input: { membershipId?: string | null; subscriptionId?: string | null; checkoutId?: string | null },
): Promise<MembershipRow | null> {
  if (input.membershipId) {
    const { data, error } = await db.from("customer_memberships")
      .select("id,user_id,plan_id,status,starts_at,ends_at,stripe_subscription_id")
      .eq("id", input.membershipId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as MembershipRow;
  }
  if (input.subscriptionId) {
    const { data, error } = await db.from("customer_memberships")
      .select("id,user_id,plan_id,status,starts_at,ends_at,stripe_subscription_id")
      .eq("stripe_subscription_id", input.subscriptionId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as MembershipRow;
  }
  if (input.checkoutId) {
    const { data, error } = await db.from("customer_memberships")
      .select("id,user_id,plan_id,status,starts_at,ends_at,stripe_subscription_id")
      .eq("stripe_checkout_session_id", input.checkoutId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as MembershipRow;
  }
  return null;
}

async function ensureWalletPass(db: DB, membership: MembershipRow) {
  const { data: existing, error: readError } = await db.from("customer_wallet_passes")
    .select("id,status")
    .eq("user_id", membership.user_id)
    .eq("membership_id", membership.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    if (existing.status !== "active") {
      const { error } = await db.from("customer_wallet_passes")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw error;
    }
    return;
  }
  const { error } = await db.from("customer_wallet_passes").insert({
    user_id: membership.user_id,
    membership_id: membership.id,
    status: "active",
  });
  if (error) throw error;
}

export async function syncMembershipSubscription(
  db: DB,
  subscription: Stripe.Subscription,
  eventId: string,
  deleted = false,
): Promise<boolean> {
  const metadataMembershipId = subscription.metadata?.membership_id || null;
  const membership = await findMembership(db, {
    membershipId: metadataMembershipId,
    subscriptionId: subscription.id,
  });
  if (!membership) return false;

  const status = subscriptionStatus(subscription.status, deleted);
  const currentStart = isoFromUnix(subscription.current_period_start);
  const currentEnd = isoFromUnix(subscription.current_period_end);
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const startsAt = membership.starts_at ?? currentStart ?? isoFromUnix(subscription.start_date) ?? new Date().toISOString();
  const terminal = status === "cancelled" || status === "expired";
  const endsAt = terminal
    ? isoFromUnix(subscription.ended_at) ?? currentEnd ?? new Date().toISOString()
    : cancelAtPeriodEnd ? currentEnd : null;
  const renewsAt = status === "active" && !cancelAtPeriodEnd ? currentEnd : null;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const { error } = await db.from("customer_memberships").update({
    status,
    starts_at: startsAt,
    renews_at: renewsAt,
    ends_at: endsAt,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_current_period_start: currentStart,
    stripe_current_period_end: currentEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
    last_stripe_event_id: eventId,
    updated_at: new Date().toISOString(),
  }).eq("id", membership.id);
  if (error) throw error;

  if (status === "active") await ensureWalletPass(db, membership);
  if (terminal) {
    await db.from("customer_wallet_passes")
      .update({ status: "revoked", provider_status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("membership_id", membership.id)
      .then(() => {}, () => {});
  }

  await auditLog(db, {
    action: `membership.stripe_${status}`,
    target: membership.id,
    data: {
      stripe_event_id: eventId,
      stripe_subscription_id: subscription.id,
      current_period_end: currentEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
    },
  });
  return true;
}

export async function fulfilMembershipCheckout(
  db: DB,
  stripe: Stripe,
  checkout: Stripe.Checkout.Session,
  eventId: string,
): Promise<boolean> {
  if (checkout.metadata?.payment_purpose !== "customer_membership") return false;
  const membership = await findMembership(db, {
    membershipId: checkout.metadata?.membership_id ?? null,
    checkoutId: checkout.id,
  });
  if (!membership) return false;

  const subscriptionId = typeof checkout.subscription === "string"
    ? checkout.subscription
    : checkout.subscription?.id ?? null;
  const customerId = typeof checkout.customer === "string"
    ? checkout.customer
    : checkout.customer?.id ?? null;

  const { error } = await db.from("customer_memberships").update({
    stripe_checkout_session_id: checkout.id,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    last_stripe_event_id: eventId,
    updated_at: new Date().toISOString(),
  }).eq("id", membership.id);
  if (error) throw error;

  if (!subscriptionId) return true;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return syncMembershipSubscription(db, subscription, eventId);
}

export async function syncMembershipFromInvoice(
  db: DB,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  eventId: string,
): Promise<boolean> {
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id ?? null;
  if (!subscriptionId) return false;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return syncMembershipSubscription(db, subscription, eventId);
}
