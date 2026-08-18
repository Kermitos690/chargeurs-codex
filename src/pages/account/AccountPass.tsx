import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  Gem,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  WalletCards,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  CustomerChargePoints,
  CustomerMembership,
  CustomerWalletPass,
  fetchPrivateAccountSummary,
  formatAccountDate,
  formatCents,
  membershipPlan,
} from "./accountData";

type State = {
  loading: boolean;
  error: boolean;
  membership: CustomerMembership | null;
  walletPass: CustomerWalletPass | null;
  chargePoints: CustomerChargePoints;
};

type ManageAction = "portal" | "cancel_at_period_end" | "resume";

const initial: State = {
  loading: true,
  error: false,
  membership: null,
  walletPass: null,
  chargePoints: { balance: 0, lastActivityAt: null },
};

export default function AccountPass() {
  const [state, setState] = useState<State>(initial);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [managementAction, setManagementAction] = useState<ManageAction | null>(null);
  const [managementMessage, setManagementMessage] = useState<string | null>(null);
  const [managementError, setManagementError] = useState<string | null>(null);
  const membershipReturn = useMemo(() => new URLSearchParams(window.location.search).get("membership"), []);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const summary = await fetchPrivateAccountSummary();
      setState({
        loading: false,
        error: false,
        membership: summary.membership,
        walletPass: summary.walletPass,
        chargePoints: summary.chargePoints,
      });
    } catch {
      setState((s) => ({ ...s, loading: false, error: true }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const plan = membershipPlan(state.membership);
  const membershipActive = Boolean(state.membership && ["active", "trialing"].includes(state.membership.status));
  const cancellationScheduled = Boolean(membershipActive && state.membership?.cancel_at_period_end);
  const periodEnd = state.membership?.stripe_current_period_end ?? state.membership?.ends_at ?? null;
  const qrUrl = useMemo(() => {
    if (!state.walletPass?.public_pass_id) return "";
    const url = new URL("/compte/login", window.location.origin);
    url.searchParams.set("pass_ref", state.walletPass.public_pass_id);
    return url.toString();
  }, [state.walletPass?.public_pass_id]);

  const providerStatus = state.walletPass?.provider_status ?? "not_issued";
  const providerLabel = providerStatus === "issued"
    ? "Émis"
    : providerStatus === "pending"
      ? "Émission en cours"
      : providerStatus === "update_pending"
        ? "Mise à jour en cours"
        : providerStatus === "error"
          ? "À vérifier"
          : providerStatus === "revoked"
            ? "Révoqué"
            : "Émission Wallet non activée";

  const subscribe = async () => {
    if (subscribing) return;
    setSubscribing(true);
    setSubscribeError(null);
    try {
      const { data, error } = await supabase.functions.invoke("customer-membership-checkout", { body: {} });
      if (error || !data?.ok) throw new Error(String(data?.error ?? "MEMBERSHIP_CHECKOUT_UNAVAILABLE"));
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
      setSubscribeError("Le démarrage de l’adhésion est momentanément indisponible. Aucun paiement n’a été confirmé depuis cette page.");
    } finally {
      setSubscribing(false);
    }
  };

  const manage = async (action: ManageAction) => {
    if (managementAction) return;
    if (action === "cancel_at_period_end") {
      const confirmed = window.confirm("Programmer l’arrêt de l’adhésion à la fin de la période déjà payée ? Vos avantages resteront actifs jusque-là.");
      if (!confirmed) return;
    }
    setManagementAction(action);
    setManagementError(null);
    setManagementMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("customer-membership-manage", { body: { action } });
      if (error || !data?.ok) throw new Error(String(data?.error ?? "MEMBERSHIP_MANAGE_UNAVAILABLE"));
      if (action === "portal" && data.portalUrl) {
        window.location.assign(String(data.portalUrl));
        return;
      }
      if (action === "cancel_at_period_end") {
        setManagementMessage(data.periodEnd
          ? `L’arrêt est programmé pour le ${formatAccountDate(String(data.periodEnd))}. Les avantages restent actifs jusqu’à cette date.`
          : "L’arrêt à la fin de la période a été programmé.");
      } else if (action === "resume") {
        setManagementMessage("Le renouvellement automatique est de nouveau actif.");
      }
      await load();
    } catch {
      setManagementError("La modification de l’adhésion n’a pas pu être confirmée. Aucun changement n’est présenté comme effectué.");
    } finally {
      setManagementAction(null);
    }
  };

  if (state.loading) {
    return <div className="glass mt-6 grid min-h-[50vh] place-items-center rounded-3xl"><Loader2 className="h-9 w-9 animate-spin text-primary" /></div>;
  }

  if (state.error) {
    return (
      <section className="mt-6 rounded-3xl border border-warning/30 bg-warning/10 p-6">
        <h1 className="font-display text-2xl font-bold">Chargeurs+ Pass indisponible</h1>
        <p className="mt-2 text-muted-foreground">Les données du Pass ne sont pas accessibles pour le moment.</p>
        <Button className="mt-5 rounded-full" variant="outline" onClick={() => void load()}>Réessayer</Button>
      </section>
    );
  }

  return (
    <div className="space-y-6 pt-6">
      {membershipReturn === "success" && (
        <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
          Paiement d’adhésion reçu par Stripe. Le statut ci-dessous est mis à jour uniquement après confirmation du webhook signé.
        </div>
      )}
      {membershipReturn === "cancelled" && (
        <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          Souscription interrompue. Aucune adhésion n’est affichée comme active sans confirmation Stripe.
        </div>
      )}
      {cancellationScheduled && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          Renouvellement désactivé. Votre adhésion et vos avantages restent actifs jusqu’au {periodEnd ? formatAccountDate(periodEnd) : "terme de la période en cours"}.
        </div>
      )}
      {managementMessage && <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success">{managementMessage}</div>}
      {managementError && <div className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{managementError}</div>}

      <section className="overflow-hidden rounded-[2rem] border border-violet-300/20 bg-[radial-gradient(circle_at_20%_10%,rgba(168,85,247,.22),transparent_35%),linear-gradient(145deg,rgba(9,6,20,.98),rgba(3,7,16,.98))] p-6 shadow-[0_30px_80px_rgba(0,0,0,.45)] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-[.16em] text-violet-200">
              <WalletCards className="h-4 w-4" /> Chargeurs+ Pass
            </div>
            <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-5xl">{plan?.name ?? "Votre Pass Chargeurs.ch"}</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              {membershipActive
                ? "Votre adhésion est liée à ce compte. Les avantages affichés ci-dessous proviennent du backend Chargeurs.ch."
                : "Aucune adhésion active n’est actuellement liée à ce compte. Le Checkout utilise automatiquement le plan actif configuré côté serveur."}
            </p>
            {!membershipActive ? (
              <div className="mt-5">
                <Button onClick={() => void subscribe()} disabled={subscribing} className="rounded-full bg-violet-500 px-6 font-bold text-white hover:bg-violet-400">
                  {subscribing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WalletCards className="mr-2 h-4 w-4" />}
                  {state.membership?.status === "pending" ? "Reprendre la souscription" : "Devenir Client Chargeurs"}
                </Button>
                {subscribeError && <p className="mt-3 max-w-xl text-sm text-destructive">{subscribeError}</p>}
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-full" onClick={() => void manage("portal")} disabled={Boolean(managementAction)}>
                  {managementAction === "portal" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}Gérer le paiement
                </Button>
                {cancellationScheduled ? (
                  <Button variant="outline" className="rounded-full border-success/30 text-success" onClick={() => void manage("resume")} disabled={Boolean(managementAction)}>
                    {managementAction === "resume" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Reprendre le renouvellement
                  </Button>
                ) : (
                  <Button variant="ghost" className="rounded-full text-muted-foreground" onClick={() => void manage("cancel_at_period_end")} disabled={Boolean(managementAction)}>
                    {managementAction === "cancel_at_period_end" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}Arrêter au renouvellement
                  </Button>
                )}
              </div>
            )}
          </div>
          <Button variant="outline" className="rounded-full" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <Info icon={CircleDollarSign} label="Tarif membre" value={plan ? `${formatCents(plan.hourly_cents, plan.currency)} / h` : "—"} />
            <Info icon={CalendarClock} label="Plafond journalier" value={plan ? `${formatCents(plan.daily_cap_cents, plan.currency)} / jour` : "—"} />
            <Info icon={Gem} label="ChargePoints" value={state.chargePoints.balance.toLocaleString("fr-CH")} />
            <Info icon={CheckCircle2} label="Statut adhésion" value={state.membership?.status ?? "Aucune"} />
            {plan?.renewal_credit_cents ? <Info icon={CircleDollarSign} label="Crédit adhésion / renouvellement" value={formatCents(plan.renewal_credit_cents, plan.currency)} /> : null}
            <Info
              icon={CalendarClock}
              label={cancellationScheduled ? "Fin de l’adhésion" : "Prochaine échéance"}
              value={cancellationScheduled
                ? (periodEnd ? formatAccountDate(periodEnd) : "—")
                : (state.membership?.renews_at ? formatAccountDate(state.membership.renews_at) : "—")}
            />
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[.045] p-5 text-center">
            {qrUrl ? (
              <div className="mx-auto w-fit rounded-2xl bg-white p-3"><QRCodeSVG value={qrUrl} size={220} level="M" includeMargin={false} /></div>
            ) : (
              <div className="mx-auto grid h-[244px] w-[244px] place-items-center rounded-2xl border border-dashed border-white/15 bg-black/20"><WalletCards className="h-14 w-14 text-white/30" /></div>
            )}
            <p className="mt-4 text-sm font-bold">QR du Pass</p>
            <p className="mt-1 text-xs text-muted-foreground">Identifiant opaque. Le scan redirige vers l’authentification et ne donne jamais accès au compte à lui seul.</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="glass rounded-3xl p-6">
          <div className="flex items-center gap-3"><Smartphone className="h-7 w-7 text-primary" /><h2 className="font-display text-xl font-bold">Apple Wallet / Google Wallet</h2></div>
          <p className="mt-3 text-lg font-semibold">{providerLabel}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {providerStatus === "issued"
              ? "Le backend indique qu’un pass Apple Wallet a été émis pour ce compte."
              : "Le Wallet Sandbox vérifie la configuration Apple avant toute émission et refuse tout faux succès si un certificat manque."}
          </p>
          {state.walletPass ? <p className="mt-4 text-xs text-muted-foreground">Révision {state.walletPass.pass_revision} · version token {state.walletPass.token_version}</p> : null}
          <Button asChild variant="outline" className="mt-4 rounded-full">
            <Link to="/compte/wallet-test"><WalletCards className="mr-2 h-4 w-4" />Tester Apple Wallet</Link>
          </Button>
        </article>

        <article className="glass rounded-3xl p-6">
          <div className="flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-success" /><h2 className="font-display text-xl font-bold">Sécurité du Pass</h2></div>
          <p className="mt-3 text-sm text-muted-foreground">Le Pass ne contient pas de donnée personnelle brute dans son QR. Les autorisations de compte restent gérées par l’authentification Chargeurs.ch.</p>
          <p className="mt-3 text-sm text-muted-foreground">Un Pass peut être versionné, synchronisé ou révoqué côté serveur sans changer les données d’une location déjà terminée.</p>
        </article>
      </section>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof WalletCards; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[.035] p-4">
      <Icon className="h-5 w-5 text-violet-300" />
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-extrabold">{value}</p>
    </div>
  );
}