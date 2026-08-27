import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type User = { id: string; email?: string | null };

type Result =
  | { ok: true; checkoutUrl: string; topupId: string; reused?: boolean }
  | { ok: true; alreadyPurchased: true; redirectUrl: string }
  | { ok: false; error: string; status: number };

export async function createLaunchOfferCheckout(
  db: SupabaseClient,
  stripe: Stripe,
  user: User,
  origin: string,
): Promise<Result> {
  const nowIso = new Date().toISOString();
  const { data: campaign, error: campaignError } = await db.from("loyalty_campaigns")
    .select("id,code,name,currency,purchase_price_cents,purchased_credit_cents,reward_value_cap_cents,active,valid_from,valid_to")
    .eq("code", "launch_offer_45")
    .eq("active", true)
    .lte("valid_from", nowIso)
    .or(`valid_to.is.null,valid_to.gt.${nowIso}`)
    .maybeSingle();
  if (campaignError) return { ok: false, error: "PASS_CAMPAIGN_UNAVAILABLE", status: 500 };
  if (!campaign) return { ok: false, error: "PASS_CAMPAIGN_NOT_AVAILABLE", status: 404 };

  const amount = Number(campaign.purchase_price_cents);
  const credit = Number(campaign.purchased_credit_cents);
  const currency = String(campaign.currency ?? "CHF").toUpperCase();
  if (amount !== 4500 || credit !== 4500 || currency !== "CHF") {
    return { ok: false, error: "PASS_CAMPAIGN_CONFIGURATION_INVALID", status: 409 };
  }

  const { data: existingEnrollment, error: enrollmentError } = await db.from("loyalty_campaign_enrollments")
    .select("id,status")
    .eq("campaign_id", campaign.id)
    .eq("user_id", user.id)
    .in("status", ["active", "completed"])
    .maybeSingle();
  if (enrollmentError) return { ok: false, error: "PASS_ENROLLMENT_LOOKUP_FAILED", status: 500 };
  if (existingEnrollment) return { ok: true, alreadyPurchased: true, redirectUrl: `${origin}/compte/pass` };

  const { error: walletCreateError } = await db.from("wallets")
    .upsert({ user_id: user.id, currency: "CHF" }, { onConflict: "user_id,currency", ignoreDuplicates: true });
  if (walletCreateError) return { ok: false, error: "PASS_WALLET_CREATE_FAILED", status: 500 };
  const { data: wallet, error: walletError } = await db.from("wallets")
    .select("id,user_id,currency")
    .eq("user_id", user.id).eq("currency", "CHF").single();
  if (walletError || !wallet) return { ok: false, error: "PASS_WALLET_UNAVAILABLE", status: 500 };

  const { data: pendingRows, error: pendingError } = await db.from("wallet_topups")
    .select("id,stripe_checkout_session_id,status")
    .eq("wallet_id", wallet.id)
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  if (pendingError) return { ok: false, error: "PASS_TOPUP_LOOKUP_FAILED", status: 500 };
  const pending = pendingRows?.[0] ?? null;
  if (pending?.stripe_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(String(pending.stripe_checkout_session_id));
      if (existing.status === "open" && existing.url) {
        return { ok: true, checkoutUrl: existing.url, topupId: String(pending.id), reused: true };
      }
    } catch (_) { /* create a replacement below */ }
    await db.from("wallet_topups").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", pending.id);
  }

  const { data: topup, error: topupError } = await db.from("wallet_topups")
    .insert({
      wallet_id: wallet.id,
      amount_cents: amount,
      currency,
      status: "pending",
      campaign_id: campaign.id,
      payment_purpose: "chargeurs_pass_topup",
      metadata: { campaign_code: campaign.code, purchased_credit_cents: credit },
    })
    .select("id")
    .single();
  if (topupError || !topup) return { ok: false, error: "PASS_TOPUP_CREATE_FAILED", status: 500 };

  const metadata = {
    payment_purpose: "chargeurs_pass_topup",
    wallet_topup_id: String(topup.id),
    campaign_id: String(campaign.id),
    campaign_code: String(campaign.code),
    customer_user_id: String(user.id),
    purchased_credit_cents: String(credit),
  };

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "auto",
      customer_email: user.email ?? undefined,
      client_reference_id: String(topup.id),
      allow_promotion_codes: false,
      line_items: [{
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: amount,
          product_data: {
            name: "Chargeurs Pass — offre de lancement",
            description: "CHF 45 de crédit Chargeurs acheté. Les récompenses de lancement se débloquent ensuite progressivement.",
          },
        },
        quantity: 1,
      }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/compte/pass?launch=success&checkout={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/compte/pass?launch=cancelled`,
    }, {
      idempotencyKey: `chargeurs_pass_launch_checkout:v1:${topup.id}:4500`,
    });
    if (!checkout.url) throw new Error("CHECKOUT_URL_MISSING");
    const { error: updateError } = await db.from("wallet_topups").update({
      stripe_checkout_session_id: checkout.id,
      updated_at: new Date().toISOString(),
    }).eq("id", topup.id);
    if (updateError) throw updateError;
    return { ok: true, checkoutUrl: checkout.url, topupId: String(topup.id) };
  } catch (_) {
    await db.from("wallet_topups").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", topup.id);
    return { ok: false, error: "PASS_CHECKOUT_FAILED", status: 500 };
  }
}
