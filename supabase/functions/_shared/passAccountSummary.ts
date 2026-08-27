import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function loadPassAccountSummary(db: SupabaseClient, userId: string) {
  const nowIso = new Date().toISOString();

  const [
    { data: wallet, error: walletError },
    { data: campaign, error: campaignError },
    { data: pricing, error: pricingError },
    { data: chargePoints, error: chargePointsError },
  ] = await Promise.all([
    db.from("wallets").select("id,currency,created_at,updated_at").eq("user_id", userId).eq("currency", "CHF").maybeSingle(),
    db.from("loyalty_campaigns")
      .select("id,code,name,description,currency,purchase_price_cents,purchased_credit_cents,reward_value_cap_cents,active,valid_from,valid_to,config")
      .eq("code", "launch_offer_45").eq("active", true).lte("valid_from", nowIso)
      .or(`valid_to.is.null,valid_to.gt.${nowIso}`).maybeSingle(),
    db.from("price_profiles")
      .select("id,name,currency,version,initial_fee_cents,period_minutes,price_per_period_cents,min_amount_cents,daily_cap_cents,total_cap_cents,max_amount_cents,deposit_cents,unreturned_fee_cents,unreturned_after_minutes")
      .eq("name", "Chargeurs.ch Client").eq("active", true).order("priority", { ascending: false }).limit(1).maybeSingle(),
    db.from("customer_chargepoints_balances")
      .select("balance,last_activity_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (walletError) throw new Error("PASS_WALLET_UNAVAILABLE");
  if (campaignError) throw new Error("PASS_CAMPAIGN_UNAVAILABLE");
  if (pricingError) throw new Error("PASS_PRICING_UNAVAILABLE");
  if (chargePointsError) throw new Error("PASS_CHARGEPOINTS_UNAVAILABLE");

  let balanceCents = 0;
  let walletLastActivityAt: string | null = null;
  if (wallet?.id) {
    const { data: lastEntry, error } = await db.from("wallet_ledger")
      .select("balance_after_cents,created_at")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("PASS_WALLET_LEDGER_UNAVAILABLE");
    balanceCents = Number(lastEntry?.balance_after_cents ?? 0);
    walletLastActivityAt = lastEntry?.created_at ?? null;
  }

  const chargePointsSummary = {
    balance: Number(chargePoints?.balance ?? 0),
    lastActivityAt: chargePoints?.last_activity_at ?? null,
  };

  if (!campaign) {
    return {
      wallet: { balanceCents, currency: "CHF", lastActivityAt: walletLastActivityAt },
      chargePoints: chargePointsSummary,
      launchOffer: null,
      pricing: pricing ?? null,
    };
  }

  const { data: enrollment, error: enrollmentError } = await db.from("loyalty_campaign_enrollments")
    .select("id,status,paid_amount_cents,purchased_credit_cents,campaign_points_earned,campaign_points_spent,reward_value_unlocked_cents,reward_value_redeemed_cents,enrolled_at,activated_at,completed_at")
    .eq("campaign_id", campaign.id).eq("user_id", userId).maybeSingle();
  if (enrollmentError) throw new Error("PASS_ENROLLMENT_UNAVAILABLE");

  const [missionsResult, rewardsResult, redemptionsResult, progressResult] = await Promise.all([
    db.from("loyalty_missions")
      .select("id,code,name,description,metric,threshold,reward_points,reward_value_cents,sort_order")
      .eq("campaign_id", campaign.id).eq("active", true).order("sort_order", { ascending: true }),
    db.from("rewards_catalog")
      .select("id,code,name,description,reward_type,points_cost,reward_value_cents,wallet_credit_cents,max_redemptions_per_user")
      .eq("campaign_id", campaign.id).eq("active", true).lte("valid_from", nowIso)
      .or(`valid_to.is.null,valid_to.gt.${nowIso}`).order("points_cost", { ascending: true }),
    db.from("reward_redemptions")
      .select("id,reward_id,points_spent,reward_value_cents,status,created_at")
      .eq("campaign_id", campaign.id).eq("user_id", userId).order("created_at", { ascending: false }),
    enrollment?.id
      ? db.from("loyalty_mission_progress")
          .select("mission_id,progress,status,completed_at,updated_at")
          .eq("enrollment_id", enrollment.id).eq("user_id", userId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (missionsResult.error || rewardsResult.error || redemptionsResult.error || progressResult.error) {
    throw new Error("PASS_LOYALTY_DETAIL_UNAVAILABLE");
  }

  const progressByMission = new Map((progressResult.data ?? []).map((row) => [String(row.mission_id), row]));
  const missions = (missionsResult.data ?? []).map((mission) => {
    const progress = progressByMission.get(String(mission.id));
    return {
      ...mission,
      progress: Number(progress?.progress ?? 0),
      status: String(progress?.status ?? "in_progress"),
      completed_at: progress?.completed_at ?? null,
    };
  });
  const redemptionCounts = new Map<string, number>();
  for (const redemption of redemptionsResult.data ?? []) {
    if (redemption.status !== "completed") continue;
    const key = String(redemption.reward_id);
    redemptionCounts.set(key, (redemptionCounts.get(key) ?? 0) + 1);
  }
  const rewards = (rewardsResult.data ?? []).map((reward) => ({
    ...reward,
    redeemed_count: redemptionCounts.get(String(reward.id)) ?? 0,
  }));

  return {
    wallet: { balanceCents, currency: "CHF", lastActivityAt: walletLastActivityAt },
    chargePoints: chargePointsSummary,
    launchOffer: {
      campaign,
      enrollment: enrollment ?? null,
      missions,
      rewards,
      redemptions: redemptionsResult.data ?? [],
    },
    pricing: pricing ?? null,
  };
}
