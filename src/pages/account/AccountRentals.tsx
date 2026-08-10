import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BatteryCharging, HelpCircle, Loader2, MapPin, Receipt, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_RENTAL_STATES,
  CustomerRental,
  fetchCustomerRentals,
  formatAccountDate,
  formatAccountMoney,
  rentalStateLabel,
} from "./accountData";

function RentalCard({ rental, active }: { rental: CustomerRental; active: boolean }) {
  return (
    <article className={`${active ? "glass-strong liquid-border" : "glass"} rounded-2xl p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {active ? <BatteryCharging className="h-5 w-5 text-primary" /> : <Receipt className="h-5 w-5 text-muted-foreground" />}
            <h3 className="font-semibold">{rentalStateLabel(rental.state)}</h3>
            {active && <Badge className="bg-gradient-primary">En cours</Badge>}
          </div>
          <Link to={`/bornes/${encodeURIComponent(rental.station_id)}`} className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary">
            <MapPin className="h-4 w-4" /> Borne {rental.station_id}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">{formatAccountDate(rental.ejected_at ?? rental.paid_at ?? rental.created_at)}</p>
        </div>
        <p className="font-bold">{formatAccountMoney(rental.amount_paid ?? rental.amount_expected, rental.currency)}</p>
      </div>
      {(rental.returned_at || rental.closed_at || rental.completed_at) && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          {rental.returned_at ? `Restituée le ${formatAccountDate(rental.returned_at)}` : `Clôturée le ${formatAccountDate(rental.closed_at ?? rental.completed_at)}`}
        </p>
      )}
    </article>
  );
}

export default function AccountRentals() {
  const [rentals, setRentals] = useState<CustomerRental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setRentals(await fetchCustomerRentals());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(() => rentals.filter((rental) => ACTIVE_RENTAL_STATES.has(rental.state)), [rentals]);
  const history = useMemo(() => rentals.filter((rental) => !ACTIVE_RENTAL_STATES.has(rental.state)), [rentals]);

  return (
    <div className="space-y-7 pt-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Mes locations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Historique protégé par votre session et les règles d'accès de la plateforme.</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualiser
        </Button>
      </header>

      {loading && <div className="glass grid min-h-56 place-items-center rounded-3xl"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}

      {!loading && error && (
        <section className="rounded-3xl border border-warning/30 bg-warning/10 p-6" role="alert">
          <h2 className="font-semibold text-warning">Impossible de charger vos locations</h2>
          <p className="mt-1 text-sm text-muted-foreground">Aucune donnée de substitution n'est affichée.</p>
          <Button variant="outline" size="sm" className="mt-4 rounded-full" onClick={() => void load()}>Réessayer</Button>
        </section>
      )}

      {!loading && !error && rentals.length === 0 && (
        <section className="glass rounded-3xl p-9 text-center">
          <BatteryCharging className="mx-auto h-11 w-11 text-primary" />
          <h2 className="mt-4 font-display text-xl font-bold">Aucune location enregistrée</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Les locations associées à votre compte ou à votre adresse email vérifiée apparaîtront ici.</p>
          <Button asChild className="mt-5 rounded-full bg-gradient-primary"><Link to="/?section=bornes">Trouver une borne</Link></Button>
        </section>
      )}

      {!loading && !error && rentals.length > 0 && (
        <>
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">En cours</h2>
              {active.map((rental) => <RentalCard key={rental.id} rental={rental} active />)}
            </section>
          )}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Historique</h2>
            {history.length > 0
              ? history.map((rental) => <RentalCard key={rental.id} rental={rental} active={false} />)
              : <p className="rounded-2xl border border-border p-5 text-sm text-muted-foreground">Aucune location passée.</p>}
          </section>
        </>
      )}

      <section className="glass flex flex-col items-start justify-between gap-4 rounded-2xl p-5 sm:flex-row sm:items-center">
        <div><h2 className="font-semibold">Une location ne correspond pas à votre situation ?</h2><p className="mt-1 text-sm text-muted-foreground">Le support peut vérifier la borne, le paiement et les événements associés.</p></div>
        <Button asChild variant="outline" className="shrink-0 rounded-full"><Link to="/compte/support"><HelpCircle className="mr-2 h-4 w-4" />Support</Link></Button>
      </section>
    </div>
  );
}
