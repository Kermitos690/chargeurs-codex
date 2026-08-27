import type Stripe from "https://esm.sh/stripe@18.5.0?target=deno";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function fulfilLaunchOfferCheckout(
  db: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<{ handled: boolean; result?: unknown }> {
  if (session.metadata?.payment_purpose !== "chargeurs_pass_topup") return { handled: false };
  if (session.payment_status !== "paid") return { handled: false };

  const topupId = String(session.metadata?.wallet_topup_id ?? "");
  const userId = String(session.metadata?.customer_user_id ?? "");
  const campaignCode = String(session.metadata?.campaign_code ?? "");
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? "";
  const amount = Number(session.amount_total ?? 0);
  const currency = String(session.currency ?? "").toUpperCase();
  if (!topupId || !userId || campaignCode !== "launch_offer_45" || !paymentIntentId || amount !== 4500 || currency !== "CHF") {
    throw new Error("PASS_TOPUP_WEBHOOK_INTEGRITY_MISMATCH");
  }

  const { data: wallet, error: walletError } = await db.from("wallet_topups")
    .select("id,wallet_id,wallets!inner(user_id)")
    .eq("id", topupId)
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();
  if (walletError || !wallet) throw new Error("PASS_TOPUP_WEBHOOK_LOCAL_RECORD_MISSING");
  const owner = Array.isArray((wallet as any).wallets) ? (wallet as any).wallets[0]?.user_id : (wallet as any).wallets?.user_id;
  if (String(owner ?? "") !== userId) throw new Error("PASS_TOPUP_WEBHOOK_USER_MISMATCH");

  const { data, error } = await db.rpc("confirm_chargeurs_pass_topup", {
    p_topup_id: topupId,
    p_stripe_checkout_session_id: session.id,
    p_stripe_payment_intent_id: paymentIntentId,
    p_amount_cents: amount,
    p_currency: currency,
  });
  if (error) throw error;
  return { handled: true, result: data };
}
