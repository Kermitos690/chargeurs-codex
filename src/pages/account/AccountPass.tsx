import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Bell,
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
  CustomerRentalCredit,
  CustomerWalletNotification,
  CustomerWalletPass,
  fetchPrivateAccountSummary,
  fetchWalletNotificationHistory,
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
  rentalCredit: CustomerRentalCredit;
  walletNotifications: CustomerWalletNotification[];
};

type ManageAction = "portal" | "cancel_at_period_end" | "resume";
type WalletAction = "issue" | "sync";

const initial: State = {
  loading: true,
  error: false,
  membership: null,
  walletPass: null,
  chargePoints: { balance: 0, lastActivityAt: null },
  rentalCredit: { balanceCents: 0, currency: "CHF", nextExpiryAt: null, lastActivityAt: null },
  walletNotifications: [],
};

const PILOT_MEMBER_RATE_LABEL = "2 CHF jusqu’à 2 h · puis +1 CHF / h commencée";

export default function AccountPass() {
  const [state, setState] = useState<State>(initial);
  const [walletHistoryError, setWalletHistoryError] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [managementAction, setManagementAction] = useState<ManageAction | null>(null);
  const [managementMessage, setManagementMessage] = useState<string | null>(null);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [walletAction, setWalletAction] = useState<WalletAction | null>(null);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const membershipReturn = useMemo(() => new URLSearchParams(window.location.search).get("membership"), []);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    setWalletHistoryError(false);
    try {
      const [summaryResult, historyResult] = await Promise.allSettled([
        fetchPrivateAccountSummary(),
        fetchWalletNotificationHistory(10),
      ]);
      if (summaryResult.status !== "fulfilled") throw summaryResult.reason;
      const summary = summaryResult.value;
      const walletNotifications = historyResult.status === "fulfilled" ? historyResult.value : [];
      setWalletHistoryError(historyResult.status === "rejected");
      setState({
        loading: false,
        error: false,
        membership: summary.membership,
        walletPass: summary.walletPass,
        chargePoints: summary.chargePoints,
        rentalCredit: summary.rentalCredit,
        walletNotifications,
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
    ? "Pass Wallet prêt"
    : providerStatus === "pending"
      ? "Émission en cours"
      : providerStatus === "update_pending"
        ? "Mise à jour en cours"
        : providerStatus === "error"
          ? "À resynchroniser"
          : providerStatus === "revoked"
            ? "Pass révoqué"
            : "Prêt à être ajouté";

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

  const addToWallet = async () => {
    if (!membershipActive || walletAction) return;
    const action: WalletAction = providerStatus === "issued" ? "sync" : "issue";
    setWalletAction(action);
    setWalletError(null);
    setWalletMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("account-privacy", {
        body: { action: "wallet_pass", walletAction: action },
      });
      if (error || !data?.ok) throw new Error(String(data?.error ?? "WALLET_PASS_UNAVAILABLE"));
      const addToWalletUrl = String(data.addToWalletUrl ?? "");
      if (!/^https:\/\/www\.passstudio\.online\/i\//i.test(addToWalletUrl)) throw new Error("WALLET_URL_INVALID");
      setWalletMessage(action === "sync"
        ? (data.status === "current" ? "Pass ouvert. Sa synchronisation fournisseur est désactivée pendant le pilote." : "Pass synchronisé. Ouverture du Wallet…")
        : "Pass créé. Ouverture du Wallet…");
      await load();
      window.location.assign(addToWalletUrl);
    } catch {
      setWalletError("Le Pass Wallet n’a pas pu être ouvert pour le moment. Votre adhésion Chargeurs+ reste inchangée.");
    } finally {
      setWalletAction(null);
    }
  };

  if (state.loading) return <div className="glass mt-6 grid min-h-[50vh] place-items-center rounded-3xl"><Loader2 className="h-9 w-9 animate-spin text-primary" /></div>;

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
      {membershipReturn === "success" && <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">Paiement d’adhésion reçu par Stripe. Le statut ci-dessous est mis à jour uniquement après confirmation du webhook signé.</div>}
      {membershipReturn === "cancelled" && <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">Souscription interrompue. Aucune adhésion n’est affichée comme active sans confirmation Stripe.</div>}
      {cancellationScheduled && <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">Renouvellement désactivé. Votre adhésion et vos avantages restent actifs jusqu’au {periodEnd ? formatAccountDate(periodEnd) : "terme de la période en cours"}.</div>}
      {managementMessage && <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success">{managementMessage}</div>}
      {managementError && <div className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{managementError}</div>}
      {walletMessage && <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success">{walletMessage}</div>}
      {walletError && <div className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{walletError}</div>}

      <section className="overflow-hidden rounded-[2rem] border border-violet-300/20 bg-[radial-gradient(circle_at_20%_10%,rgba(168,85,247,.22),transparent_35%),linear-gradient(145deg,rgba(9,6,20,.98),rgba(3,7,16,.98))] p-6 shadow-[0_30px_80px_rgba(0,0,0,.45)] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-[.16em] text-violet-200"><WalletCards className="h-4 w-4" /> Chargeurs+ Pass</div>
            <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-5xl">{plan?.name ?? "Votre Pass Chargeurs.ch"}</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">{membershipActive ? "Votre adhésion est liée à ce compte. Les avantages affichés ci-dessous proviennent du backend Chargeurs.ch." : "Aucune adhésion active n’est actuellement liée à ce compte. Le Checkout utilise automatiquement le plan actif configuré côté serveur."}</p>
            {!membershipActive ? (
              <div className="mt-5">
                <Button onClick={() => void subscribe()} disabled={subscribing} className="rounded-full bg-violet-500 px-6 font-bold text-white hover:bg-violet-400">{subscribing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WalletCards className="mr-2 h-4 w-4" />}{state.membership?.status === "pending" ? "Reprendre la souscription" : "Devenir Client Chargeurs"}</Button>
                {subscribeError && <p className="mt-3 max-w-xl text-sm text-destructive">{subscribeError}</p>}
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-full" onClick={() => void manage("portal")} disabled={Boolean(managementAction)}>{managementAction === "portal" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}Gérer le paiement</Button>
                {cancellationScheduled ? (
                  <Button variant="outline" className="rounded-full border-success/30 text-success" onClick={() => void manage("resume")} disabled={Boolean(managementAction)}>{managementAction === "resume" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Reprendre le renouvellement</Button>
                ) : (
                  <Button variant="ghost" className="rounded-full text-muted-foreground" onClick={() => void manage("cancel_at_period_end")} disabled={Boolean(managementAction)}>{managementAction === "cancel_at_period_end" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}Arrêter au renouvellement</Button>
                )}
              </div>
            )}
          </div>
          <Button variant="outline" className="rounded-full" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Info icon={CircleDollarSign} label="Tarif membre pilote" value={PILOT_MEMBER_RATE_LABEL} />
              <Info icon={CalendarClock} label="Plafond journalier" value="5.90 CHF / 24 h" />
              <Info icon={Gem} label="ChargePoints" value={state.chargePoints.balance.toLocaleString("fr-CH")} />
              <Info icon={CheckCircle2} label="Statut adhésion" value={state.membership?.status ?? "Aucune"} />
              <Info icon={WalletCards} label="Solde prépayé disponible" value={formatCents(state.rentalCredit.balanceCents, state.rentalCredit.currency)} />
              {plan?.renewal_credit_cents ? <Info icon={CircleDollarSign} label="Crédit attribué par période" value={formatCents(plan.renewal_credit_cents, plan.currency)} /> : null}
              <Info icon={CalendarClock} label={cancellationScheduled ? "Fin de l’adhésion" : "Prochaine échéance"} value={cancellationScheduled ? (periodEnd ? formatAccountDate(periodEnd) : "—") : (state.membership?.renews_at ? formatAccountDate(state.membership.renews_at) : "—")} />
            </div>
            <p className="mt-5 max-w-2xl text-sm text-muted-foreground">Le prix faisant foi reste le snapshot affiché avant chaque location. Pour une location membre v3, si au moins 30 CHF sont disponibles, le backend peut réserver 30 CHF dans le solde prépayé sans créer une seconde garantie Stripe ; au retour, seul le prix réel est consommé et le reste est libéré. Si le solde est insuffisant, le parcours de garantie Stripe complet reste séparé.</p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[.045] p-5 text-center">
            {qrUrl ? <div className="mx-auto w-fit rounded-2xl bg-white p-3"><QRCodeSVG value={qrUrl} size={220} level="M" includeMargin={false} /></div> : <div className="mx-auto grid h-[244px] w-[244px] place-items-center rounded-2xl border border-dashed border-white/15 bg-black/20"><WalletCards className="h-14 w-14 text-white/30" /></div>}
            <p className="mt-4 text-sm font-bold">QR du Pass</p>
            <p className="mt-1 text-xs text-muted-foreground">Identifiant opaque. Le scan redirige vers l’authentification et ne donne jamais accès au compte à lui seul.</p>
          </div>
        </div>
      </section>

      <section id="historique-wallet" className="glass rounded-3xl p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-violet-500/10 p-2.5 text-violet-300"><Bell className="h-6 w-6" /></div>
            <div>
              <h2 className="font-display text-xl font-bold">Historique Wallet</h2>
              <p className="mt-1 text-sm text-muted-foreground">Les 10 dernières notifications Wallet livrées, du plus récent au plus ancien.</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
        </div>

        {walletHistoryError ? (
          <div className="mt-5 rounded-2xl border border-warning/25 bg-warning/10 p-4 text-sm text-warning">L’historique Wallet n’a pas pu être chargé. Les notifications restent conservées côté Chargeurs.ch ; réessayez dans un instant.</div>
        ) : state.walletNotifications.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">Aucune notification Wallet pour le moment.</div>
        ) : (
          <div className="mt-5 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-background/25">
            {state.walletNotifications.map((notification) => (
              <article key={notification.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{notification.title}</h3>
                  <time className="text-xs text-muted-foreground" dateTime={notification.delivered_at ?? notification.created_at}>{formatAccountDate(notification.delivered_at ?? notification.created_at)}</time>
                </div>
                {notification.message ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{notification.message}</p> : null}
              </article>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">Cette liste est un affichage récent. L’historique technique complet reste conservé côté Chargeurs.ch et n’est pas supprimé lorsque de nouvelles notifications arrivent.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="glass rounded-3xl p-6">
          <div className="flex items-center gap-3"><Smartphone className="h-7 w-7 text-primary" /><h2 className="font-display text-xl font-bold">Apple Wallet / Google Wallet</h2></div>
          <p className="mt-3 text-lg font-semibold">{providerLabel}</p>
          <p className="mt-2 text-sm text-muted-foreground">{membershipActive ? `Votre Pass est relié au solde Chargeurs+ actuel (${formatCents(state.rentalCredit.balanceCents, state.rentalCredit.currency)}). Son ouverture reste disponible ; les synchronisations fournisseur automatiques sont désactivées pendant le pilote.` : "Le bouton Wallet devient disponible dès que votre adhésion Chargeurs+ est active."}</p>
          <Button className="mt-5 w-full rounded-2xl bg-black py-6 text-base font-bold text-white hover:bg-black/85" disabled={!membershipActive || Boolean(walletAction)} onClick={() => void addToWallet()}>
            {walletAction ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <WalletCards className="mr-2 h-5 w-5" />}
            {providerStatus === "issued" ? "Ouvrir mon Wallet" : "Ajouter à Apple / Google Wallet"}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">Le lien d’ajout Pass Studio est généré côté serveur et n’expose aucune clé fournisseur.</p>
          {state.walletPass ? <p className="mt-3 text-xs text-muted-foreground">Révision {state.walletPass.pass_revision} · version token {state.walletPass.token_version}</p> : null}
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
