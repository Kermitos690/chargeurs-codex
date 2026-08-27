import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  Gift,
  Gem,
  Loader2,
  RefreshCw,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatCents } from "./accountData";

type Campaign = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currency: string;
  purchase_price_cents: number;
  purchased_credit_cents: number;
  reward_value_cap_cents: number;
};

type Enrollment = {
  id: string;
  status: string;
  paid_amount_cents: number;
  purchased_credit_cents: number;
  campaign_points_earned: number;
  campaign_points_spent: number;
  reward_value_unlocked_cents: number;
  reward_value_redeemed_cents: number;
} | null;

type Mission = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  metric: string;
  threshold: number;
  reward_points: number;
  reward_value_cents: number;
  progress: number;
  status: string;
};

type Reward = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  points_cost: number;
  reward_value_cents: number;
  wallet_credit_cents: number;
  max_redemptions_per_user: number | null;
  redeemed_count: number;
};

type PassSummary = {
  wallet: { balanceCents: number; currency: string; lastActivityAt: string | null };
  chargePoints: { balance: number; lastActivityAt: string | null };
  launchOffer: null | {
    campaign: Campaign;
    enrollment: Enrollment;
    missions: Mission[];
    rewards: Reward[];
  };
  pricing: null | {
    currency: string;
    initial_fee_cents: number;
    period_minutes: number;
    price_per_period_cents: number;
    min_amount_cents: number;
    max_amount_cents: number;
    deposit_cents: number;
    unreturned_fee_cents: number;
    unreturned_after_minutes: number;
  };
};

function missionProgressLabel(mission: Mission) {
  if (mission.metric === "campaign_paid_credit_spent_cents" || mission.metric === "spent_cents") {
    return `${formatCents(Math.min(mission.progress, mission.threshold))} / ${formatCents(mission.threshold)}`;
  }
  return `${Math.min(mission.progress, mission.threshold)} / ${mission.threshold}`;
}

export default function ChargeursLaunchPass() {
  const [summary, setSummary] = useState<PassSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const launchReturn = useMemo(() => new URLSearchParams(window.location.search).get("launch"), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("account-privacy", {
        body: { action: "summary" },
      });
      if (invokeError || !data?.ok || !data?.data?.pass) throw new Error("PASS_SUMMARY_UNAVAILABLE");
      setSummary(data.data.pass as PassSummary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const buy = async () => {
    if (buying) return;
    setBuying(true);
    setBuyError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("customer-membership-checkout", {
        body: { action: "buy_launch_offer_45" },
      });
      if (invokeError || !data?.ok) throw new Error(String(data?.error ?? "PASS_CHECKOUT_UNAVAILABLE"));
      if (data.checkoutUrl) {
        window.location.assign(String(data.checkoutUrl));
        return;
      }
      if (data.redirectUrl) {
        window.location.assign(String(data.redirectUrl));
        return;
      }
      await load();
    } catch {
      setBuyError("Le paiement de l’offre de lancement n’a pas pu être démarré. Aucun crédit n’a été ajouté.");
    } finally {
      setBuying(false);
    }
  };

  const redeem = async (reward: Reward) => {
    if (redeeming) return;
    setRedeeming(reward.id);
    setRewardError(null);
    try {
      const rpc = supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
      const { error: rpcError } = await rpc.rpc("redeem_chargepoints_reward", {
        p_reward_id: reward.id,
        p_idempotency_key: `account:${crypto.randomUUID()}`,
      });
      if (rpcError) throw rpcError;
      await load();
    } catch {
      setRewardError("Cette récompense ne peut pas être débloquée pour le moment. Aucun point n’a été retiré.");
    } finally {
      setRedeeming(null);
    }
  };

  if (loading) {
    return (
      <section className="grid min-h-56 place-items-center rounded-[2rem] border border-emerald-300/15 bg-emerald-500/5">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
      </section>
    );
  }

  if (error || !summary?.launchOffer) {
    return (
      <section className="rounded-[2rem] border border-warning/25 bg-warning/10 p-6">
        <h1 className="font-display text-2xl font-bold">Chargeurs Pass momentanément indisponible</h1>
        <p className="mt-2 text-sm text-muted-foreground">Le solde et l’offre ne sont pas accessibles pour le moment. Aucun paiement n’est lancé depuis cet état.</p>
        <Button variant="outline" className="mt-4 rounded-full" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />Réessayer
        </Button>
      </section>
    );
  }

  const { campaign, enrollment, missions, rewards } = summary.launchOffer;
  const currency = campaign.currency || "CHF";
  const pointsAvailable = Math.max(0, Number(summary.chargePoints.balance ?? 0));
  const unlockedRemaining = Math.max(
    0,
    Number(enrollment?.reward_value_unlocked_cents ?? 0) - Number(enrollment?.reward_value_redeemed_cents ?? 0),
  );
  const rewardCap = Number(campaign.reward_value_cap_cents ?? 0);
  const unlocked = Number(enrollment?.reward_value_unlocked_cents ?? 0);
  const progressPercent = rewardCap > 0 ? Math.min(100, Math.round((unlocked / rewardCap) * 100)) : 0;
  const pricing = summary.pricing;
  const pricingLabel = pricing
    ? `${formatCents(pricing.price_per_period_cents, pricing.currency)} / ${pricing.period_minutes} min · minimum ${formatCents(pricing.min_amount_cents, pricing.currency)}`
    : "Tarif indisponible";
  const nonReturnDays = pricing?.unreturned_after_minutes
    ? pricing.unreturned_after_minutes / 1440
    : null;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-emerald-300/20 bg-[radial-gradient(circle_at_15%_10%,rgba(16,185,129,.22),transparent_35%),linear-gradient(145deg,rgba(4,15,18,.99),rgba(3,7,16,.99))] p-6 shadow-[0_30px_80px_rgba(0,0,0,.4)] sm:p-8">
      {launchReturn === "success" && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
          Paiement transmis à Stripe. Le crédit apparaît ici uniquement après confirmation du webhook signé.
        </div>
      )}
      {launchReturn === "cancelled" && (
        <div className="mb-5 rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          Paiement interrompu. Aucun crédit n’a été ajouté.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-[.16em] text-emerald-200">
            <Sparkles className="h-4 w-4" /> Offre de lancement
          </div>
          <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-5xl">Chargeurs Pass</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {formatCents(campaign.purchase_price_cents, currency)} chargés = {formatCents(campaign.purchased_credit_cents, currency)} de crédit immédiat, puis jusqu’à {formatCents(campaign.reward_value_cap_cents, currency)} de récompenses à débloquer en utilisant Chargeurs.ch.
          </p>
        </div>
        <Button variant="outline" className="rounded-full" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />Actualiser
        </Button>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={WalletCards} label="Crédit" value={formatCents(summary.wallet.balanceCents, summary.wallet.currency)} />
        <Metric icon={Gem} label="Charge Points" value={`${pointsAvailable.toLocaleString("fr-CH")} ⚡`} />
        <Metric icon={Gift} label="Récompenses débloquées" value={`${formatCents(unlocked, currency)} / ${formatCents(rewardCap, currency)}`} />
        <Metric icon={CircleDollarSign} label="Tarif Pass" value={pricingLabel} />
      </div>

      {!enrollment ? (
        <div className="mt-7 rounded-3xl border border-emerald-300/20 bg-emerald-400/10 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <h2 className="font-display text-xl font-bold">Chargez une fois, louez avec votre crédit Chargeurs.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Vous payez {formatCents(campaign.purchase_price_cents, currency)} en une transaction. Après confirmation Stripe, le même montant devient votre crédit Chargeurs Pass.
            </p>
          </div>
          <Button onClick={() => void buy()} disabled={buying} className="mt-4 rounded-full bg-emerald-400 px-6 font-black text-slate-950 hover:bg-emerald-300 sm:mt-0">
            {buying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WalletCards className="mr-2 h-4 w-4" />}
            Charger {formatCents(campaign.purchase_price_cents, currency)}
          </Button>
        </div>
      ) : (
        <div className="mt-7">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold">Progression lancement</span>
            <span className="text-emerald-200">{progressPercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Jusqu’à {formatCents(rewardCap, currency)} de récompenses peuvent être débloquées. Les Charge Points restent séparés du crédit et sont échangés volontairement.
          </p>
        </div>
      )}
      {buyError && <p className="mt-3 text-sm text-destructive">{buyError}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Gagner des points</h2>
          <div className="mt-3 space-y-3">
            {missions.map((mission) => {
              const done = mission.status === "completed";
              return (
                <div key={mission.id} className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{mission.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{mission.description}</p>
                    </div>
                    <span className={done ? "text-xs font-bold text-emerald-300" : "text-xs text-muted-foreground"}>
                      {done ? "Terminé" : missionProgressLabel(mission)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">+{Number(mission.reward_points).toLocaleString("fr-CH")} ⚡</span>
                    <span className="font-semibold text-emerald-200">+{formatCents(mission.reward_value_cents, currency)} de potentiel récompense</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold"><Gift className="h-5 w-5 text-emerald-300" /> Utiliser mes points</h2>
          <div className="mt-3 space-y-3">
            {rewards.map((reward) => {
              const userLimitReached = reward.max_redemptions_per_user != null && reward.redeemed_count >= reward.max_redemptions_per_user;
              const enoughPoints = pointsAvailable >= Number(reward.points_cost);
              const enoughUnlocked = unlockedRemaining >= Number(reward.reward_value_cents);
              const canRedeem = Boolean(enrollment) && enoughPoints && enoughUnlocked && !userLimitReached;
              const missingPoints = Math.max(0, Number(reward.points_cost) - pointsAvailable);
              return (
                <div key={reward.id} className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{reward.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{reward.description}</p>
                    </div>
                    <span className="whitespace-nowrap text-sm font-black text-emerald-200">{Number(reward.points_cost).toLocaleString("fr-CH")} ⚡</span>
                  </div>
                  <Button
                    className="mt-3 w-full rounded-full"
                    variant={canRedeem ? "default" : "outline"}
                    disabled={!canRedeem || Boolean(redeeming)}
                    onClick={() => void redeem(reward)}
                  >
                    {redeeming === reward.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
                    {userLimitReached
                      ? "Déjà utilisée"
                      : canRedeem
                        ? `Échanger contre ${formatCents(reward.wallet_credit_cents, currency)}`
                        : !enrollment
                          ? "Activez l’offre d’abord"
                          : !enoughPoints
                            ? `Encore ${missingPoints.toLocaleString("fr-CH")} points`
                            : "Récompense pas encore débloquée"}
                  </Button>
                </div>
              );
            })}
          </div>
          {rewardError && <p className="mt-3 text-sm text-destructive">{rewardError}</p>}
        </div>
      </div>

      {pricing && (
        <div className="mt-7 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Tarif membre :</span>{" "}
          {formatCents(pricing.price_per_period_cents, pricing.currency)} par tranche de {pricing.period_minutes} minutes, minimum {formatCents(pricing.min_amount_cents, pricing.currency)} par location. Réserve de {formatCents(pricing.deposit_cents, pricing.currency)} depuis le crédit disponible.
          {nonReturnDays != null && ` Après ${nonReturnDays} jours sans retour, le total non-retour prévu par le snapshot est ${formatCents(pricing.unreturned_fee_cents, pricing.currency)}.`}
        </div>
      )}
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof WalletCards; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
      <Icon className="h-5 w-5 text-emerald-300" />
      <p className="mt-3 text-xs uppercase tracking-[.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}
