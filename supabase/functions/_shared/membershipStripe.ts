import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { auditLog } from "./db.ts";

type DB = SupabaseClient;
type StripeClientLike = { subscriptions: { retrieve: (id: string) => Promise<any> } };

type MembershipRow = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  stripe_subscription_id: string | null;
};

function isoFromUnix(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

function subscriptionStatus(status: unknown, deleted = false) {
  const value = String(status ?? "");
  if (deleted || value === "canceled") return "cancelled";
  if (value === "active" || value === "trialing") return "active";
  if (value === "past_due" || value === "unpaid" || value === "paused") return "past_due";
  if (value === "incomplete_expired") return "expired";
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
  subscription: any,
  eventId: string,
  deleted = false,
): Promise<boolean> {
  const metadataMembershipId = typeof subscription?.metadata?.membership_id === "string"
    ? subscription.metadata.membership_id
    : null;
  const subscriptionId = typeof subscription?.id === "string" ? subscription.id : null;
  if (!subscriptionId) return false;

  const membership = await findMembership(db, {
    membershipId: metadataMembershipId,
    subscriptionId,
  });
  if (!membership) return false;

  const status = subscriptionStatus(subscription?.status, deleted);
  const currentStart = isoFromUnix(subscription?.current_period_start);
  const currentEnd = isoFromUnix(subscription?.current_period_end);
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
  const startsAt = membership.starts_at ?? currentStart ?? isoFromUnix(subscription?.start_date) ?? new Date().toISOString();
  const terminal = status === "cancelled" || status === "expired";
  const endsAt = terminal
    ? isoFromUnix(subscription?.ended_at) ?? currentEnd ?? new Date().toISOString()
    : cancelAtPeriodEnd ? currentEnd : null;
  const renewsAt = status === "active" && !cancelAtPeriodEnd ? currentEnd : null;
  const customerId = typeof subscription?.customer === "string"
    ? subscription.customer
    : typeof subscription?.customer?.id === "string" ? subscription.customer.id : null;

  const { error } = await db.from("customer_memberships").update({
    status,
    starts_at: startsAt,
    renews_at: renewsAt,
    ends_at: endsAt,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
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
      stripe_subscription_id: subscriptionId,
      current_period_end: currentEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
    },
  });
  return true;
}

export async function fulfilMembershipCheckout(
  db: DB,
  stripe: StripeClientLike,
  checkout: any,
  eventId: string,
): Promise<boolean> {
  if (checkout?.metadata?.payment_purpose !== "customer_membership") return false;
  const membership = await findMembership(db, {
    membershipId: typeof checkout?.metadata?.membership_id === "string" ? checkout.metadata.membership_id : null,
    checkoutId: typeof checkout?.id === "string" ? checkout.id : null,
  });
  if (!membership) return false;

  const subscriptionId = typeof checkout?.subscription === "string"
    ? checkout.subscription
    : typeof checkout?.subscription?.id === "string" ? checkout.subscription.id : null;
  const customerId = typeof checkout?.customer === "string"
    ? checkout.customer
    : typeof checkout?.customer?.id === "string" ? checkout.customer.id : null;

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
  stripe: StripeClientLike,
  invoice: any,
  eventId: string,
): Promise<boolean> {
  const subscriptionId = typeof invoice?.subscription === "string"
    ? invoice.subscription
    : typeof invoice?.subscription?.id === "string" ? invoice.subscription.id : null;
  if (!subscriptionId) return false;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return syncMembershipSubscription(db, subscription, eventId);
}
