import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BatteryCharging,
  CircleDollarSign,
  Gem,
  HelpCircle,
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { useCustomer } from "@/hooks/useCustomer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_RENTAL_STATES,
  CustomerChargePoints,
  CustomerMembership,
  CustomerPayment,
  CustomerRental,
  CustomerWalletPass,
  fetchPrivateAccountSummary,
  formatAccountDate,
  formatAccountMoney,
  formatCents,
  membershipPlan,
  rentalStateLabel,
} from "./accountData";

type State = {
  loading: boolean;
  error: boolean;
  rentals: CustomerRental[];
  payments: CustomerPayment[];
  membership: CustomerMembership | null;
  walletPass: CustomerWalletPass | null;
  chargePoints: CustomerChargePoints;
};

const initialState: State = {
  loading: true,
  error: false,
  rentals: [],
  payments: [],
  membership: null,
  walletPass: null,
  chargePoints: { balance: 0, lastActivityAt: null },
};

export default function AccountHome() {
  const { user } = useCustomer();
  const [state, setState] = useState<State>(initialState);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    try {
      const summary = await fetchPrivateAccountSummary();
      setState({
        loading: false,
        error: false,
        rentals: summary.rentals.slice(0, 10),
        payments: summary.payments.slice(0, 10),
        membership: summary.membership,
        walletPass: summary.walletPass,
        chargePoints: summary.chargePoints,
      });
    } catch {
      setState((current) => ({ ...current, loading: false, error: true }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(
    () => state.rentals.find((rental) => ACTIVE_RENTAL_STATES.has(rental.state)),
    [state.rentals],
  );
  const settledTotal = useMemo(
    () => state.payments
      .filter((payment) => payment.status === "succeeded" || payment.status === "paid")
      .reduce((total, payment) => total + Number(payment.amount ?? 0), 0),
    [state.payments],
  );
  const plan = membershipPlan(state.membership);
  const membershipActive = Boolean(state.membership && ["active", "trialing"].includes(state.membership.status));
  const displayName = String(user?.user_metadata?.display_name || user?.email?.split("@")[0] || "bonjour");
  const passStatus = state.walletPass?.provider_status === "issued"
    ? "Actif"
    : state.walletPass?.provider_status === "pending" || state.walletPass?.provider_status === "update_pending"
      ? "Mise à jour en cours"
      : state.walletPass?.provider_status === "error"
        ? "À vérifier"
        : state.walletPass?.provider_status === "revoked"
          ? "Révoqué"
          : "Non émis";

  return (
    <div className="space-y-7 pt-3">
      <section className="glass-strong liquid-border overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${membershipActive ? "border-success/25 bg-success/10 text-success" : "border-primary/25 bg-primary/10 text-primary"}`}>
              <Sparkles className="h-3.5 w-3.5" />{membershipActive ? (plan?.name ?? "Client Chargeurs") : "Compte Chargeurs.ch"}
            </span>
            <h1 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">Bonjour {displayName}</h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              {membershipActive
                ? "Connectez votre compte à une borne pour appliquer automatiquement vos avantages membres."
                : "Scannez une borne depuis votre compte pour poursuivre votre location sur votre téléphone."}
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{membershipActive ? "Votre tarif" : "Statut"}</p>
                <p className="font-display text-3xl font-extrabold text-success">
                  {membershipActive && plan ? `${formatCents(plan.hourly_cents, plan.currency)} / h` : "Compte prêt"}
                </p>
                {membershipActive && plan?.daily_cap_cents ? <p className="mt-1 text-sm text-muted-foreground">Plafond {formatCents(plan.daily_cap_cents, plan.currency)} / jour</p> : null}
              </div>
              <Button asChild className="rounded-full bg-gradient-success px-6 py-5 font-bold text-success-foreground"><Link to="/compte/scanner"><QrCode className="mr-2 h-5 w-5" />Scanner une borne</Link></Button>
            </div>
          </div>
          <Button variant="outline" size="sm" className="self-start rounded-full" onClick={() => void load()} disabled={state.loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${state.loading ? "animate-spin" : ""}`} />Actualiser
          </Button>
        </div>
      </section>

      {state.loading && (
        <div className="glass grid min-h-48 place-items-center rounded-3xl" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {!state.loading && state.error && (
        <section className="rounded-3xl border border-warning/30 bg-warning/10 p-6" role="alert">
          <h2 className="font-semibold text-warning">Vos données sont momentanément indisponibles</h2>
          <p className="mt-1 text-sm text-muted-foreground">Aucune donnée fictive n'est affichée. Réessayez dans quelques instants.</p>
          <Button variant="outline" size="sm" className="mt-4 rounded-full" onClick={() => void load()}>Réessayer</Button>
        </section>
      )}

      {!state.loading && !state.error && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="glass rounded-2xl p-5"><BatteryCharging className="h-6 w-6 text-primary" /><p className="mt-4 text-sm text-muted-foreground">Location active</p><p className="mt-1 text-2xl font-extrabold">{active ? "1" : "0"}</p></article>
            <article className="glass rounded-2xl p-5"><CircleDollarSign className="h-6 w-6 text-success" /><p className="mt-4 text-sm text-muted-foreground">Paiements récents</p><p className="mt-1 text-2xl font-extrabold">{formatAccountMoney(settledTotal, "CHF")}</p></article>
            <article className="glass rounded-2xl p-5"><Gem className="h-6 w-6 text-violet-400" /><p className="mt-4 text-sm text-muted-foreground">ChargePoints</p><p className="mt-1 text-2xl font-extrabold">{state.chargePoints.balance.toLocaleString("fr-CH")}</p><p className="mt-1 text-xs text-muted-foreground">Aucun barème n’est appliqué tant qu’une règle n’est pas activée.</p></article>
            <article className="glass rounded-2xl p-5"><WalletCards className="h-6 w-6 text-secondary" /><p className="mt-4 text-sm text-muted-foreground">Chargeurs+ Pass</p><p className="mt-1 text-2xl font-extrabold">{passStatus}</p><p className="mt-1 text-xs text-muted-foreground">{state.walletPass ? `Révision ${state.walletPass.pass_revision}` : "Aucun pass associé"}</p></article>
          </section>

          {membershipActive && plan && (
            <section className="glass-strong rounded-3xl border border-violet-400/15 p-6">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <Badge className="bg-violet-600">{plan.name}</Badge>
                  <h2 className="mt-3 font-display text-2xl font-bold">Vos avantages actuels</h2>
                  <p className="mt-2 text-muted-foreground">{formatCents(plan.hourly_cents, plan.currency)} / h · plafond {formatCents(plan.daily_cap_cents, plan.currency)} / jour</p>
                  {plan.renewal_credit_cents > 0 && <p className="mt-1 text-sm text-muted-foreground">Crédit adhésion / renouvellement : {formatCents(plan.renewal_credit_cents, plan.currency)}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prochaine échéance</p>
                  <p className="mt-1 font-bold">{state.membership?.renews_at ? formatAccountDate(state.membership.renews_at) : "—"}</p>
                </div>
              </div>
            </section>
          )}

          {active ? (
            <section className="glass-strong liquid-border rounded-3xl p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Badge className="bg-gradient-primary">En cours</Badge>
                  <h2 className="mt-3 font-display text-2xl font-bold">{rentalStateLabel(active.state)}</h2>
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-4 w-4" />Borne {active.station_id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Démarrée le {formatAccountDate(active.ejected_at ?? active.paid_at ?? active.created_at)}</p>
                </div>
                <p className="text-xl font-extrabold text-gradient">{formatAccountMoney(active.amount_paid ?? active.amount_expected, active.currency)}</p>
              </div>
              <Button asChild variant="outline" className="mt-5 rounded-full"><Link to="/compte/locations">Voir la location<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            </section>
          ) : (
            <section className="glass rounded-3xl p-7 text-center">
              <QrCode className="mx-auto h-10 w-10 text-success" />
              <h2 className="mt-3 font-display text-xl font-bold">Prêt à louer ?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Sur la borne, choisissez votre parcours puis scannez le QR depuis votre téléphone.</p>
              <Button asChild className="mt-5 rounded-full bg-gradient-success text-success-foreground"><Link to="/compte/scanner">Scanner une borne</Link></Button>
            </section>
          )}
        </>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <Link to="/compte/paiements" className="glass group rounded-2xl p-5 transition-transform hover:-translate-y-0.5">
          <CircleDollarSign className="h-6 w-6 text-success" />
          <h2 className="mt-3 font-semibold">Paiements et remboursements</h2>
          <p className="mt-1 text-sm text-muted-foreground">Consultez les transactions reliées à vos locations.</p>
          <span className="mt-4 inline-flex items-center text-sm font-semibold text-primary">Consulter<ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
        </Link>
        <Link to="/compte/support" className="glass group rounded-2xl p-5 transition-transform hover:-translate-y-0.5">
          <HelpCircle className="h-6 w-6 text-secondary" />
          <h2 className="mt-3 font-semibold">Besoin d'aide ?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ouvrez une demande liée à une borne ou une location.</p>
          <span className="mt-4 inline-flex items-center text-sm font-semibold text-primary">Contacter le support<ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
        </Link>
      </section>
    </div>
  );
}
