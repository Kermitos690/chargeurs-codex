import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BatteryCharging,
  CircleDollarSign,
  HelpCircle,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCustomer } from "@/hooks/useCustomer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_RENTAL_STATES,
  CustomerPayment,
  CustomerRental,
  fetchCustomerPayments,
  fetchCustomerRentals,
  formatAccountDate,
  formatAccountMoney,
  rentalStateLabel,
} from "./accountData";

type State = {
  loading: boolean;
  error: boolean;
  rentals: CustomerRental[];
  payments: CustomerPayment[];
};

export default function AccountHome() {
  const { user } = useCustomer();
  const [state, setState] = useState<State>({ loading: true, error: false, rentals: [], payments: [] });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: false }));
    try {
      const [rentals, payments] = await Promise.all([fetchCustomerRentals(10), fetchCustomerPayments(10)]);
      setState({ loading: false, error: false, rentals, payments });
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
  const displayName = String(user?.user_metadata?.display_name || user?.email?.split("@")[0] || "bonjour");

  return (
    <div className="space-y-7 pt-3">
      <section className="glass-strong liquid-border overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><Sparkles className="h-3.5 w-3.5" />Espace client</span>
            <h1 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">Bonjour {displayName}</h1>
            <p className="mt-2 max-w-xl text-muted-foreground">Suivez vos locations, paiements et demandes d'assistance depuis un espace protégé par votre compte.</p>
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
          <section className="grid gap-3 sm:grid-cols-3">
            <article className="glass rounded-2xl p-5"><BatteryCharging className="h-6 w-6 text-primary" /><p className="mt-4 text-sm text-muted-foreground">Location active</p><p className="mt-1 text-2xl font-extrabold">{active ? "1" : "0"}</p></article>
            <article className="glass rounded-2xl p-5"><MapPin className="h-6 w-6 text-secondary" /><p className="mt-4 text-sm text-muted-foreground">Locations récentes</p><p className="mt-1 text-2xl font-extrabold">{state.rentals.length}</p></article>
            <article className="glass rounded-2xl p-5"><CircleDollarSign className="h-6 w-6 text-success" /><p className="mt-4 text-sm text-muted-foreground">Paiements récents</p><p className="mt-1 text-2xl font-extrabold">{formatAccountMoney(settledTotal, "CHF")}</p></article>
          </section>

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
              <BatteryCharging className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 font-display text-xl font-bold">Aucune location en cours</h2>
              <p className="mt-1 text-sm text-muted-foreground">Trouvez une borne disponible pour louer votre prochaine batterie.</p>
              <Button asChild className="mt-5 rounded-full bg-gradient-primary"><Link to="/?section=bornes">Trouver une borne</Link></Button>
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
